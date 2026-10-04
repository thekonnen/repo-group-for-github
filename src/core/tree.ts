import { displayName } from './edit';
import { flatList, pickIn, postOrder, sharedKeysFor } from './placement';
import { byPush, orderRepos, SORT_KEYS, SORT_LABEL, sortRepos, type SortKey } from './sort';
import { isReadmePath } from './readme';
import type { Group, RepoInfo } from './types';

/** A group with the repos placed directly in it and recursive totals. */
export interface GroupNode {
  group: Group;
  path: string[];
  key: string; // 'infra/dagsrv'; '' for the virtual root
  repos: RepoInfo[]; // placed here (root: the ungrouped ones): pinned first, then the group's sort (default newest push)
  pins: string[]; // names of the repos actually pinned here (stale pins are ignored), in pin order
  shared: RepoInfo[]; // A3: also listed here through `shared` rules (their primary group is elsewhere), newest push first
  sharedFrom: Map<string, string>; // A3: shared repo name -> key of its primary group ('' = Ungrouped)
  members: RepoInfo[]; // every distinct repository of the group, subgroups and shared included
  children: GroupNode[];
  total: number; // recursive count of distinct repos (a shared repo counts once per group, never twice in a parent or the root)
  subgroups: number; // recursive group count
  issues: number; // recursive sum of open issues + PRs
  latest: string | null; // newest push, recursive
}

export interface TreeModel {
  root: GroupNode;
  byKey: Map<string, GroupNode>;
  /** repo name -> key of the group it landed in ('' = ungrouped). */
  placed: Map<string, string>;
  /** A3: repo name -> keys of the extra groups it is listed in (primary placement excluded). */
  secondary: Map<string, string[]>;
  visible: number;
}

export { byPush, SORT_KEYS, SORT_LABEL, sortRepos };
export type { SortKey };

/** Builds the group tree for an index. Archived repos are hidden, as GitHub does under "All". */
export function buildTree(groups: Group[], repos: RepoInfo[]): TreeModel {
  const visible = repos.filter((r) => !r.archived);
  const order = postOrder(groups);
  const byKey = new Map<string, GroupNode>();
  const mk = (group: Group, path: string[]): GroupNode => {
    const node: GroupNode = { group, path, key: path.join('/'), repos: [], pins: [], shared: [], sharedFrom: new Map(), members: [], children: [], total: 0, subgroups: 0, issues: 0, latest: null };
    node.children = group.groups.map((c) => mk(c, [...path, c.name]));
    byKey.set(node.key, node);
    return node;
  };
  const rootGroup: Group = { name: '', description: 'All repositories, organized into groups', logo: null, teams: [], match: [], groups };
  const root = mk(rootGroup, []);
  const placed = new Map<string, string>();
  for (const r of visible) {
    const hit = pickIn(order, r);
    const node = hit ? byKey.get(hit.key)! : root;
    node.repos.push(r);
    placed.set(r.name, node.key);
  }
  const secondary = new Map<string, string[]>();
  const flat = flatList(groups);
  if (flat.some((x) => x.group.shared?.length)) {
    for (const r of visible) {
      const keys = sharedKeysFor(flat, r, placed.get(r.name) ?? '');
      if (!keys.length) continue;
      secondary.set(r.name, keys);
      for (const k of keys) {
        const n = byKey.get(k)!;
        n.shared.push(r);
        n.sharedFrom.set(r.name, placed.get(r.name) ?? '');
      }
    }
  }
  const fold = (n: GroupNode) => {
    n.repos.sort(byPush);
    const ordered = orderRepos(n.repos, n.group.sort ?? 'pushed', n.group.pinned);
    n.repos = ordered.list;
    n.pins = ordered.pins;
    n.shared.sort(byPush);
    // Distinct repos of the group: own, shared, then subgroups (a repo shared into a group and also below it counts once).
    const uniq = new Map<string, RepoInfo>();
    for (const r of n.repos) uniq.set(r.name, r);
    for (const r of n.shared) uniq.set(r.name, r);
    for (const c of n.children) {
      fold(c);
      for (const r of c.members) uniq.set(r.name, r);
      n.subgroups += 1 + c.subgroups;
    }
    n.members = [...uniq.values()];
    n.total = n.members.length;
    n.issues = n.members.reduce((s, r) => s + (r.openIssuesAndPrs ?? 0), 0);
    n.latest = n.members.reduce<string | null>((m, r) => (r.pushedAt && (!m || Date.parse(r.pushedAt) > Date.parse(m)) ? r.pushedAt : m), null);
  };
  fold(root);
  return { root, byKey, placed, secondary, visible: visible.length };
}

