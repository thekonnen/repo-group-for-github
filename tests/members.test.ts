// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/background/api';
import { memoryKV } from '../src/background/kv';
import { createHandler } from '../src/background/handlers';
import { loadTeamMembers, teamMembersKey } from '../src/background/members-data';
import { memoryIndexStore } from '../src/background/repo-index';
import { aggregateMembers, filterPeople, filterTeamGroups, membersByTeam, viaText, viaTeams, type MembersByTeam } from '../src/core/members';
import type { Group } from '../src/core/types';
import { mountOrgRepos, type Mounted } from '../src/features/mount';
import { CallError } from '../src/github/client';
import type { Request } from '../src/github/messages';
import { example } from './fixtures';
import { fakeFetch, type Route } from './fake-github';
import { fakeCall, memberAccess } from './page-helpers';

const g = (name: string, teams: Group['teams'] = [], groups: Group[] = []): Group => ({ name, title: '', description: '', keywords: [], logo: '', teams, match: [], groups }) as Group;
const T = (slug: string, permission: any = 'push') => ({ slug, permission });
const m = (login: string, name: string | null = null) => ({ login, name, avatarUrl: `https://avatars.example/${login}` });

describe('aggregateMembers (C3)', () => {
  const tree = [g('infra', [T('core_team'), T('ops', 'admin')], [g('dagsrv', [T('core_team', 'pull')]), g('authn')])];
  const members: MembersByTeam = { core_team: [m('bob'), m('Alice', 'Alice A'), m('carol')], ops: [m('alice'), m('dave')] };

  it('inherits ancestors’ teams and lists each person with their teams, highest permission first', () => {
    const people = aggregateMembers(tree, ['infra', 'authn'], members);
    expect(people.map((p) => p.login)).toEqual(['Alice', 'bob', 'carol', 'dave']); // sorted by login, deduplicated case-insensitively
    const alice = people[0];
    expect(alice.name).toBe('Alice A');
    expect(alice.best).toBe('admin');
    expect(alice.via.map((v) => [v.team, v.permission, v.inherited, v.from])).toEqual([['ops', 'admin', true, 'infra'], ['core_team', 'push', true, 'infra']]);
    expect(people.find((p) => p.login === 'bob')!.best).toBe('push');
  });

  it('closest definition wins per slug: a subgroup can lower what its parent set', () => {
    const people = aggregateMembers(tree, ['infra', 'dagsrv'], members);
    const bob = people.find((p) => p.login === 'bob')!;
    expect(bob.via).toEqual([{ team: 'core_team', permission: 'pull', from: 'infra/dagsrv', inherited: false }]);
    expect(bob.best).toBe('pull');
    // the person also in ops keeps the highest across teams
    expect(people.find((p) => p.login === 'Alice')!.best).toBe('admin');
  });

  it('a parent group sees only its own teams, not those of its subgroups', () => {
    expect(viaTeams(tree, ['infra']).map((v) => v.team)).toEqual(['core_team', 'ops']);
    expect(viaTeams(tree, ['infra', 'dagsrv']).map((v) => [v.team, v.inherited])).toEqual([['core_team', false], ['ops', true]]);
  });

  it('teams that are not loaded contribute nobody; a group without teams has no people', () => {
    expect(aggregateMembers(tree, ['infra'], { ops: [m('dave')] }).map((p) => p.login)).toEqual(['dave']);
    expect(aggregateMembers([g('x')], ['x'], members)).toEqual([]);
    expect(aggregateMembers(tree, ['nope'], members)).toEqual([]);
  });

  it('ranks custom roles by their base role, unknown ones last', () => {
    const t = [g('a', [T('t1', 'reviewer'), T('t2', 'mystery'), T('t3', 'pull')])];
    const p = aggregateMembers(t, ['a'], { t1: [m('x')], t2: [m('x')], t3: [m('x')] }, { reviewer: 'maintain' });
    expect(p[0].via.map((v) => v.team)).toEqual(['t1', 't3', 't2']);
    expect(p[0].best).toBe('reviewer');
  });

  it('groups by team (highest permission first) and searches', () => {
    const teams = membersByTeam(tree, ['infra', 'dagsrv'], members);
    expect(teams.map((t) => [t.team, t.permission, t.inherited, t.people.length])).toEqual([['ops', 'admin', true, 2], ['core_team', 'pull', false, 3]]);
    expect(teams[1].people.map((p) => p.login)).toEqual(['Alice', 'bob', 'carol']);
    const people = aggregateMembers(tree, ['infra'], members);
    expect(filterPeople(people, 'ALICE A').map((p) => p.login)).toEqual(['Alice']);
    expect(filterPeople(people, 'ops').map((p) => p.login)).toEqual(['Alice', 'dave']); // team slug matches
    expect(filterPeople(people, '').length).toBe(4);
    expect(filterTeamGroups(teams, 'dave').map((t) => [t.team, t.people.map((p) => p.login)])).toEqual([['ops', ['dave']]]);
    expect(filterTeamGroups(teams, 'core').map((t) => t.people.length)).toEqual([3]); // a team match keeps everyone
  });

  it('writes the provenance text', () => {
    expect(viaText({ team: 'core_team', permission: 'push', from: 'infra', inherited: true })).toBe('via core_team · Write · inherited from infra');
    expect(viaText({ team: 'core_team', permission: 'pull', from: 'infra/dagsrv', inherited: false })).toBe('via core_team · Read');
  });
});

