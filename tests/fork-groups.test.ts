import { describe, expect, it } from 'vitest';
import { load } from './fixtures';
import { matches } from '../src/core/glob';
import { pickIn, placement, postOrder, ruleFor } from '../src/core/placement';
import { proposeForkGroups, withForkGroups } from '../src/core/fork-groups';
import { readConfig } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';
import { aiText, repositoriesContext } from '../src/core/ai-prompt';
import { memoryKV } from '../src/background/kv';
import { memoryIndexStore } from '../src/background/repo-index';
import { loadParents } from '../src/background/parents';
import { createClient } from '../src/background/api';
import { fakeFetch } from './fake-github';
import { reconcile } from '../src/core/index-sync';
import type { Group, RepoInfo } from '../src/core/types';

const g = (name: string, match: string[], groups: Group[] = []): Group => ({ name, description: '', logo: null, teams: [], match, groups });
const fork = (name: string, parent: string | null): RepoInfo => ({ name, fork: true, parent });
const read = (t: string) => readConfig(t, load, { org: 'me' });

describe('fork-of rules', () => {
  const repos: RepoInfo[] = [fork('fuse', 'macfuse/fuse'), fork('osxfuse', 'osxfuse/osxfuse'), fork('lib', 'macfuse/lib'), { name: 'own' }, fork('noparent', null)];
  it('matches forks by parent owner or owner/repo, case-insensitively', () => {
    const order = postOrder([g('mac', ['fork-of:MacFUSE']), g('one', ['fork-of:osxfuse/osxfuse'])]);
    expect(pickIn(order, repos[0])?.key).toBe('mac');
    expect(pickIn(order, repos[2])?.key).toBe('mac');
    expect(pickIn(order, repos[1])?.key).toBe('one');
    expect(pickIn(order, repos[3])).toBeNull();
    expect(pickIn(order, repos[4])).toBeNull();
    expect(pickIn(order, 'fuse')).toBeNull(); // by name alone a fork-of rule never hits
  });
  it('needs the repo to be a fork with a known parent', () => {
    const order = postOrder([g('mac', ['fork-of:macfuse'])]);
    expect(pickIn(order, { name: 'x', parent: 'macfuse/x' })).toBeNull();
    expect(pickIn(order, { name: 'x', fork: true })).toBeNull();
    expect(matches(['fork-of:macfuse'], 'fork-of:macfuse')).toBe(false);
  });
  it('keeps the 5.3 precedence: exact beats pattern, deepest pattern wins', () => {
    const tree = [g('infra', ['fuse-*'], [g('deep', ['fork-of:macfuse/fuse'])]), g('forks', ['fork-of:macfuse', 'lib'])];
    const order = postOrder(tree);
    // both fork-of rules are exact-style: the first in post-order (children before parents) wins
    expect(pickIn(order, fork('fuse', 'macfuse/fuse'))?.key).toBe('infra/deep');
    expect(pickIn(order, fork('lib', 'macfuse/lib'))?.key).toBe('forks');
    // a * fork-of rule is a pattern: it loses to an exact name elsewhere
    const t2 = postOrder([g('a', ['fork-of:mac*']), g('b', ['fuse'])]);
    expect(pickIn(t2, fork('fuse', 'macfuse/fuse'))?.key).toBe('b');
    expect(ruleFor(g('a', ['fork-of:mac*']), fork('fuse', 'macfuse/fuse'))).toBe('fork-of:mac*');
    expect(placement([g('mac', ['fork-of:macfuse'])], repos)).toMatchObject({ fuse: 'mac', lib: 'mac', osxfuse: '', own: '' });
  });
  it('validates the rule and round-trips through the writer', () => {
    const ok = read('groups:\n  - name: mac\n    match: ["fork-of:macfuse", "fork-of:a/b"]\n');
    expect(ok.error).toBeUndefined();
    expect(ok.config!.groups[0].match).toEqual(['fork-of:macfuse', 'fork-of:a/b']);
    expect(read(writeConfig(ok.config!, 'me/.github/repo-groups.yml')).config).toEqual(ok.config);
    expect(read('groups:\n  - name: mac\n    match: ["fork-of:"]\n').error).toBe('"mac": rule "fork-of:" needs an owner, like fork-of:macfuse or fork-of:macfuse/macfuse.');
    expect(read('groups:\n  - name: mac\n    match: ["fork-of:a/b/c"]\n').error).toMatch(/needs an owner/);
  });
});

