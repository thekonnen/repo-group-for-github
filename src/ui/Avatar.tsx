import { useEffect, useState } from 'preact/hooks';
import { avatarTone } from '../core/tree';

/**
 * Group avatar: the logo when `logo` (a data URL) is given and loads, otherwise the letter. The letter tone comes from
 * the name (sum of char codes mod 5); the org root uses the neutral tone.
 */
export function Avatar({ name, cls, root, logo }: { name: string; cls: string; root?: boolean; logo?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logo]);
  if (logo && !failed) return <img class={`${cls} rg-logo-img`} src={logo} alt="" onError={() => setFailed(true)} />;
  const tone = root ? 'rg-av-repo' : `rg-av${avatarTone(name)}`;
  return <span class={`${cls} ${tone}`}>{(name || '?')[0].toUpperCase()}</span>;
}
