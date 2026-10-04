import promptFile from '../../design/ai-prompt.txt?raw';
import { q } from './yaml-write';
import type { RepoInfo } from './types';

/** The prompt body: design/ai-prompt.txt without its leading "#" doc comments. */
export const AI_PROMPT_TEMPLATE = promptFile
  .split('\n')
  .filter((l) => !l.startsWith('#'))
  .join('\n')
  .trim();

export const SCOPE_LINE = 'Only classify the repositories listed. Keep every other group exactly as it is.';

export const SCOPE_WARN_LIMIT = 500;

export function aiPrompt(org: string, opts: { scoped?: boolean } = {}): string {
  let text = AI_PROMPT_TEMPLATE.replace(/\{\{org\}\}/g, org);
  if (opts.scoped) {
    // Right after the Task list, before "Output rules:".
    text = text.replace('\n\nOutput rules:', `\n${SCOPE_LINE}\n\nOutput rules:`);
  }
  return text;
}

export function repositoriesContext(repos: Pick<RepoInfo, 'name' | 'description' | 'language' | 'fork' | 'parent'>[]): string {
  const lines = ['repositories:  # read-only context, ignored when pasted back'];
  for (const r of repos) {
    lines.push(`  - name: ${r.name}`);
    if (r.description) lines.push(`    description: ${q(r.description)}`);
    if (r.language) lines.push(`    language: ${r.language}`);
    if (r.fork && r.parent) lines.push(`    fork_of: ${r.parent}`);
  }
  return lines.join('\n');
}

/** "Copy prompt for AI + YML" payload. */
export function aiText(org: string, yamlText: string, repos: Pick<RepoInfo, 'name' | 'description' | 'language' | 'fork' | 'parent'>[], scoped = false): string {
  return (
    aiPrompt(org, { scoped }) +
    '\n\nCurrent file and repositories:\n\n```yaml\n' +
    yamlText.replace(/\s+$/, '') +
    '\n\n' +
    repositoriesContext(repos) +
    '\n```\n'
  );
}
