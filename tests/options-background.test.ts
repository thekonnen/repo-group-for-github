import { describe, expect, it } from 'vitest';
import { createHandler } from '../src/background/handlers';
import { memoryKV } from '../src/background/kv';
import { memoryIndexStore } from '../src/background/repo-index';
import { orgFromUrl } from '../src/ext-pages/tab-org';
import { englishMessage } from '../src/i18n';
import { fakeFetch, makeRepos, orgReposRoute } from './fake-github';

const memberships = (orgs: string[]) => (u: URL) => (u.pathname === '/user/memberships/orgs' ? { json: orgs.map((o) => ({ state: 'active', organization: { login: o, avatar_url: `https://a/${o}.png` } })) } : undefined);
const fileRoute = (withFile: string[], forbidden: string[] = []) => (u: URL) => {
  const m = /^\/repos\/([^/]+)\/\.github\/contents\/repo-groups\.yml$/.exec(u.pathname);
  if (!m) return undefined;
  if (forbidden.includes(m[1])) return { status: 403, json: { message: 'Resource not accessible' } };
  return withFile.includes(m[1]) ? { json: { content: btoa('groups: []'), sha: 's' } } : { status: 404, json: { message: 'Not Found' } };
};
const userRoute = (u: URL) => (u.pathname === '/user' ? { json: { login: 'ana', avatar_url: 'https://a/ana.png' } } : undefined);

async function signedIn(extra: Parameters<typeof fakeFetch>, opts: { now?: () => number } = {}) {
  const f = fakeFetch(userRoute, ...extra);
  const kv = memoryKV();
  const index = memoryIndexStore();
  const h = createHandler({ fetch: f.fetch, kv, index, clientId: 'c', now: opts.now });
  await h({ type: 'auth:pat', token: 'tok' });
  f.calls.length = 0;
  return { f, kv, index, h };
}

describe('orgs:list', () => {
  it('lists memberships, flags orgs with repo-groups.yml, at most 4 checks in flight', async () => {
    const names = Array.from({ length: 9 }, (_, i) => `org${i}`);
    const { f, h } = await signedIn([memberships(names), fileRoute(['org1', 'org7'], ['org3'])]);
    const r: any = await h({ type: 'orgs:list' });
    expect(r.ok).toBe(true);
    expect(r.data.orgs.map((o: any) => o.login)).toEqual(names);
    expect(r.data.orgs.filter((o: any) => o.hasFile).map((o: any) => o.login)).toEqual(['org1', 'org7']);
    expect(r.data.orgs[0]).toMatchObject({ avatarUrl: 'https://a/org0.png', hasFile: false });
    expect(f.stats.maxInflight).toBeLessThanOrEqual(4);
    expect(f.calls[0].url).toContain('/user/memberships/orgs?state=active&per_page=100');
  });
  it('is cached for the refresh interval, and force bypasses it', async () => {
    let t = 1_000_000;
    const { f, h } = await signedIn([memberships(['a']), fileRoute(['a'])], { now: () => t });
    await h({ type: 'orgs:list' });
    const n = f.calls.length;
    t += 4 * 60_000;
    await h({ type: 'orgs:list' });
    expect(f.calls).toHaveLength(n);
    await h({ type: 'orgs:list', force: true });
    expect(f.calls.length).toBeGreaterThan(n);
    const m = f.calls.length;
    t += 6 * 60_000;
    await h({ type: 'orgs:list' });
    expect(f.calls.length).toBeGreaterThan(m);
  });
  it('is empty without a sign-in and makes no request', async () => {
    const f = fakeFetch();
    const h = createHandler({ fetch: f.fetch, kv: memoryKV(), index: memoryIndexStore(), clientId: 'c' });
    expect(await h({ type: 'orgs:list' })).toEqual({ ok: true, data: { orgs: [], fetchedAt: 0 } });
    expect(f.calls).toHaveLength(0);
  });
  it('reports an auth error instead of an empty list', async () => {
    const { h } = await signedIn([(u) => (u.pathname === '/user/memberships/orgs' ? { status: 401, json: {} } : undefined)]);
    expect(await h({ type: 'orgs:list' })).toMatchObject({ ok: false, error: { kind: 'auth' } });
  });
});

