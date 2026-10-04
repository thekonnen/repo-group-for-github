import { logoPath } from './logo';
import { findGroup, placement } from './placement';
import { prunePins, type SortKey } from './sort';
import type { Group, RepoInfo, TeamTag } from './types';

/** The single change behind Edit group / New group. Re-applied to a fresh file when a commit conflicts (§7). */
export type Edit =
  /** `teams` (F12): when given it replaces the group's own team tags; when absent they are kept. */
  | { kind: 'edit'; path: string[]; name: string; title?: string; description: string; match: string[]; logo?: LogoChange; teams?: TeamTag[] }
  | { kind: 'new'; parent: string[]; name: string; title?: string; description: string; match: string[]; logo?: LogoChange; teams?: TeamTag[] }
  /** F9: adds the exact repo name to the match list of an existing group. */
  | { kind: 'file'; path: string[]; repo: string }
  /** Removes a group and all its subgroups from the file. No repository is touched: they fall back to the other rules. */
  | { kind: 'delete'; path: string[] }
  /** C5: pins (appends to the end of `pinned`) or unpins a repo in a group. The repo must be placed in that group. */
  | { kind: 'pin'; path: string[]; repo: string; pinned: boolean }
  /** C5: sets the default order of a group's repos; `null` removes `sort:` (back to Last pushed). */
  | { kind: 'sort'; path: string[]; sort: SortKey | null };

/** A logo change (F7): a new 192x192 PNG (base64, committed with the YAML in one commit) or "use the letter". */
export type LogoChange = { png: string } | { remove: true };
export const hasPng = (e: Edit): boolean => (e.kind === 'new' || e.kind === 'edit') && !!e.logo && 'png' in e.logo;

/** Trimmed tags, empty slugs dropped, one tag per slug (the last one wins). */
export function cleanTeams(teams: TeamTag[]): TeamTag[] {
  const map = new Map<string, TeamTag>();
  for (const t of teams) {
    const slug = t.slug.trim();
    if (slug) map.set(slug, { slug, permission: t.permission.trim() || 'push' });
  }
  return [...map.values()];
}

/** Letters that do not decompose into base + accent. */
const FOLD: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', ł: 'l', þ: 'th', ı: 'i' };

/**
 * Display name -> slug, the way GitLab builds a path: "Grupo: Competição" -> "grupo-competicao".
 * Accents are removed, other characters become "-". Letters with no Latin form (e.g. 日本語) leave nothing,
 * so the person types a slug.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[ßæœøđðłþı]/g, (c) => FOLD[c])
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** What people see: the title, or the slug when there is none. */
export const displayName = (g: { name: string; title?: string }): string => g.title || g.name;

/** Title to store: trimmed, and dropped when it only repeats the slug. */
export const cleanTitle = (title: string | undefined, slug: string): string | undefined => {
  const t = (title ?? '').replace(/\s+/g, ' ').trim();
  return t && t !== slug ? t : undefined;
};

/**
 * "dag, dagsrv;dags" -> three rules. Repository names cannot contain commas or spaces, so splitting a rule on them
 * can only fix input (typed, pasted, or written by hand into the YAML); it never changes a valid rule.
 */
export const splitRules = (input: string): string[] => [...new Set(input.split(/[\s,;]+/).map((r) => r.trim()).filter(Boolean))];

/** Group names are slugs: lowercase, other characters become "-". Edge dashes are kept while typing. */
export const slugName = (v: string): string => v.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
export const finalName = (v: string): string => slugName(v.trim()).replace(/^-+|-+$/g, '');

/** Error text for the drawer, or null when the draft is valid. */
export function validateDraft(groups: Group[], d: { mode: 'edit' | 'new'; path: string[]; name: string; title?: string }): string | null {
  const name = finalName(d.name);
  if (!name) return (d.title ?? '').trim() ? 'Could not make a slug from this name. Type one in the Slug field.' : 'Name is required.';
  const parent = d.mode === 'edit' ? d.path.slice(0, -1) : d.path;
  const siblings = parent.length ? findGroup(groups, parent)?.groups : groups;
  const self = d.mode === 'edit' ? d.path[d.path.length - 1] : null;
  if (siblings?.some((g) => g.name === name && g.name !== self)) return `A group named "${name}" already exists here.`;
  return null;
}

const clone = (groups: Group[]): Group[] => structuredClone(groups);

/** True when the group or any subgroup satisfies `test`. */
const any = (g: Group, test: (x: Group) => boolean): boolean => test(g) || g.groups.some((c) => any(c, test));

