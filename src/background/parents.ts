import { batches, rateLimitPause } from '../core/index-sync';
import type { Client } from './api';
import { aliasQuery, graphql } from './graphql';
import type { IndexStore } from './repo-index';
import type { KV } from './kv';

/** repo name -> upstream "owner/repo", or null when GitHub reports none. */
type Cache = Record<string, string | null>;

const FIELDS = 'name parent { nameWithOwner owner { login } }';

/**
 * Upstream of fork repositories (A5). The REST list only says `fork: true`; the parent lives on the single-repo
 * object, so it is read with GraphQL aliases, 50 forks per query, only for forks, only once per repo (cached in kv).
 * The result is also written into the stored index, so a reload renders it without any request.
 * When the rate limit floor is hit nothing is requested and what is cached is returned.
 */
export async function loadParents(client: Client, kv: KV, store: IndexStore, org: string): Promise<Record<string, string | null>> {
  const snap = await store.load(org);
  if (!snap) return {};
  const key = `rg:parents:${org}`;
  const cache: Cache = (await kv.get<Cache>(key)) ?? {};
  const forks = snap.repos.filter((r) => r.fork);
  const missing = forks.filter((r) => r.parent === undefined && !(r.name in cache)).map((r) => r.name);
  let changed = false;
  for (const group of batches(missing, 50)) {
    if (rateLimitPause(client.rate.remaining, client.rate.resetAt).paused) break;
    const { query, variables } = aliasQuery(group, FIELDS);
    const data = await graphql<Record<string, any>>(client, query, { o: org, ...variables });
    group.forEach((n, i) => {
      const r = data[`r${i}`];
      if (r) {
        cache[n] = r.parent?.nameWithOwner ?? null;
        changed = true;
      }
    });
  }
  if (changed) await kv.set(key, cache);
  const out: Record<string, string | null> = {};
  let patched = false;
  const repos = snap.repos.map((r) => {
    if (!r.fork) return r;
    const p = r.parent !== undefined ? r.parent : cache[r.name];
    if (p === undefined) return r;
    out[r.name] = p;
    if (r.parent === p) return r;
    patched = true;
    return { ...r, parent: p };
  });
  if (patched) await store.save(org, repos, snap.meta);
  return out;
}
