import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/background/api';
import { memoryKV } from '../src/background/kv';
import { createHandler } from '../src/background/handlers';
import { memoryIndexStore } from '../src/background/repo-index';
import { grantTeam, loadTeamAccess, loadTeams, teamAccessKey } from '../src/background/teams-data';
import { fakeFetch, type Route } from './fake-github';

const client = (f: ReturnType<typeof fakeFetch>) => createClient({ fetch: f.fetch, getToken: async () => 't' });

const isGql = (url: URL, call: { method: string }) => url.pathname === '/graphql' && call.method === 'POST';
const gqlBody = (call: { body?: string }) => JSON.parse(call.body!) as { query: string; variables: Record<string, any> };

/** Teams in pages of 2 so pagination is exercised. */
const teamsRoute = (all: string[]): Route => (url, call) => {
  if (!isGql(url, call)) return undefined;
  const { query, variables } = gqlBody(call);
  if (!query.includes('teams(first')) return undefined;
  const start = variables.after ? Number(variables.after) : 0;
  const page = all.slice(start, start + 2);
  const more = start + 2 < all.length;
  return {
    json: { data: { organization: { teams: { pageInfo: { hasNextPage: more, endCursor: String(start + 2) }, nodes: page.map((slug) => ({ slug, name: slug.toUpperCase(), privacy: 'CLOSED', parentTeam: null, members: { totalCount: 3 } })) } } } },
  };
};

/** Each team's repositories, pages of 2. */
const teamReposRoute = (data: Record<string, [string, string][]>): Route => (url, call) => {
  if (!isGql(url, call)) return undefined;
  const { query, variables } = gqlBody(call);
  if (!query.includes('team(slug')) return undefined;
  const all = data[variables.slug];
  if (!all) return { json: { data: { organization: { team: null } } } };
  const start = variables.after ? Number(variables.after) : 0;
  const page = all.slice(start, start + 2);
  return {
    json: { data: { organization: { team: { repositories: { pageInfo: { hasNextPage: start + 2 < all.length, endCursor: String(start + 2) }, edges: page.map(([name, permission]) => ({ permission, node: { name } })) } } } } },
  };
};

const roles: Route = (url) => (url.pathname === '/orgs/o/custom-repository-roles' ? { json: { total_count: 1, custom_roles: [{ name: 'reviewer', base_role: 'triage' }] } } : undefined);