// ---------- background: GraphQL, pagination, cache, permission errors ----------

const gqlBody = (call: { body?: string }) => JSON.parse(call.body!) as { query: string; variables: Record<string, any> };
const membersRoute = (data: Record<string, string[]>, forbid: string[] = []): Route => (url, call) => {
  if (url.pathname !== '/graphql' || call.method !== 'POST') return undefined;
  const { query, variables } = gqlBody(call);
  if (!query.includes('members(first')) return undefined;
  if (forbid.includes(variables.slug)) {
    return { json: { data: { organization: { team: null } }, errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }] } };
  }
  const all = data[variables.slug];
  if (!all) return { json: { data: { organization: { team: null } } } };
  const start = variables.after ? Number(variables.after) : 0;
  return {
    json: { data: { organization: { team: { members: { pageInfo: { hasNextPage: start + 2 < all.length, endCursor: String(start + 2) }, nodes: all.slice(start, start + 2).map((login) => ({ login, name: login === 'a' ? 'Ann' : '', avatarUrl: `https://avatars.example/${login}` })) } } } } },
  };
};
const client = (f: ReturnType<typeof fakeFetch>) => createClient({ fetch: f.fetch, getToken: async () => 't' });

describe('team members (GraphQL)', () => {
  it('pages through members of only the teams asked for, and caches per org + team', async () => {
    const f = fakeFetch(membersRoute({ core_team: ['a', 'b', 'c'], ops: ['d'] }));
    const kv = memoryKV();
    const r = await loadTeamMembers(client(f), kv, 'o', ['core_team', 'core_team'], { now: () => 1000 });
    expect(r.members.core_team).toEqual([{ login: 'a', name: 'Ann', avatarUrl: 'https://avatars.example/a' }, { login: 'b', name: null, avatarUrl: 'https://avatars.example/b' }, { login: 'c', name: null, avatarUrl: 'https://avatars.example/c' }]);
    expect(Object.keys(r.members)).toEqual(['core_team']);
    expect(f.calls).toHaveLength(2);
    expect(f.calls.every((c) => c.method === 'POST' && c.url.endsWith('/graphql'))).toBe(true); // read only
    expect(gqlBody(f.calls[1]).variables).toMatchObject({ org: 'o', slug: 'core_team', after: '2' });
    expect(await kv.get(teamMembersKey('o', 'core_team'))).toBeTruthy();
    await loadTeamMembers(client(f), kv, 'o', ['core_team'], { now: () => 1000 + 60_000 }); // within the interval
    expect(f.calls).toHaveLength(2);
    await loadTeamMembers(client(f), kv, 'o', ['core_team'], { now: () => 1000 + 6 * 60_000 }); // stale
    expect(f.calls).toHaveLength(4);
  });

  it('reports teams it cannot read instead of failing, and does not cache them', async () => {
    const f = fakeFetch(membersRoute({ ops: ['d'] }, ['secret']));
    const kv = memoryKV();
    const r = await loadTeamMembers(client(f), kv, 'o', ['ops', 'secret', 'ghost']);
    expect(r.members).toEqual({ ops: [{ login: 'd', name: null, avatarUrl: 'https://avatars.example/d' }] });
    expect(r.unreadable).toEqual({ secret: 'hidden', ghost: 'hidden' });
    expect(await kv.get(teamMembersKey('o', 'secret'))).toBeUndefined();
  });

  it('maps a REST-level 403 to forbidden', async () => {
    const f = fakeFetch(() => ({ status: 403, json: { message: 'Resource not accessible by integration' } }));
    const r = await loadTeamMembers(client(f), memoryKV(), 'o', ['ops']);
    expect(r.unreadable).toEqual({ ops: 'forbidden' });
  });

  it('is served by the background handler (team:members)', async () => {
    const f = fakeFetch(membersRoute({ ops: ['d'] }));
    const handle = createHandler({ fetch: f.fetch, kv: memoryKV(), index: memoryIndexStore() });
    const res = await handle({ type: 'team:members', org: 'o', slugs: ['ops'] } as Request);
    expect(res).toMatchObject({ ok: true, data: { members: { ops: [{ login: 'd' }] }, unreadable: {} } });
  });
});

