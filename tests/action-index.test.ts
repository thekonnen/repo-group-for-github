import { describe, expect, it } from 'vitest';
import { createClient } from '../src/background/api';
import { refreshActionIndex } from '../src/background/action-index';
import { loadDetails } from '../src/background/details';
import { createHandler } from '../src/background/handlers';
import { memoryKV } from '../src/background/kv';
import { memoryIndexStore } from '../src/background/repo-index';
import { parseActionIndex } from '../src/core/action-index';
import { detailTotals } from '../src/core/details';
import { fakeFetch, makeRepos, orgReposRoute, type Route } from './fake-github';

const org = 'o';
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const client = (f: ReturnType<typeof fakeFetch>) => createClient({ fetch: f.fetch, getToken: async () => 't' });
const GENERATED = new Date(Date.now() - 30 * 60000).toISOString(); // 30 minutes old, after every push of makeRepos()
const NOW = () => Date.now();

/** The Action file as written by design/actions/repo-index.yml (no viewerIsAdmin). */
const fileOf = (raw: any[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  org,
  generatedAt: GENERATED,
  total: raw.length,
  repos: raw.map((r) => ({ name: r.name, description: r.description, language: r.language, private: r.private, archived: r.archived, fork: r.fork, pushedAt: r.pushed_at, stars: r.stargazers_count, forks: r.forks_count, openIssuesAndPrs: r.open_issues_count })),
  ...extra,
});
const fileRoute = (body: () => unknown): Route => (u) => {
  if (u.pathname !== `/repos/${org}/.github/contents/repo-index.json`) return undefined;
  const b = body();
  return b === undefined ? { status: 404, json: { message: 'Not Found' } } : { json: b };
};
/** GraphQL alias lookups: only `canOpen` repos resolve (the rest are null, as for a repo the user cannot open). */
const graphqlRoute = (canOpen: (name: string) => boolean, log: string[][] = [], headers?: () => Record<string, string> | undefined): Route => (u, call) => {
  if (u.pathname !== '/graphql') return undefined;
  const { query, variables } = JSON.parse(call.body!);
  const names = Object.keys(variables).filter((k) => /^n\d+$/.test(k)).map((k) => variables[k] as string);
  log.push(names);
  const data: Record<string, unknown> = {};
  names.forEach((n, i) => {
    if (!canOpen(n)) data[`r${i}`] = null;
    else if (query.includes('viewerPermission')) data[`r${i}`] = { name: n, viewerPermission: Number(n.split('-')[1]) % 10 === 0 ? 'ADMIN' : 'WRITE' };
    else data[`r${i}`] = { name: n, issues: { totalCount: 2 }, pullRequests: { totalCount: 3 } };
  });
  return { json: { data }, headers: headers?.() };
};

const SECRET = 'repo-5'; // listed in the file, but the user cannot open it
const world = (n: number, over: { file?: () => unknown; headers?: () => Record<string, string> | undefined } = {}) => {
  const all = makeRepos(n);
  const mine = all.filter((r) => r.name !== SECRET);
  const gql: string[][] = [];
  const f = fakeFetch(fileRoute(over.file ?? (() => fileOf(all))), graphqlRoute((x) => x !== SECRET, gql, over.headers), orgReposRoute(org, () => mine));
  return { f, gql, all, mine };
};
const restPages = (f: ReturnType<typeof fakeFetch>) => f.calls.filter((c) => c.url.includes(`/orgs/${org}/repos`));

