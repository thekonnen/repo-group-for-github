import { useState } from 'preact/hooks';
import { byteLength, ERR_README_BIG, isReadmePath, isSafeReadmePath, kb, MAX_README_BYTES, readmeFilePath, readmeTooBig, type ReadmeChange } from '../../core/readme';
import { Markdown } from './Markdown';

export type ReadmeMode = 'inline' | 'file' | 'path';

/** What the person typed in the README field of the drawer. Nothing is sent until Save. */
export interface ReadmeDraft {
  mode: ReadmeMode;
  text: string;
  path: string;
}

/** Initial draft from the group's saved `readme` (a path or inline text) and, for a file, its loaded text. */
export function initialReadme(saved: string | undefined, groupPath: string[], loaded: string | null | undefined): ReadmeDraft {
  if (saved && isReadmePath(saved)) {
    const own = saved === readmeFilePath(groupPath);
    return own ? { mode: 'file', text: loaded ?? '', path: saved } : { mode: 'path', text: '', path: saved };
  }
  return { mode: 'inline', text: saved ?? '', path: '' };
}

/** The change this draft makes to the group, `undefined` when it changes nothing. `loaded` is the text of the saved file, if any. */
export function readmeChange(d: ReadmeDraft, saved: string | undefined, groupPath: string[], loaded: string | null | undefined): ReadmeChange | undefined {
  const clean = (t: string) => t.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+/, '').replace(/\s+$/, '');
  if (d.mode === 'path') {
    const p = d.path.trim();
    if (p === (saved ?? '')) return undefined;
    return p ? { path: p } : { remove: true };
  }
  const text = clean(d.text);
  if (d.mode === 'inline') {
    if (text === clean(saved && !isReadmePath(saved) ? saved : '')) return undefined;
    return text ? { inline: d.text } : { remove: true };
  }
  const here = readmeFilePath(groupPath);
  if (!text) return saved ? { remove: true } : undefined;
  if (saved === here && loaded != null && clean(loaded) === text) return undefined;
  return { file: d.text };
}

/** Error text for the draft, or null when it can be saved. */
export function readmeProblem(d: ReadmeDraft): string | null {
  if (d.mode === 'path') {
    const p = d.path.trim();
    if (!p) return null;
    if (!isReadmePath(p)) return 'Use a path to a Markdown file, for example readmes/infra.md.';
    if (!isSafeReadmePath(p)) return 'The path must stay inside the .github repository (no leading slash or "..").';
    return null;
  }
  return readmeTooBig(d.text) ? ERR_README_BIG : null;
}

/**
 * README field of the group drawer (C4): Markdown text with Write / Preview tabs, stored either inside repo-groups.yml or as
 * a file in <org>/.github, or the path of a file that already exists there.
 */
export function ReadmeField({ org, groupPath, draft, onChange, loading, problem }: { org: string; groupPath: string[]; draft: ReadmeDraft; onChange: (d: ReadmeDraft) => void; loading?: boolean; problem?: string | null }) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const size = byteLength(draft.text);
  const file = readmeFilePath(groupPath);
  return (
    <div class="rg-field">
      <label for="rg-f-readme-mode">README</label>
      <select id="rg-f-readme-mode" class="rg-y-scope" aria-label="Where the README is stored" value={draft.mode} onChange={(e) => onChange({ ...draft, mode: (e.target as HTMLSelectElement).value as ReadmeMode })}>
        <option value="inline" selected={draft.mode === 'inline'}>Text inside repo-groups.yml</option>
        <option value="file" selected={draft.mode === 'file'}>Markdown file in {org}/.github</option>
        <option value="path" selected={draft.mode === 'path'}>Path of an existing file</option>
      </select>
      {draft.mode === 'path' ? (
        <>
          <input id="rg-f-readme-path" class="rg-input rg-mono" value={draft.path} autocomplete="off" placeholder="readmes/infra.md" aria-label="README path" aria-invalid={problem ? 'true' : undefined} onInput={(e) => onChange({ ...draft, path: (e.target as HTMLInputElement).value })} />
          <span class="rg-hint">A Markdown file inside <code>{org}/.github</code>. Leave it empty for no README.</span>
        </>
      ) : (
        <>
          <div class="rg-tabs rg-md-tabs" role="tablist" aria-label="README">
            <button type="button" role="tab" class="rg-tab" id="rg-readme-tab-write" aria-selected={tab === 'write'} onClick={() => setTab('write')}>Write</button>
            <button type="button" role="tab" class="rg-tab" id="rg-readme-tab-preview" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button>
          </div>
          {tab === 'write' ? (
            <textarea id="rg-f-readme" class="rg-input rg-md-text" rows={8} spellcheck={true} value={draft.text} placeholder={loading ? 'Loading the README…' : '# About this group\n\nWhat lives here, who owns it, where to start.'} aria-invalid={problem ? 'true' : undefined}
              onInput={(e) => onChange({ ...draft, text: (e.target as HTMLTextAreaElement).value })} />
          ) : (
            <div class="rg-md-preview" role="tabpanel" aria-label="README preview">{draft.text.trim() ? <Markdown text={draft.text} /> : <span class="rg-muted">Nothing to preview yet.</span>}</div>
          )}
          <span class="rg-hint">
            {problem ? <span class="rg-error" role="alert">{problem}</span> : <>Markdown: headings, lists, links, code, tables. HTML is shown as text. {kb(size)} of {MAX_README_BYTES / 1024} KB{draft.mode === 'file' ? <> · saved as <code>{file}</code> in the same commit</> : null}.</>}
          </span>
        </>
      )}
      {draft.mode === 'path' && problem && <span class="rg-hint"><span class="rg-error" role="alert">{problem}</span></span>}
    </div>
  );
}
