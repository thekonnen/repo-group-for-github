import { avatarTone } from '../core/tree';

/** Letter avatar; the tone comes from the name (sum of char codes mod 5). The org root uses the neutral tone. */
export function Avatar({ name, cls, root }: { name: string; cls: string; root?: boolean }) {
  const tone = root ? 'rg-av-repo' : `rg-av${avatarTone(name)}`;
  return <span class={`${cls} ${tone}`}>{(name || '?')[0].toUpperCase()}</span>;
}
