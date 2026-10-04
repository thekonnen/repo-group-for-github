import { findGroup, placement } from './placement';
import type { Group, GroupSort, RepoInfo } from './types';

/** The orders GitHub's own list offers; also the values of a group's `sort:` key (C5). */
export type SortKey = GroupSort;
export const SORT_KEYS: SortKey[] = ['pushed', 'name', 'stars', 'issues'];
export const SORT_LABEL: Record<SortKey, string> = { pushed: 'Last pushed', name: 'Name', stars: 'Stars', issues: 'Open issues & PRs' };
export const isSortKey = (v: unknown): v is SortKey => typeof v === 'string' && (SORT_KEYS as string[]).includes(v);

const pushMs = (r: Pick<RepoInfo, 'pushedAt'>) => Date.parse(r.pushedAt ?? '') || 0;
export const byPush = (a: RepoInfo, b: RepoInfo): number => pushMs(b) - pushMs(a);

/** Ties fall back to the newest push, then the name. Never mutates the input. */
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

/**
 * Pins first, in pin order (names match case-insensitively; a name that is not in `repos` is ignored; repeats count
 * once), then the rest in `sort` order. Pure and stable: the same input always gives the same list.
 */
export function orderRepos(repos: RepoInfo[], sort: SortKey = 'pushed', pinned: readonly string[] = []): { list: RepoInfo[]; pins: string[] } {
  const byLower = new Map(repos.map((r) => [r.name.toLowerCase(), r]));
  const head: RepoInfo[] = [];
  const seen = new Set<string>();
  for (const p of pinned) {
    const r = byLower.get(p.toLowerCase());
    if (r && !seen.has(r.name)) (head.push(r), seen.add(r.name));
  }
  const rest = sortRepos(repos.filter((r) => !seen.has(r.name)), sort);
  return { list: [...head, ...rest], pins: head.map((r) => r.name) };
}

/**
 * Drops pins that no longer point at a repo placed in their own group (renamed, deleted, archived or now caught by
 * another group). Never mutates the input. Used on every pin/sort write, so stale pins disappear on the next commit.
 */
export function prunePins(groups: Group[], repos: Pick<RepoInfo, 'name'>[]): Group[] {
  const placed = placement(groups, repos);
  const inGroup = new Map<string, Set<string>>();
  for (const [name, key] of Object.entries(placed)) {
    if (!inGroup.has(key)) inGroup.set(key, new Set());
    inGroup.get(key)!.add(name.toLowerCase());
  }
  const walk = (list: Group[], parent: string[]): Group[] =>
    list.map((g) => {
      const path = [...parent, g.name];
      const here = inGroup.get(path.join('/'));
      const pinned = (g.pinned ?? []).filter((p) => here?.has(p.toLowerCase()));
      const { pinned: _drop, ...rest } = g;
      return { ...rest, ...(pinned.length ? { pinned } : {}), groups: walk(g.groups, path) };
    });
  return walk(groups, []);
}

/** True when `repo` is in the pinned list of the group at `path`. */
export const isPinned = (groups: Group[], path: string[], repo: string): boolean =>
  !!findGroup(groups, path)?.pinned?.some((p) => p.toLowerCase() === repo.toLowerCase());