// ---------- UI ----------

const body = readFileSync(join(process.cwd(), 'tests/fixtures/org-repos.html'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
let mounted: Mounted | null = null;
beforeEach(() => {
  document.documentElement.innerHTML = body;
});
afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.documentElement.innerHTML = '';
});
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const tab = (label: string) => $$('.rg-tab').find((t) => t.textContent!.trim().startsWith(label));

const DATA = { core_team: [m('bob', 'Bob B'), m('alice')], 'ai-squad': [m('carol')] };

async function open(hash: string, opts: { members?: (req: any) => any; access?: any; config?: any } = {}) {
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories' + hash);
  const base = fakeCall({ access: opts.access, config: opts.config });
  const log: Request[] = [];
  const call = async (req: Request) => {
    if (req.type === 'team:members') {
      log.push(req);
      if (opts.members) return opts.members(req);
      return { members: Object.fromEntries(req.slugs.filter((s) => s in DATA).map((s) => [s, (DATA as any)[s]])), unreadable: {} };
    }
    return base.call(req);
  };
  mounted = (await mountOrgRepos('thekonnen', { call: call as any }, document, 200))!;
  await vi.waitFor(() => expect($('.rg-g-head')).toBeTruthy());
  return log;
}

describe('Members tab (C3)', () => {
  it('lists people of the effective teams with provenance, links, and the honest note', async () => {
    const log = await open('#ai/llm-proxy');
    await vi.waitFor(() => expect(tab('Members')).toBeTruthy());
    expect(log).toHaveLength(0); // nothing is loaded until the tab is opened
    tab('Members')!.click();
    await vi.waitFor(() => expect($$('.rg-member').length).toBe(3));
    expect(log).toHaveLength(1);
    expect((log[0] as any).slugs).toEqual(['core_team', 'ai-squad']); // llm-proxy own core_team (Read), ai-squad inherited
    const rows = $$('.rg-member').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('alice');
    expect(rows[0]).toContain('core_team · Read');
    expect(rows[2]).toContain('carol');
    expect(rows[2]).toContain('ai-squad · Maintain · inherited from ai');
    expect($('.rg-member-login[href="https://github.com/bob"]')).toBeTruthy();
    expect($('.rg-member-via a[href="https://github.com/orgs/thekonnen/teams/core_team/repositories"]')).toBeTruthy();
    expect($('[data-rg="members-note"]')!.textContent).toMatch(/team membership.*not include individual collaborators.*organization owners/);
  });

  it('toggles to by team, and searches', async () => {
    await open('#ai/llm-proxy');
    await vi.waitFor(() => expect(tab('Members')).toBeTruthy());
    tab('Members')!.click();
    await vi.waitFor(() => expect($$('.rg-member').length).toBe(3));
    ($$('.rg-view-seg button').find((b) => b.textContent === 'By team'))!.click();
    await vi.waitFor(() => expect($$('.rg-members-team').length).toBe(2));
    expect($$('.rg-members-team h3').map((h) => h.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['ai-squad · Maintain · inherited from ai', 'core_team · Read']);
    const input = $('.rg-members input[type="search"]') as HTMLInputElement;
    input.value = 'bob';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect($$('.rg-member').length).toBe(1));
    expect($('.rg-member')!.textContent).toContain('bob');
  });

  it('is not offered on the root', async () => {
    await open('');
    await vi.waitFor(() => expect(tab('Groups and repositories')).toBeTruthy());
    expect(tab('Members')).toBeUndefined();
  });

  it('says so, without crashing, when the user cannot read members', async () => {
    await open('#ai/llm-proxy', { members: (req) => ({ members: {}, unreadable: Object.fromEntries(req.slugs.map((s: string) => [s, 'forbidden'])) }) });
    await vi.waitFor(() => expect(tab('Members')).toBeTruthy());
    tab('Members')!.click();
    await vi.waitFor(() => expect($('[data-rg="members-forbidden"]')).toBeTruthy());
    expect($('[data-rg="members-forbidden"]')!.textContent).toMatch(/Members: Read/);
    expect($$('.rg-member').length).toBe(0);
    expect($('[data-rg="members-note"]')).toBeTruthy();
  });

  it('treats a 403 from the background as "not available", and other failures as an error line', async () => {
    const { CallError: CE } = await import('../src/github/client');
    await open('#ai/llm-proxy', { members: () => { throw new CE({ kind: 'forbidden', message: 'no' }); } });
    await vi.waitFor(() => expect(tab('Members')).toBeTruthy());
    tab('Members')!.click();
    await vi.waitFor(() => expect($('[data-rg="members-forbidden"]')).toBeTruthy());
  });

  it('shows a plain message when the call fails for another reason', async () => {
    await open('#ai/llm-proxy', { members: () => { throw new CallError({ kind: 'network', message: 'offline' }); } });
    await vi.waitFor(() => expect(tab('Members')).toBeTruthy());
    tab('Members')!.click();
    await vi.waitFor(() => expect($('.rg-members [role="alert"]')!.textContent).toContain('offline'));
  });

  it('works read-only for members without write access (F15)', async () => {
    await open('#ai/llm-proxy', { access: memberAccess });
    await vi.waitFor(() => expect(tab('Members')).toBeTruthy());
    tab('Members')!.click();
    await vi.waitFor(() => expect($$('.rg-member').length).toBe(3));
    expect($$('.rg-members button').every((b) => /By (person|team)/.test(b.textContent!))).toBe(true); // no write buttons
  });

  it('explains a group with no teams', async () => {
    const cfg = example();
    cfg.groups.forEach(function strip(x: Group) { x.teams = []; x.groups.forEach(strip); });
    await open('#infra/dagsrv', { config: { exists: true, sha: 's', config: cfg, warnings: [] } });
    await vi.waitFor(() => expect(tab('Members')).toBeTruthy());
    tab('Members')!.click();
    await vi.waitFor(() => expect($('.rg-members')!.textContent).toContain('No teams are tagged on this group'));
  });
});
