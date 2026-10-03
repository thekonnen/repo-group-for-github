import { useEffect, useRef, useState } from 'preact/hooks';
import { dataUrlToBase64, ERR_UNREADABLE, parseLogoUrl, validateLogoFile } from '../../core/logo';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { LogoCropper } from './LogoCropper';

/** What the person chose for the logo while the drawer is open. Nothing is sent until Save. */
export type LogoDraft = { kind: 'keep' } | { kind: 'png'; png: string } | { kind: 'remove' };

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('read'));
    fr.readAsDataURL(file);
  });

/**
 * Logo field of the group drawer (F7): upload, drop, paste or link, then crop. `current` is the data URL of the logo the
 * group has today (null: none or not loaded).
 */
export function LogoField({
  name,
  current,
  hasLogo,
  draft,
  onChange,
  fetchLink,
  autoFocus,
}: {
  name: string;
  current: string | null;
  hasLogo: boolean;
  draft: LogoDraft;
  onChange: (d: LogoDraft) => void;
  fetchLink: (url: string) => Promise<string>;
  autoFocus?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null); // image being cropped
  const [error, setError] = useState('');
  const [urlOpen, setUrlOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dropOn, setDropOn] = useState(false);
  const upload = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const shown = draft.kind === 'png' ? `data:image/png;base64,${draft.png}` : draft.kind === 'remove' ? null : current;
  const showsLogo = draft.kind === 'png' || (draft.kind === 'keep' && hasLogo);

  async function pick(file: File | null | undefined) {
    if (!file) return;
    const problem = validateLogoFile(file);
    if (problem) return setError(problem);
    try {
      const url = await readAsDataUrl(file);
      setError('');
      setUrlOpen(false);
      setSrc(url);
    } catch {
      setError('The file could not be read. Try choosing it again.');
    }
  }

  // Paste an image from the clipboard (text pastes into fields are left alone).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      void pick(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  /** The click handler sends the message right away: the permission prompt needs the user gesture. */
  function loadLink(raw: string) {
    const p = parseLogoUrl(raw);
    if ('error' in p) return setError(p.error);
    setLoading(true);
    setError('');
    fetchLink(p.url.href).then(
      (dataUrl) => {
        setUrlOpen(false);
        setSrc(dataUrl);
      },
      (e) => setError(e instanceof Error ? e.message : ERR_UNREADABLE),
    ).finally(() => setLoading(false));
  }

  return (
    <div class="rg-field">
      <label for="rg-logo-upload">Logo</label>
      <div
        class={`rg-logo-field${dropOn ? ' rg-drop-on' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setDropOn(true))}
        onDragLeave={() => setDropOn(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropOn(false);
          void pick(e.dataTransfer?.files?.[0]);
        }}
      >
        {shown ? <img class="rg-big-av rg-logo-img" src={shown} alt="Current logo" /> : <Avatar name={name || '?'} cls="rg-big-av" />}
        <div class="rg-stack">
          <div class="rg-y-tools">
            <button type="button" class="rg-btn" id="rg-logo-upload" ref={upload} data-autofocus={autoFocus ? '' : undefined} onClick={() => fileInput.current?.click()}>
              <Icon name="image" />Upload image
            </button>
            <button type="button" class="rg-btn" aria-expanded={urlOpen} onClick={() => setUrlOpen(!urlOpen)}>
              <Icon name="link" />Paste a link
            </button>
          </div>
          <span class="rg-hint">
            PNG, JPG, SVG or WebP up to 5 MB. You can also drop a file here or paste an image.
            {showsLogo && (
              <>
                {' '}
                <button type="button" class="rg-linkish" onClick={() => (setSrc(null), onChange({ kind: 'remove' }))}>Use the letter instead</button>
              </>
            )}
          </span>
          <input
            type="file"
            ref={fileInput}
            accept="image/*"
            hidden
            aria-label="Logo file"
            onChange={(e) => {
              const el = e.target as HTMLInputElement;
              void pick(el.files?.[0]);
              el.value = ''; // the same file can be chosen again
            }}
          />
        </div>
      </div>
      {urlOpen && (
        <div class="rg-add-rule">
          <input
            class="rg-input"
            id="rg-logo-url"
            type="url"
            placeholder="https://example.com/logo.png"
            autocomplete="off"
            aria-label="Link to an image"
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), loadLink((e.target as HTMLInputElement).value))}
          />
          <button type="button" class="rg-btn" disabled={loading} onClick={(e) => loadLink(((e.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement).value)}>
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
      )}
      {error && <span class="rg-error" role="alert">{error}</span>}
      {src && (
        <LogoCropper
          src={src}
          onCancel={() => (setSrc(null), upload.current?.focus())}
          onError={(m) => (setSrc(null), setError(m))}
          onUse={(dataUrl) => {
            setSrc(null);
            setError('');
            onChange({ kind: 'png', png: dataUrlToBase64(dataUrl) });
            upload.current?.focus();
          }}
        />
      )}
    </div>
  );
}
