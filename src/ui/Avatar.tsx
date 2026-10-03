import { avatarTone } from '../core/tree';

/**
 * Letter avatar. The tone comes from the slug (sum of char codes mod 5), so it stays the same when the display name
 * changes; the letter comes from the display name. The org root uses the neutral tone.
 */
export function Avatar({ name, label, cls, root }: { name: string; label?: string; cls: string; root?: boolean }) {
  const tone = root ? 'rg-av-repo' : `rg-av${avatarTone(name)}`;
  return <span class={`${cls} ${tone}`}>{(label || name || '?')[0].toUpperCase()}</span>;
}