describe('Action index (index: action)', () => {
  it('first index downloads the file instead of paginating, confirms by GraphQL, then refreshes incrementally', async () => {
    const { f, gql, mine } = world(120);
    const store = memoryIndexStore();
    const r: any = await refreshActionIndex(client(f), org, store, { now: NOW });
    expect(r).toMatchObject({ status: 'ok', mode: 'incremental' });
    expect(restPages(f)).toHaveLength(1); // only the incremental page 1, no parallel pagination
    const fileCalls = f.calls.filter((c) => c.url.includes('repo-index.json'));
    expect(fileCalls).toHaveLength(1);
    expect(fileCalls[0].headers.Accept).toBe('application/vnd.github.raw+json');
    expect(gql.map((g) => g.length)).toEqual([50, 50, 20]); // 50 repos per query, never one per repo
    expect(r.repos.map((x: any) => x.name).sort()).toEqual(mine.map((x) => x.name).sort());
    expect(r.meta.index).toBe('action');
    expect(r.repos.find((x: any) => x.name === 'repo-10').viewerIsAdmin).toBe(true); // from viewerPermission
    expect(r.repos.find((x: any) => x.name === 'repo-11').viewerIsAdmin).toBe(false);
    expect(await store.loadUnconfirmed!(org)).toBeNull();
    // the next visit is a plain incremental refresh: 1 request, no file, no GraphQL
    const f2 = fakeFetch(orgReposRoute(org, () => mine));
    await refreshActionIndex(client(f2), org, store, { now: () => Date.now() + 60_000 });
    expect(f2.calls).toHaveLength(1);
  });

  it('never lets a repo the user cannot open reach the page: not before, not after the check', async () => {
    const all = makeRepos(120);
    const mine = all.filter((r) => r.name !== SECRET);
    const inner = fakeFetch(fileRoute(() => fileOf(all)), graphqlRoute((x) => x !== SECRET), orgReposRoute(org, () => mine));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    // Hold the first GraphQL answer to look at what the page could see in the meantime.
    const slow = async (input: string, init?: RequestInit) => {
      if (input.endsWith('/graphql')) await held;
      return inner.fetch(input, init);
    };
    const kv = memoryKV();
    kv.data.set('rg:auth', { token: 't', kind: 'oauth', login: 'u', avatarUrl: '' });
    kv.data.set(`rg:file:${org}`, { exists: true, text: 'version: 1\nindex: action\ngroups: []\n', sha: 's', etag: null });
    const store = memoryIndexStore();
    const h = createHandler({ fetch: slow, kv, index: store });
    const run = h({ type: 'org:refresh', org });
    await new Promise((r) => setTimeout(r, 20));
    const cachedDuring = JSON.stringify(await h({ type: 'org:cached', org }));
    expect(cachedDuring).toBe('{"ok":true,"data":null}'); // nothing from the file yet
    expect(JSON.stringify(await h({ type: 'org:progress', org }))).not.toContain('repo-');
    expect(JSON.stringify(await store.load(org))).not.toContain('repo-');
    release();
    const after = [JSON.stringify(await run), JSON.stringify(await h({ type: 'org:cached', org })), JSON.stringify(await store.load(org))];
    for (const s of after) {
      expect(s).not.toContain(`"${SECRET}"`);
      expect(s).toContain('"repo-6"');
    }
  });

  it('progress carries only a percentage, and the repos it exposes are confirmed ones', async () => {
    const { f } = world(120);
    const events: any[] = [];
    await refreshActionIndex(client(f), org, memoryIndexStore(), { now: NOW, onProgress: (p) => events.push({ ...p, names: p.repos.map((r) => r.name) }) });
    expect(events[0]).toMatchObject({ loaded: 0, estimatedTotal: 100, phase: 'action', names: [] });
    expect(events.every((e) => e.estimatedTotal === 100)).toBe(true);
    expect(events.flatMap((e) => e.names)).not.toContain(SECRET);
  });

  it('resumes after a rate-limit pause without downloading the file again, still hiding unconfirmed entries', async () => {
    const all = makeRepos(400);
    const mine = all.filter((r) => r.name !== SECRET);
    let low = true;
    const f = fakeFetch(fileRoute(() => fileOf(all)), graphqlRoute((x) => x !== SECRET, [], () => (low ? { 'x-ratelimit-remaining': '100' } : undefined)), orgReposRoute(org, () => mine));
    const store = memoryIndexStore();
    const p: any = await refreshActionIndex(client(f), org, store, { now: NOW });
    expect(p.status).toBe('paused');
    const part = await store.load(org);
    expect(part!.repos).toHaveLength(299); // one wave of 6 queries x 50 (repo-5 is not among the confirmed)
    expect((await store.loadUnconfirmed!(org))!.repos).toHaveLength(100);
    low = false;
    const f2 = fakeFetch(graphqlRoute((x) => x !== SECRET), orgReposRoute(org, () => mine));
    const r: any = await refreshActionIndex(client(f2), org, store, { now: () => Date.now() + 60_000 });
    expect(r.status).toBe('ok');
    expect(f2.calls.some((c) => c.url.includes('repo-index.json'))).toBe(false);
    expect(r.repos).toHaveLength(399);
    expect(r.repos.some((x: any) => x.name === SECRET)).toBe(false);
  });

  it("a forced Re-index replaces everything with the user's own data and clears the unconfirmed list", async () => {
    const { f, mine } = world(120);
    const store = memoryIndexStore();
    await refreshActionIndex(client(f), org, store, { now: NOW });
    await store.saveUnconfirmed!(org, { repos: [{ name: 'leftover' }], generatedAt: GENERATED });
    const f2 = fakeFetch(orgReposRoute(org, () => mine));
    const r: any = await refreshActionIndex(client(f2), org, store, { force: true });
    expect(r.mode).toBe('full');
    expect(await store.loadUnconfirmed!(org)).toBeNull();
    expect(r.repos).toHaveLength(119);
  });

  it.each([
    ['a missing file', () => undefined],
    ['an invalid file', () => ({ nope: true })],
    ['a file of another org', () => fileOf(makeRepos(3), { org: 'other' })],
    ['a file without a valid date', () => fileOf(makeRepos(3), { generatedAt: 'yesterday' })],
  ])('falls back silently to the API index for %s', async (_n, file) => {
    const { f, mine } = world(120, { file });
    const r: any = await refreshActionIndex(client(f), org, memoryIndexStore());
    expect(r).toMatchObject({ status: 'ok', mode: 'full' });
    expect(restPages(f).length).toBe(2); // normal parallel pagination
    expect(f.calls.some((c) => c.url.endsWith('/graphql'))).toBe(false);
    expect(r.repos).toHaveLength(mine.length);
    expect(r.meta.index).toBeUndefined();
  });

  it('without a token the file is not used at all', async () => {
    const { f } = world(120);
    const r: any = await refreshActionIndex(client(f), org, memoryIndexStore(), { publicOnly: true });
    expect(r.mode).toBe('full');
    expect(f.calls.some((c) => c.url.includes('repo-index.json') || c.url.endsWith('/graphql'))).toBe(false);
  });

  it('is only used when repo-groups.yml says index: action', async () => {
    const all = makeRepos(10);
    const kv = memoryKV();
    kv.data.set('rg:auth', { token: 't', kind: 'oauth', login: 'u', avatarUrl: '' });
    const f = fakeFetch(
      (u) => (u.pathname.endsWith('repo-groups.yml') ? { json: { content: b64('version: 1\ngroups: []\n'), sha: 's' } } : undefined),
      fileRoute(() => fileOf(all)),
      graphqlRoute(() => true),
      orgReposRoute(org, () => all),
    );
    const h = createHandler({ fetch: f.fetch, kv, index: memoryIndexStore() });
    const r: any = await h({ type: 'org:refresh', org });
    expect(r.data.mode).toBe('full');
    expect(f.calls.some((c) => c.url.includes('repo-index.json'))).toBe(false);
  });

  it('parses the format of the workflow template and ignores junk entries', () => {
    const ok = parseActionIndex({ version: 1, org: 'O', generatedAt: GENERATED, repos: [{ name: 'a', description: null, pushedAt: GENERATED, viewerIsAdmin: true }, { name: 'a' }, {}, 7] }, 'o')!;
    expect(ok.repos).toHaveLength(1);
    expect(ok.repos[0]).toMatchObject({ name: 'a', description: '', stars: 0 });
    expect(ok.repos[0].viewerIsAdmin).toBeUndefined();
    expect(parseActionIndex({ version: 2, repos: [] }, 'o')).toBeNull();
  });
});

