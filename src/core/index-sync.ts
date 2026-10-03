import type { RepoInfo } from './types';

export const PAGE_SIZE = 100;
export const FULL_SYNC_MAX_AGE_MS = 24 * 3600 * 1000;
export const RATE_LIMIT_FLOOR = 200;

/** Page count from a GitHub `Link` header (rel="last"); 1 when absent. */
export function lastPageFromLink(link: string | null | undefined): number {
  if (!link) return 1;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="last"/);
    if (m) {
      const p = Number(new URL(m[1]).searchParams.get('page'));
      if (Number.isInteger(p) && p > 0) return p;
    }
  }
  return 1;
}

/** Pages 2..last, to fetch in parallel after page 1 returned. */
export function remainingPages(last: number): number[] {
  return Array.from({ length: Math.max(0, last - 1) }, (_, i) => i + 2);
}

/** Split a list into batches of `size` (e.g. 6 parallel requests, 50 repos per GraphQL query). */
export function batches<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Incremental stop rule: keep paging only while every repo on the page was pushed after the last sync. */
export function shouldContinueIncremental(page: Pick<RepoInfo, 'pushedAt'>[], lastIncrementalSync: string | null): boolean {
  if (!lastIncrementalSync || !page.length) return false;
  const since = Date.parse(lastIncrementalSync);
  return page.every((r) => !!r.pushedAt && Date.parse(r.pushedAt) > since);
}

/** Merge fresh repos into the index by name. */
export function mergeIndex(existing: RepoInfo[], incoming: RepoInfo[]): RepoInfo[] {
  const map = new Map(existing.map((r) => [r.name, r]));
  for (const r of incoming) map.set(r.name, { ...map.get(r.name), ...r });
  return sortByPush([...map.values()]);
}

/** Full reconciliation replaces the index; deleted and renamed repos disappear. Keeps viewerIsAdmin if not provided. */
export function reconcile(existing: RepoInfo[], fresh: RepoInfo[]): RepoInfo[] {
  const old = new Map(existing.map((r) => [r.name, r]));
  return sortByPush(fresh.map((r) => ({ ...r, viewerIsAdmin: r.viewerIsAdmin ?? old.get(r.name)?.viewerIsAdmin })));
}

export const sortByPush = (list: RepoInfo[]): RepoInfo[] =>
  list.slice().sort((a, b) => (Date.parse(b.pushedAt ?? '') || 0) - (Date.parse(a.pushedAt ?? '') || 0));

export interface IndexMeta {
  lastFullSync: string | null;
  lastIncrementalSync: string | null;
  total: number;
  /** How the first index was built: from the user's own API calls, or from repo-index.json (after confirmation). */
  index?: 'api' | 'action';
}

/** Whether a background full reconciliation is due (§F14). */
export function needsFullSync(meta: IndexMeta | null, observedTotal: number | null, now = Date.now(), force = false): boolean {
  if (force || !meta || !meta.lastFullSync) return true;
  if (now - Date.parse(meta.lastFullSync) > FULL_SYNC_MAX_AGE_MS) return true;
  return observedTotal != null && observedTotal !== meta.total;
}

/** Pause background work below the floor; returns the reset time to show ("resumes at HH:MM"). */
export function rateLimitPause(remaining: number | null, resetEpochSec: number | null): { paused: boolean; resumeAt?: Date } {
  if (remaining == null || remaining >= RATE_LIMIT_FLOOR) return { paused: false };
  return { paused: true, resumeAt: resetEpochSec ? new Date(resetEpochSec * 1000) : undefined };
}

/** REST gives no total; a different page count from the stored one means repos were added or removed. */
export const pagesChanged = (meta: IndexMeta, lastPage: number): boolean => lastPage !== Math.max(1, Math.ceil(meta.total / PAGE_SIZE));
