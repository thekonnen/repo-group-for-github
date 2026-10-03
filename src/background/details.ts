import { batches, rateLimitPause } from '../core/index-sync';
import { DETAILS_MAX_REPOS, DETAILS_TTL_MS, type DetailsMap } from '../core/details';
import type { Client } from './api';
import { aliasQuery, graphql } from './graphql';
import type { KV } from './kv';

interface Cache {
  items: Record<string, { issues: number; prs: number; at: number }>;
}

const FIELDS = 'name issues(states: OPEN) { totalCount } pullRequests(states: OPEN) { totalCount }';

/**
 * Separate open issue and pull request counts (F14), lazily and only for small groups.
 * GraphQL aliases, 50 repos per query, never one request per repository. Cached per org for the refresh interval.
 * When the rate limit floor is hit nothing is requested and what is cached is returned.
 */
export async function loadDetails(client: Client, kv: KV, org: string, repos: string[], opts: { now?: () => number; ttl?: number } = {}): Promise<DetailsMap> {
  const now = (opts.now ?? Date.now)();
  const ttl = opts.ttl ?? DETAILS_TTL_MS;
  const key = `rg:details:${org}`;
  const cache: Cache = (await kv.get<Cache>(key)) ?? { items: {} };
  const names = [...new Set(repos)];
  const answer = (): DetailsMap => {
    const out: DetailsMap = {};
    for (const n of names) if (cache.items[n]) out[n] = { issues: cache.items[n].issues, prs: cache.items[n].prs };
    return out;
  };
  if (names.length > DETAILS_MAX_REPOS) return answer(); // big groups keep the combined number
  const stale = names.filter((n) => !cache.items[n] || now - cache.items[n].at >= ttl);
  let changed = false;
  for (const group of batches(stale, 50)) {
    if (rateLimitPause(client.rate.remaining, client.rate.resetAt).paused) break;
    const { query, variables } = aliasQuery(group, FIELDS);
    const data = await graphql<Record<string, any>>(client, query, { o: org, ...variables });
    group.forEach((n, i) => {
      const r = data[`r${i}`];
      if (r) {
        cache.items[n] = { issues: r.issues?.totalCount ?? 0, prs: r.pullRequests?.totalCount ?? 0, at: now };
        changed = true;
      }
    });
  }
  if (changed) await kv.set(key, cache);
  return answer();
}