describe('org teams (GraphQL)', () => {
  it('pages through the teams, reads custom roles, and caches per org', async () => {
    const f = fakeFetch(teamsRoute(['b', 'a', 'c']), roles);
    const kv = memoryKV();
    let now = 1000;
    const r = await loadTeams(client(f), kv, 'o', { now: () => now });
    expect(r.teams.map((t) => t.slug)).toEqual(['a', 'b', 'c']);
    expect(r.customRoles).toEqual({ reviewer: 'triage' });
    const gqls = f.calls.filter((c) => c.url.endsWith('/graphql'));
    expect(gqls).toHaveLength(2);
    expect(gqlBody(gqls[1]).variables.after).toBe('2');
    const before = f.calls.length;
    await loadTeams(client(f), kv, 'o', { now: () => now + 60_000 }); // within the 5 minute interval
    expect(f.calls.length).toBe(before);
    await loadTeams(client(f), kv, 'o', { now: () => (now += 6 * 60_000) }); // stale
    expect(f.calls.length).toBeGreaterThan(before);
  });
  it('custom roles are null when the user cannot read them', async () => {
    const f = fakeFetch(teamsRoute(['a']), (u) => (u.pathname.endsWith('/custom-repository-roles') ? { status: 403, json: { message: 'Must be an org owner' } } : undefined));
    expect((await loadTeams(client(f), memoryKV(), 'o')).customRoles).toBeNull();
  });
  it('surfaces a forbidden GraphQL answer (missing Members permission)', async () => {
    const f = fakeFetch((u, c) => (isGql(u, c) ? { json: { data: { organization: null }, errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }] } } : undefined));
    await expect(loadTeams(client(f), memoryKV(), 'o')).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('team access (GraphQL)', () => {
  const data = {
    core_team: [['dagsrv', 'WRITE'], ['kite-dagsrv', 'WRITE'], ['authn', 'READ'], ['keep_alive_job', 'WRITE'], ['x', 'TRIAGE']] as [string, string][],
    'ai-squad': [['oroute', 'MAINTAIN']] as [string, string][],
  };
  it('maps permissions, pages, and fetches only the teams asked for (never per repository)', async () => {
    const f = fakeFetch(teamReposRoute(data));
    const access = await loadTeamAccess(client(f), memoryKV(), 'o', ['core_team']);
    expect(access).toEqual({ core_team: { dagsrv: 'push', 'kite-dagsrv': 'push', authn: 'pull', keep_alive_job: 'push', x: 'triage' } });
    expect(f.calls).toHaveLength(3); // 5 repos in pages of 2
    expect(f.calls.every((c) => c.url.endsWith('/graphql'))).toBe(true);
    expect(f.calls.map((c) => gqlBody(c).variables.slug)).toEqual(['core_team', 'core_team', 'core_team']);
  });
  it('caches each team with the refresh interval; force bypasses it; a team that is not found has no repositories', async () => {
    const f = fakeFetch(teamReposRoute(data));
    const kv = memoryKV();
    const now = () => 5000;
    await loadTeamAccess(client(f), kv, 'o', ['ai-squad', 'nope'], { now });
    const n = f.calls.length;
    expect(await loadTeamAccess(client(f), kv, 'o', ['ai-squad', 'nope'], { now: () => 6000 })).toEqual({ 'ai-squad': { oroute: 'maintain' }, nope: {} });
    expect(f.calls.length).toBe(n);
    await loadTeamAccess(client(f), kv, 'o', ['ai-squad'], { now: () => 6000, force: true });
    expect(f.calls.length).toBe(n + 1);
    expect(kv.data.has(teamAccessKey('o', 'ai-squad'))).toBe(true);
  });
});

describe('grant access (team repos PUT)', () => {
  const put = (reply: any) => fakeFetch((u, c) => (c.method === 'PUT' && u.pathname.startsWith('/orgs/o/teams/') ? reply : undefined));

  it('sends PUT /orgs/{org}/teams/{slug}/repos/{org}/{repo} with the permission, and raises the cache', async () => {
    const f = put({ status: 204 });
    const kv = memoryKV();
    await kv.set(teamAccessKey('o', 't'), { at: 1, value: { r: 'pull' } });
    const res = await grantTeam(client(f), kv, 'o', 't', 'r', 'push');
    expect(res).toEqual({ ok: true });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ method: 'PUT', url: 'https://api.github.com/orgs/o/teams/t/repos/o/r' });
    expect(JSON.parse(f.calls[0].body!)).toEqual({ permission: 'push' });
    expect((await kv.get<any>(teamAccessKey('o', 't')))!.value).toEqual({ r: 'push' });
  });
  it('403 and 404 mean "ask an org owner"; the accepted-permissions header is logged and kept in the detail', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    for (const status of [403, 404]) {
      const f = put({ status, json: { message: status === 403 ? 'Must have admin rights to Repository.' : 'Not Found' }, headers: { 'x-accepted-github-permissions': 'administration=write; members=read' } });
      const res = await grantTeam(client(f), memoryKV(), 'o', 't', 'r', 'push');
      expect(res).toMatchObject({ ok: false, kind: 'admin', message: 'You need admin access to this repository — ask an org owner' });
      expect((res as any).detail).toContain('administration=write');
    }
    expect(debug.mock.calls.some((c) => String(c[0]).startsWith('[RG]'))).toBe(true);
    debug.mockRestore();
  });
  it('422 shows GitHub’s message', async () => {
    const res = await grantTeam(client(put({ status: 422, json: { message: 'Validation Failed: repository is not owned by the organization' } })), memoryKV(), 'o', 't', 'r', 'push');
    expect(res).toMatchObject({ ok: false, kind: 'validation', message: 'Validation Failed: repository is not owned by the organization' });
  });
  it('403 "not accessible by integration" (permissions changed, not yet accepted) points to the installation settings', async () => {
    const res = await grantTeam(client(put({ status: 403, json: { message: 'Resource not accessible by integration' } })), memoryKV(), 'o', 't', 'r', 'push');
    expect(res).toMatchObject({ ok: false, kind: 'permissions', message: 'Repository Group for Github needs new permissions in o. An org owner must accept the update in Settings → GitHub Apps.' });
  });
});

describe('handler messages', () => {
  const deps = (f: ReturnType<typeof fakeFetch>) => ({ fetch: f.fetch, kv: memoryKV(), index: memoryIndexStore(), clientId: 'cid' });

  it('team:grant goes through as one PUT and never a DELETE', async () => {
    const f = put204();
    const h = createHandler(deps(f));
    const r = await h({ type: 'team:grant', org: 'o', team: 't', repo: 'r', permission: 'maintain' });
    expect(r).toEqual({ ok: true, data: { ok: true } });
    expect(f.calls.map((c) => c.method)).toEqual(['PUT']);
  });
  it('org:config warns about team slugs that do not exist in the org (and only warns)', async () => {
    const yml = 'groups:\n  - name: infra\n    teams: ["core_team", "ghost"]\n    match: ["a"]\n';
    const f = fakeFetch(
      (u) => (u.pathname === '/repos/o/.github/contents/repo-groups.yml' ? { json: { sha: 's1', content: btoa(yml) }, headers: { etag: 'e1' } } : undefined),
      teamsRoute(['core_team']),
      roles,
    );
    const h = createHandler({ ...deps(f), kv: authedKV() });
    const r: any = await h({ type: 'org:config', org: 'o' });
    expect(r.ok).toBe(true);
    expect(r.data.config.groups[0].teams.map((t: any) => t.slug)).toEqual(['core_team', 'ghost']);
    expect(r.data.warnings).toEqual(['"infra": team "ghost" was not found in o.']);
  });
});

function put204() {
  return fakeFetch((u, c) => (c.method === 'PUT' ? { status: 204 } : undefined));
}

/** A KV that already holds a token, so API calls are authenticated. */
function authedKV() {
  const kv = memoryKV();
  kv.data.set('rg:auth', { token: 't', kind: 'oauth', login: 'me', avatar: '' });
  return kv;
}
