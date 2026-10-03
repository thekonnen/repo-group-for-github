// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryKV } from '../src/background/kv';
import { createHandler } from '../src/background/handlers';
import { memoryIndexStore } from '../src/background/repo-index';
import { mountOrgRepos, mountTeamRepos, type Mounted } from '../src/features/mount';
import { CallError } from '../src/github/client';
import type { Request } from '../src/github/messages';
import { locateTeamRepos } from '../src/github/selectors';
import { example } from './fixtures';
import { fakeFetch, type Route } from './fake-github';
import { fakeCall, memberAccess } from './page-helpers';

const read = (f: string) => readFileSync(join(process.cwd(), 'tests/fixtures', f), 'utf8').replace(/<!--[\s\S]*?-->/, '');
const orgHtml = read('org-repos.html');
const teamHtml = read('team-repos.html');
let mounted: Mounted | null = null;

afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.documentElement.innerHTML = '';
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const btn = (label: string | RegExp, within: ParentNode = document) =>
  ([...within.querySelectorAll('button, a')] as HTMLElement[]).find((b) => (typeof label === 'string' ? b.textContent!.trim() === label : label.test(b.textContent!.trim())))!;
const names = () => $$('.rg-root[data-rg="view"] .rg-row .rg-row-title a').map((a) => a.textContent!.trim());

// ----- a fake GitHub for the teams endpoints, driven through the real background handler -----

const ENUM: Record<string, string> = { pull: 'READ', triage: 'TRIAGE', push: 'WRITE', maintain: 'MAINTAIN', admin: 'ADMIN' };

function backend(initial: Record<string, Record<string, string>>, opts: { deny?: Record<string, { status: number; message: string }>; teams?: string[] } = {}) {
  const access = structuredClone(initial);
  const slugs = opts.teams ?? Object.keys(initial);
  const gql: Route = (url, call) => {
    if (url.pathname !== '/graphql') return undefined;
    const { query, variables } = JSON.parse(call.body!);
    if (query.includes('teams(first')) return { json: { data: { organization: { teams: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: slugs.map((slug) => ({ slug, name: slug, privacy: 'CLOSED', parentTeam: null, members: { totalCount: 1 } })) } } } } };
    const repos = access[variables.slug];
    if (!repos) return { json: { data: { organization: { team: null } } } };
    return { json: { data: { organization: { team: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, edges: Object.entries(repos).map(([name, p]) => ({ permission: ENUM[p], node: { name } })) } } } } } };
  };
  const put: Route = (url, call) => {
    const m = url.pathname.match(/^\/orgs\/thekonnen\/teams\/([^/]+)\/repos\/thekonnen\/([^/]+)$/);
    if (!m || call.method !== 'PUT') return undefined;
    const deny = opts.deny?.[m[2]];
    if (deny) return { status: deny.status, json: { message: deny.message }, headers: { 'x-accepted-github-permissions': 'administration=write; members=read' } };
    (access[m[1]] ??= {})[m[2]] = JSON.parse(call.body!).permission;
    return { status: 204 };
  };
  const f = fakeFetch(gql, put);
  const handle = createHandler({ fetch: f.fetch, kv: memoryKV(), index: memoryIndexStore() });
  const writes = () => f.calls.filter((c) => c.method !== 'GET' && !c.url.endsWith('/graphql'));
  return { access, f, handle, writes };
}

/** Page requests for teams go to the real handler (fake fetch); everything else is the usual fake. */
function harness(be: ReturnType<typeof backend>, opts: Parameters<typeof fakeCall>[0] = {}) {
  const base = fakeCall(opts);
  const log: Request[] = [];
  const call = async (req: Request) => {
    log.push(req);
    if (req.type === 'org:teams' || req.type === 'team:access' || req.type === 'team:grant' || req.type === 'yaml:validate') {
      const r = await be.handle(req);
      if (!r.ok) throw new CallError(r.error);
      return r.data;
    }
    return base.call(req);
  };
  return { call: call as any, log };
}

/** Only infra is tagged konnen_team (Write): the F12 done-when setup. */
const infraOnly = () => {
  const cfg = example();
  cfg.groups[1].teams = [];
  cfg.groups[1].groups[0].teams = [];
  return { exists: true, sha: 'sha1', config: cfg, warnings: [] };
};
const KT = { dagu: 'push', 'konnen-dagu': 'push', authentik: 'pull', keep_supabase_alive: 'push' };