/** The rules of a group and of all its subgroups, the group's own first. */
const allRules = (g: Group): string[] => [...g.match, ...g.groups.flatMap(allRules)];

/** Applies an edit to a tree (never mutates the input). Logo, teams and subgroups of an edited group are kept. */
export function applyEdit(groups: Group[], edit: Edit, repos?: Pick<RepoInfo, 'name' | 'archived'>[]): { groups: Group[] } | { error: string } {
  const next = clone(groups);
  if (edit.kind === 'pin' || edit.kind === 'sort') {
    const t = findGroup(next, edit.path);
    if (!t) return { error: `The group "${edit.path.join('/')}" no longer exists. Reload the page and try again.` };
    const visible = repos?.filter((r) => !r.archived);
    if (edit.kind === 'sort') {
      if (edit.sort && edit.sort !== 'pushed') t.sort = edit.sort;
      else delete t.sort;
    } else {
      const lower = edit.repo.toLowerCase();
      const rest = (t.pinned ?? []).filter((p) => p.toLowerCase() !== lower);
      if (edit.pinned) {
        // Pins only apply to the repo's primary placement: refuse to pin one that another group holds.
        if (visible && placement(next, visible)[visible.find((r) => r.name.toLowerCase() === lower)?.name ?? ''] !== edit.path.join('/'))
          return { error: `"${edit.repo}" is not in ${edit.path.join('/')} (another group or rule places it). Reload the page and try again.` };
        rest.push(edit.repo);
      }
      if (rest.length) t.pinned = rest;
      else delete t.pinned;
    }
    // Stale pins (repo renamed, deleted, archived or moved to another group) go away with this write.
    return { groups: visible?.length ? prunePins(next, visible) : next };
  }
  if (edit.kind === 'delete') {
    const parentPath = edit.path.slice(0, -1);
    const parent = parentPath.length ? findGroup(next, parentPath) : null;
    const list = parent ? parent.groups : next;
    const at = list.findIndex((g) => g.name === edit.path[edit.path.length - 1]);
    if (at < 0) return { error: `The group "${edit.path.join('/')}" no longer exists. Reload the page and try again.` };
    const [gone] = list.splice(at, 1);
    // A subgroup's repositories stay in the group above: its rules (and those of its own subgroups) move up.
    // A top-level group has nothing above, so its repositories become Ungrouped unless another rule catches them.
    if (parent) {
      const have = new Set(parent.match.map((m) => m.toLowerCase()));
      for (const rule of allRules(gone)) if (!have.has(rule.toLowerCase())) (parent.match.push(rule), have.add(rule.toLowerCase()));
    }
    return { groups: next };
  }
  if (edit.kind === 'file') {
    const t = findGroup(next, edit.path);
    if (!t) return { error: `The group "${edit.path.join('/')}" no longer exists. Reload the page and try again.` };
    if (!t.match.some((m) => m.toLowerCase() === edit.repo.toLowerCase())) t.match.push(edit.repo);
    return { groups: next };
  }
  const name = finalName(edit.name);
  const match = edit.match.map((m) => m.trim()).filter(Boolean);
  if (edit.kind === 'new') {
    const list = edit.parent.length ? findGroup(next, edit.parent)?.groups : next;
    if (!list) return { error: `The group "${edit.parent.join('/')}" no longer exists. Reload the page and try again.` };
    if (!name) return { error: 'Name is required.' };
    if (list.some((g) => g.name === name)) return { error: `A group named "${name}" already exists here.` };
    const logo = edit.logo && 'png' in edit.logo ? logoPath([...edit.parent, name]) : null;
    list.push({ name, ...(cleanTitle(edit.title, name) ? { title: cleanTitle(edit.title, name) } : {}), description: edit.description.trim(), logo, teams: edit.teams ? cleanTeams(edit.teams) : [], match, groups: [] });
    return { groups: next };
  }
  const g = findGroup(next, edit.path);
  if (!g) return { error: `The group "${edit.path.join('/')}" no longer exists. Reload the page and try again.` };
  const parent = edit.path.slice(0, -1);
  const siblings = parent.length ? findGroup(next, parent)!.groups : next;
  if (!name) return { error: 'Name is required.' };
  if (siblings.some((s) => s !== g && s.name === name)) return { error: `A group named "${name}" already exists here.` };
  g.name = name;
  if (edit.title !== undefined) {
    const t = cleanTitle(edit.title, name);
    if (t) g.title = t;
    else delete g.title;
  }
  g.description = edit.description.trim();
  g.match = match;
  if (edit.logo) g.logo = 'png' in edit.logo ? logoPath([...parent, name]) : null;
  if (edit.teams) g.teams = cleanTeams(edit.teams);
  return { groups: next };
}

