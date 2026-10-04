import { displayName } from './edit';
import { pickIn, postOrder } from './placement';
import type { Group, RepoInfo } from './types';

/** A group with the repos placed directly in it and recursive totals. */
export interface GroupNode {
  group: Group;
  path: string[];
  key: string; // 'infra/dagsrv'; '' for the virtual root
  repos: RepoInfo[]; // placed here (root: the ungrouped ones), newest push first
  children: GroupNode[];
  total: number; // recursive repo count (root: every visible repo)
  subgroups: number; // recursive group count
  issues: number; // recursive sum of open issues + PRs
  latest: string | null; // newest push, recursive
}

export interface TreeModel {
  root: GroupNode;
  byKey: Map<string, GroupNode>;
  /** repo name -> key of the group it landed in ('' = ungrouped). */
  placed: Map<string, string>;
  visible: number;
}

const pushMs = (r: Pick<RepoInfo, 'pushedAt'>) => Date.parse(r.pushedAt ?? '') || 0;
export const byPush = (a: RepoInfo, b: RepoInfo): number => pushMs(b) - pushMs(a);

/** Builds the group tree for an index. Archived repos are hidden, as GitHub does under "All". */
export function buildTree(groups: Group[], repos: RepoInfo[]): TreeModel {
  const visible = repos.filter((r) => !r.archived);
  const order = postOrder(groups);
  const byKey = new Map<string, GroupNode>();
  const mk = (group: Group, path: string[]): GroupNode => {
    const node: GroupNode = { group, path, key: path.join('/'), repos: [], children: [], total: 0, subgroups: 0, issues: 0, latest: null };
    node.children = group.groups.map((c) => mk(c, [...path, c.name]));
    byKey.set(node.key, node);
    return node;
  };
  const rootGroup: Group = { name: '', description: 'All repositories, organized into groups', logo: null, teams: [], match: [], groups };
  const root = mk(rootGroup, []);
  const placed = new Map<string, string>();
  for (const r of visible) {
    const hit = pickIn(order, r.name, r.topics);
    const node = hit ? byKey.get(hit.key)! : root;
    node.repos.push(r);
    placed.set(r.name, node.key);
  }
  const fold = (n: GroupNode) => {
    n.repos.sort(byPush);
    n.total = n.repos.length;
    n.issues = n.repos.reduce((s, r) => s + (r.openIssuesAndPrs ?? 0), 0);
    let latest = n.repos[0]?.pushedAt ?? null;
    for (const c of n.children) {
      fold(c);
      n.total += c.total;
      n.subgroups += 1 + c.subgroups;
      n.issues += c.issues;
      if (c.latest && (!latest || Date.parse(c.latest) > Date.parse(latest))) latest = c.latest;
    }
    n.latest = latest;
  };
  fold(root);
  return { root, byKey, placed, visible: visible.length };
}

let last: { sha: string | null; version: unknown; model: TreeModel } | null = null;
/** Placement is memoized by (config sha, index version): one recompute per change. */
export function memoTree(sha: string | null, version: unknown, groups: Group[], repos: RepoInfo[]): TreeModel {
  if (last && last.sha === sha && last.version === version) return last.model;
  last = { sha, version, model: buildTree(groups, repos) };
  return last.model;
}

export const nodeAt = (model: TreeModel, path: string[]): GroupNode | null => model.byKey.get(path.join('/')) ?? null;

export function allRepos(node: GroupNode): RepoInfo[] {
  return node.children.reduce<RepoInfo[]>((acc, c) => acc.concat(allRepos(c)), node.repos.slice());
}

export type Row =
  | { kind: 'group'; node: GroupNode; depth: number; open: boolean }
  | { kind: 'repo'; repo: RepoInfo; depth: number; prefix?: string };

/** Visible rows of a group: its subgroups (expandable inline) first, then the repos placed directly in it. */
export function treeRows(node: GroupNode, expanded: ReadonlySet<string>, depth = 0): Row[] {
  const out: Row[] = [];
  for (const c of node.children) {
    const open = expanded.has(c.key);
    out.push({ kind: 'group', node: c, depth, open });
    if (open) out.push(...treeRows(c, expanded, depth + 1));
  }
  for (const r of node.repos) out.push({ kind: 'repo', repo: r, depth });
  return out;
}

/** Search across the current group recursively: name and description, flat, with a muted path prefix. */
export function searchRows(model: TreeModel, node: GroupNode, query: string): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = allRepos(node).filter((r) => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q));
  return hits.sort(byPush).map((repo) => {
    const key = model.placed.get(repo.name) ?? '';
    const parts = key ? key.split('/') : [];
    // Titles for people, slugs only as a fallback.
    const rel = parts.slice(node.path.length).map((_, i) => {
      const k = parts.slice(0, node.path.length + i + 1).join('/');
      const g = model.byKey.get(k)?.group;
      return g ? displayName(g) : parts[node.path.length + i];
    });
    return { kind: 'repo' as const, repo, depth: 0, prefix: rel.length ? rel.join(' / ') + ' / ' : undefined };
  });
}

export type SortKey = 'pushed' | 'name' | 'stars' | 'issues';
export const SORT_KEYS: SortKey[] = ['pushed', 'name', 'stars', 'issues'];
export const SORT_LABEL: Record<SortKey, string> = { pushed: 'Last pushed', name: 'Name', stars: 'Stars', issues: 'Open issues & PRs' };

/** The orders GitHub's own list offers. Ties fall back to the newest push, then the name. */
export function sortRepos(list: RepoInfo[], key: SortKey): RepoInfo[] {
  const byName = (a: RepoInfo, b: RepoInfo) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const cmp: Record<SortKey, (a: RepoInfo, b: RepoInfo) => number> = {
    pushed: (a, b) => byPush(a, b) || byName(a, b),
    name: byName,
    stars: (a, b) => (b.stars ?? 0) - (a.stars ?? 0) || byPush(a, b) || byName(a, b),
    issues: (a, b) => (b.openIssuesAndPrs ?? 0) - (a.openIssuesAndPrs ?? 0) || byPush(a, b) || byName(a, b),
  };
  return list.slice().sort(cmp[key]);
}

/** "All repositories" tab: every repository of the group (subgroups included) as one flat list, like GitHub's own. */
export function flatRows(node: GroupNode, sort: SortKey, query = ''): Row[] {
  const q = query.trim().toLowerCase();
  const repos = allRepos(node).filter((r) => !q || r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q));
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