async function openTeam(be: ReturnType<typeof backend>, opts: Parameters<typeof fakeCall>[0] = {}) {
  document.documentElement.innerHTML = teamHtml;
  window.history.replaceState(null, '', '/orgs/thekonnen/teams/konnen_team/repositories');
  const h = harness(be, { config: infraOnly(), ...opts });
  mounted = (await mountTeamRepos('thekonnen', 'konnen_team', { call: h.call }, document, 200))!;
  await vi.waitFor(() => expect($('.rg-g-head')).toBeTruthy());
  return h;
}

describe('team page selectors', () => {
  beforeEach(() => (document.documentElement.innerHTML = teamHtml));
  it('takes over the list column and keeps GitHub’s team header and tabs', () => {
    const m = locateTeamRepos(document, 'thekonnen')!;
    expect(m.column.id).toBe('team-content');
    expect(m.filterList).toBeNull();
    expect(m.column.contains($('nav.tabs'))).toBe(false);
    expect(m.column.contains($('h1'))).toBe(false);
  });
  it('works without a search box (falls back to the first repository link) and ignores tab links', () => {
    $('.toolbar')!.remove();
    expect(locateTeamRepos(document, 'thekonnen')!.column.id).toBe('team-content');
  });
  it('does nothing when there is no list to take over', () => {
    $('#team-content')!.remove();
    expect(locateTeamRepos(document, 'thekonnen')).toBeNull();
    // an empty team has no repository links: the search box alone is enough to mount (banners may still apply)
    document.documentElement.innerHTML = '<body><main><h1>t</h1><div id="x"><input placeholder="Search repositories"></div></main></body>';
    expect(locateTeamRepos(document, 'thekonnen')!.column.id).toBe('x');
    document.documentElement.innerHTML = '<body><main><h1>t</h1><div id="x"><p>No repositories</p></div></main></body>';
    expect(locateTeamRepos(document, 'thekonnen')).toBeNull();
  });
});

