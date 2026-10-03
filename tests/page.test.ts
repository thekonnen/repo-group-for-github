// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasGithubFilter, routeOf } from '../src/github/route';
import { commonAncestor, findFilterList, locateOrgRepos } from '../src/github/selectors';
import { watchUrl, waitFor } from '../src/github/navigation';
import { mountOrgRepos } from '../src/features/mount';
import type { Request } from '../src/github/messages';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/org-repos.html'), 'utf8');
const body = html.replace(/<!--[\s\S]*?-->/, '');
const load = (h = body) => (document.documentElement.innerHTML = h);

import { at, fakeCall, repos } from './page-helpers';

const settle = () => vi.waitFor(() => expect(document.querySelector('.rg-root[data-rg="view"] .rg-view')).toBeTruthy());
const names = () => [...document.querySelectorAll('.rg-root[data-rg="view"] .rg-row .rg-row-title a')].map((a) => (a.textContent ?? '').trim());

beforeEach(() => {
  load();
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories');
});
afterEach(() => {
  document.documentElement.innerHTML = '';
});

describe('routing and selectors', () => {
  it('only takes over /orgs/<org>/repositories', () => {
    expect(routeOf({ pathname: '/orgs/thekonnen/repositories' })).toEqual({ kind: 'org-repos', org: 'thekonnen' });
    expect(routeOf({ pathname: '/orgs/thekonnen/repositories/' })).toEqual({ kind: 'org-repos', org: 'thekonnen' });
    for (const p of ['/orgs/thekonnen/people', '/orgs/thekonnen/teams/x/repositories', '/organizations/o/repositories', '/thekonnen/repo/issues', '/orgs/x', '/settings/profile', '/']) expect(routeOf({ pathname: p })).toBeNull();
    // F9: the new repository page and the repo home page (where the pending entry is filed)
    expect(routeOf({ pathname: '/organizations/o/repositories/new' })).toEqual({ kind: 'new-repo', org: 'o' });
    expect(routeOf({ pathname: '/new' })).toEqual({ kind: 'new-repo', org: null });
    expect(routeOf({ pathname: '/thekonnen/repo' })).toEqual({ kind: 'repo', org: 'thekonnen', repo: 'repo' });
    expect(routeOf({ pathname: '/thekonnen/my.repo-1/' })).toEqual({ kind: 'repo', org: 'thekonnen', repo: 'my.repo-1' });
  });
  it('detects GitHub filter params', () => {
    expect(hasGithubFilter('?type=public')).toBe(true);
    expect(hasGithubFilter('?q=abc&sort=name')).toBe(true);
    expect(hasGithubFilter('?language=Go')).toBe(true);
    expect(hasGithubFilter('')).toBe(false);
    expect(hasGithubFilter('?sort=name')).toBe(false);
  });
  it('finds the content column and the filter list', () => {
    const m = locateOrgRepos(document)!;
    expect(m.column.id).toBe('content');
    expect(m.filterList?.tagName).toBe('UL');
    expect(findFilterList(document)?.querySelectorAll('li')).toHaveLength(6);
  });
  it('falls back when there is no "New repository" link or no sidebar', () => {
    document.querySelector('.head a')!.remove();
    expect(locateOrgRepos(document)!.column.id).toBe('content');
    document.querySelector('#sidebar')!.remove();
    const m = locateOrgRepos(document)!;
    expect(m.column.id).toBe('content');
    expect(m.filterList).toBeNull();
  });
  it('returns null when the list cannot be found or isolated', () => {
    document.querySelector('.searchbox input')!.remove();
    expect(locateOrgRepos(document)).toBeNull();
    load('<body><main><input placeholder="Search repositories"></main></body>');
    expect(locateOrgRepos(document)).toBeNull();
  });
  it('commonAncestor works', () => {
    const a = document.querySelector('h2')!;
    const b = document.querySelector('input')!;
    expect(commonAncestor(a, b)?.id).toBe('content');
  });
});

// The real page keeps the "All" title row and the New repository button outside the list column.
const headerOutside = body
  .replace('<div class="head"><h2>All</h2><a href="/organizations/thekonnen/repositories/new">New repository</a></div>', '')
  .replace('<main>\n      <div id="content">', '<main>\n      <div id="title-row"><h2>All</h2><a href="/organizations/thekonnen/repositories/new">New repository</a></div>\n      <div id="content" class="Content-x9 mx-auto" style="max-width: 720px; padding: 0 24px">');

