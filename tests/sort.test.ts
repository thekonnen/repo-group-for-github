import { describe, expect, it } from 'vitest';
import { applyEdit, commitMessage } from '../src/core/edit';
import { diffTrees } from '../src/core/diff';
import { buildTree } from '../src/core/tree';
import { isPinned, orderRepos, prunePins } from '../src/core/sort';
import { readConfig } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';
import { AI_PROMPT_TEMPLATE } from '../src/core/ai-prompt';
import { findGroup } from '../src/core/placement';
import type { RepoInfo } from '../src/core/types';
import { example, load, REPOS } from './fixtures';

const R = (name: string, o: Partial<RepoInfo> = {}): RepoInfo => ({ name, ...o });
const names = (l: RepoInfo[]) => l.map((r) => r.name);
const read = (t: string) => readConfig(t, load, { org: 'o' });

describe('orderRepos (pins + stable sort)', () => {
  const list = [R('b', { pushedAt: '2026-01-02T00:00:00Z', stars: 1 }), R('a', { pushedAt: '2026-01-01T00:00:00Z', stars: 9 }), R('c', { pushedAt: '2026-01-03T00:00:00Z', stars: 1, openIssuesAndPrs: 4 })];
  it('defaults to last pushed, other keys as GitHub does, and never mutates', () => {
    const copy = list.slice();
    expect(names(orderRepos(list).list)).toEqual(['c', 'b', 'a']);
    expect(names(orderRepos(list, 'name').list)).toEqual(['a', 'b', 'c']);
    expect(names(orderRepos(list, 'stars').list)).toEqual(['a', 'c', 'b']);
    expect(names(orderRepos(list, 'issues').list)).toEqual(['c', 'b', 'a']);
    expect(list).toEqual(copy);
  });
  it('puts pins first in pin order whatever the sort, ignoring stale and repeated pins, case-insensitively', () => {
    const r = orderRepos(list, 'name', ['C', 'gone', 'a', 'c']);
    expect(names(r.list)).toEqual(['c', 'a', 'b']);
    expect(r.pins).toEqual(['c', 'a']);
  });
  it('is stable for equal keys', () => {
    const same = [R('x'), R('y'), R('z')];
    expect(names(orderRepos(same, 'stars').list)).toEqual(['x', 'y', 'z']);
  });
});

describe('tree with pins and sort', () => {
  it('orders a group by its sort, pins on top; the group latest push ignores the order', () => {
    const cfg = example();
    const g = findGroup(cfg.groups, ['infra', 'dagsrv'])!;
    g.sort = 'name';
    g.pinned = ['kite-dagsrv', 'not-here'];
    const repos = ['kite-dagsrv', 'dagsrv', 'dags-repo'].map((name, i) => R(name, { pushedAt: `2026-01-0${i + 1}T00:00:00Z` }));
    const node = buildTree(cfg.groups, repos).byKey.get('infra/dagsrv')!;
    expect(names(node.repos)).toEqual(['kite-dagsrv', 'dags-repo', 'dagsrv']);
    expect(node.pins).toEqual(['kite-dagsrv']);
    expect(node.latest).toBe('2026-01-03T00:00:00Z');
  });
  it('pins of a repo placed in another group are ignored', () => {
    const cfg = example();
    findGroup(cfg.groups, ['infra', 'authn'])!.pinned = ['kite-dagsrv'];
    const model = buildTree(cfg.groups, REPOS);
    expect(model.byKey.get('infra/authn')!.pins).toEqual([]);
    expect(model.placed.get('kite-dagsrv')).toBe('infra/dagsrv');
  });
});

describe('YAML: reader, validator, writer', () => {
  const yml = 'groups:\n  - name: a\n    match: ["x"]\n    pinned: ["x", " y ", "x"]\n    sort: stars\n';
  it('reads pinned (deduped, trimmed) and sort', () => {
    const g = read(yml).config!.groups[0];
    expect(g.pinned).toEqual(['x', 'y']);
    expect(g.sort).toBe('stars');
  });
  it('rejects a bad pinned or sort with section 5.2 style messages', () => {
    expect(read('groups:\n  - name: a\n    pinned: x\n').error).toBe('"a": pinned must be a list of repository names.');
    expect(read('groups:\n  - name: a\n    pinned: [1]\n').error).toBe('"a": pinned must be a list of repository names.');
    expect(read('groups:\n  - name: a\n    sort: size\n').error).toBe('"a": sort must be one of pushed, name, stars, issues.');
  });
  it('writes match, pinned, sort, groups in that order and round-trips', () => {
    const cfg = read('groups:\n  - name: a\n    match: ["x"]\n    sort: name\n    pinned: ["x"]\n    groups:\n      - name: b\n').config!;
    const text = writeConfig(cfg, 'o/.github/repo-groups.yml');
    expect(text).toContain('    match: ["x"]\n    pinned: ["x"]\n    sort: name\n    groups:\n');
    expect(read(text).config).toEqual(cfg);
    expect(writeConfig(cfg, 'h', { personal: true })).toContain('pinned: ["x"]');
  });
  it('omits an empty pinned list', () => {
    const text = writeConfig(read('groups:\n  - name: a\n    pinned: []\n').config!, 'h');
    expect(text).not.toContain('pinned');
  });
  it('the diff lists pinned and sort changes', () => {
    const a = read('groups:\n  - name: a\n').config!.groups;
    const b = read('groups:\n  - name: a\n    pinned: ["x"]\n    sort: name\n').config!.groups;
    const items = diffTrees(a, b, []).items.map((i) => `${i.k} ${i.text} -> ${i.to}`);
    expect(items).toEqual(['~ Pinned of a -> x', '~ Sort of a -> Name']);
  });
  it('the AI prompt says to keep pinned and sort untouched', () => {
    expect(AI_PROMPT_TEMPLATE).toMatch(/Keep every "pinned" and "sort" value exactly as it is/);
  });
});

