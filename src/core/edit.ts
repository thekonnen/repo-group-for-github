import { isForkRule, isPropRule, isTopicRule, matchesRepo, parsePropRule, type RuleTarget } from './glob';
import { logoPath } from './logo';
import { findGroup, flatList, keyOf, pickIn, placement, postOrder, ruleFor, sharedPlacement } from './placement';
import { labelKey } from './labels';
import { cleanReadme, isSafeReadmePath, readmeFilePath, type ReadmeChange } from './readme';
import type { Group, LabelTag, MilestoneTag, TeamTag } from './types';

/** The single change behind Edit group / New group. Re-applied to a fresh file when a commit conflicts (§7). */
export type Edit =
  /** `teams` (F12): when given it replaces the group's own team tags; when absent they are kept. */
  | { kind: 'edit'; path: string[]; name: string; title?: string; description: string; match: string[]; shared?: string[]; logo?: LogoChange; readme?: ReadmeChange; teams?: TeamTag[]; labels?: LabelTag[]; milestones?: MilestoneTag[] }
  | { kind: 'new'; parent: string[]; name: string; title?: string; description: string; match: string[]; shared?: string[]; logo?: LogoChange; readme?: ReadmeChange; teams?: TeamTag[]; labels?: LabelTag[]; milestones?: MilestoneTag[] }
  /** F9: adds the exact repo name to the match list of an existing group. */
  | { kind: 'file'; path: string[]; repo: string }
  /** Removes a group and all its subgroups from the file. No repository is touched: they fall back to the other rules. */
  | { kind: 'delete'; path: string[] }
  /** A4: moves repositories to a group ([] = Ungrouped), in one commit. Exact names only: it never edits patterns. */
  | { kind: 'move'; repos: string[]; to: string[]; /** The index records of `repos`, so topic:, prop: and fork-of: rules are honored when the edit is re-applied. */ targets?: RuleTarget[]; /** Ungrouped moves: also remove the exact names from the `shared` lists that list the repo. */ dropShared?: boolean }
  /** A3: also lists repositories in a group (adds the exact name to its `shared`) without changing their home. */
  | { kind: 'share'; repos: string[]; to: string[]; targets?: RuleTarget[] }
  /** A3: stops listing repositories in a group: removes their exact names from its `shared`. The home group is never touched. */
  | { kind: 'unshare'; repos: string[]; from: string[]; targets?: RuleTarget[] };

/** A logo change (F7): a new 192x192 PNG (base64, committed with the YAML in one commit) or "use the letter". */
export type LogoChange = { png: string } | { remove: true };
export const hasPng = (e: Edit): boolean => (e.kind === 'new' || e.kind === 'edit') && !!e.logo && 'png' in e.logo;

/** The README text of an edit that stores it as a file (committed with repo-groups.yml), if it carries one. */
export const readmeFileOf = (e: Edit): string | null => ((e.kind === 'new' || e.kind === 'edit') && e.readme && 'file' in e.readme ? cleanReadme(e.readme.file) || null : null);
export const hasReadmeFile = (e: Edit): boolean => readmeFileOf(e) !== null;

/** Sets or clears `readme` on a group. Returns an error text for a path that leaves the repository. */
function setReadme(g: Group, change: ReadmeChange | undefined, groupPath: string[]): string | null {
  if (!change) return null;
  let v: string | undefined;
  if ('remove' in change) v = undefined;
  else if ('inline' in change) v = cleanReadme(change.inline) || undefined;
  else if ('path' in change) {
    v = change.path.trim() || undefined;
    if (v && !isSafeReadmePath(v)) return 'The README path must stay inside the .github repository.';
  } else v = cleanReadme(change.file) ? readmeFilePath(groupPath) : undefined;
  if (v) g.readme = v;
  else delete g.readme;
  return null;
}

/** Trimmed tags, empty slugs dropped, one tag per slug (the last one wins). */
export function cleanTeams(teams: TeamTag[]): TeamTag[] {
  const map = new Map<string, TeamTag>();
  for (const t of teams) {
    const slug = t.slug.trim();
    if (slug) map.set(slug, { slug, permission: t.permission.trim() || 'push' });
  }
  return [...map.values()];
}

