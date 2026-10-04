import { batches, lastPageFromLink, remainingPages } from '../core/index-sync';
import type { RepoInfo } from '../core/types';
import { GitHubError, type Client } from './api';
import type { KV } from './kv';

type Props = NonNullable<RepoInfo['props']>;

export interface PropsResult {
  /** repo name -> custom property values (only repos that have at least one value). */
  props: Record<string, Props>;
  /** GitHub refused the endpoint (403/404): permission missing or not accepted yet. Rules then match nothing. */
  unavailable: boolean;
}

interface Cached extends PropsResult {
  at: number;
}

export const propsKey = (org: string) => `rg:props:${org}`;

/** True when the file text has a custom-property rule: only then do we spend requests on properties. */
export const usesProps = (fileText: string | undefined): boolean => !!fileText && /prop:/i.test(fileText);

/** GitHub's value: string, string[] or null. */
function normalize(rows: any[]): Record<string, Props> {
  const out: Record<string, Props> = {};
  for (const row of rows) {
    if (!row?.repository_name) continue;
    const p: Props = {};
    for (const x of row.properties ?? []) {
      const v = x?.value;
      if (!x?.property_name || v == null) continue;
      if (Array.isArray(v)) {
        const list = v.filter((s: unknown): s is string => typeof s === 'string');
        if (list.length) p[x.property_name] = list;
      } else if (typeof v === 'string' && v !== '') p[x.property_name] = v;
    }
    if (Object.keys(p).length) out[row.repository_name] = p;
  }
  return out;
}

/**
 * Org custom property values (`GET /orgs/{org}/properties/values`, 100 per page, remaining pages in parallel).
 * Kept in a side cache per org, not on the index entries: orgs without property rules pay nothing, the index
 * schema and its merge/reconcile code stay untouched, and a refresh never drops them.
 */
export async function loadProps(
  client: Client,
  kv: KV,
  org: string,
  o: { force?: boolean; cacheOnly?: boolean; now?: () => number; ttlMs?: number } = {},
): Promise<PropsResult> {
  const now = (o.now ?? Date.now)();
  const cached = await kv.get<Cached>(propsKey(org));
  const stale = cached ? { props: cached.props, unavailable: cached.unavailable } : { props: {}, unavailable: false };
  if (o.cacheOnly) return stale;
  if (cached && !o.force && now - cached.at >= 0 && now - cached.at < (o.ttlMs ?? 5 * 60_000)) return stale;
  const base = `/orgs/${encodeURIComponent(org)}/properties/values?per_page=100`;
  try {
    const first = await client.rest(`${base}&page=1`, { allow404: true });
    if (first.status === 404) throw new GitHubError(404, 'not-found', 'no properties');
    const rows: any[] = Array.isArray(first.data) ? first.data : [];
    const pages = remainingPages(lastPageFromLink(first.headers.get('link')));
    for (const group of batches(pages, 6)) {
      const res = await Promise.all(group.map((p) => client.rest(`${base}&page=${p}`)));
      for (const r of res) if (Array.isArray(r.data)) rows.push(...r.data);
    }
    const value: PropsResult = { props: normalize(rows), unavailable: false };
    await kv.set(propsKey(org), { ...value, at: now });
    return value;
  } catch (e) {
    if (e instanceof GitHubError && (e.kind === 'forbidden' || e.kind === 'not-found' || e.kind === 'sso')) {
      // Degrade quietly: no error, rules match nothing, one hint on the Match rules tab.
      const value: PropsResult = { props: {}, unavailable: true };
      await kv.set(propsKey(org), { ...value, at: now });
      return value;
    }
    return stale; // rate limit, network, 5xx: keep what we had
  }
}

/** Joins property values into repos (copies only the repos that have some). */
export function withProps<T extends RepoInfo>(repos: T[], props: Record<string, Props>): T[] {
  return Object.keys(props).length ? repos.map((r) => (props[r.name] ? { ...r, props: props[r.name] } : r)) : repos;
}