let last: { sha: string | null; version: unknown; model: TreeModel } | null = null;
/** Placement is memoized by (config sha, index version): one recompute per change. */
export function memoTree(sha: string | null, version: unknown, groups: Group[], repos: RepoInfo[]): TreeModel {
  if (last && last.sha === sha && last.version === version) return last.model;
  last = { sha, version, model: buildTree(groups, repos) };
  return last.model;
}

export const nodeAt = (model: TreeModel, path: string[]): GroupNode | null => model.byKey.get(path.join('/')) ?? null;

/** Every distinct repository of the group: its own, those shared into it, and those of its subgroups. */
export function allRepos(node: GroupNode): RepoInfo[] {
  return node.members;
}

/** "infra/dagsrv" -> "Infra / Scheduler" (display names); '' -> "Ungrouped". */
export function pathTitle(model: TreeModel, key: string): string {
  if (!key) return 'Ungrouped';
  const parts = key.split('/');
  return parts.map((p, i) => { const g = model.byKey.get(parts.slice(0, i + 1).join('/'))?.group; return g ? displayName(g) : p; }).join(' / ');
}

export type Row =
  | { kind: 'group'; node: GroupNode; depth: number; open: boolean }
  /** `also` (A3): this row is a shared membership; it holds the key of the repo's primary group ('' = Ungrouped). `in` is the group that lists it. */
  | { kind: 'repo'; repo: RepoInfo; depth: number; prefix?: string; also?: string; in?: string };

/** Visible rows of a group: its subgroups (expandable inline) first, then the repos placed directly in it. */
export function treeRows(node: GroupNode, expanded: ReadonlySet<string>, depth = 0, order: (n: GroupNode) => RepoInfo[] = (n) => n.repos): Row[] {
  const out: Row[] = [];
  for (const c of node.children) {
    const open = expanded.has(c.key);
    out.push({ kind: 'group', node: c, depth, open });
    if (open) out.push(...treeRows(c, expanded, depth + 1, order));
  }
  for (const r of order(node)) out.push({ kind: 'repo', repo: r, depth });
  for (const r of node.shared) out.push({ kind: 'repo', repo: r, depth, also: node.sharedFrom.get(r.name) ?? '', in: node.key });
  return out;
}

