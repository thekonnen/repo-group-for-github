import { logoPath } from './logo';
import { findGroup } from './placement';
import type { Group, TeamTag } from './types';

/** The single change behind Edit group / New group. Re-applied to a fresh file when a commit conflicts (§7). */
export type Edit =
  /** `teams` (F12): when given it replaces the group's own team tags; when absent they are kept. */
  | { kind: 'edit'; path: string[]; name: string; title?: string; description: string; match: string[]; logo?: LogoChange; teams?: TeamTag[] }
  | { kind: 'new'; parent: string[]; name: string; title?: string; description: string; match: string[]; logo?: LogoChange; teams?: TeamTag[] }
  /** F9: adds the exact repo name to the match list of an existing group. */
  | { kind: 'file'; path: string[]; repo: string };

/** A logo change (F7): a new 192x192 PNG (base64, committed with the YAML in one commit) or "use the letter". */
export type LogoChange = { png: string } | { remove: true };
export const hasPng = (e: Edit): boolean => e.kind !== 'file' && !!e.logo && 'png' in e.logo;

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

/** Applies an edit to a tree (never mutates the input). Logo, teams and subgroups of an edited group are kept. */
export function applyEdit(groups: Group[], edit: Edit): { groups: Group[] } | { error: string } {
  const next = clone(groups);
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
  e.kind === 'file' ? e.path.join('/') : (e.kind === 'new' ? [...e.parent, finalName(e.name)] : [...e.path.slice(0, -1), finalName(e.name)]).join('/');

/** `chore(repo-groups): edit group infra/dagsrv` (§7). */
export function commitMessage(e: Edit): string {
  if (e.kind === 'file') return `chore(repo-groups): file ${e.repo} in ${e.path.join('/')}`;
  if (e.kind === 'new') return `chore(repo-groups): add ${e.parent.length ? 'subgroup' : 'group'} ${editPath(e)}${hasPng(e) ? ' with logo' : ''}`;
  const from = e.path.join('/');
  const to = editPath(e);
  if (from === to && hasPng(e)) return `chore(repo-groups): add logo for ${to}`;
  return from === to ? `chore(repo-groups): edit group ${from}` : `chore(repo-groups): rename group ${from} to ${to}`;
}

/** Where the PNG of an edit is stored, or null when the edit has no new logo. */
export const editLogoPath = (e: Edit): string | null => (hasPng(e) ? logoPath(editPath(e).split('/')) : null);

/** The new logo PNG (base64) of an edit, if it carries one. */
export const pngOf = (e: Edit): string | null => (e.kind !== 'file' && e.logo && 'png' in e.logo ? e.logo.png : null);
