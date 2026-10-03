/**
 * Action index (`index: action`, F14) with the privacy rule of F15 §5.
 *
 * Problem: repo-index.json is written by an org-level token, so it can list repositories this user cannot open.
 * No name from that file may ever reach the page until the user's OWN API calls confirm it.
 *
 * Design: a two-state index.
 *  - `unconfirmed`: the entries of the file, kept in a separate record of the store (`loadUnconfirmed`). `load()`, and
 *    therefore `org:cached` and `org:refresh`, can never return them, and progress messages carry only a percentage.
 *  - confirmed: moved into the normal index only when the user's token can open the repo. Confirmation uses GraphQL
 *    `repository(owner:, name:)` aliases, 50 per query, 6 queries in parallel. They resolve to null for a repo the user
 *    cannot open, and to a different name for a renamed one (both are dropped). The answer also carries
 *    `viewerPermission`, which gives `viewerIsAdmin` (not in the file, it depends on who is looking).
 *
 * Why GraphQL and not "run the parallel REST reconciliation first": REST would need the whole listing (about 34 requests
 * for 3,400 repos, 100 repos of payload each) before ANY name could be shown. Confirmation by name is cheap per request
 * (a few bytes per repo, GraphQL has its own rate pool), runs newest first (the file is sorted by push), and the page
 * fills in wave by wave, so the first confirmed repos show after one round trip. The file data (description, stars,
 * counts) is used for the confirmed entries; it is refreshed by the normal incremental refresh that runs right after,
 * starting at the file's `generatedAt`. Anything the file does not know (new repos) comes from that incremental refresh
 * or the 24 h reconciliation. A forced Re-index or a full reconciliation replaces everything with the user's own data
 * and clears the unconfirmed list. A missing or invalid file falls back silently to the API index.
 */
import { batches, rateLimitPause, sortByPush, type IndexMeta } from '../core/index-sync';
import { parseActionIndex } from '../core/action-index';
import type { RepoInfo } from '../core/types';
import { GitHubError, type Client } from './api';
import { aliasQuery, graphql } from './graphql';
import { decodeBase64Utf8 } from './org-data';
import { refreshIndex, type IndexOptions, type IndexStore, type RefreshResult, type Unconfirmed } from './repo-index';

const FILE = 'repo-index.json';
const BATCH = 50;

/** Downloads and parses repo-index.json; null for a missing, unreadable or invalid file. */
export async function fetchActionFile(client: Client, org: string) {
  let data: any;
  try {
    const res = await client.rest(`/repos/${encodeURIComponent(org)}/.github/contents/${FILE}`, { accept: 'application/vnd.github.raw+json', allow404: true });
    if (res.status === 404) return null;
    data = res.data;
    if (data && typeof data.content === 'string' && data.encoding === 'base64') data = JSON.parse(decodeBase64Utf8(data.content));
  } catch (e) {
    if (e instanceof GitHubError && (e.kind === 'auth' || e.kind === 'network' || e.kind === 'rate-limit')) throw e;
    return null;
  }
  return parseActionIndex(data, org);
}

/** Names the user can open, with their permission: the only way an entry of the file becomes visible. */
async function confirmBatch(client: Client, org: string, names: string[]): Promise<Map<string, boolean>> {
  const { query, variables } = aliasQuery(names, 'name viewerPermission');
  const data = await graphql<Record<string, { name: string; viewerPermission: string | null } | null>>(client, query, { o: org, ...variables });
  const out = new Map<string, boolean>();
  names.forEach((n, i) => {
    const hit = data[`r${i}`];
    if (hit && typeof hit.name === 'string' && hit.name.toLowerCase() === n.toLowerCase()) out.set(n, hit.viewerPermission === 'ADMIN');
  });
  return out;
}

const iso = (now: () => number) => new Date(now()).toISOString();

/** Confirms the pending entries wave by wave; each wave is persisted (index first, then the shrunken pending list). */
async function confirmPending(client: Client, org: string, store: IndexStore, pending: Unconfirmed, opts: IndexOptions): Promise<'done' | 'paused'> {
  const concurrency = opts.concurrency ?? 6;
  const total = pending.repos.length;
  let remaining = pending.repos;
  const meta = (n: number): IndexMeta => ({ lastFullSync: pending.generatedAt, lastIncrementalSync: pending.generatedAt, total: n, index: 'action' });
  const cached = await store.load(org);
  let confirmed: RepoInfo[] = cached?.repos ?? [];
  const progress = () => opts.onProgress?.({ loaded: Math.round(((total - remaining.length) / Math.max(1, total)) * 100), estimatedTotal: 100, repos: confirmed, phase: 'action' });
  progress();
  for (const wave of batches(batches(remaining, BATCH), concurrency)) {
    if (rateLimitPause(client.rate.remaining, client.rate.resetAt).paused) return 'paused';
    const answers = await Promise.all(wave.map((names) => confirmBatch(client, org, names.map((r) => r.name))));
    const byName = new Map<string, boolean>();
    for (const a of answers) for (const [n, admin] of a) byName.set(n, admin);
    const fresh = wave.flat().filter((r) => byName.has(r.name)).map((r) => ({ ...r, viewerIsAdmin: byName.get(r.name) }));
    const have = new Set(confirmed.map((r) => r.name));
    confirmed = sortByPush(confirmed.concat(fresh.filter((r) => !have.has(r.name))));
    const done = new Set(wave.flat().map((r) => r.name));
    remaining = remaining.filter((r) => !done.has(r.name));
    await store.save(org, confirmed, meta(confirmed.length));
    await store.saveUnconfirmed!(org, remaining.length ? { ...pending, repos: remaining } : null);
    progress();
  }
  if (!remaining.length) await store.save(org, confirmed, meta(confirmed.length));
  return 'done';
}

/** Like refreshIndex, for orgs with `index: action`. Falls back to the API index when the file is unusable. */
export async function refreshActionIndex(client: Client, org: string, store: IndexStore, opts: IndexOptions & { force?: boolean; publicOnly?: boolean } = {}): Promise<RefreshResult> {
  // GraphQL needs a token; without one the file can not be confirmed, so nothing from it is used.
  if (!store.loadUnconfirmed || !store.saveUnconfirmed || opts.publicOnly) return refreshIndex(client, org, store, opts);
  const pause = rateLimitPause(client.rate.remaining, client.rate.resetAt);
  if (pause.paused) return { status: 'paused', resumeAt: pause.resumeAt };
  const now = opts.now ?? Date.now;

  let pending = await store.loadUnconfirmed(org);
  const cached = await store.load(org);
  if (opts.force) {
    // Re-index: the user's own full listing replaces everything, including the unconfirmed list.
    await store.saveUnconfirmed(org, null);
    pending = null;
  } else if (!pending && !cached) {
    const file = await fetchActionFile(client, org);
    if (!file) return refreshIndex(client, org, store, opts);
    pending = { repos: sortByPush(file.repos), generatedAt: file.generatedAt };
    await store.saveUnconfirmed(org, pending);
  }
  if (pending) {
    if ((await confirmPending(client, org, store, pending, opts)) === 'paused') {
      const p = rateLimitPause(client.rate.remaining, client.rate.resetAt);
      return { status: 'paused', resumeAt: p.resumeAt };
    }
  }
  const result = await refreshIndex(client, org, store, { ...opts, now });
  if (result.status === 'ok' && result.mode === 'full') await store.saveUnconfirmed(org, null); // reconciliation = the user's own data
  return result;
}