describe('detail counts (org:details)', () => {
  const names = (n: number) => makeRepos(n).map((r) => r.name);
  it('loads split counts in batches of 50, never per repository, and caches them for the refresh interval', async () => {
    const gql: string[][] = [];
    const f = fakeFetch(graphqlRoute(() => true, gql));
    const kv = memoryKV();
    const t = Date.parse('2026-01-10T12:00:00Z');
    const d = await loadDetails(client(f), kv, org, names(120), { now: () => t });
    expect(gql.map((g) => g.length)).toEqual([50, 50, 20]);
    expect(d['repo-3']).toEqual({ issues: 2, prs: 3 });
    expect(Object.keys(d)).toHaveLength(120);
    await loadDetails(client(f), kv, org, names(120), { now: () => t + 60_000 });
    expect(gql).toHaveLength(3); // cached
    await loadDetails(client(f), kv, org, [...names(120), 'repo-new'], { now: () => t + 60_000 });
    expect(gql).toHaveLength(4); // only the one missing repo
    expect(gql[3]).toEqual(['repo-new']);
    await loadDetails(client(f), kv, org, names(120), { now: () => t + 6 * 60_000 });
    expect(gql).toHaveLength(7); // stale after 5 minutes
    expect(f.calls.every((c) => c.url.endsWith('/graphql'))).toBe(true);
  });
  it('does nothing and returns what is cached when the rate limit floor is hit', async () => {
    const kv = memoryKV();
    const f = fakeFetch(graphqlRoute(() => true, [], () => ({ 'x-ratelimit-remaining': '100' })));
    const c = client(f);
    const t = Date.parse('2026-01-10T12:00:00Z');
    const first = await loadDetails(c, kv, org, names(100), { now: () => t });
    expect(Object.keys(first)).toHaveLength(50); // the second batch was skipped: 100 remaining is below the floor
    expect(f.calls).toHaveLength(1);
    const again = await loadDetails(c, kv, org, names(100), { now: () => t + 10 * 60_000 });
    expect(f.calls).toHaveLength(1); // paused: no request, stale cache returned
    expect(Object.keys(again)).toHaveLength(50);
  });
  it('ignores requests for more than 200 repositories', async () => {
    const f = fakeFetch(graphqlRoute(() => true));
    expect(await loadDetails(client(f), memoryKV(), org, names(201))).toEqual({});
    expect(f.calls).toHaveLength(0);
  });
  it('is reachable through the message router', async () => {
    const f = fakeFetch(graphqlRoute(() => true));
    const kv = memoryKV();
    kv.data.set('rg:auth', { token: 't', kind: 'oauth', login: 'u', avatarUrl: '' });
    const h = createHandler({ fetch: f.fetch, kv, index: memoryIndexStore() });
    expect(await h({ type: 'org:details', org, repos: ['a', 'b'] })).toMatchObject({ ok: true, data: { a: { issues: 2, prs: 3 }, b: { issues: 2, prs: 3 } } });
  });
  it('split totals need details for every repo and a group of 200 or fewer', () => {
    expect(detailTotals([{ name: 'a' }, { name: 'b' }], { a: { issues: 1, prs: 2 }, b: { issues: 3, prs: 4 } })).toEqual({ issues: 4, prs: 6 });
    expect(detailTotals([{ name: 'a' }, { name: 'b' }], { a: { issues: 1, prs: 2 } })).toBeNull();
    expect(detailTotals(Array.from({ length: 201 }, (_, i) => ({ name: `r${i}` })), {})).toBeNull();
  });
});
