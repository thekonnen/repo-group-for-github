import { describe, expect, it } from 'vitest';
import { createClient, explainTokenRejection, GitHubError } from '../src/background/api';
import { pollDeviceFlow, startDeviceFlow } from '../src/background/auth';
import { memoryKV } from '../src/background/kv';
import { createHandler } from '../src/background/handlers';
import { decodeBase64Utf8, probeAccess, readOrgFile } from '../src/background/org-data';
import { fullIndex, memoryIndexStore, refreshIndex } from '../src/background/repo-index';
import { fakeFetch, makeRepos, orgReposRoute, rawRepo } from './fake-github';

const client = (f: ReturnType<typeof fakeFetch>, token: string | null = 't') => createClient({ fetch: f.fetch, getToken: async () => token });

describe('device flow', () => {
  const flow = (reply: any, status = 200) => fakeFetch((u) => (u.hostname === 'github.com' ? { status, json: reply } : undefined));
  it('starts and sends only the client id', async () => {
    const f = flow({ device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    const d = await startDeviceFlow(f.fetch, 'cid');
    expect(d).toMatchObject({ deviceCode: 'dc', userCode: 'ABCD-1234', interval: 5 });
    expect(f.calls[0].body).toBe('client_id=cid');
    expect(f.calls[0].url).toBe('https://github.com/login/device/code');
  });
  it('explains a disabled device flow and a missing client id', async () => {
    await expect(startDeviceFlow(flow({ error: 'device_flow_disabled' }, 200).fetch, 'cid')).rejects.toThrow(/Enable "Device Flow"/);
    await expect(startDeviceFlow(flow({}).fetch, '')).rejects.toThrow(/client id/);
  });
  it.each([
    [{ error: 'authorization_pending' }, { state: 'pending', interval: 5 }],
    [{ error: 'slow_down', interval: 10 }, { state: 'pending', interval: 10 }],
    [{ error: 'slow_down' }, { state: 'pending', interval: 10 }],
    [{ error: 'expired_token' }, { state: 'error', reason: 'expired' }],
    [{ error: 'access_denied' }, { state: 'error', reason: 'denied' }],
    [{ access_token: 'gho_x' }, { state: 'done', token: 'gho_x' }],
  ])('polls %j', async (reply, expected) => {
    const r = await pollDeviceFlow(flow(reply).fetch, 'cid', 'dc', 5);
    expect(r).toMatchObject(expected as any);
  });
  it('uses the device grant type', async () => {
    const f = flow({ error: 'authorization_pending' });
    await pollDeviceFlow(f.fetch, 'cid', 'dc', 5);
    expect(decodeURIComponent(f.calls[0].body!)).toContain('grant_type=urn:ietf:params:oauth:grant-type:device_code');
  });
});

describe('api client errors', () => {
  const err = async (rep: any) => {
    const f = fakeFetch(() => rep);
    return (await client(f).rest('/x').catch((e) => e)) as GitHubError;
  };
  it('classifies statuses', async () => {
    expect((await err({ status: 401, json: { message: 'Bad credentials' } })).kind).toBe('auth');
    expect((await err({ status: 404, json: { message: 'Not Found' } })).kind).toBe('not-found');
    expect((await err({ status: 422, json: { message: 'nope' } })).kind).toBe('validation');
    expect((await err({ status: 403, json: { message: 'Forbidden' } })).kind).toBe('forbidden');
  });
  it('detects rate limits and sso, and exposes the accepted-permissions header', async () => {
    const rl = await err({ status: 403, json: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1000' } });
    expect(rl.kind).toBe('rate-limit');
    expect(rl.detail?.resetAt).toBe(1000);
    const sso = await err({ status: 403, json: { message: 'Resource protected by organization SAML enforcement' }, headers: { 'x-github-sso': 'required; url=https://github.com/orgs/o/sso?x=1' } });
    expect(sso.kind).toBe('sso');
    expect(sso.detail?.ssoUrl).toBe('https://github.com/orgs/o/sso?x=1');
    const perm = await err({ status: 403, json: { message: 'Resource not accessible' }, headers: { 'x-accepted-github-permissions': 'administration=write' } });
    expect(perm.detail?.acceptedPermissions).toBe('administration=write');
  });
  it('reports network failures and sends the bearer token', async () => {
    const e = await createClient({ fetch: async () => { throw new TypeError('x'); }, getToken: async () => 't' }).rest('/x').catch((x) => x);
    expect(e.kind).toBe('network');
    const f = fakeFetch(() => ({ json: {} }));
    await client(f).rest('/x');
    expect(f.calls[0].headers.Authorization).toBe('Bearer t');
    const g = fakeFetch(() => ({ json: {} }));
    await client(g, null).rest('/x');
    expect(g.calls[0].headers.Authorization).toBeUndefined();
  });
  it('explains org token policies', () => {
    expect(explainTokenRejection('Resource protected by organization SAML enforcement.')).toMatch(/SSO/);
    expect(explainTokenRejection('The org forbids access via a personal access token (classic).')).toMatch(/fine-grained/);
    expect(explainTokenRejection('something else')).toBeNull();
  });
});

describe('repo index (F14 done-when)', () => {
  const org = 'o';
  it('indexes 3,400 repos in 34 requests, at most 6 in flight, with progress', async () => {
    const data = makeRepos(3400);
    const f = fakeFetch(orgReposRoute(org, () => data));
    const store = memoryIndexStore();
    const progress: number[] = [];
    const r = await fullIndex(client(f), org, store, { onProgress: (p) => progress.push(p.loaded) });
    expect(f.calls).toHaveLength(34);
    expect(f.stats.maxInflight).toBeLessThanOrEqual(6);
    expect(r.repos).toHaveLength(3400);
    expect(progress[0]).toBe(100);
    expect(progress.at(-1)).toBe(3400);
    expect(progress.length).toBeGreaterThan(5);
    expect(r.repos[0].name).toBe('repo-0');
    expect(r.repos[0]).toMatchObject({ language: 'TypeScript', viewerIsAdmin: true, stars: 0 });
    expect((await store.load(org))!.meta.total).toBe(3400);
  });
  it('uses 2 concurrent requests in public-only mode', async () => {
    const f = fakeFetch(orgReposRoute(org, () => makeRepos(1000)));
    const h = createHandler({ fetch: f.fetch, kv: memoryKV(), index: memoryIndexStore(), clientId: 'c' });
    const res: any = await h({ type: 'org:refresh', org });
    expect(res.ok).toBe(true);
    expect(f.stats.maxInflight).toBeLessThanOrEqual(2);
  });
  it('an incremental refresh with no new pushes makes exactly 1 request', async () => {
    const data = makeRepos(3400);
    const store = memoryIndexStore();
    const f1 = fakeFetch(orgReposRoute(org, () => data));
    await refreshIndex(client(f1), org, store, { now: () => Date.parse('2026-01-10T13:00:00Z') });
    const f2 = fakeFetch(orgReposRoute(org, () => data));
    const r = await refreshIndex(client(f2), org, store, { now: () => Date.parse('2026-01-10T14:00:00Z') });
    expect(f2.calls).toHaveLength(1);
    expect(r).toMatchObject({ status: 'ok', mode: 'incremental' });
  });
  it('an incremental refresh merges new pushes and keeps paging while pages are all new', async () => {
    const base = makeRepos(300, Date.parse('2026-01-10T12:00:00Z'));
    let data = base;
    const store = memoryIndexStore();
    await refreshIndex(client(fakeFetch(orgReposRoute(org, () => data))), org, store, { now: () => Date.parse('2026-01-10T12:30:00Z') });
    // The 120 oldest repos are pushed again after the last sync: they move to the front (same page count).
    const pushed = base.slice(180).map((r, i) => ({ ...r, pushed_at: new Date(Date.parse('2026-01-10T13:00:00Z') - i * 1000).toISOString() }));
    data = [...pushed, ...base.slice(0, 180)];
    const f = fakeFetch(orgReposRoute(org, () => data));
    const r: any = await refreshIndex(client(f), org, store, { now: () => Date.parse('2026-01-10T13:30:00Z') });
    expect(r.mode).toBe('incremental');
    expect(f.calls).toHaveLength(2); // page 1 all new, page 2 mixed -> stop
    expect(r.repos).toHaveLength(300);
    expect(r.repos[0].name).toBe('repo-180');
  });
  it('reconciliation (full) drops deleted repos and runs when the page count changes', async () => {
    let data = makeRepos(250);
    const store = memoryIndexStore();
    await refreshIndex(client(fakeFetch(orgReposRoute(org, () => data))), org, store, { now: () => Date.parse('2026-01-10T12:30:00Z') });
    data = data.slice(0, 150); // 100 repos deleted: page count 3 -> 2
    const r: any = await refreshIndex(client(fakeFetch(orgReposRoute(org, () => data))), org, store, { now: () => Date.parse('2026-01-10T12:40:00Z') });
    expect(r.mode).toBe('full');
    expect(r.repos).toHaveLength(150);
  });
  it('runs a full sync when the last one is older than 24h or on force', async () => {
    const data = makeRepos(50);
    const store = memoryIndexStore();
    await refreshIndex(client(fakeFetch(orgReposRoute(org, () => data))), org, store, { now: () => Date.parse('2026-01-10T12:30:00Z') });
    const late: any = await refreshIndex(client(fakeFetch(orgReposRoute(org, () => data))), org, store, { now: () => Date.parse('2026-01-12T12:30:00Z') });
    expect(late.mode).toBe('full');
    const forced: any = await refreshIndex(client(fakeFetch(orgReposRoute(org, () => data))), org, store, { force: true });
    expect(forced.mode).toBe('full');
  });
  it('pauses below the rate-limit floor and makes no requests', async () => {
    const f = fakeFetch(orgReposRoute(org, () => makeRepos(10)), () => undefined);
    const c = client(f);
    c.rate.remaining = 150;
    c.rate.resetAt = 2000000000;
    const r = await refreshIndex(c, org, memoryIndexStore());
    expect(r.status).toBe('paused');
    expect(f.calls).toHaveLength(0);
  });
});

describe('org file and access', () => {
  const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  it('decodes UTF-8 base64 with line breaks', () => {
    expect(decodeBase64Utf8(b64('ação\nok').replace(/(.{6})/g, '$1\n'))).toBe('ação\nok');
  });
  it('reads the file, then revalidates with the ETag (304 uses the cache), and handles 404', async () => {
    const kv = memoryKV();
    let mode: 'ok' | '304' | '404' = 'ok';
    const f = fakeFetch((u, call) => {
      if (!u.pathname.endsWith('/contents/repo-groups.yml')) return undefined;
      if (mode === '404') return { status: 404, json: { message: 'Not Found' } };
      if (mode === '304') return call.headers['If-None-Match'] === '"e1"' ? { status: 304 } : { json: {} };
      return { json: { content: b64('version: 1\ngroups: []\n# ç'), sha: 'abc' }, headers: { etag: '"e1"' } };
    });
    const c = client(f);
    const a = await readOrgFile(c, kv, 'o');
    expect(a).toEqual({ exists: true, text: 'version: 1\ngroups: []\n# ç', sha: 'abc', etag: '"e1"' });
    mode = '304';
    expect(await readOrgFile(c, kv, 'o')).toEqual(a);
    mode = '404';
    expect((await readOrgFile(c, kv, 'o')).exists).toBe(false);
  });
  const world = (o: { role?: 'admin' | 'member' | null; push?: boolean; dotgithub?: boolean; installed?: boolean; forking?: boolean }) =>
    fakeFetch(
      (u) => (u.pathname === '/user/memberships/orgs/o' ? (o.role ? { json: { role: o.role, state: 'active' } } : { status: 404, json: {} }) : undefined),
      (u) => (u.pathname === '/repos/o/.github' ? (o.dotgithub === false ? { status: 404, json: {} } : { json: { default_branch: 'main', permissions: { push: !!o.push }, allow_forking: o.forking ?? true } }) : undefined),
      (u) => (u.pathname === '/user/installations' ? { json: { installations: o.installed === false ? [] : [{ account: { login: 'O' } }] } } : undefined),
    );
  it('detects owner, editor, member, outside collaborator and missing App', async () => {
    const lvl = async (o: Parameters<typeof world>[0], kind: 'oauth' | 'pat' = 'oauth') => (await probeAccess(client(world(o)), 'o', kind)).access.level;
    expect(await lvl({ role: 'admin', push: true })).toBe('owner');
    expect(await lvl({ role: 'member', push: true })).toBe('editor');
    expect(await lvl({ role: 'member' })).toBe('member');
    expect(await lvl({ role: null, dotgithub: false })).toBe('outside');
    expect(await lvl({ role: 'member', installed: false })).toBe('no-app');
    expect(await lvl({ role: 'member', installed: false }, 'pat')).toBe('member'); // PAT skips the installation check
  });
  it('exposes suggest-mode inputs from .github', async () => {
    const r = await probeAccess(client(world({ role: 'member', forking: false })), 'o', 'oauth');
    expect(r.access).toMatchObject({ suggestMode: true, canForkSuggest: false });
    expect(r.dotGithub.defaultBranch).toBe('main');
  });
});

describe('message handler', () => {
  it('signs in through the device flow and never returns the token', async () => {
    const f = fakeFetch(
      (u) => (u.pathname === '/login/oauth/access_token' ? { json: { access_token: 'gho_secret' } } : undefined),
      (u) => (u.pathname === '/user' ? { json: { login: 'alysson', avatar_url: 'https://a/x.png' } } : undefined),
    );
    const kv = memoryKV();
    const h = createHandler({ fetch: f.fetch, kv, index: memoryIndexStore(), clientId: 'cid' });
    const done = await h({ type: 'auth:poll', deviceCode: 'dc', interval: 5 });
    expect(JSON.stringify(done)).not.toContain('gho_secret');
    expect(done).toMatchObject({ ok: true, data: { state: 'done', signedIn: true, login: 'alysson', kind: 'oauth' } });
    expect(JSON.stringify(await h({ type: 'auth:status' }))).not.toContain('gho_secret');
    expect(kv.data.get('rg:auth')).toMatchObject({ token: 'gho_secret' });
    expect(await h({ type: 'auth:signout' })).toMatchObject({ ok: true, data: { signedIn: false } });
  });
  it('validates a pasted token and returns errors with a hint', async () => {
    const f = fakeFetch((u) => (u.pathname === '/user' ? { status: 401, json: {} } : undefined));
    const h = createHandler({ fetch: f.fetch, kv: memoryKV(), index: memoryIndexStore(), clientId: 'c' });
    expect(await h({ type: 'auth:pat', token: 'bad' })).toMatchObject({ ok: false, error: { message: 'GitHub rejected this token.' } });
    const g = fakeFetch(() => ({ status: 403, json: { message: 'Resource protected by organization SAML enforcement' } }));
    const h2 = createHandler({ fetch: g.fetch, kv: memoryKV(), index: memoryIndexStore(), clientId: 'c' });
    const r: any = await h2({ type: 'org:file', org: 'o' });
    expect(r.ok).toBe(false);
    expect(r.error.hint).toMatch(/SSO/);
  });
});
