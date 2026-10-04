import { useEffect, useState } from 'preact/hooks';
import { idbDelete, idbGet, idbSet } from '../../storage/idb';
import { Avatar } from '../../ui/Avatar';
import { Drawer } from '../../ui/Drawer';
import { Icon } from '../../ui/Icon';
import { LogoField, type LogoDraft } from '../logo-cropper/LogoField';

const key = (org: string) => `rootlogo:${org}`;

/**
 * Avatar of the top level (the org or personal account). Shows the custom image kept in this browser, otherwise
 * GitHub's own profile picture, otherwise the letter. The pencil opens an upload + crop drawer (same field as groups).
 */
export function RootAvatar({ org, name, canChange, fetchLink }: { org: string; name: string; canChange: boolean; fetchLink: (url: string) => Promise<string> }) {
  const [custom, setCustom] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LogoDraft>({ kind: 'keep' });

  useEffect(() => {
    idbGet<string>(key(org)).then((v) => setCustom(v ?? null), () => {});
  }, [org]);

  const save = async () => {
    try {
      if (draft.kind === 'png') {
        const url = `data:image/png;base64,${draft.png}`;
        await idbSet(key(org), url);
        setCustom(url);
      } else if (draft.kind === 'remove') {
        await idbDelete(key(org));
        setCustom(null);
      }
    } catch {
      /* storage unavailable: keep what is shown */
    }
    setOpen(false);
  };

  const avatar = <Avatar name={name} label={name} cls="rg-big-av" root logo={custom ?? `https://github.com/${encodeURIComponent(org)}.png?size=112`} />;
  if (!canChange) return avatar;
  return (
    <>
      <button type="button" class="rg-big-av-btn" aria-label={`Change the picture of ${org}`} title="Change the picture" onClick={() => (setDraft({ kind: 'keep' }), setOpen(true))}>
        {avatar}
        <span class="rg-pen"><Icon name="pencil" size={12} /></span>
      </button>
      {open && (
        <Drawer
          title={`Picture of ${org}`}
          titleId="rg-root-logo-title"
          onClose={() => setOpen(false)}
          focus="#rg-logo-upload"
          footer={
            <>
              <span class="rg-grow">Saved in this browser only. GitHub's own profile picture does not change.</span>
              <button type="button" class="rg-btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" class="rg-btn rg-btn-primary" disabled={draft.kind === 'keep'} onClick={() => void save()}>Save</button>
            </>
          }
        >
          <LogoField name={name} label={name} current={custom} hasLogo={!!custom} draft={draft} onChange={setDraft} fetchLink={fetchLink} />
        </Drawer>
      )}
    </>
  );
}