/** Trimmed labels, empty names dropped, one per name (case-insensitive, the last one wins). A blank color means the default. */
export function cleanLabels(labels: LabelTag[]): LabelTag[] {
  const map = new Map<string, LabelTag>();
  for (const l of labels) {
    const name = l.name.trim();
    if (!name) continue;
    const color = l.color?.trim().replace(/^#/, '').toLowerCase();
    const description = l.description?.trim();
    map.set(labelKey(name), { name, ...(color ? { color } : {}), ...(description ? { description } : {}) });
  }
  return [...map.values()];
}

/** Trimmed milestones, empty titles dropped, one per title (case-insensitive, the last one wins). */
export function cleanMilestones(ms: MilestoneTag[]): MilestoneTag[] {
  const map = new Map<string, MilestoneTag>();
  for (const m of ms) {
    const title = m.title.trim();
    if (!title) continue;
    const due_on = m.due_on?.trim();
    const description = m.description?.trim();
    map.set(labelKey(title), { title, ...(due_on ? { due_on } : {}), ...(description ? { description } : {}) });
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
export function validateDraft(groups: Group[], d: { mode: 'edit' | 'new'; path: string[]; name: string; title?: string; match?: string[] }): string | null {
  const bad = d.match?.find((r) => isPropRule(r) && !parsePropRule(r));
  if (bad) return `The rule "${bad}" needs a property and a value, like prop:client=Acme.`;
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

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** A repository by name, or the index record (so topic:, prop: and fork-of: rules count). */
export type RepoRef = string | RuleTarget;
const nameOf = (r: RepoRef): string => (typeof r === 'string' ? r : r.name);
const targetOf = (r: RepoRef): RuleTarget => (typeof r === 'string' ? { name: r } : r);
const uniqueRefs = (repos: RepoRef[]): RepoRef[] => {
  const seen = new Set<string>();
  return repos.filter((r) => (seen.has(nameOf(r)) ? false : (seen.add(nameOf(r)), true)));
};

/** True when `key` is `of` itself or lies below it. */
const within = (key: string, of: string): boolean => key === of || key.startsWith(of + '/');

/** An exact repo-name entry (not a topic:/prop:/fork-of: rule, no `*`) that equals the name. */
const isNameEntry = (rule: string, name: string): boolean => !rule.includes('*') && !isTopicRule(rule) && !isPropRule(rule) && !isForkRule(rule) && sameName(rule, name);

/** Removes the exact name from `g.shared`; true when something was removed. */
function dropSharedName(g: Group, name: string): boolean {
  if (!g.shared?.some((r) => isNameEntry(r, name))) return false;
  const rest = g.shared.filter((r) => !isNameEntry(r, name));
  if (rest.length) g.shared = rest;
  else delete g.shared;
  return true;
}

/** A group (by key) that still lists a repo through one of its `shared` rules. `exact` = the entry is the repo's own name. */
export interface StillShared {
  key: string;
  rule: string;
  exact: boolean;
}

export interface MoveResult {
  groups: Group[];
  /** False when the tree already says it: nothing to commit. */
  changed: boolean;
  /** Groups the exact name was removed from (keys). */
  removedFrom: string[];
  /** After the move a pattern still places the repo somewhere other than `to` (only possible for Ungrouped). */
  stillCaught?: { key: string; rule: string };
  /** Ungrouped moves: groups that still list the repo through `shared` (the exact-name ones are removed with `dropShared`). */
  stillShared: StillShared[];
}

/**
 * A4: puts the exact repo name in the `match` of `to` and takes that exact name out of every other group
 * (§5.3: exact names win, so the name at the destination is enough even when a pattern caught it before).
 * `to` = [] means Ungrouped: only the exact names are removed, and `stillCaught` says when a pattern keeps it in a group.
 * A3: the exact name is also taken out of the `shared` lists of the destination and its ancestors (they contain the repo
 * now, so listing it there is redundant). For Ungrouped, `stillShared` reports the groups that still list it; with
 * `dropShared` the exact-name entries are removed.
 * Pass the index record (RuleTarget) so topic:, prop: and fork-of: rules are honored. Never mutates the input.
 */
export function moveRepo(groups: Group[], ref: RepoRef, to: string[], opts: { dropShared?: boolean } = {}): MoveResult | { error: string } {
  const repo = nameOf(ref);
  const t = targetOf(ref);
  const next = clone(groups);
  const dest = to.length ? findGroup(next, to) : null;
  if (to.length && !dest) return { error: `The group "${to.join('/')}" no longer exists. Reload the page and try again.` };
  const isExactRule = (r: string) => !r.includes('*') && sameName(r, repo);
  const removedFrom: string[] = [];
  let changed = false;
  for (const n of postOrder(next)) {
    if (n.group === dest || !n.group.match.some(isExactRule)) continue;
    n.group.match = n.group.match.filter((r) => !isExactRule(r));
    removedFrom.push(n.key);
    changed = true;
  }
  if (dest && !dest.match.some(isExactRule)) (dest.match.push(repo), (changed = true));
  const destKey = keyOf(to);
  if (dest) for (const n of postOrder(next)) if (within(destKey, n.key) && dropSharedName(n.group, repo)) changed = true;
  const out: MoveResult = { groups: next, changed, removedFrom, stillShared: [] };
  if (!dest) {
    for (const n of flatList(next)) {
      for (const rule of (n.group.shared ?? []).filter((r) => matchesRepo([r], t))) out.stillShared.push({ key: n.key, rule, exact: isNameEntry(rule, repo) });
    }
    if (opts.dropShared && out.stillShared.some((x) => x.exact)) {
      for (const n of flatList(next)) if (dropSharedName(n.group, repo)) out.changed = true;
      out.stillShared = out.stillShared.filter((x) => !x.exact);
    }
    const hit = pickIn(postOrder(next), t);
    const rule = hit && ruleFor(hit.group, t);
    if (hit && rule) out.stillCaught = { key: hit.key, rule };
  }
  return out;
}

export interface MovePlan {
  groups: Group[];
  /** True when at least one repository needs a change in the file. */
  changed: boolean;
  /** Repositories that change (these go into the commit). */
  moved: string[];
  /** Repositories already placed at the destination: skipped. */
  already: string[];
  /** Repositories moved to Ungrouped that a pattern still places in a group. */
  stillCaught: { repo: string; key: string; rule: string }[];
  /** Repositories that were only listed at the destination through `shared`: moving makes them live there. */
  wasListed: string[];
  /** Ungrouped moves: groups that still list a moved repository through `shared`. */
  stillShared: ({ repo: string } & StillShared)[];
}

/** A4: `moveRepo` for several repositories, folded into one tree (one commit). Never mutates the input. */
export function moveRepos(groups: Group[], repos: RepoRef[], to: string[], opts: { dropShared?: boolean } = {}): MovePlan | { error: string } {
  const dest = to.join('/');
  const refs = uniqueRefs(repos);
  const now = sharedPlacement(groups, refs.map(targetOf));
  const out: MovePlan = { groups: clone(groups), changed: false, moved: [], already: [], stillCaught: [], wasListed: [], stillShared: [] };
  if (to.length && !findGroup(groups, to)) return { error: `The group "${dest}" no longer exists. Reload the page and try again.` };
  for (const ref of refs) {
    const repo = nameOf(ref);
    if (now.primary[repo] === dest) {
      out.already.push(repo);
      continue;
    }
    const r = moveRepo(out.groups, ref, to, opts);
    if ('error' in r) return r;
    out.groups = r.groups;
    if (r.changed) out.moved.push(repo);
    if (to.length && now.secondary.get(repo)?.includes(dest)) out.wasListed.push(repo);
    if (r.stillCaught) out.stillCaught.push({ repo, ...r.stillCaught });
    for (const x of r.stillShared) out.stillShared.push({ repo, ...x });
  }
  out.changed = out.moved.length > 0;
  return out;
}

export interface SharePlan {
  groups: Group[];
  /** True when at least one name was added. */
  changed: boolean;
  /** Repositories whose exact name was added to the destination's `shared` (these go into the commit). */
  added: string[];
  /** Repositories the destination already lists, by exact name or through a shared rule. */
  already: string[];
  /** Repositories that live in the destination or below it: it already contains them. */
  redundant: string[];
}

/**
 * A3: "Also list in…". Adds the EXACT repo name to the `shared` list of `to` (never edits patterns); the home group
 * is untouched. Skips repositories that already live in `to` (or below) and the ones it already lists. `to` must be a group.
 */
export function shareRepos(groups: Group[], repos: RepoRef[], to: string[]): SharePlan | { error: string } {
  const next = clone(groups);
  const dest = to.length ? findGroup(next, to) : null;
  if (!dest) return { error: to.length ? `The group "${to.join('/')}" no longer exists. Reload the page and try again.` : 'Pick a group: a repository cannot be listed in Ungrouped.' };
  const key = keyOf(to);
  const refs = uniqueRefs(repos);
  const { primary } = sharedPlacement(groups, refs.map(targetOf));
  const out: SharePlan = { groups: next, changed: false, added: [], already: [], redundant: [] };
  for (const ref of refs) {
    const name = nameOf(ref);
    const home = primary[name] ?? '';
    if (home && within(home, key)) out.redundant.push(name);
    else if (matchesRepo(dest.shared ?? [], targetOf(ref))) out.already.push(name);
    else {
      dest.shared = [...(dest.shared ?? []), name];
      out.added.push(name);
    }
  }
  out.changed = out.added.length > 0;
  return out;
}

export interface UnsharePlan {
  groups: Group[];
  /** True when at least one exact name was removed. */
  changed: boolean;
  /** Repositories whose exact name was removed from `from.shared` (these go into the commit). */
  removed: string[];
  /** Repositories `from` has no exact entry for (listed only through a rule, or not listed at all). */
  notLinked: string[];
  /** Repositories `from` still lists through a `shared` rule (pattern, topic:, prop:, fork-of:, or a wildcard): not removable automatically. */
  stillShared: { repo: string; rule: string }[];
}

/**
 * A3: "Remove link". Removes the EXACT repo name (case-insensitive) from the `shared` list of `from` (the key is dropped
 * when the list becomes empty). Never touches match rules or the home group. Rules of `shared` that still catch a repo
 * are reported in `stillShared`: they have to be edited in the group.
 */
export function unshareRepos(groups: Group[], repos: RepoRef[], from: string[]): UnsharePlan | { error: string } {
  const next = clone(groups);
  const g = from.length ? findGroup(next, from) : null;
  if (!g) return { error: `The group "${from.join('/')}" no longer exists. Reload the page and try again.` };
  const out: UnsharePlan = { groups: next, changed: false, removed: [], notLinked: [], stillShared: [] };
  for (const ref of uniqueRefs(repos)) {
    const name = nameOf(ref);
    if (dropSharedName(g, name)) out.removed.push(name);
    else out.notLinked.push(name);
    for (const rule of (g.shared ?? []).filter((r) => matchesRepo([r], targetOf(ref)))) out.stillShared.push({ repo: name, rule });
  }
  out.changed = out.removed.length > 0;
  return out;
}

/** Applies an edit to a tree (never mutates the input). Logo, teams and subgroups of an edited group are kept. */
export function applyEdit(groups: Group[], edit: Edit): { groups: Group[] } | { error: string } {
  const next = clone(groups);
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
  if (edit.kind === 'move') {
    const r = moveRepos(groups, edit.targets ?? edit.repos, edit.to, { dropShared: edit.dropShared });
    return 'error' in r ? r : { groups: r.groups };
  }
  if (edit.kind === 'unshare') {
    const r = unshareRepos(groups, edit.targets ?? edit.repos, edit.from);
    return 'error' in r ? r : { groups: r.groups };
  }
  if (edit.kind === 'share') {
    const r = shareRepos(groups, edit.targets ?? edit.repos, edit.to);
    return 'error' in r ? r : { groups: r.groups };
  }
  if (edit.kind === 'file') {
    const t = findGroup(next, edit.path);
    if (!t) return { error: `The group "${edit.path.join('/')}" no longer exists. Reload the page and try again.` };
    if (!t.match.some((m) => m.toLowerCase() === edit.repo.toLowerCase())) t.match.push(edit.repo);
    return { groups: next };
  }
  const name = finalName(edit.name);
  const match = edit.match.map((m) => m.trim()).filter(Boolean);
  const shared = (edit.shared ?? []).map((m) => m.trim()).filter(Boolean);
  if (edit.kind === 'new') {
    const list = edit.parent.length ? findGroup(next, edit.parent)?.groups : next;
    if (!list) return { error: `The group "${edit.parent.join('/')}" no longer exists. Reload the page and try again.` };
    if (!name) return { error: 'Name is required.' };
    if (list.some((g) => g.name === name)) return { error: `A group named "${name}" already exists here.` };
    const logo = edit.logo && 'png' in edit.logo ? logoPath([...edit.parent, name]) : null;
    const made: Group = { name, ...(cleanTitle(edit.title, name) ? { title: cleanTitle(edit.title, name) } : {}), description: edit.description.trim(), logo, teams: edit.teams ? cleanTeams(edit.teams) : [], match, ...(shared.length ? { shared } : {}), groups: [] };
    const bad = setReadme(made, edit.readme, [...edit.parent, name]);
    if (bad) return { error: bad };
    list.push(made);
    if (edit.labels?.length) made.labels = cleanLabels(edit.labels);
    if (edit.milestones?.length) made.milestones = cleanMilestones(edit.milestones);
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
  // `shared` given: it replaces the group's rules (empty clears them); absent: kept.
  if (edit.shared) {
    if (shared.length) g.shared = shared;
    else delete g.shared;
  }
  if (edit.logo) g.logo = 'png' in edit.logo ? logoPath([...parent, name]) : null;
  if (edit.teams) g.teams = cleanTeams(edit.teams);
  const bad = setReadme(g, edit.readme, [...parent, name]);
  if (bad) return { error: bad };
  if (edit.labels) {
    const l = cleanLabels(edit.labels);
    if (l.length) g.labels = l;
    else delete g.labels;
  }
  if (edit.milestones) {
    const m = cleanMilestones(edit.milestones);
    if (m.length) g.milestones = m;
    else delete g.milestones;
  }
  return { groups: next };
}

export const editPath = (e: Edit): string =>
  e.kind === 'unshare' ? keyOf(e.from) : e.kind === 'move' || e.kind === 'share' ? keyOf(e.to) : e.kind === 'file' || e.kind === 'delete' ? e.path.join('/') : (e.kind === 'new' ? [...e.parent, finalName(e.name)] : [...e.path.slice(0, -1), finalName(e.name)]).join('/');

/** `chore(repo-groups): edit group infra/dagsrv` (§7). */
export function commitMessage(e: Edit): string {
  if (e.kind === 'file') return `chore(repo-groups): file ${e.repo} in ${e.path.join('/')}`;
  if (e.kind === 'unshare') return `chore(repo-groups): stop listing ${e.repos.length === 1 ? e.repos[0] : `${e.repos.length} repositories`} in ${e.from.join('/')}`;
  if (e.kind === 'share') return `chore(repo-groups): also list ${e.repos.length === 1 ? e.repos[0] : `${e.repos.length} repositories`} in ${e.to.join('/')}`;
  if (e.kind === 'move') return `chore(repo-groups): move ${e.repos.length === 1 ? e.repos[0] : `${e.repos.length} repositories`} to ${e.to.length ? e.to.join('/') : 'ungrouped'}`;
  if (e.kind === 'delete') return `chore(repo-groups): delete ${e.path.length > 1 ? 'subgroup' : 'group'} ${e.path.join('/')}${e.path.length > 1 ? ' (rules moved to the parent group)' : ''}`;
  if (e.kind === 'new') return `chore(repo-groups): add ${e.parent.length ? 'subgroup' : 'group'} ${editPath(e)}${hasPng(e) ? ' with logo' : ''}${hasReadmeFile(e) ? (hasPng(e) ? ' and README' : ' with README') : ''}`;
  const from = e.path.join('/');
  const to = editPath(e);
  if (from === to && hasPng(e)) return `chore(repo-groups): add ${hasReadmeFile(e) ? 'logo and README' : 'logo'} for ${to}`;
  if (from === to && hasReadmeFile(e)) return `chore(repo-groups): update README for ${to}`;
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

export function deleteImpact(groups: Group[], path: string[], repos: { name: string; archived?: boolean; fork?: boolean; parent?: string | null }[]): DeleteImpact | null {
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
