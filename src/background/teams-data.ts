import { classifyGrantError, type GrantResult } from '../core/grant';
import { edgesToAccess, withGranted, type TeamAccess } from '../core/teams';
import type { Permission } from '../core/types';
import type { OrgTeam, TeamsResult } from '../github/messages';
import { GitHubError, type Client } from './api';
import type { KV } from './kv';

/** Same default as the repo index: teams and their access are refreshed after 5 minutes. */
export const TEAMS_TTL_MS = 5 * 60_000;

const TEAMS_Q = `query ($org: String!, $after: String) {
  organization(login: $org) {
    teams(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { slug name privacy parentTeam { slug } members { totalCount } }
    }
  }
}`;

const TEAM_REPOS_Q = `query ($org: String!, $slug: String!, $after: String) {
  organization(login: $org) {
    team(slug: $slug) {
      repositories(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { permission node { name } }
      }
    }
  }
}`;

const MAX_PAGES = 200;

/** GraphQL through the REST client (so rate-limit headers and error mapping are shared). */
export async function gql<T = any>(client: Client, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await client.rest('/graphql', { method: 'POST', body: { query, variables } });
  const errors: { type?: string; message?: string }[] | undefined = res.data?.errors;
  if (errors?.length && !res.data?.data?.organization) {
    const e = errors[0];
    const message = e.message ?? 'GitHub could not answer the teams query.';
    if (e.type === 'NOT_FOUND') throw new GitHubError(404, 'not-found', message);
    if (e.type === 'FORBIDDEN' || e.type === 'INSUFFICIENT_SCOPES') throw new GitHubError(403, 'forbidden', message);
    throw new GitHubError(200, 'other', message);
  }
  return res.data.data as T;
}

interface Cached<T> {
  at: number;
  value: T;
}

const fresh = <T>(c: Cached<T> | undefined, now: number, ttl: number): c is Cached<T> => !!c && now - c.at < ttl;

export interface TeamsOpts {
  force?: boolean;
  now?: () => number;
  ttlMs?: number;
}

export const teamsKey = (org: string) => `rg:teams:${org}`;
export const teamAccessKey = (org: string, slug: string) => `rg:team-access:${org}:${slug}`;

/** `GET /orgs/{org}/custom-repository-roles`: name -> base role. null when the list cannot be read. */
async function readCustomRoles(client: Client, org: string): Promise<Record<string, string> | null> {
  try {
    const res = await client.rest(`/orgs/${encodeURIComponent(org)}/custom-repository-roles`, { allow404: true });
    if (res.status === 404) return null;
    const out: Record<string, string> = {};
    for (const r of res.data?.custom_roles ?? []) if (r?.name) out[r.name] = r.base_role;
    return out;
  } catch (e) {
    if (e instanceof GitHubError && (e.kind === 'forbidden' || e.kind === 'not-found')) return null;
    throw e;
  }
}

/** The org's teams (paginated GraphQL, cached per org) and its custom repository roles. */
export async function loadTeams(client: Client, kv: KV, org: string, o: TeamsOpts = {}): Promise<TeamsResult> {
  const now = (o.now ?? Date.now)();
  const cached = await kv.get<Cached<TeamsResult>>(teamsKey(org));
  if (!o.force && fresh(cached, now, o.ttlMs ?? TEAMS_TTL_MS)) return cached.value;
  const teams: OrgTeam[] = [];
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const data: any = await gql(client, TEAMS_Q, { org, after });
    const conn: any = data.organization?.teams;
    for (const n of conn?.nodes ?? []) teams.push({ slug: n.slug, name: n.name, privacy: n.privacy, parent: n.parentTeam?.slug ?? null, members: n.members?.totalCount });
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  teams.sort((a, b) => a.slug.localeCompare(b.slug));
  const value: TeamsResult = { teams, customRoles: await readCustomRoles(client, org) };
  await kv.set(teamsKey(org), { at: now, value } satisfies Cached<TeamsResult>);
  return value;
}

/** Cached team slugs, for validation warnings. Never touches the network. */
export async function cachedTeamSlugs(kv: KV, org: string): Promise<string[] | undefined> {
  const c = await kv.get<Cached<TeamsResult>>(teamsKey(org));
  return c?.value.teams.map((t) => t.slug);
}

/** One team's repositories with permission (paginated GraphQL). A team that cannot be found has no repositories. */
async function fetchTeamAccess(client: Client, org: string, slug: string): Promise<Record<string, Permission>> {
  const out: Record<string, Permission> = {};
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const data: any = await gql(client, TEAM_REPOS_Q, { org, slug, after });
    const conn: any = data.organization?.team?.repositories;
    Object.assign(out, edgesToAccess(conn?.edges ?? []));
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

/**
 * Access of each given team, cached per team. Only the slugs asked for are fetched (the teams in the YAML plus the open
 * team page), one GraphQL query per page of 100 repositories, never one request per repository.
 */
export async function loadTeamAccess(client: Client, kv: KV, org: string, slugs: string[], o: TeamsOpts = {}): Promise<TeamAccess> {
  const now = (o.now ?? Date.now)();
  const out: TeamAccess = {};
  await Promise.all(
    [...new Set(slugs)].map(async (slug) => {
      const cached = await kv.get<Cached<Record<string, Permission>>>(teamAccessKey(org, slug));
      if (!o.force && fresh(cached, now, o.ttlMs ?? TEAMS_TTL_MS)) return void (out[slug] = cached.value);
      const access = await fetchTeamAccess(client, org, slug);
      await kv.set(teamAccessKey(org, slug), { at: now, value: access } satisfies Cached<Record<string, Permission>>);
      out[slug] = access;
    }),
  );
  return out;
}

/**
 * Gives `team` the permission on `repo`: `PUT /orgs/{org}/teams/{team}/repos/{org}/{repo}` with `{ permission }` (§6, §8).
 * This is the only write to team access; there is no DELETE anywhere.
 */
export async function grantTeam(client: Client, kv: KV, org: string, team: string, repo: string, permission: Permission): Promise<GrantResult> {
  const enc = encodeURIComponent;
  try {
    await client.rest(`/orgs/${enc(org)}/teams/${enc(team)}/repos/${enc(org)}/${enc(repo)}`, { method: 'PUT', body: { permission } });
  } catch (e) {
    if (e instanceof GitHubError) {
      const accepted = e.detail?.acceptedPermissions;
      if (accepted) console.debug('[RG] team grant failed; GitHub expected permissions:', accepted, `${team} -> ${repo}`);
      return classifyGrantError({ status: e.status, kind: e.kind, message: e.message, acceptedPermissions: accepted }, org);
    }
    throw e;
  }
  // Keep the cache honest without another round trip.
  const key = teamAccessKey(org, team);
  const cached = await kv.get<Cached<Record<string, Permission>>>(key);
  if (cached) {
    const next = withGranted({ [team]: cached.value }, team, repo, permission)[team];
    await kv.set(key, { at: cached.at, value: next });
  }
  return { ok: true };
}