describe('proposeForkGroups', () => {
  const repos: RepoInfo[] = [
    fork('fuse', 'macfuse/fuse'),
    fork('lib', 'MacFuse/lib'),
    fork('one-off', 'solo/x'),
    fork('a', 'big/a'),
    fork('b', 'big/b'),
    fork('c', 'big/c'),
    fork('placed', 'big/placed'),
    { name: 'own' },
    { ...fork('old1', 'old/a'), archived: true },
    { ...fork('old2', 'old/b'), archived: true },
  ];
  it('proposes one group per owner with at least 2 ungrouped forks, biggest first', () => {
    const p = proposeForkGroups([g('mine', ['placed'])], repos);
    expect(p.map((x) => [x.group.name, x.group.match, x.repos])).toEqual([
      ['big', ['fork-of:big'], ['a', 'b', 'c']],
      ['macfuse', ['fork-of:macfuse'], ['fuse', 'lib']],
    ]);
  });
  it('skips owners already covered and renames a clashing group', () => {
    expect(proposeForkGroups([g('x', ['fork-of:big'])], repos).map((x) => x.owner)).toEqual(['macfuse']);
    const p = proposeForkGroups([g('macfuse', ['something'])], repos);
    expect(p.find((x) => x.owner === 'macfuse')!.group.name).toBe('macfuse-forks');
  });
  it('is empty without parents and the draft is valid YAML that files the forks', () => {
    expect(proposeForkGroups([], [{ name: 'f', fork: true }, { name: 'g', fork: true }])).toEqual([]);
    const groups = [g('mine', ['own'])];
    const draft = withForkGroups(groups, proposeForkGroups(groups, repos));
    const text = writeConfig({ version: 1, index: 'api', groups: draft }, 'me/.github/repo-groups.yml');
    const cfg = read(text).config!;
    expect(placement(cfg.groups, repos)).toMatchObject({ fuse: 'macfuse', a: 'big', own: 'mine' });
  });
});

describe('AI context', () => {
  it('lists fork_of for forks with a known parent', () => {
    const ctx = repositoriesContext([fork('fuse', 'macfuse/fuse'), { name: 'own' }]);
    expect(ctx).toContain('    fork_of: macfuse/fuse');
    expect(ctx.match(/fork_of/g)).toHaveLength(1);
    expect(aiText('me', 'groups: []', [fork('fuse', 'macfuse/fuse')])).toContain('fork_of: macfuse/fuse');
  });
});

describe('fork parents in the index', () => {
  const store = async () => {
    const s = memoryIndexStore();
    const repos: RepoInfo[] = [{ name: 'own' }, ...Array.from({ length: 120 }, (_, i) => ({ name: `f${i}`, fork: true }))];
    await s.save('me', repos, { lastFullSync: null, lastIncrementalSync: null, total: repos.length });
    return s;
  };
  const route = (calls: string[]) => (u: URL, c: { body?: string }) => {
    if (u.pathname !== '/graphql') return undefined;
    const q = JSON.parse(c.body!);
    calls.push(q.query);
    const data: Record<string, unknown> = {};
    Object.keys(q.variables)
      .filter((k) => k.startsWith('n'))
      .forEach((k, i) => (data[`r${i}`] = { name: q.variables[k], parent: { nameWithOwner: `up/${q.variables[k]}`, owner: { login: 'up' } } }));
    return { json: { data } };
  };
  it('asks GraphQL for forks only, 50 per query, once, and stores the parent in the index', async () => {
    const calls: string[] = [];
    const f = fakeFetch(route(calls));
    const client = createClient({ fetch: f.fetch, getToken: async () => 't' });
    const kv = memoryKV();
    const s = await store();
    const map = await loadParents(client, kv, s, 'me');
    expect(calls).toHaveLength(3); // 120 forks -> 50 + 50 + 20; "own" is not asked
    expect(calls[0]).toContain('parent { nameWithOwner owner { login } }');
    expect(map.f0).toBe('up/f0');
    expect(Object.keys(map)).toHaveLength(120);
    expect((await s.load('me'))!.repos.find((r) => r.name === 'f5')!.parent).toBe('up/f5');
    await loadParents(client, kv, s, 'me');
    expect(calls).toHaveLength(3); // nothing new to ask
  });
  it('answers from the kv cache when the index lost its parents, and keeps parents on reconcile', async () => {
    const calls: string[] = [];
    const f = fakeFetch(route(calls));
    const client = createClient({ fetch: f.fetch, getToken: async () => 't' });
    const kv = memoryKV();
    const s = await store();
    await loadParents(client, kv, s, 'me');
    const snap = (await s.load('me'))!;
    await s.save('me', snap.repos.map((r) => ({ ...r, parent: undefined })), snap.meta);
    expect((await loadParents(client, kv, s, 'me')).f1).toBe('up/f1');
    expect(calls).toHaveLength(3);
    expect(reconcile(snap.repos, [{ name: 'f1', fork: true }])[0].parent).toBe('up/f1');
  });
});
