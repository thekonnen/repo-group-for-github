// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler } from '../src/background/handlers';
import { saveAuth } from '../src/background/auth';
import { memoryKV } from '../src/background/kv';
import { memoryIndexStore } from '../src/background/repo-index';
import { mountUserRepos, type Mounted } from '../src/features/mount';
import type { Request } from '../src/github/messages';
import { routeOf } from '../src/github/route';
import { locateUserRepos } from '../src/github/selectors';
import { rawRepo, fakeFetch } from './fake-github';
import { fakeCall } from './page-helpers';

const read = (f: string) => {
  const t = readFileSync(join(process.cwd(), 'tests/fixtures', f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  return t.match(/<body[\s\S]*<\/body>/)?.[0] ?? t;
};
let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.documentElement.innerHTML = '';
});

describe('personal account page', () => {
  it('routes only /<login>?tab=repositories', () => {
    expect(routeOf({ pathname: '/AlyssonJalles', search: '?tab=repositories' })).toEqual({ kind: 'user-repos', owner: 'AlyssonJalles' });
    for (const [pathname, search] of [['/AlyssonJalles', ''], ['/AlyssonJalles', '?tab=stars'], ['/settings', '?tab=repositories'], ['/AlyssonJalles/x', '?tab=repositories']] as const) {
      expect(routeOf({ pathname, search })?.kind).not.toBe('user-repos');
    }
  });

  it('locates the list; the toolbar is hidden with it and the profile sidebar stays', () => {
    document.documentElement.innerHTML = read('user-repos.html');
    const f = locateUserRepos(document)!;
    expect(f.column.id).toBe('user-repositories-list');
    expect(f.extras.map((e) => e.className)).toEqual(['border-bottom color-border-muted tmp-py-3']);
    expect(f.filterList).toBeNull();
    expect(locateUserRepos(new DOMParser().parseFromString('<main></main>', 'text/html'))).toBeNull();
  });

  const mount = async (login: string | null) => {
    document.documentElement.innerHTML = read('user-repos.html');
    window.history.replaceState(null, '', '/alyssonjalles?tab=repositories');
    const { call } = fakeCall({ signedIn: !!login, access: { access: { level: 'owner', canWriteOrg: true, hasOrgFile: true, suggestMode: false, canForkSuggest: true, syncNeedsRepoAdmin: false, publicOnly: false, personal: true } } });
    const wrapped = async (req: Request) => (req.type === 'auth:status' ? { signedIn: !!login, login } : call(req));
    mounted = await mountUserRepos('alyssonjalles', { call: wrapped as any }, document, 1500);
    return mounted;
  };

  it('replaces the list with the grouped view on your own profile', async () => {
    expect(await mount('AlyssonJalles')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('.rg-root[data-rg="view"]')).toBeTruthy();
    expect(document.getElementById('user-repositories-list')!.classList.contains('rg-hidden')).toBe(true);
    expect(document.querySelector('.Layout-sidebar')!.classList.contains('rg-hidden')).toBe(false);
    const nr = [...document.querySelectorAll('a')].find((a) => a.textContent === 'New repository') as HTMLAnchorElement;
    expect(nr.getAttribute('href')).toBe('https://github.com/new?owner=alyssonjalles');
  });

  it('does nothing on somebody else\'s profile or when signed out', async () => {
    expect(await mount('someone-else')).toBeNull();
    expect(await mount(null)).toBeNull();
    expect(document.querySelector('.rg-root')).toBeNull();
  });
});

describe('personal account in the background', () => {
  const setup = async (login = 'AlyssonJalles') => {
    const kv = memoryKV();
    await saveAuth(kv, { token: 't', kind: 'oauth', login, avatarUrl: '' });
    const f = fakeFetch(
      (u) => (u.pathname === '/user/repos' ? { json: [rawRepo(1, '2026-01-01T00:00:00Z')] } : undefined),
      (u) => (u.pathname === '/orgs/thekonnen/repos' ? { json: [rawRepo(2, '2026-01-01T00:00:00Z')] } : undefined),
      (u) => (u.pathname === '/user/installations' ? { json: { installations: [{ account: { login } }] } } : undefined),
      (u) => (u.pathname === '/repos/alyssonjalles/.github' ? { json: { default_branch: 'main', permissions: { push: true } } } : undefined),
      (u, c) => (u.pathname === '/user/repos' && c.method === 'POST' ? { json: {} } : undefined),
    );
    const h = createHandler({ fetch: f.fetch, kv, index: memoryIndexStore(), clientId: 'c' });
    return { h, f };
  };

  it('lists your own repos with /user/repos (private included) and an org with /orgs/{org}/repos', async () => {
    const { h, f } = await setup();
    const own: any = await h({ type: 'org:refresh', org: 'alyssonjalles' });
    expect(own.data.repos.map((r: any) => r.name)).toEqual(['repo-1']);
    expect(f.calls[0].url).toContain('/user/repos?affiliation=owner');
    const org: any = await h({ type: 'org:refresh', org: 'thekonnen' });
    expect(org.data.repos.map((r: any) => r.name)).toEqual(['repo-2']);
    expect(f.calls.at(-1)!.url).toContain('/orgs/thekonnen/repos');
  });

  it('you own your account: write access, no membership call, no teams', async () => {
    const { h, f } = await setup();
    const a: any = await h({ type: 'org:access', org: 'alyssonjalles' });
    expect(a.data.access).toMatchObject({ level: 'owner', canWriteOrg: true, personal: true });
    expect(f.calls.some((c) => c.url.includes('/user/memberships/'))).toBe(false);
    expect(((await h({ type: 'org:teams', org: 'alyssonjalles' })) as any).data).toEqual({ teams: [], customRoles: null });
    expect(f.calls.some((c) => c.url.includes('graphql'))).toBe(false);
  });

  it('creates your private .github with POST /user/repos', async () => {
    const { h, f } = await setup();
    await h({ type: 'org:create-dotgithub', org: 'alyssonjalles' });
    const post = f.calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('https://api.github.com/user/repos');
    expect(JSON.parse(post.body!)).toMatchObject({ name: '.github', private: true });
  });
});