describe('cache:clear', () => {
  it('removes indexes, org files and the org list but keeps the token, prefs and settings', async () => {
    const { kv, index, h } = await signedIn([fileRoute(['o']), memberships(['o'])]);
    await h({ type: 'prefs:set', org: 'o', prefs: { view: 'list', groupedByDefault: false } });
    await h({ type: 'settings:set', settings: { refreshMinutes: 15 } });
    await h({ type: 'org:file', org: 'o' });
    await h({ type: 'orgs:list' });
    await kv.set('rg:teams:o', { x: 1 });
    await index.save('o', [], { lastFullSync: 'x', lastIncrementalSync: 'x', total: 0 });
    await kv.set('rg:pending-repo', { keep: true });
    expect(kv.data.has('rg:file:o')).toBe(true);

    const r: any = await h({ type: 'cache:clear' });
    expect(r.ok).toBe(true);
    expect(await index.load('o')).toBeNull();
    for (const k of ['rg:file:o', 'rg:teams:o', 'rg:orgs']) expect(kv.data.has(k)).toBe(false);
    expect(kv.data.get('rg:auth')).toMatchObject({ token: 'tok', login: 'ana' });
    expect(kv.data.get('rg:prefs:o')).toMatchObject({ view: 'list', groupedByDefault: false });
    expect(kv.data.get('rg:settings')).toEqual({ refreshMinutes: 15 });
    expect(kv.data.has('rg:pending-repo')).toBe(true);
    expect(await h({ type: 'auth:status' })).toMatchObject({ ok: true, data: { signedIn: true, login: 'ana' } });
  });
});

describe('settings and refresh interval', () => {
  it('defaults to 5 minutes and clamps bad values', async () => {
    const { h } = await signedIn([]);
    expect(await h({ type: 'settings:get' })).toEqual({ ok: true, data: { refreshMinutes: 5 } });
    expect(await h({ type: 'settings:set', settings: { refreshMinutes: 30 } })).toEqual({ ok: true, data: { refreshMinutes: 30 } });
    expect(await h({ type: 'settings:set', settings: { refreshMinutes: -3 } })).toEqual({ ok: true, data: { refreshMinutes: 5 } });
  });
  it('org:refresh makes no request inside the interval, one after it, and force bypasses', async () => {
    const data = makeRepos(250);
    let t = Date.parse('2026-01-10T12:00:00Z');
    const { f, h } = await signedIn([orgReposRoute('o', () => data)], { now: () => t });
    const first: any = await h({ type: 'org:refresh', org: 'o' }); // empty cache: full index
    expect(first.data.mode).toBe('full');
    expect(f.calls).toHaveLength(3);

    f.calls.length = 0;
    t += 4 * 60_000;
    const within: any = await h({ type: 'org:refresh', org: 'o' });
    expect(f.calls).toHaveLength(0);
    expect(within).toMatchObject({ ok: true, data: { status: 'ok', mode: 'incremental' } });
    expect(within.data.repos).toHaveLength(250);

    t += 2 * 60_000; // 6 minutes after the sync
    await h({ type: 'org:refresh', org: 'o' });
    expect(f.calls).toHaveLength(1);

    f.calls.length = 0;
    await h({ type: 'org:refresh', org: 'o', force: true });
    expect(f.calls.length).toBeGreaterThan(1);
  });
  it('honors a custom interval', async () => {
    let t = Date.parse('2026-01-10T12:00:00Z');
    const { f, h } = await signedIn([orgReposRoute('o', () => makeRepos(10))], { now: () => t });
    await h({ type: 'settings:set', settings: { refreshMinutes: 30 } });
    await h({ type: 'org:refresh', org: 'o' });
    f.calls.length = 0;
    t += 20 * 60_000;
    await h({ type: 'org:refresh', org: 'o' });
    expect(f.calls).toHaveLength(0);
    t += 11 * 60_000;
    await h({ type: 'org:refresh', org: 'o' });
    expect(f.calls).toHaveLength(1);
  });
});

describe('token rejection advice', () => {
  it('keeps the org policy message so the UI can show a hint', async () => {
    const f = fakeFetch((u) => (u.pathname === '/user' ? { status: 403, json: { message: 'Resource protected by organization SAML enforcement' } } : undefined));
    const h = createHandler({ fetch: f.fetch, kv: memoryKV(), index: memoryIndexStore(), clientId: 'c' });
    const r: any = await h({ type: 'auth:pat', token: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error.hint).toMatch(/SSO/);
  });
});

describe('helpers', () => {
  const known = (l: string) => ['thekonnen', 'acme'].includes(l.toLowerCase());
  it('finds the org of a tab url', () => {
    expect(orgFromUrl('https://github.com/orgs/thekonnen/repositories', () => false)).toBe('thekonnen');
    expect(orgFromUrl('https://github.com/orgs/other/people', () => false)).toBe('other');
    expect(orgFromUrl('https://github.com/TheKonnen/dagu/issues', known)).toBe('TheKonnen');
    expect(orgFromUrl('https://github.com/someuser/repo', known)).toBeNull();
    expect(orgFromUrl('https://github.com/settings/profile', () => true)).toBeNull();
    expect(orgFromUrl('https://example.com/orgs/x', known)).toBeNull();
    expect(orgFromUrl(undefined, known)).toBeNull();
    expect(orgFromUrl('https://github.com/', known)).toBeNull();
  });
  it('fills i18n placeholders from the English file', () => {
    expect(englishMessage('popupOpenGrouped', ['acme'])).toBe('Open grouped view for acme');
    expect(englishMessage('signIn')).toBe('Sign in with GitHub');
  });
});
