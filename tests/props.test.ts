import { describe, expect, it } from 'vitest';
import { load } from './fixtures';
import { fakeFetch, orgReposRoute, makeRepos, type Route } from './fake-github';
import { isPropRule, parsePropRule, propHit, ruleLabel, matches } from '../src/core/glob';
import { pickIn, placement, postOrder, ruleFor } from '../src/core/placement';
import { readConfig } from '../src/core/yaml-read';
import { validateDraft } from '../src/core/edit';
import { aiText, repositoriesContext } from '../src/core/ai-prompt';
import { createClient } from '../src/background/api';
import { createHandler } from '../src/background/handlers';
import { memoryKV } from '../src/background/kv';
import { memoryIndexStore } from '../src/background/repo-index';
import { loadProps, propsKey, withProps } from '../src/background/props-data';
import { APP_PERMISSIONS } from '../src/core/app-link';

const read = (t: string) => readConfig(t, load, { org: 'o' });

describe('property rules (core)', () => {
  it('parses and labels', () => {
    expect(isPropRule('PROP:a=b')).toBe(true);
    expect(isPropRule('dags-*')).toBe(false);
    expect(parsePropRule('prop:client=Acme')).toEqual({ name: 'client', value: 'Acme' });
    expect(parsePropRule('prop:client')).toBeNull();
    expect(parsePropRule('prop:=x')).toBeNull();
    expect(parsePropRule('prop:a=')).toBeNull();
    expect(ruleLabel('prop:client=Acme')).toBe('client: Acme');
    expect(ruleLabel('dags-*')).toBe('dags-*');
  });
  it('matches value case-insensitively, with globs, on strings and lists', () => {
    expect(propHit('prop:Client=acme', { client: 'ACME' })).toBe(true);
    expect(propHit('prop:team=da*', { team: 'Data' })).toBe(true);
    expect(propHit('prop:team=da*', { team: ['ml', 'data-eng'] })).toBe(true);
    expect(propHit('prop:team=da*', { team: 'ml' })).toBe(false);
    expect(propHit('prop:team=da*', undefined)).toBe(false);
    expect(propHit('prop:client', { client: 'x' })).toBe(false);
    expect(matches(['prop:client=Acme'], 'whatever', { client: 'Acme' })).toBe(true);
    expect(matches(['prop:client=Acme'], 'whatever')).toBe(false);
  });
  const cfg = read(`groups:
  - name: clients
    groups:
      - name: acme
        match: ["prop:client=Acme"]
  - name: data
    match: ["prop:team=da*", "special"]
  - name: names
    match: ["acme-*"]
`).config!;
  const order = postOrder(cfg.groups);
  it('keeps the §5.3 precedence: exact-style beats pattern-style, deepest pattern wins', () => {
    // exact-style property rule beats a name pattern in another group
    expect(pickIn(order, 'acme-web', { client: 'Acme' })?.key).toBe('clients/acme');
    // an exact name beats a property pattern
    expect(pickIn(order, 'special', { team: 'data' })?.key).toBe('data');
    expect(pickIn(order, 'x', { team: 'data' })?.key).toBe('data');
    // no props: falls back to name rules / ungrouped
    expect(pickIn(order, 'acme-web')?.key).toBe('names');
    expect(pickIn(order, 'other')).toBeNull();
    expect(ruleFor(cfg.groups[0].groups[0], 'x', { client: 'acme' })).toBe('prop:client=Acme');
  });
  it('placement uses repo props', () => {
    const p = placement(cfg.groups, [{ name: 'a', props: { client: 'Acme' } }, { name: 'b' }]);
    expect(p).toEqual({ a: 'clients/acme', b: '' });
  });
});

describe('property rules (validation, drawer, AI)', () => {
  it('rejects prop: without name=value', () => {
    const r = read(`groups:\n  - name: a\n    match: ["prop:client"]\n`);
    expect(r.error).toBe('"a": rule "prop:client" needs a property and a value, like prop:client=Acme.');
    expect(read(`groups:\n  - name: a\n    match: ["prop:client=Acme"]\n`).error).toBeUndefined();
  });
  it('blocks a bad rule in the drawer', () => {
    expect(validateDraft([], { mode: 'new', path: [], name: 'a', match: ['prop:x'] })).toMatch(/needs a property and a value/);
    expect(validateDraft([], { mode: 'new', path: [], name: 'a', match: ['prop:x=y'] })).toBeNull();
  });
  it('lists properties in the AI context and explains prop: rules in the prompt', () => {
    const ctx = repositoriesContext([{ name: 'r', props: { client: 'Acme', tags: ['a', 'b'] } }, { name: 's' }]);
    expect(ctx).toContain('    properties: { "client": "Acme", "tags": ["a", "b"] }');
    expect(ctx.match(/properties:/g)).toHaveLength(1);
    expect(aiText('o', 'groups: []', [])).toContain('prop:client=Acme');
  });
  it('registers the app with Custom properties: Read', () => {
    expect(APP_PERMISSIONS.organization_custom_properties).toBe('read');
  });
});

