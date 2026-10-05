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
  /** How each lookup went (status or error + how many items), for diagnosing an empty list. */
  sources?: Record<string, string>;
}

const KEY = 'rg:orgs:v2';
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
  // GitHub App user tokens often get an empty list from /user/memberships/orgs, so also read the App's installations
  // and /user/orgs. Each source may fail on its own; only when all fail is the error surfaced.
  const seen = new Map<string, { login: string; avatarUrl?: string }>();
  const add = (login: unknown, avatarUrl: unknown) => {
    const l = String(login ?? '');
    if (l && !seen.has(l.toLowerCase())) seen.set(l.toLowerCase(), { login: l, avatarUrl: avatarUrl as string | undefined });
  };
  let firstError: unknown;
  let ok = 0;
  const sources: Record<string, string> = {};
  const attempt = async (name: string, f: () => Promise<number>) => {
    try {
      sources[name] = `ok, ${await f()} found`;
      ok++;
    } catch (e) {
      sources[name] = e instanceof GitHubError ? `${e.status} ${e.message}` : String(e);
      firstError ??= e;
      console.debug('[RG] orgs source failed:', e instanceof GitHubError ? `${e.status} ${e.message}` : e);
    }
  };
  await attempt('memberships', async () => {
    const m = await client.rest<any[]>('/user/memberships/orgs?state=active&per_page=100');
    for (const x of m.data ?? []) add(x.organization?.login, x.organization?.avatar_url);
    return (m.data ?? []).length;
  });
  await attempt('user/orgs', async () => {
    const m = await client.rest<any[]>('/user/orgs?per_page=100');
    for (const x of m.data ?? []) add(x.login, x.avatar_url);
    return (m.data ?? []).length;
  });
  await attempt('installations', async () => {
    const m = await client.rest<any>('/user/installations?per_page=100');
    for (const i of m.data?.installations ?? []) if (i.account?.type === 'Organization') add(i.account.login, i.account.avatar_url);
    return (m.data?.installations ?? []).length;
  });
  console.debug('[RG] orgs found:', [...seen.keys()], `${ok}/3 sources ok`);
  if (!ok) throw firstError;
  const base = [...seen.values()];
  const out: OrgEntry[] = [];
  for (const group of batches(base, CONCURRENCY)) {
    const flags = await Promise.all(group.map((o) => hasOrgFile(client, o.login)));
    group.forEach((o, i) => out.push({ ...o, hasFile: flags[i] }));
  }
  const list: OrgList = { orgs: out, fetchedAt: opts.now, user: opts.user, sources };
  if (out.length) await kv.set(KEY, list); // an empty list is more likely a missing permission than the truth: ask again next time
  return list;
}
