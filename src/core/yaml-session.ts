import { SCOPE_WARN_LIMIT } from './ai-prompt';
import type { DiffResult } from './diff';
import { allRepos, type GroupNode, type TreeModel } from './tree';
import type { RepoInfo } from './types';

export interface ScopeOption {
  id: 'all' | 'ungrouped' | 'group';
  label: string;
  repos: RepoInfo[];
}

/** What goes into the `repositories:` context list of the AI prompt (F8/F14). */
export function scopeOptions(model: TreeModel, group?: GroupNode | null): ScopeOption[] {
  const all = allRepos(model.root);
  const out: ScopeOption[] = [
    { id: 'all', label: `All repositories (${all.length})`, repos: all },
    { id: 'ungrouped', label: `Ungrouped only (${model.root.repos.length})`, repos: model.root.repos },
  ];
  if (group && group !== model.root) {
    const g = allRepos(group);
    out.push({ id: 'group', label: `This group (${g.length})`, repos: g });
  }
  return out;
}

/** Long lists make AI answers worse and can exceed context limits. */
export function scopeWarning(count: number): string | null {
  return count > SCOPE_WARN_LIMIT
    ? `This list has ${count.toLocaleString()} repositories. Long lists make AI answers worse and can exceed context limits. Try “Ungrouped only” or a single group.`
    : null;
}

export const changesText = (n: number): string => `${n} change${n === 1 ? '' : 's'}`;

/** "7 groups · 9 of 10 repositories grouped · 1 ungrouped · code fences removed" */
export function statusSummary(d: DiffResult, total: number, stripped: boolean): string {
  return [
    `${d.groups} group${d.groups === 1 ? '' : 's'}`,
    `${total - d.ungrouped} of ${total} repositories grouped`,
    d.ungrouped ? `${d.ungrouped} ungrouped` : '',
    stripped ? 'code fences removed' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** `chore(repo-groups): apply YAML edit (19 changes)` (§7). */
export const yamlCommitMessage = (changes: number): string => `chore(repo-groups): apply YAML edit (${changesText(changes)})`;