const row = (name: string, props: Record<string, unknown>) => ({
  repository_name: name,
  repository_id: 1,
  repository_full_name: `o/${name}`,
  properties: Object.entries(props).map(([property_name, value]) => ({ property_name, value })),
});

/** 250 repos in pages of 100 with a Link header, as GitHub serves them. */
const propsRoute = (opts: { status?: number } = {}): Route => (url) => {
  if (url.pathname !== '/orgs/o/properties/values') return undefined;
  if (opts.status) return { status: opts.status, json: { message: 'Resource not accessible by integration' } };
  const page = Number(url.searchParams.get('page') ?? '1');
  const all = Array.from({ length: 250 }, (_, i) => row(`repo-${i}`, i % 2 ? { client: 'Acme', team: ['data', 'ml'] } : { client: null }));
  return {
    json: all.slice((page - 1) * 100, page * 100),
    headers: { link: `<https://api.github.com/orgs/o/properties/values?per_page=100&page=2>; rel="next", <https://api.github.com/orgs/o/properties/values?per_page=100&page=3>; rel="last"` },
  };
};
const client = (f: ReturnType<typeof fakeFetch>) => createClient({ fetch: f.fetch, getToken: async () => 't' });

describe('loadProps (background)', () => {
  it('pages through all values, drops nulls, caches by interval', async () => {
    const f = fakeFetch(propsRoute());
    const kv = memoryKV();
    let now = 1000;
    const r = await loadProps(client(f), kv, 'o', { now: () => now });
    expect(f.calls.map((c) => new URL(c.url).searchParams.get('page')).sort()).toEqual(['1', '2', '3']);
    expect(f.calls.every((c) => new URL(c.url).searchParams.get('per_page') === '100')).toBe(true);
    expect(r.unavailable).toBe(false);
    expect(Object.keys(r.props)).toHaveLength(125);
    expect(r.props['repo-1']).toEqual({ client: 'Acme', team: ['data', 'ml'] });
    expect(r.props['repo-0']).toBeUndefined();
    await loadProps(client(f), kv, 'o', { now: () => (now += 60_000) });
    expect(f.calls).toHaveLength(3); // inside the interval: no request
    await loadProps(client(f), kv, 'o', { now: () => (now += 10 * 60_000) });
    expect(f.calls).toHaveLength(6);
    expect((await loadProps(client(f), kv, 'o', { cacheOnly: true })).props['repo-1']).toBeDefined();
    expect(f.calls).toHaveLength(6);
  });
  it.each([403, 404])('degrades on %i without throwing', async (status) => {
    const f = fakeFetch(propsRoute({ status }));
    const kv = memoryKV();
    const r = await loadProps(client(f), kv, 'o');
    expect(r).toEqual({ props: {}, unavailable: true });
    expect((await kv.get<any>(propsKey('o'))).unavailable).toBe(true);
  });
  it('withProps copies only repos that have values', () => {
    const repos: { name: string; props?: Record<string, string | string[]> }[] = [{ name: 'a' }, { name: 'b' }];
    const out = withProps(repos, { a: { client: 'x' } });
    expect(out[0].props).toEqual({ client: 'x' });
    expect(out[1]).toBe(repos[1]);
    expect(withProps(repos, {})).toBe(repos);
  });
});

describe('handler joins props', () => {
  const FILE = `groups:\n  - name: acme\n    match: ["prop:client=Acme"]\n`;
  const setup = async (rules: Route[], fileText = FILE) => {
    const f = fakeFetch(orgReposRoute('o', () => makeRepos(3)), ...rules);
    const kv = memoryKV();
    await kv.set('rg:file:o', { exists: true, text: fileText, sha: 's', etag: null });
    const handle = createHandler({ fetch: f.fetch, kv, session: memoryKV(), index: memoryIndexStore(), getToken: async () => 't' } as any);
    return { f, handle };
  };
  it('adds props to refreshed repos, only when the file has a prop: rule', async () => {
    const { handle } = await setup([(u) => (u.pathname === '/orgs/o/properties/values' ? { json: [row('repo-1', { client: 'Acme' })] } : undefined)]);
    const r: any = await handle({ type: 'org:refresh', org: 'o' } as any);
    expect(r.ok).toBe(true);
    expect(r.data.repos.find((x: any) => x.name === 'repo-1').props).toEqual({ client: 'Acme' });
    const cached: any = await handle({ type: 'org:cached', org: 'o' } as any);
    expect(cached.data.repos.find((x: any) => x.name === 'repo-1').props).toEqual({ client: 'Acme' });
    const plain = await setup([], 'groups: []\n');
    await plain.handle({ type: 'org:refresh', org: 'o' } as any);
    expect(plain.f.calls.some((c) => c.url.includes('/properties/'))).toBe(false);
  });
  it('flags propsUnavailable and still answers when GitHub refuses', async () => {
    const { handle } = await setup([propsRoute({ status: 403 })]);
    const r: any = await handle({ type: 'org:refresh', org: 'o' } as any);
    expect(r.ok).toBe(true);
    expect(r.data.meta.propsUnavailable).toBe(true);
    expect(r.data.repos.every((x: any) => !x.props)).toBe(true);
  });
});
