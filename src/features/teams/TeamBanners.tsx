import { useState } from 'preact/hooks';
import type { Controller } from '../grouped-view/controller';
import { useStore } from '../store';

const repos = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'repository' : 'repositories'}`;

/** Team repositories page banners (F12), only the ones that apply. Renders nothing on other pages. */
export function TeamBanners({ ctl }: { ctl: Controller }) {
  const t = ctl.teams;
  const tv = useStore(t.store);
  const [open, setOpen] = useState(false);
  const team = t.team;
  if (!team) return null;
  const b = t.banners();
  const org = ctl.store.get().org;
  return (
    <>
      {tv.accessError && (
        <div class="rg-banner rg-banner-warn" role="alert"><span class="rg-grow"><b>Could not read what {team} can access.</b> {tv.accessError}</span></div>
      )}
      {b && b.rows.length > 0 && (
        <div class="rg-banner" role="status" data-rg="sync-banner">
          <span class="rg-grow"><b>{repos(new Set(b.rows.map((r) => r.repo)).size)}</b> in groups tagged <code>{team}</code> don’t give it the access set in repo-groups.yml.</span>
          <button type="button" class="rg-btn" onClick={() => void t.openSync({ teams: [team] })}>Review &amp; sync</button>
        </div>
      )}
      {b && b.untagged.length > 0 && (
        <div class="rg-banner rg-banner-warn" role="status" data-rg="untagged-banner">
          <span class="rg-grow">
            <b>{repos(b.untagged.length)}</b> this team can access {b.untagged.length === 1 ? 'is' : 'are'} in groups not tagged for it. The extension never removes this access.
            {open && (
              <ul class="rg-untagged">
                {b.untagged.map((name) => <li key={name}><a href={`https://github.com/${org}/${name}`}>{name}</a></li>)}
              </ul>
            )}
          </span>
          <button type="button" class="rg-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide list' : 'Show list'}</button>
        </div>
      )}
    </>
  );
}