describe('title row outside the list column', () => {
  it('is found as an extra part and hidden with the column, then restored', async () => {
    load(headerOutside);
    const m = locateOrgRepos(document)!;
    expect(m.column.id).toBe('content');
    expect(m.extras.map((e) => e.id)).toEqual(['title-row']);
    const { call } = fakeCall();
    const mounted = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(document.getElementById('title-row')!.classList.contains('rg-hidden')).toBe(true));
    expect(document.getElementById('content')!.classList.contains('rg-hidden')).toBe(true);
    mounted.dispose();
    expect(document.getElementById('title-row')!.classList.contains('rg-hidden')).toBe(false);
  });
  it('shows GitHub’s own title and list again in list mode', async () => {
    load(headerOutside);
    const { call } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-view-seg')).toBeTruthy());
    (document.querySelector('.rg-view-seg button[title="GitHub list view"]') as HTMLElement).click();
    await vi.waitFor(() => expect(document.getElementById('title-row')!.classList.contains('rg-hidden')).toBe(false));
    m.dispose();
  });
  it('our container takes the column’s classes and inline style, so GitHub’s margins apply', async () => {
    load(headerOutside);
    const { call } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    const root = document.querySelector('.rg-root[data-rg="view"]')!;
    expect(root.classList.contains('Content-x9')).toBe(true);
    expect(root.classList.contains('mx-auto')).toBe(true);
    expect(root.classList.contains('rg-hidden')).toBe(false);
    expect(root.getAttribute('style')).toContain('max-width: 720px');
    m.dispose();
  });
  it('does not hide the global header’s links or unrelated headings', () => {
    load(headerOutside.replace('<header>', '<header><h2>All</h2><a href="/organizations/thekonnen/repositories/new">New repository</a>'));
    const m = locateOrgRepos(document)!;
    expect(m.extras.map((e) => e.id)).toEqual(['title-row']);
  });
});

describe('navigation helpers', () => {
  it('watchUrl fires on turbo:load and on hash changes, and stops after unsubscribe', () => {
    const cb = vi.fn();
    const stop = watchUrl(cb);
    expect(cb).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('turbo:load'));
    expect(cb).toHaveBeenCalledTimes(2);
    window.history.pushState(null, '', '/orgs/thekonnen/repositories#infra');
    window.dispatchEvent(new Event('hashchange'));
    expect(cb).toHaveBeenCalledTimes(3);
    stop();
    document.dispatchEvent(new Event('turbo:load'));
    expect(cb).toHaveBeenCalledTimes(3);
  });
  it('waitFor resolves when the element shows up, and gives up after the timeout', async () => {
    document.body.innerHTML = '';
    const p = waitFor(() => document.getElementById('late'), 2000);
    setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<i id="late"></i>'), 20);
    expect((await p)?.id).toBe('late');
    expect(await waitFor(() => document.getElementById('never'), 80)).toBeNull();
  });
});