describe('team repositories page (F12)', () => {
  it('shows only what the team can access, in the org’s groups, with its permission on each row', async () => {
    await openTeam(backend({ konnen_team: KT }));
    await vi.waitFor(() => expect(names()).toContain('infra'));
    expect($('#team-content')!.classList.contains('rg-hidden')).toBe(true); // GitHub's list is replaced
    expect($('nav.tabs')!.classList.contains('rg-hidden')).toBe(false); // the team header and tabs stay
    expect($('.rg-view h1')!.textContent).toBe('konnen_team');
    expect(names()).toEqual(['infra', 'dagu', 'authentik', 'keep_supabase_alive']); // ai and checkmate hold nothing the team reaches
    expect($$('.rg-root[data-rg="view"] .rg-repo-label, .rg-root[data-rg="view"] .rg-row .rg-label').map((l) => l.textContent)).toContain('Write');
    expect($('[data-rg="side"]')).toBeNull();
    // open the dagu subgroup: its repos carry the team's permission instead of Public/Private
    (document.querySelector('.rg-chev[aria-label="Expand dagu"]') as HTMLElement).click();
    await vi.waitFor(() => expect(names()).toContain('konnen-dagu'));
    const row = (name: string) => $$('.rg-row').find((r) => r.querySelector('.rg-row-title a')?.textContent === name)!;
    expect(row('konnen-dagu').querySelector('.rg-label')!.textContent).toBe('Write');
    (document.querySelector('.rg-chev[aria-label="Expand authentik"]') as HTMLElement).click();
    await vi.waitFor(() => expect(names()).toContain('authentik')); // group row and repo row share the name
    expect($$('.rg-row').filter((r) => r.querySelector('.rg-row-title a')?.textContent === 'authentik').map((r) => r.querySelector('.rg-label')!.textContent)).toEqual(['Group', 'Read']);
    expect($$('.rg-row').find((r) => r.querySelector('.rg-row-title a')?.textContent === 'keep_supabase_alive')!.querySelector('.rg-label')!.textContent).toBe('Write');
  });

  it('groups tagged with the team get a highlighted chip; chips open the team page', async () => {
    await openTeam(backend({ konnen_team: KT }));
    await vi.waitFor(() => expect(names()).toContain('infra'));
    const chip = $('.rg-row .rg-tchip')!;
    expect(chip.textContent).toBe('konnen_team');
    expect(chip.classList.contains('rg-on')).toBe(true);
    expect(chip.getAttribute('href')).toBe('https://github.com/orgs/thekonnen/teams/konnen_team/repositories');
  });

  it('F12 done-when: banner "4 repositories", Sync access lists exactly those four rows, granting leaves keep_supabase_alive alone, PUT only', async () => {
    const be = backend({ konnen_team: KT });
    const h = await openTeam(be);
    await vi.waitFor(() => expect($('[data-rg="sync-banner"]')).toBeTruthy());
    const banner = $('[data-rg="sync-banner"]')!;
    expect(banner.textContent).toContain('4 repositories');
    expect(banner.textContent).toContain('in groups tagged konnen_team don’t give it the access set in repo-groups.yml.');
    expect(banner.classList.contains('rg-banner-warn')).toBe(false); // the accent banner
    // the neutral one: keep_supabase_alive is reachable but in no tagged group
    const info = $('[data-rg="untagged-banner"]')!;
    expect(info.textContent).toContain('1 repository this team can access is in groups not tagged for it');
    expect(info.textContent).toContain('never removes');
    expect(info.querySelector('li')).toBeNull();
    btn('Show list', info).click();
    await vi.waitFor(() => expect([...info.querySelectorAll('li a')].map((a) => a.textContent)).toEqual(['keep_supabase_alive']));

    btn('Review & sync', banner).click();
    await vi.waitFor(() => expect($$('.rg-sync-row[data-repo]')).toHaveLength(4));
    expect($('#rg-sync-title')!.textContent).toBe('Sync access');
    expect($('.rg-sync-head')!.textContent).toBe('Give konnen_team access to 4 repositories');
    const rows = $$('.rg-sync-row[data-repo]').map((r) => [r.dataset.repo, r.dataset.team, ...[...r.querySelectorAll('[role="cell"]')].slice(3).map((c) => c.textContent)]);
    expect(rows).toEqual([
      ['authentik', 'konnen_team', 'Read', 'Write'],
      ['dags-repo', 'konnen_team', 'none', 'Write'],
      ['konnen-authentik', 'konnen_team', 'none', 'Write'],
      ['konnen-checkmate', 'konnen_team', 'none', 'Write'],
    ]);
    expect($$('.rg-sync-row[data-repo] input').every((i) => (i as HTMLInputElement).checked)).toBe(true);

    btn(/^Grant access/).click();
    await vi.waitFor(() => expect($$('.rg-sync-note.rg-ok').map((n) => n.textContent)).toEqual(['Granted', 'Granted', 'Granted', 'Granted']));
    // requests: only PUT, one per row, never keep_supabase_alive, never DELETE
    const writes = be.writes();
    expect(writes.map((w) => w.method)).toEqual(['PUT', 'PUT', 'PUT', 'PUT']);
    expect(writes.map((w) => w.url.split('/repos/thekonnen/')[1]).sort()).toEqual(['authentik', 'dags-repo', 'konnen-authentik', 'konnen-checkmate']);
    expect(writes.every((w) => JSON.parse(w.body!).permission === 'push')).toBe(true);
    expect(be.f.calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(be.access.konnen_team.keep_supabase_alive).toBe('push');
    expect(be.f.stats.maxInflight).toBeLessThanOrEqual(3);
    expect(be.f.stats.maxInflight).toBeGreaterThanOrEqual(2);
    expect(h.log.filter((r) => r.type === 'team:grant')).toHaveLength(4);
    // the page refreshed the team's access: the banner is gone and the newly reachable repos show up
    await vi.waitFor(() => expect($('[data-rg="sync-banner"]')).toBeNull());
    expect(be.f.calls.filter((c) => c.url.endsWith('/graphql')).length).toBeGreaterThan(1);
  });

  it('shows a result per row: admin error, GitHub’s 422 message, and the permissions-update message with its link; other rows continue', async () => {
    const be = backend(
      { konnen_team: KT },
      {
        deny: {
          'dags-repo': { status: 404, message: 'Not Found' },
          'konnen-authentik': { status: 422, message: 'Validation Failed: not owned by the organization' },
          'konnen-checkmate': { status: 403, message: 'Resource not accessible by integration' },
        },
      },
    );
    await openTeam(be);
    await vi.waitFor(() => expect($('[data-rg="sync-banner"]')).toBeTruthy());
    btn('Review & sync').click();
    await vi.waitFor(() => expect($$('.rg-sync-row[data-repo]')).toHaveLength(4));
    btn(/^Grant access/).click();
    await vi.waitFor(() => expect($$('.rg-sync-note').filter((n) => n.textContent).length).toBe(4));
    const note = (repo: string) => $(`.rg-sync-row[data-repo="${repo}"] .rg-sync-note`)!;
    expect(note('authentik').textContent).toBe('Granted');
    expect(note('dags-repo').textContent).toContain('You need admin access to this repository — ask an org owner');
    expect(note('dags-repo').textContent).toContain('administration=write'); // X-Accepted-GitHub-Permissions in the detail
    expect(note('konnen-authentik').textContent).toContain('Validation Failed: not owned by the organization');
    expect(note('konnen-checkmate').textContent).toContain('needs new permissions in thekonnen');
    expect(note('konnen-checkmate').querySelector('a')!.getAttribute('href')).toBe('https://github.com/organizations/thekonnen/settings/installations');
    expect(note('konnen-checkmate').querySelector('a')!.textContent).toBe('Settings → GitHub Apps');
    expect(be.access.konnen_team.authentik).toBe('push'); // the row that worked was applied
    // the banner now counts the three that are still missing
    await vi.waitFor(() => expect($('[data-rg="sync-banner"]')!.textContent).toContain('3 repositories'));
  });

  it('a member sees the plan, with rows they cannot apply unchecked; only repos they administer can be granted', async () => {
    const be = backend({ konnen_team: KT });
    const cached = (await import('./page-helpers')).repos.map((r) => ({ ...r, viewerIsAdmin: r.name === 'authentik' || r.name === 'dags-repo' }));
    const h = harness(be, { config: infraOnly(), access: memberAccess });
    const base = h.call;
    const call: any = async (req: Request) => {
      if (req.type === 'org:cached') return { repos: cached, meta: { lastFullSync: new Date().toISOString(), lastIncrementalSync: new Date().toISOString(), total: cached.length } };
      if (req.type === 'org:refresh') return { status: 'ok', mode: 'incremental', repos: cached, meta: { lastFullSync: new Date().toISOString(), lastIncrementalSync: new Date().toISOString(), total: cached.length } };
      return base(req);
    };
    document.documentElement.innerHTML = teamHtml;
    window.history.replaceState(null, '', '/orgs/thekonnen/teams/konnen_team/repositories');
    mounted = (await mountTeamRepos('thekonnen', 'konnen_team', { call }, document, 200))!;
    await vi.waitFor(() => expect($('[data-rg="sync-banner"]')).toBeTruthy());
    btn('Review & sync').click();
    await vi.waitFor(() => expect($$('.rg-sync-row[data-repo]')).toHaveLength(4));
    expect($('.rg-hint[role="note"]')!.textContent).toContain('You can update the 2 repositories you administer. Org owners can update all of them.');
    const checked = (repo: string) => ($(`.rg-sync-row[data-repo="${repo}"] input`) as HTMLInputElement).checked;
    expect(['authentik', 'dags-repo', 'konnen-authentik', 'konnen-checkmate'].map(checked)).toEqual([true, true, false, false]);
    expect($('.rg-sync-row[data-repo="konnen-authentik"]')!.textContent).toContain('Needs an org owner or a repo admin');
    btn(/^Grant access \(2\)/).click();
    await vi.waitFor(() => expect($$('.rg-sync-note.rg-ok')).toHaveLength(2));
    expect(be.writes().map((w) => w.url.split('/repos/thekonnen/')[1]).sort()).toEqual(['authentik', 'dags-repo']);
  });

  it('when nobody can apply a row the plan is read-only, with Copy list', async () => {
    const be = backend({ konnen_team: KT });
    await openTeam(be, { access: memberAccess });
    await vi.waitFor(() => expect($('[data-rg="sync-banner"]')).toBeTruthy());
    btn('Review & sync').click();
    await vi.waitFor(() => expect($$('.rg-sync-row[data-repo]')).toHaveLength(4));
    expect($$('.rg-sync-row[data-repo] input').every((i) => !(i as HTMLInputElement).checked && (i as HTMLInputElement).disabled)).toBe(true);
    expect(btn(/^Grant access/)).toBeUndefined();
    expect($('.rg-hint[role="note"]')!.textContent).toContain('Copy the list');
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    btn('Copy list').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toBe(['thekonnen/authentik\tkonnen_team\tWrite', 'thekonnen/dags-repo\tkonnen_team\tWrite', 'thekonnen/konnen-authentik\tkonnen_team\tWrite', 'thekonnen/konnen-checkmate\tkonnen_team\tWrite'].join('\n'));
    expect(be.writes()).toEqual([]);
  });

  it('shows no banner when the team already has the access; list/grouped toggle works like F4', async () => {
    const full = { dagu: 'push', 'konnen-dagu': 'push', authentik: 'push', 'dags-repo': 'push', 'konnen-authentik': 'push', 'konnen-checkmate': 'push' };
    await openTeam(backend({ konnen_team: full }));
    await vi.waitFor(() => expect(names()).toContain('infra'));
    expect($('[data-rg="sync-banner"]')).toBeNull();
    expect($('[data-rg="untagged-banner"]')).toBeNull();
    expect(btn('Edit group')).toBeUndefined(); // the team page is a read-only view of the tree
    expect(btn('New repository')).toBeUndefined();
    ($('.rg-view-seg button[title="GitHub list view"]') as HTMLElement).click();
    await vi.waitFor(() => expect($('#team-content')!.classList.contains('rg-hidden')).toBe(false));
    expect($('.rg-banner')!.textContent).toContain('GitHub’s default list');
  });

  it('says so when the team’s access cannot be read, instead of loading forever', async () => {
    const be = backend({ konnen_team: KT });
    const h = harness(be);
    const call: any = async (req: Request) => {
      if (req.type === 'team:access') throw new CallError({ kind: 'forbidden', message: 'Resource not accessible by integration' });
      return h.call(req);
    };
    document.documentElement.innerHTML = teamHtml;
    window.history.replaceState(null, '', '/orgs/thekonnen/teams/konnen_team/repositories');
    mounted = (await mountTeamRepos('thekonnen', 'konnen_team', { call }, document, 200))!;
    await vi.waitFor(() => expect($('.rg-banner[role="alert"]')!.textContent).toContain('Could not read what konnen_team can access.'));
  });
});

describe('teams on the org page', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = orgHtml;
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories');
  });
  const open = async (be = backend({ konnen_team: KT, 'ai-squad': {} }), opts: Parameters<typeof fakeCall>[0] = {}) => {
    const h = harness(be, opts);
    mounted = (await mountOrgRepos('thekonnen', { call: h.call }, document, 200))!;
    await vi.waitFor(() => expect($('.rg-g-head')).toBeTruthy());
    return { h, be };
  };

  it('group rows show team chips (inherited ones muted, at most 2 then +n); the sidebar lists the teams from the file', async () => {
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories#ai');
    await open();
    await vi.waitFor(() => expect(names()).toContain('litellm'));
    const row = $$('.rg-row').find((r) => r.querySelector('.rg-row-title a')?.textContent === 'litellm')!;
    expect([...row.querySelectorAll('.rg-tchip')].map((c) => [c.textContent, c.classList.contains('rg-inh')])).toEqual([['konnen_team', false], ['ai-squad', true]]);
    // the sidebar Teams section
    const links = $$('[data-rg="side"] .rg-nav-link');
    expect(links.map((a) => a.textContent)).toEqual(['ai-squad', 'konnen_team']);
    expect(links[1].getAttribute('href')).toBe('https://github.com/orgs/thekonnen/teams/konnen_team/repositories');
    expect($('[data-rg="side"]')!.textContent).toContain('Teams');
  });

  it('"+n" shows the remaining teams', async () => {
    const cfg = example();
    cfg.groups[0].teams = ['a', 'b', 'c', 'd'].map((slug) => ({ slug, permission: 'push' }));
    await open(backend({}), { config: { exists: true, sha: 's', config: cfg, warnings: [] } });
    await vi.waitFor(() => expect(names()).toContain('infra'));
    const row = $$('.rg-row').find((r) => r.querySelector('.rg-row-title a')?.textContent === 'infra')!;
    expect([...row.querySelectorAll('.rg-tchip')].map((c) => c.textContent)).toEqual(['a', 'b', '+2']);
    btn('+2', row).click();
    await vi.waitFor(() => expect([...row.querySelectorAll('.rg-tchip')].map((c) => c.textContent)).toEqual(['a', 'b', 'c', 'd']));
  });

  it('the group header chip opens a menu with Sync access for the teams of that group', async () => {
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories#infra');
    const { be } = await open(backend({ konnen_team: KT }), { config: infraOnly() });
    await vi.waitFor(() => expect($('.rg-g-title .rg-tchip')).toBeTruthy());
    $('.rg-g-title .rg-tchip')!.click();
    await vi.waitFor(() => expect($('.rg-menu[role="menu"]')).toBeTruthy());
    expect($('.rg-menu a')!.getAttribute('href')).toBe('https://github.com/orgs/thekonnen/teams/konnen_team/repositories');
    btn('Sync access…').click();
    await vi.waitFor(() => expect($$('.rg-sync-row[data-repo]')).toHaveLength(4));
    expect(be.writes()).toEqual([]); // opening the drawer never writes
  });
});

