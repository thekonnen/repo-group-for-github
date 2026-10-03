import { batches } from '../core/index-sync';
import { GitHubError, type Client } from './api';
import type { KV } from './kv';

export interface OrgEntry {
  login: string;
  avatarUrl?: string;
  hasFile: boolean;
}
export interface OrgList {
  orgs: OrgEntry[];
  fetchedAt: number;
  user?: string;
}

const KEY = 'rg:orgs';
const CONCURRENCY = 4;

/** Whether <org>/.github/repo-groups.yml exists. Only network, auth and rate-limit problems are surfaced. */
async function hasOrgFile(client: Client, org: string): Promise<boolean> {
  try {
    const r = await client.rest(`/repos/${encodeURIComponent(org)}/.github/contents/repo-groups.yml`, { allow404: true });
    return r.status !== 404;
  } catch (e) {
    if (e instanceof GitHubError && (e.kind === 'auth' || e.kind === 'network' || e.kind === 'rate-limit')) throw e;
    return false; // not readable by this user: treat as "no org file"
  }
}

/**
 * The organizations the user belongs to (no personal account), each flagged with whether it has a repo-groups.yml.
 * Cached for the refresh interval, so opening the popup repeatedly costs nothing.
 */
export async function listOrgs(client: Client, kv: KV, opts: { minutes: number; now: number; user?: string; force?: boolean }): Promise<OrgList> {
  const cached = await kv.get<OrgList>(KEY);
  if (!opts.force && cached && cached.user === opts.user && opts.now - cached.fetchedAt >= 0 && opts.now - cached.fetchedAt < opts.minutes * 60_000) return cached;
  const m = await client.rest<any[]>('/user/memberships/orgs?state=active&per_page=100');
  const base = (m.data ?? []).map((x) => ({ login: String(x.organization?.login ?? ''), avatarUrl: x.organization?.avatar_url as string | undefined })).filter((o) => o.login);
  const out: OrgEntry[] = [];
  for (const group of batches(base, CONCURRENCY)) {
    const flags = await Promise.all(group.map((o) => hasOrgFile(client, o.login)));
    group.forEach((o, i) => out.push({ ...o, hasFile: flags[i] }));
  }
  const list: OrgList = { orgs: out, fetchedAt: opts.now, user: opts.user };
  await kv.set(KEY, list);
  return list;
}
