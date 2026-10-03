import { findGroup } from './placement';
import type { Group } from './types';

/** The single change behind Edit group / New group. Re-applied to a fresh file when a commit conflicts (§7). */
export type Edit =
  | { kind: 'edit'; path: string[]; name: string; description: string; match: string[] }
  | { kind: 'new'; parent: string[]; name: string; description: string; match: string[] };

/** Group names are slugs: lowercase, other characters become "-". Edge dashes are kept while typing. */
export const slugName = (v: string): string => v.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
export const finalName = (v: string): string => slugName(v.trim()).replace(/^-+|-+$/g, '');

/** Error text for the drawer, or null when the draft is valid. */
export function validateDraft(groups: Group[], d: { mode: 'edit' | 'new'; path: string[]; name: string }): string | null {
  const name = finalName(d.name);
  if (!name) return 'Name is required.';
  const parent = d.mode === 'edit' ? d.path.slice(0, -1) : d.path;
  const siblings = parent.length ? findGroup(groups, parent)?.groups : groups;
  const self = d.mode === 'edit' ? d.path[d.path.length - 1] : null;
  if (siblings?.some((g) => g.name === name && g.name !== self)) return `A group named "${name}" already exists here.`;
  return null;
}

const clone = (groups: Group[]): Group[] => structuredClone(groups);

/** Applies an edit to a tree (never mutates the input). Logo, teams and subgroups of an edited group are kept. */
export function applyEdit(groups: Group[], edit: Edit): { groups: Group[] } | { error: string } {
  const next = clone(groups);
  const name = finalName(edit.name);
  const match = edit.match.map((m) => m.trim()).filter(Boolean);
  if (edit.kind === 'new') {
    const list = edit.parent.length ? findGroup(next, edit.parent)?.groups : next;
    if (!list) return { error: `The group "${edit.parent.join('/')}" no longer exists. Reload the page and try again.` };
    if (!name) return { error: 'Name is required.' };
    if (list.some((g) => g.name === name)) return { error: `A group named "${name}" already exists here.` };
    list.push({ name, description: edit.description.trim(), logo: null, teams: [], match, groups: [] });
    return { groups: next };
  }
  const g = findGroup(next, edit.path);
  if (!g) return { error: `The group "${edit.path.join('/')}" no longer exists. Reload the page and try again.` };
  const parent = edit.path.slice(0, -1);
  const siblings = parent.length ? findGroup(next, parent)!.groups : next;
  if (!name) return { error: 'Name is required.' };
  if (siblings.some((s) => s !== g && s.name === name)) return { error: `A group named "${name}" already exists here.` };
  g.name = name;
  g.description = edit.description.trim();
  g.match = match;
  return { groups: next };
}

export const editPath = (e: Edit): string => (e.kind === 'new' ? [...e.parent, finalName(e.name)] : [...e.path.slice(0, -1), finalName(e.name)]).join('/');

/** `chore(repo-groups): edit group infra/dagu` (§7). */
export function commitMessage(e: Edit): string {
  if (e.kind === 'new') return `chore(repo-groups): add ${e.parent.length ? 'subgroup' : 'group'} ${editPath(e)}`;
  const from = e.path.join('/');
  const to = editPath(e);
  return from === to ? `chore(repo-groups): edit group ${from}` : `chore(repo-groups): rename group ${from} to ${to}`;
}