describe('Teams field in Edit group', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = orgHtml;
  });
  async function openEdit(hash: string, edit?: (req: any) => any, be = backend({ konnen_team: KT, 'ai-squad': {}, extra: {} }, { teams: ['ai-squad', 'extra', 'konnen_team'] })) {
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories' + hash);
    const h = harness(be, { edit, config: infraOnly() });
    mounted = (await mountOrgRepos('thekonnen', { call: h.call }, document, 200))!;
    await vi.waitFor(() => expect(btn('Edit group')).toBeTruthy());
    btn('Edit group').click();
    await vi.waitFor(() => expect($('.rg-drawer')).toBeTruthy());
    return { h, be };
  }
  const fieldTeams = () => $$('.rg-tlist .rg-trow').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());

  it('shows own teams with a permission select, and inherited ones read-only and muted', async () => {
    await openEdit('#infra/dagu');
    await vi.waitFor(() => expect($('.rg-tlist')).toBeTruthy());
    expect(fieldTeams()).toEqual(['konnen_teamWrite · from infra']);
    expect($('.rg-trow.rg-inh select')).toBeNull();
    expect($('#rg-f-teams-l')!.textContent).toBe('Teams');
  });

  it('adds a team from the picker, changes its permission, removes it, and commits the teams with the edit', async () => {
    const saved: any[] = [];
    const { h } = await openEdit('#infra', (req) => {
      saved.push(req.edit);
      const cfg = structuredClone(example());
      return { status: 'ok', sha: 'sha-2', config: cfg, warnings: [] };
    });
    await vi.waitFor(() => expect($$('.rg-tlist .rg-trow select')).toHaveLength(1));
    expect(($('.rg-tlist .rg-trow select') as HTMLSelectElement).value).toBe('push');
    expect([...($('.rg-tlist .rg-trow select') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Read', 'Triage', 'Write', 'Maintain', 'Admin']);

    btn('Add team').click();
    await vi.waitFor(() => expect($('[role="listbox"]')).toBeTruthy());
    await vi.waitFor(() => expect($$('[role="option"]').map((o) => o.textContent!.trim())).toEqual(['ai-squad', 'extra'])); // konnen_team is already on the group
    const input = $('[role="combobox"]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect($$('[role="option"]')[1].getAttribute('aria-selected')).toBe('true'));
    expect(input.getAttribute('aria-activedescendant')).toBe($$('[role="option"]')[1].id);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fieldTeams().some((t) => t.startsWith('extra'))).toBe(true));
    expect($('[role="listbox"]')).toBeNull();

    const sel = $$('.rg-tlist .rg-trow select')[1] as HTMLSelectElement;
    sel.value = 'maintain';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(($$('.rg-tlist .rg-trow select')[1] as HTMLSelectElement).value).toBe('maintain'));

    ($('[aria-label="Remove team konnen_team"]') as HTMLElement).click();
    await vi.waitFor(() => expect($$('.rg-tlist .rg-trow select')).toHaveLength(1));
    btn('Save changes').click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ kind: 'edit', path: ['infra'], teams: [{ slug: 'extra', permission: 'maintain' }] });
    expect(h.log.some((r) => r.type === 'org:edit')).toBe(true);
  });

  it('Save stays disabled until the teams change; a warning shows for a team that is not in the org', async () => {
    const cfg = infraOnly();
    cfg.config.groups[0].teams.push({ slug: 'ghost', permission: 'pull' });
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories#infra');
    const h = harness(backend({ konnen_team: KT }), { config: cfg });
    mounted = (await mountOrgRepos('thekonnen', { call: h.call }, document, 200))!;
    await vi.waitFor(() => expect(btn('Edit group')).toBeTruthy());
    btn('Edit group').click();
    await vi.waitFor(() => expect($('.rg-drawer')).toBeTruthy());
    expect((btn('Save changes') as HTMLButtonElement).disabled).toBe(true);
    await vi.waitFor(() => expect($('.rg-hint.rg-warn')!.textContent).toBe('Team “ghost” was not found in thekonnen.'));
    ($('[aria-label="Permission for konnen_team"]') as HTMLSelectElement).value = 'admin';
    $('[aria-label="Permission for konnen_team"]')!.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect((btn('Save changes') as HTMLButtonElement).disabled).toBe(false));
  });

  it('Sync access from the drawer opens the plan for the group; it is disabled while team changes are unsaved', async () => {
    const { be } = await openEdit('#infra');
    const sync = () => btn('Sync access') as HTMLButtonElement;
    await vi.waitFor(() => expect(sync()).toBeTruthy());
    expect(sync().disabled).toBe(false);
    ($('[aria-label="Remove team konnen_team"]') as HTMLElement).click();
    await vi.waitFor(() => expect($('.rg-trow-actions')!.textContent).toContain('Add team'));
    expect((btn('Sync access') as HTMLButtonElement).disabled).toBe(true);
    expect($('[aria-labelledby="rg-f-teams-l"]')!.textContent).toContain('Save your team changes first. Sync access uses the saved file.');
    expect(be.writes()).toEqual([]);
  });

  it('typing a slug works when the org’s teams cannot be listed', async () => {
    const be = backend({ konnen_team: KT });
    const h = harness(be, { config: infraOnly() });
    const call: any = async (req: Request) => {
      if (req.type === 'org:teams') throw new CallError({ kind: 'forbidden', message: 'Resource not accessible by integration' });
      return h.call(req);
    };
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories#infra');
    mounted = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(btn('Edit group')).toBeTruthy());
    btn('Edit group').click();
    await vi.waitFor(() => expect($('.rg-drawer')).toBeTruthy());
    btn('Add team').click();
    await vi.waitFor(() => expect($('[role="combobox"]')).toBeTruthy());
    const input = $('[role="combobox"]') as HTMLInputElement;
    expect(input.placeholder).toBe('Type a team slug');
    input.value = 'new-team';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fieldTeams().some((t) => t.startsWith('new-team'))).toBe(true));
  });
});

describe('unknown team slug in the YAML editor', () => {
  it('shows a yellow warning line and the file still applies', async () => {
    document.documentElement.innerHTML = orgHtml;
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories');
    const be = backend({ konnen_team: KT });
    await be.handle({ type: 'org:teams', org: 'thekonnen' }); // the background has the org's team list cached
    const h = harness(be, { config: infraOnly() });
    mounted = (await mountOrgRepos('thekonnen', { call: h.call }, document, 200))!;
    await vi.waitFor(() => expect(btn('Edit YAML')).toBeTruthy());
    btn('Edit YAML').click();
    await vi.waitFor(() => expect($('#rg-y-text')).toBeTruthy());
    const area = $('#rg-y-text') as HTMLTextAreaElement;
    area.value = 'groups:\n  - name: infra\n    teams: ["konnen_team", "other-org-team"]\n    match: ["dagu"]\n';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect($('.rg-y-status.rg-warn')).toBeTruthy());
    expect($('.rg-y-status.rg-warn')!.textContent).toContain('"infra": team "other-org-team" was not found in thekonnen.');
    expect($('.rg-y-status.rg-err')).toBeNull();
    expect(($('#rg-y-apply') as HTMLButtonElement).disabled).toBe(false);
  });
});
