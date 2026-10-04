/** Group READMEs (C4): where they live and how a `readme:` value is read. Pure, no DOM. */
import { MAX_README_BYTES } from './markdown';

export { MAX_README_BYTES };

/** What the drawer asks for. `file` is Markdown text committed as `readmes/<path>.md` together with repo-groups.yml. */
export type ReadmeChange = { inline: string } | { path: string } | { file: string } | { remove: true };

/** `readmes/infra-dagsrv.md` for the group `infra/dagsrv`, mirroring `logos/` (§7). */
export const readmeFilePath = (groupPath: string[]): string => `readmes/${groupPath.join('-')}.md`;

/** One line that looks like a file name inside <org>/.github: `readmes/infra.md`. Anything else is inline Markdown. */
export const isReadmePath = (v: string): boolean => !/[\r\n]/.test(v.trim()) && /^[\w.\-/]+\.(md|markdown)$/i.test(v.trim());

/** A path must stay inside the repository: no leading slash, no `..`, no empty segments. */
export const isSafeReadmePath = (p: string): boolean => !p.startsWith('/') && p.split('/').every((s) => s && s !== '..' && s !== '.');

export const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/** "12.5 KB" for messages. */
export const kb = (bytes: number): string => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;

export const readmeTooBig = (text: string): boolean => byteLength(text) > MAX_README_BYTES;

export const ERR_README_BIG = `The README is larger than ${MAX_README_BYTES / 1024} KB. Shorten it or link to a longer page.`;

/** Normalized inline text: LF line ends, no trailing blank space, one final newline. */
export const cleanReadme = (text: string): string => {
  const t = text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+/, '').replace(/\s+$/, '');
  return t ? t + '\n' : '';
};

/** Result of reading a `readme:` value from the file. */
export type ReadmeValue = { value: string } | { error: string } | { none: true };

/** Checks a raw `readme:` value of group `name`. */
export function readReadme(name: string, org: string, raw: unknown): ReadmeValue {
  if (raw == null) return { none: true };
  if (typeof raw !== 'string') return { error: `"${name}": readme must be text or a path to a .md file in ${org}/.github.` };
  if (!raw.trim()) return { none: true };
  if (isReadmePath(raw)) {
    const p = raw.trim();
    if (!isSafeReadmePath(p)) return { error: `"${name}": readme path "${p}" must stay inside ${org}/.github.` };
    return { value: p };
  }
  if (readmeTooBig(raw)) return { error: `"${name}": readme is larger than ${MAX_README_BYTES / 1024} KB.` };
  return { value: cleanReadme(raw) };
}