/** Search across the current group recursively: name and description, flat, with a muted path prefix. `also` adds repositories found another way (the AI). */
/** Every word of the query appears in the name or the description ("s3 repo" finds "s3-backup-repo"). */
function textHit(r: RepoInfo, q: string): boolean {
  const hay = `${r.name} ${r.description ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** The words a group answers to in a search: names, description, keywords and README (inline Markdown, or the loaded file). */
export function readmeText(g: Group, texts: Readonly<Record<string, string | null>>): string {
  const r = g.readme?.trim();
  return r ? (isReadmePath(r) ? texts[r] ?? '' : r) : '';
}

export function groupText(g: Group, texts: Readonly<Record<string, string | null>>): string {
  const readme = readmeText(g, texts);
  return [g.name, g.title, g.description, (g.keywords ?? []).join(' '), readme].filter(Boolean).join(' ');
}

/** Groups and subgroups below `node` whose README has every word of the query. Names and descriptions stay with the repository matches. */
export function groupHits(node: GroupNode, query: string, texts: Readonly<Record<string, string | null>>): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const out: Row[] = [];
  const walk = (n: GroupNode) => {
    for (const c of n.children) {
      const hay = readmeText(c.group, texts).toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push({ kind: 'group', node: c, depth: 0, open: false });
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function searchRows(model: TreeModel, node: GroupNode, query: string, also?: ReadonlySet<string>): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = allRepos(node).filter((r) => textHit(r, q) || also?.has(r.name));
  // Titles for people, slugs only as a fallback.
  const titled = (parts: string[], from: number) =>
    parts.slice(from).map((_, i) => {
      const g = model.byKey.get(parts.slice(0, from + i + 1).join('/'))?.group;
      return g ? displayName(g) : parts[from + i];
    });
  const under = (key: string) => node.key === '' || key === node.key || key.startsWith(node.key + '/');
  return hits.sort(byPush).map((repo) => {
    const key = model.placed.get(repo.name) ?? '';
    if (!under(key)) {
      // A3: only reachable here through a shared rule. Show where it is listed here, and where it lives.
      const here = (model.secondary.get(repo.name) ?? []).find(under) ?? node.key;
      const rel = here ? titled(here.split('/'), node.path.length) : [];
      return { kind: 'repo' as const, repo, depth: 0, prefix: rel.length ? rel.join(' / ') + ' / ' : undefined, also: key, in: here };
    }
    const parts = key ? key.split('/') : [];
    const rel = titled(parts, node.path.length);
    return { kind: 'repo' as const, repo, depth: 0, prefix: rel.length ? rel.join(' / ') + ' / ' : undefined };
  });
}

/** "All repositories" tab: every repository of the group (subgroups included) as one flat list, like GitHub's own. */
export function flatRows(node: GroupNode, sort: SortKey, query = '', also?: ReadonlySet<string>): Row[] {
  const q = query.trim().toLowerCase();
  const repos = allRepos(node).filter((r) => !q || textHit(r, q) || also?.has(r.name));
  return sortRepos(repos, sort).map((repo) => ({ kind: 'repo' as const, repo, depth: 0 }));
}

/** First-level groups start collapsed except the first one; all collapsed above 200 repos. */
export function defaultExpanded(model: TreeModel): Set<string> {
  if (model.visible > 200 || !model.root.children.length) return new Set();
  return new Set([model.root.children[0].key]);
}

export interface SideItem {
  key: string;
  name: string; // display name
  depth: number;
  total: number;
  logo: string | null;
}

/** Sidebar entries: "All groups", then every group and subgroup with recursive counts. */
export function sideItems(model: TreeModel): SideItem[] {
  const out: SideItem[] = [{ key: '', name: 'All groups', depth: 0, total: model.root.total, logo: null }];
  const walk = (n: GroupNode, depth: number) => {
    for (const c of n.children) {
      out.push({ key: c.key, name: displayName(c.group), depth, total: c.total, logo: c.group.logo });
      walk(c, depth + 1);
    }
  };
  walk(model.root, 1);
  return out;
}

/** Letter-avatar tone 1..5: sum of char codes of the name, mod 5 (+1). */
export function avatarTone(name: string): number {
  let s = 0;
  for (let i = 0; i < name.length; i++) s += name.charCodeAt(i);
  return (s % 5) + 1;
}

/** Windowing for long lists: rows [start, end) to render for a scroll position. */
export function windowRange(scrollTop: number, viewport: number, rowHeight: number, total: number, overscan = 6): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const count = Math.ceil(viewport / rowHeight);
  const end = Math.min(total, first + count + overscan);
  return { start: Math.min(end, Math.max(0, first - overscan)), end };
}

export const VIRTUALIZE_AFTER = 100;
