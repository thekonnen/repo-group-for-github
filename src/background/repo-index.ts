import { batches, lastPageFromLink, mergeIndex, needsFullSync, pagesChanged, rateLimitPause, reconcile, remainingPages, shouldContinueIncremental, sortByPush, type IndexMeta } from '../core/index-sync';
import type { RepoInfo } from '../core/types';
import type { Client } from './api';

export interface IndexStore {
  load(org: string): Promise<{ repos: RepoInfo[]; meta: IndexMeta } | null>;
  save(org: string, repos: RepoInfo[], meta: IndexMeta): Promise<void>;
  /** Removes every stored index (Options > Clear cache). */
  clear(): Promise<void>;
}

export function memoryIndexStore(): IndexStore {
  const m = new Map<string, { repos: RepoInfo[]; meta: IndexMeta }>();
  return {
    async load(org) {
      return m.get(org) ?? null;
    },
    async save(org, repos, meta) {
      m.set(org, { repos: structuredClone(repos), meta: { ...meta } });
    },
    async clear() {
      m.clear();
    },
  };
}

/** REST repo -> index entry (§F14 fields). languageColor is not in REST and is left null. */
export function toRepoInfo(r: any): RepoInfo {
  return {
    name: r.name,
    description: r.description ?? '',
    language: r.language ?? null,
    languageColor: null,
    private: !!r.private,
    archived: !!r.archived,
    fork: !!r.fork,
    pushedAt: r.pushed_at ?? null,
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    openIssuesAndPrs: r.open_issues_count ?? 0,
    viewerIsAdmin: r.permissions?.admin ?? false,
  };
}

const pagePath = (org: string, page: number) => `/orgs/${encodeURIComponent(org)}/repos?type=all&sort=pushed&direction=desc&per_page=100&page=${page}`;

export interface IndexOptions {
  concurrency?: number; // 6 normally, 2 in public-only mode
  now?: () => number;
  onProgress?: (p: { loaded: number; estimatedTotal: number; repos: RepoInfo[] }) => void;
}

export type RefreshResult = { status: 'ok'; repos: RepoInfo[]; meta: IndexMeta; mode: 'full' | 'incremental' } | { status: 'paused'; resumeAt?: Date };

const iso = (now: () => number) => new Date(now()).toISOString();

/** First index: page 1, then the remaining pages in parallel batches; replaces the index at the end. */
export async function fullIndex(client: Client, org: string, store: IndexStore, opts: IndexOptions = {}): Promise<{ repos: RepoInfo[]; meta: IndexMeta }> {
  const now = opts.now ?? Date.now;
  const first = await client.rest<any[]>(pagePath(org, 1));
  const last = lastPageFromLink(first.headers.get('link'));
  let fresh = first.data.map(toRepoInfo);
  const progress = () => opts.onProgress?.({ loaded: fresh.length, estimatedTotal: Math.max(fresh.length, last * 100), repos: sortByPush(fresh) });
  progress();
  for (const group of batches(remainingPages(last), opts.concurrency ?? 6)) {
    const pages = await Promise.all(group.map((p) => client.rest<any[]>(pagePath(org, p))));
    for (const p of pages) fresh = fresh.concat(p.data.map(toRepoInfo));
    progress();
  }
  const old = await store.load(org);
  const repos = reconcile(old?.repos ?? [], dedupe(fresh));
  const stamp = iso(now);
  const meta: IndexMeta = { lastFullSync: stamp, lastIncrementalSync: stamp, total: repos.length };
  await store.save(org, repos, meta);
  return { repos, meta };
}

const dedupe = (list: RepoInfo[]) => [...new Map(list.map((r) => [r.name, r])).values()];

/** Fetches page 1 and keeps paging only while every repo is newer than the last sync. Usually 1 request. */
export async function incrementalRefresh(client: Client, org: string, store: IndexStore, current: { repos: RepoInfo[]; meta: IndexMeta }, opts: IndexOptions = {}) {
  const now = opts.now ?? Date.now;
  let page = 1;
  let incoming: RepoInfo[] = [];
  let lastPage = 1;
  for (;;) {
    const res = await client.rest<any[]>(pagePath(org, page));
    if (page === 1) lastPage = lastPageFromLink(res.headers.get('link'));
    const batch = res.data.map(toRepoInfo);
    incoming = incoming.concat(batch);
    if (page >= lastPage || !shouldContinueIncremental(batch, current.meta.lastIncrementalSync)) break;
    page++;
  }
  const repos = mergeIndex(current.repos, incoming);
  const meta: IndexMeta = { ...current.meta, lastIncrementalSync: iso(now), total: repos.length };
  await store.save(org, repos, meta);
  return { repos, meta, lastPage };
}

/** Entry point: render-from-cache is the caller's job; this brings the index up to date. */
export async function refreshIndex(client: Client, org: string, store: IndexStore, opts: IndexOptions & { force?: boolean } = {}): Promise<RefreshResult> {
  const pause = rateLimitPause(client.rate.remaining, client.rate.resetAt);
  if (pause.paused) return { status: 'paused', resumeAt: pause.resumeAt };
  const now = opts.now ?? Date.now;
  const cached = await store.load(org);
  if (!cached || opts.force) {
    return { status: 'ok', mode: 'full', ...(await fullIndex(client, org, store, opts)) };
  }
  const inc = await incrementalRefresh(client, org, store, cached, opts);
  const changed = pagesChanged(cached.meta, inc.lastPage);
  if (needsFullSync(cached.meta, changed ? -1 : cached.meta.total, now())) {
    const p = rateLimitPause(client.rate.remaining, client.rate.resetAt);
    if (!p.paused) return { status: 'ok', mode: 'full', ...(await fullIndex(client, org, store, opts)) };
  }
  return { status: 'ok', mode: 'incremental', repos: inc.repos, meta: inc.meta };
}
