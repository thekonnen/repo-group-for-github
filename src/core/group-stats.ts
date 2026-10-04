import { langColor } from './lang-colors';
import type { GroupNode } from './tree';
import type { RepoInfo } from './types';

export const WEEKS = 12;
export const TOP_LANGS = 5;
const DAY = 86400000;
const WEEK = 7 * DAY;

export interface LangShare {
  /** Language name, or "Other" for the merged tail. */
  name: string;
  other: boolean;
  repos: number;
  /** Share of the repos that have a language, 0-100, one decimal. */
  percent: number;
  color: string;
}

export interface GroupStats {
  repos: number;
  stars: number;
  forks: number;
  /** Top languages by repo count (top 5 + Other). Repos without a language are not in the shares. */
  languages: LangShare[];
  noLanguage: number;
  /** Repos pushed within the last 30 days. */
  pushed30d: number;
  /** ISO time of the newest push, or null. */
  lastPush: string | null;
  /** "Repos last pushed in that week": index 0 = oldest of the 12 weeks, index 11 = the current week. Not commit activity. */
  weekly: number[];
}

export interface StatsOptions {
  includeArchived?: boolean;
  now?: number;
}

/** Pure aggregate over a repo list (the caller passes the recursive set). Archived repos are skipped unless asked for. */
export function computeStats(repos: readonly RepoInfo[], opts: StatsOptions = {}): GroupStats {
  const now = opts.now ?? Date.now();
  const counts = new Map<string, { n: number; color: string | null }>();
  const weekly = new Array<number>(WEEKS).fill(0);
  let n = 0, stars = 0, forks = 0, noLanguage = 0, pushed30d = 0, last = 0;
  for (const r of repos) {
    if (r.archived && !opts.includeArchived) continue;
    n++;
    stars += r.stars ?? 0;
    forks += r.forks ?? 0;
    if (r.language) {
      const c = counts.get(r.language);
      if (c) c.n++;
      else counts.set(r.language, { n: 1, color: r.languageColor ?? null });
    } else noLanguage++;
    const t = Date.parse(r.pushedAt ?? '');
    if (!Number.isFinite(t)) continue;
    if (t > last) last = t;
    const age = now - t;
    if (age <= 30 * DAY) pushed30d++;
    if (age < WEEKS * WEEK) weekly[WEEKS - 1 - Math.max(0, Math.floor(age / WEEK))]++;
  }
  const sorted = [...counts].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const withLang = n - noLanguage;
  const pct = (x: number) => (withLang ? Math.round((x / withLang) * 1000) / 10 : 0);
  const languages: LangShare[] = sorted.slice(0, TOP_LANGS).map(([name, c]) => ({ name, other: false, repos: c.n, percent: pct(c.n), color: langColor(name, c.color) }));
  const rest = sorted.slice(TOP_LANGS).reduce((s, [, c]) => s + c.n, 0);
  if (rest) languages.push({ name: 'Other', other: true, repos: rest, percent: pct(rest), color: '#8b949e' });
  return { repos: n, stars, forks, languages, noLanguage, pushed30d, lastPush: last ? new Date(last).toISOString() : null, weekly };
}

/** Every repo placed in a node or in any of its subgroups. */
export function nodeRepos(node: GroupNode): RepoInfo[] {
  const out: RepoInfo[] = [];
  const walk = (n: GroupNode) => {
    for (const r of n.repos) out.push(r);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

const memo = new WeakMap<GroupNode, { hour: number; stats: GroupStats }>();

/** Recursive stats of a group node, memoized per node (trees are rebuilt when the index or config changes) and per hour. */
export function groupStats(node: GroupNode, now: number = Date.now()): GroupStats {
  const hour = Math.floor(now / 3600000);
  const hit = memo.get(node);
  if (hit && hit.hour === hour) return hit.stats;
  const stats = computeStats(nodeRepos(node), { now });
  memo.set(node, { hour, stats });
  return stats;
}