export const editPath = (e: Edit): string =>
  e.kind === 'file' || e.kind === 'delete' || e.kind === 'pin' || e.kind === 'sort' ? e.path.join('/') : (e.kind === 'new' ? [...e.parent, finalName(e.name)] : [...e.path.slice(0, -1), finalName(e.name)]).join('/');

/** `chore(repo-groups): edit group infra/dagsrv` (§7). */
export function commitMessage(e: Edit): string {
  if (e.kind === 'pin') return `chore(repo-groups): ${e.pinned ? 'pin' : 'unpin'} ${e.repo} in ${e.path.join('/')}`;
  if (e.kind === 'sort') return `chore(repo-groups): ${e.sort && e.sort !== 'pushed' ? `sort ${e.path.join('/')} by ${e.sort}` : `reset sort of ${e.path.join('/')}`}`;
  if (e.kind === 'file') return `chore(repo-groups): file ${e.repo} in ${e.path.join('/')}`;
  if (e.kind === 'delete') return `chore(repo-groups): delete ${e.path.length > 1 ? 'subgroup' : 'group'} ${e.path.join('/')}${e.path.length > 1 ? ' (rules moved to the parent group)' : ''}`;
  if (e.kind === 'new') return `chore(repo-groups): add ${e.parent.length ? 'subgroup' : 'group'} ${editPath(e)}${hasPng(e) ? ' with logo' : ''}`;
  const from = e.path.join('/');
  const to = editPath(e);
  if (from === to && hasPng(e)) return `chore(repo-groups): add logo for ${to}`;
  return from === to ? `chore(repo-groups): edit group ${from}` : `chore(repo-groups): rename group ${from} to ${to}`;
}

/** Where the PNG of an edit is stored, or null when the edit has no new logo. */
export const editLogoPath = (e: Edit): string | null => (hasPng(e) ? logoPath(editPath(e).split('/')) : null);

/** The new logo PNG (base64) of an edit, if it carries one. */
export const pngOf = (e: Edit): string | null => ((e.kind === 'new' || e.kind === 'edit') && e.logo && 'png' in e.logo ? e.logo.png : null);

/** What deleting a group does, for the confirmation screen. Pure: it applies the delete and compares where repos land. */
export interface DeleteImpact {
  /** Subgroups at any depth that go with it. */
  subgroups: number;
  /** Match rules in the group and in its subgroups. */
  rules: number;
  /** Rules that move up to the parent group (0 for a top-level group). */
  movedRules: number;
  /** The group the repositories stay in ('' = a top-level group: they become Ungrouped). */
  parentKey: string;
  /** Repositories that sit in the group or below, today. */
  repos: number;
  /** Where those repositories land afterwards: group key ('' = Ungrouped) -> how many. */
  landing: { key: string; count: number }[];
  /** The group or a subgroup has team tags (access already granted on GitHub is not revoked). */
  hasTeams: boolean;
  /** The group or a subgroup has a logo (the file stays in <org>/.github/logos). */
  hasLogo: boolean;
}

export function deleteImpact(groups: Group[], path: string[], repos: { name: string; archived?: boolean }[]): DeleteImpact | null {
  const g = findGroup(groups, path);
  const after = applyEdit(groups, { kind: 'delete', path });
  if (!g || 'error' in after) return null;
  const count = (x: Group): { subs: number; rules: number } => x.groups.reduce((a, c) => { const r = count(c); return { subs: a.subs + 1 + r.subs, rules: a.rules + r.rules }; }, { subs: 0, rules: x.match.length });
  const { subs, rules } = count(g);
  const key = path.join('/');
  const before = placement(groups, repos);
  const now = placement(after.groups, repos);
  const landing = new Map<string, number>();
  let moved = 0;
  for (const r of repos) {
    const was = before[r.name];
    if (was !== key && !was.startsWith(key + '/')) continue;
    moved++;
    landing.set(now[r.name], (landing.get(now[r.name]) ?? 0) + 1);
  }
  return {
    subgroups: subs,
    rules,
    movedRules: path.length > 1 ? rules : 0,
    parentKey: path.slice(0, -1).join('/'),
    repos: moved,
    landing: [...landing].map(([k, n]) => ({ key: k, count: n })).sort((a, b) => b.count - a.count),
    hasTeams: any(g, (x) => x.teams.length > 0),
    hasLogo: any(g, (x) => !!x.logo),
  };
}