describe('pin and sort edits', () => {
  const repos = REPOS;
  const base = example().groups;
  it('pins at the end, unpins, and names the commit', () => {
    const a: any = applyEdit(base, { kind: 'pin', path: ['infra', 'dagsrv'], repo: 'dagsrv', pinned: true }, repos);
    const b: any = applyEdit(a.groups, { kind: 'pin', path: ['infra', 'dagsrv'], repo: 'kite-dagsrv', pinned: true }, repos);
    expect(findGroup(b.groups, ['infra', 'dagsrv'])!.pinned).toEqual(['dagsrv', 'kite-dagsrv']);
    expect(isPinned(b.groups, ['infra', 'dagsrv'], 'DAGSRV')).toBe(true);
    const c: any = applyEdit(b.groups, { kind: 'pin', path: ['infra', 'dagsrv'], repo: 'dagsrv', pinned: false }, repos);
    expect(findGroup(c.groups, ['infra', 'dagsrv'])!.pinned).toEqual(['kite-dagsrv']);
    const d: any = applyEdit(c.groups, { kind: 'pin', path: ['infra', 'dagsrv'], repo: 'kite-dagsrv', pinned: false }, repos);
    expect(findGroup(d.groups, ['infra', 'dagsrv'])!.pinned).toBeUndefined();
    expect(commitMessage({ kind: 'pin', path: ['infra', 'dagsrv'], repo: 'dagsrv', pinned: true })).toBe('chore(repo-groups): pin dagsrv in infra/dagsrv');
    expect(commitMessage({ kind: 'pin', path: ['infra', 'dagsrv'], repo: 'dagsrv', pinned: false })).toBe('chore(repo-groups): unpin dagsrv in infra/dagsrv');
  });
  it('refuses to pin a repo that another group holds, or a group that is gone; never mutates', () => {
    const before = JSON.stringify(base);
    expect(applyEdit(base, { kind: 'pin', path: ['infra', 'authn'], repo: 'dagsrv', pinned: true }, repos)).toMatchObject({ error: expect.stringContaining('not in infra/authn') });
    expect(applyEdit(base, { kind: 'pin', path: ['gone'], repo: 'x', pinned: true }, repos)).toMatchObject({ error: expect.stringContaining('no longer exists') });
    expect(JSON.stringify(base)).toBe(before);
  });
  it('drops stale pins on the next write', () => {
    const cfg = example().groups;
    findGroup(cfg, ['infra', 'dagsrv'])!.pinned = ['dagsrv', 'renamed-away'];
    findGroup(cfg, ['ai'])!.pinned = ['dagsrv'];
    const r: any = applyEdit(cfg, { kind: 'sort', path: ['infra', 'dagsrv'], sort: 'name' }, repos);
    expect(findGroup(r.groups, ['infra', 'dagsrv'])!.pinned).toEqual(['dagsrv']);
    expect(findGroup(r.groups, ['ai'])!.pinned).toBeUndefined();
    expect(prunePins(cfg, repos)).not.toBe(cfg);
  });
  it('sets and clears sort; the default clears the key', () => {
    const a: any = applyEdit(base, { kind: 'sort', path: ['infra'], sort: 'stars' });
    expect(findGroup(a.groups, ['infra'])!.sort).toBe('stars');
    const b: any = applyEdit(a.groups, { kind: 'sort', path: ['infra'], sort: 'pushed' });
    expect(findGroup(b.groups, ['infra'])!.sort).toBeUndefined();
    expect(commitMessage({ kind: 'sort', path: ['infra'], sort: 'stars' })).toBe('chore(repo-groups): sort infra by stars');
    expect(commitMessage({ kind: 'sort', path: ['infra'], sort: null })).toBe('chore(repo-groups): reset sort of infra');
  });
  it('an edit of the group keeps its pins and sort', () => {
    const cfg = example().groups;
    Object.assign(findGroup(cfg, ['infra', 'dagsrv'])!, { pinned: ['dagsrv'], sort: 'name' });
    const r: any = applyEdit(cfg, { kind: 'edit', path: ['infra', 'dagsrv'], name: 'jobs', description: 'x', match: ['dagsrv'] });
    expect(findGroup(r.groups, ['infra', 'jobs'])).toMatchObject({ pinned: ['dagsrv'], sort: 'name' });
  });
});
