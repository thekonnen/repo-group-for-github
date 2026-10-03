import { useEffect, useState } from 'preact/hooks';
import { avatarTone } from '../core/tree';

/**
 * Group avatar: the logo when `logo` (a data URL) is given and loads, otherwise the letter. The letter tone comes from
 * the slug (sum of char codes mod 5), so it stays the same when the display name changes; the letter comes from the
 * display name. The org root uses the neutral tone.
 */
export function Avatar({ name, label, cls, root, logo }: { name: string; label?: string; cls: string; root?: boolean; logo?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logo]);
  if (logo && !failed) return <img class={`${cls} rg-logo-img`} src={logo} alt="" onError={() => setFailed(true)} />;
  const tone = root ? 'rg-av-repo' : `rg-av${avatarTone(name)}`;
  return <span class={`${cls} ${tone}`}>{(label || name || '?')[0].toUpperCase()}</span>;
}