describe('grouped view on the page', () => {
  it('renders from the index: infra and ai on the root, keep_supabase_alive ungrouped; hides GitHub’s list', async () => {
    const { call } = fakeCall();
    const m = await mountOrgRepos('thekonnen', { call }, document, 200);
    expect(m).toBeTruthy();
    await settle();
    await vi.waitFor(() => expect(names()).toEqual(['infra', 'dagu', 'authentik', 'checkmate', 'ai', 'keep_supabase_alive'])); // infra starts expanded
    expect(document.getElementById('content')!.classList.contains('rg-hidden')).toBe(true);
    expect(document.querySelector('.rg-view h1')!.textContent).toBe('thekonnen');
    expect(document.querySelector('.rg-crumbs')!.textContent).toContain('thekonnen');
    const statNums = [...document.querySelectorAll('.rg-stat b')].map((b) => b.textContent);
    expect(statNums.slice(0, 2)).toEqual(['10', '6']);
    expect(document.querySelector('.rg-status')!.textContent).toMatch(/10 repositories/);
    // repo rows link to the repo on GitHub
    m!.dispose();
  });
  it('shows the Groups tree below the filter list and highlights the current group', async () => {
    const { call } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelectorAll('[data-rg="side"] .rg-nav-item')).toHaveLength(7));
    const side = document.querySelector('[data-rg="side"]')!;
    expect(document.querySelector('#sidebar ul')!.nextElementSibling).toBe(side);
    expect(side.textContent).toContain('Repository Group');
    expect([...side.querySelectorAll('.rg-nav-item span:nth-child(3)')].map((s) => s.textContent)).toEqual(['10', '6', '3', '2', '1', '3', '2']);
    expect(side.querySelector('[aria-current="true"]')!.textContent).toContain('All groups');
    m.dispose();
  });
  it('#infra/dagu opens the dagu page with its three repos; the sidebar follows', async () => {
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories#infra/dagu');
    const { call } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(names().sort()).toEqual(['dags-repo', 'dagu', 'konnen-dagu']));
    expect(document.querySelector('.rg-view h1')!.textContent).toBe('dagu');
    expect([...document.querySelectorAll('.rg-crumbs a, .rg-crumbs .rg-cur')].map((c) => c.textContent!.slice(1))).toEqual(['thekonnen', 'infra', 'dagu']);
    expect(document.querySelector('[data-rg="side"] [aria-current="true"]')!.textContent).toContain('dagu');
    m.dispose();
  });
  it('hash navigation moves between groups and back to the root', async () => {
    const { call } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(names()).toContain('infra'));
    window.history.pushState(null, '', '/orgs/thekonnen/repositories#ai/litellm');
    window.dispatchEvent(new Event('hashchange'));
    await vi.waitFor(() => expect(names().sort()).toEqual(['konnen-litellm', 'litellm']));
    window.history.pushState(null, '', '/orgs/thekonnen/repositories');
    window.dispatchEvent(new Event('popstate'));
    await vi.waitFor(() => expect(names()).toEqual(['infra', 'dagu', 'authentik', 'checkmate', 'ai', 'keep_supabase_alive']));
    window.history.pushState(null, '', '/orgs/thekonnen/repositories#nope/x');
    window.dispatchEvent(new Event('hashchange'));
    await vi.waitFor(() => expect(document.querySelector('.rg-view h1')!.textContent).toBe('thekonnen'));
    m.dispose();
  });
  it('clicking a group row navigates; the chevron expands it inline', async () => {
    const { call } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(names()).toContain('infra'));
    // infra starts expanded (first group): its subgroups are listed indented
    await vi.waitFor(() => expect(names()).toEqual(['infra', 'dagu', 'authentik', 'checkmate', 'ai', 'keep_supabase_alive']));
    (document.querySelector('.rg-chev[aria-label="Collapse infra"]') as HTMLElement).click();
    await vi.waitFor(() => expect(names()).toEqual(['infra', 'ai', 'keep_supabase_alive']));
    (document.querySelector('.rg-chev[aria-label="Expand ai"]') as HTMLElement).click();
    await vi.waitFor(() => expect(names()).toEqual(['infra', 'ai', 'litellm', 'omniroute', 'keep_supabase_alive']));
    expect(document.querySelector('.rg-chev[aria-label="Collapse ai"]')).toBeTruthy();
    (document.querySelectorAll('.rg-row-title a.rg-grp')[1] as HTMLElement).click();
    await vi.waitFor(() => expect(window.location.hash).toBe('#ai'));
    await vi.waitFor(() => expect(document.querySelector('.rg-view h1')!.textContent).toBe('ai'));
    m.dispose();
  });
  it('search filters recursively with a path prefix; "/" focuses it', async () => {
    const { call } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(document.getElementById('rg-search')).toBeTruthy());
    const input = document.getElementById('rg-search') as HTMLInputElement;
    input.value = 'authentik';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(names()).toEqual(['infra / authentik / konnen-authentik', 'infra / checkmate / konnen-checkmate', 'infra / authentik / authentik']));
    expect(document.querySelector('.rg-box-head')!.textContent).toContain('3 results for “authentik”');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('.rg-empty')!.textContent).toContain('No repositories match'));
    document.body.focus();
    const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    const typing = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    input.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(false);
    m.dispose();
  });
  it('tabs: Ungrouped on the root, Match rules on a group', async () => {
    const { call } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect([...document.querySelectorAll('.rg-tab')].map((t) => t.textContent!.trim())).toEqual(['Groups and repositories', 'Ungrouped 1']));
    (document.querySelectorAll('.rg-tab')[1] as HTMLElement).click();
    await vi.waitFor(() => expect(names()).toEqual(['keep_supabase_alive']));
    window.history.pushState(null, '', '/orgs/thekonnen/repositories#infra/dagu');
    window.dispatchEvent(new Event('hashchange'));
    await vi.waitFor(() => expect([...document.querySelectorAll('.rg-tab')].map((t) => t.textContent!.trim())).toEqual(['Groups and repositories', 'Match rules 3']));
    (document.querySelectorAll('.rg-tab')[1] as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('.rg-rules')!.textContent).toContain('dags-*'));
    expect([...document.querySelectorAll('.rg-rules .rg-chip')].map((c) => c.textContent)).toEqual(expect.arrayContaining(['dagu', 'dags-*', 'konnen-dagu']));
    m.dispose();
  });
  it('toggles to GitHub’s list with a banner, remembers the choice, and back', async () => {
    const { call, log } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-view-seg')).toBeTruthy());
    (document.querySelector('.rg-view-seg button[title="GitHub list view"]') as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('.rg-banner')!.textContent).toContain('This is GitHub’s default list'));
    expect(document.getElementById('content')!.classList.contains('rg-hidden')).toBe(false);
    expect(log.some((r) => r.type === 'prefs:set' && (r.prefs as any).view === 'list')).toBe(true);
    (document.querySelector('.rg-banner button') as HTMLElement).click();
    await vi.waitFor(() => expect(document.getElementById('content')!.classList.contains('rg-hidden')).toBe(true));
    m.dispose();
  });
  it('opens in GitHub’s list when the URL has filter params, and honors the saved view otherwise', async () => {
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories?type=public');
    const a = fakeCall();
    const m1 = (await mountOrgRepos('thekonnen', { call: a.call }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-banner')).toBeTruthy());
    expect(document.getElementById('content')!.classList.contains('rg-hidden')).toBe(false);
    m1.dispose();
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories');
    const b = fakeCall();
    b.call.mockImplementation(async (req: Request) => (req.type === 'prefs:get' ? { view: 'list' } : (await fakeCall().call(req))));
    const m2 = (await mountOrgRepos('thekonnen', { call: b.call }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-banner')).toBeTruthy());
    m2.dispose();
  });
  it('a New repository button links to the native page, with the group preselected on group pages', async () => {
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories#infra/dagu');
    const { call } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-g-actions a')).toBeTruthy());
    expect((document.querySelector('.rg-g-actions a') as HTMLAnchorElement).getAttribute('href')).toBe('https://github.com/organizations/thekonnen/repositories/new?rg_group=infra%2Fdagu');
    m.dispose();
  });
  it('shows the index status progress, and the rate-limit pause message', async () => {
    const { call } = fakeCall();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const slow: any = vi.fn(async (req: Request) => {
      if (req.type === 'org:refresh') { await held; return { status: 'paused', resumeAt: new Date(Date.parse('2026-01-10T15:30:00Z')).toISOString() }; }
      if (req.type === 'org:progress') return { loaded: 1200, estimatedTotal: 3400 };
      if (req.type === 'org:cached') return null;
      return call(req);
    });
    const m = (await mountOrgRepos('thekonnen', { call: slow, sleep: async () => { await new Promise((r) => setTimeout(r, 5)); } }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-status')!.textContent).toBe('Indexing 1,200 of about 3,400 repositories…'));
    release();
    await vi.waitFor(() => expect(document.querySelector('.rg-status')!.textContent).toMatch(/^Paused to respect GitHub’s rate limit — resumes at /));
    m.dispose();
  });
});

describe('states', () => {
  it('shows sign-in first, with the device code inline', async () => {
    const { call } = fakeCall({ signedIn: false });
    const m = (await mountOrgRepos('thekonnen', { call, sleep: () => new Promise(() => {}) }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-view .rg-empty')!.textContent).toContain('Sign in with GitHub'));
    expect(document.getElementById('content')!.classList.contains('rg-hidden')).toBe(true);
    expect(document.querySelectorAll('[data-rg="side"] .rg-nav-item')).toHaveLength(0);
    const open = vi.fn();
    m.dispose();
    const m2 = (await mountOrgRepos('thekonnen', { call, open, sleep: () => new Promise(() => {}) }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-view .rg-btn-primary')).toBeTruthy());
    (document.querySelector('.rg-view .rg-btn-primary') as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('.rg-code')!.textContent).toBe('ABCD-1234'));
    (document.querySelector('.rg-view .rg-btn-primary') as HTMLElement).click();
    expect(open).toHaveBeenCalledWith('https://github.com/login/device?user_code=ABCD-1234');
    m2.dispose();
  });
  it('shows everything ungrouped when the org has no repo-groups.yml, and an error when it is invalid', async () => {
    const a = fakeCall({ config: { exists: false } });
    const m = (await mountOrgRepos('thekonnen', { call: a.call }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-banner')!.textContent).toContain('has no repo-groups.yml'));
    await vi.waitFor(() => expect(names()).toHaveLength(10));
    m.dispose();
    const b = fakeCall({ config: { exists: true, sha: 's', error: 'bad indentation (line 3)', warnings: [] } });
    const m2 = (await mountOrgRepos('thekonnen', { call: b.call }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-banner')!.textContent).toContain('bad indentation (line 3)'));
    m2.dispose();
  });
  it('does nothing and leaves the page alone when the list is not found', async () => {
    load('<body><main><p>hello</p></main></body>');
    const { call } = fakeCall();
    const before = document.body.innerHTML;
    expect(await mountOrgRepos('thekonnen', { call }, document, 60)).toBeNull();
    expect(document.body.innerHTML).toBe(before);
    expect(call).not.toHaveBeenCalled();
  });
  it('dispose restores GitHub’s list and removes our nodes; mounting twice does not duplicate', async () => {
    const { call } = fakeCall();
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await settle();
    m.dispose();
    expect(document.querySelector('.rg-root')).toBeNull();
    expect(document.getElementById('content')!.classList.contains('rg-hidden')).toBe(false);
    const m2 = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    expect(document.querySelectorAll('.rg-root[data-rg="view"]')).toHaveLength(1);
    expect(document.querySelectorAll('#rg-style')).toHaveLength(1);
    m2.dispose();
  });
});
