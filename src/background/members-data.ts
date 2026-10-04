import type { TeamMembersResult } from '../github/messages';
import { GitHubError, type Client } from './api';
import type { KV } from './kv';
import { gql, TEAMS_TTL_MS, type TeamsOpts } from './teams-data';

const MEMBERS_Q = `query ($org: String!, $slug: String!, $after: String) {
  organization(login: $org) {
    team(slug: $slug) {
      members(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { login name avatarUrl }
      }
    }
  }
}`;

const MAX_PAGES = 50;
type Members = TeamMembersResult['members'][string];
interface Cached {
  at: number;
  value: Members;
}

export const teamMembersKey = (org: string, slug: string) => `rg:team-members:${org}:${slug}`;

/** One team's members (paginated GraphQL). Returns null when GitHub answers null (team hidden or no Members permission). */
async function fetchMembers(client: Client, org: string, slug: string): Promise<Members | null> {
  const out: Members = [];
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const data: any = await gql(client, MEMBERS_Q, { org, slug, after });
    const conn: any = data?.organization?.team?.members;
    if (!conn) return null;
    for (const n of conn.nodes ?? []) if (n?.login) out.push({ login: n.login, name: n.name || null, avatarUrl: n.avatarUrl });
    if (!conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

/**
 * Members of each given team, cached per org + team with the refresh interval. Read only. A team that cannot be read is
 * reported in `unreadable` instead of failing the whole call.
 */
export async function loadTeamMembers(client: Client, kv: KV, org: string, slugs: string[], o: TeamsOpts = {}): Promise<TeamMembersResult> {
  const now = (o.now ?? Date.now)();
  const result: TeamMembersResult = { members: {}, unreadable: {} };
  await Promise.all(
    [...new Set(slugs)].map(async (slug) => {
      const cached = await kv.get<Cached>(teamMembersKey(org, slug));
      if (!o.force && cached && now - cached.at < (o.ttlMs ?? TEAMS_TTL_MS)) return void (result.members[slug] = cached.value);
      try {
        const members = await fetchMembers(client, org, slug);
        if (!members) return void (result.unreadable[slug] = 'hidden');
        await kv.set(teamMembersKey(org, slug), { at: now, value: members } satisfies Cached);
        result.members[slug] = members;
      } catch (e) {
        if (e instanceof GitHubError && (e.kind === 'forbidden' || e.kind === 'not-found')) return void (result.unreadable[slug] = e.kind === 'forbidden' ? 'forbidden' : 'hidden');
        throw e;
      }
    }),
  );
  return result;
}
