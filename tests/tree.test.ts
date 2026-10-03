import { describe, expect, it } from 'vitest';
import { example, REPOS } from './fixtures';
import { allRepos, avatarTone, buildTree, defaultExpanded, flatRows, memoTree, nodeAt, searchRows, sideItems, treeRows, windowRange } from '../src/core/tree';
import type { RepoInfo } from '../src/core/types';

const at = (min: number) => new Date(Date.parse('2026-01-10T12:00:00Z') - min * 60000).toISOString();
const repos: RepoInfo[] = [
  { name: 'kite-llm-proxy', description: 'AI Gateway', pushedAt: at(31), openIssuesAndPrs: 2 },
  { name: 'llm-proxy', pushedAt: at(46), openIssuesAndPrs: 1 },
  { name: 'kite-authn', pushedAt: at(120) },
  { name: 'kite-cmonitor', description: 'Deploy the uptime monitor using authn as login', pushedAt: at(180) },
  { name: 'authn', pushedAt: at(300) },
  { name: 'kite-dagsrv', pushedAt: at(302) },
  { name: 'dagsrv', pushedAt: at(360) },
  { name: 'keep_alive_job', pushedAt: at(780) },
  { name: 'oroute', pushedAt: at(900) },
  { name: 'dags-repo', pushedAt: at(2900) },
  { name: 'old-thing', archived: true, pushedAt: at(5000) },
];

describe('tree model (F1 done-when)', () => {
  const m = buildTree(example().groups, repos);
  it('shows infra and ai on the root with keep_alive_job ungrouped; hides archived', () => {
    expect(m.root.children.map((c) => c.key)).toEqual(['infra', 'ai']);
    expect(m.root.repos.map((r) => r.name)).toEqual(['keep_alive_job']);
    expect(m.visible).toBe(10);
    expect(m.root.total).toBe(10);
    expect(m.placed.has('old-thing')).toBe(false);
  });
  it('hash #infra/dagsrv has dagsrv, dags-repo and kite-dagsrv', () => {
    const n = nodeAt(m, ['infra', 'dagsrv'])!;
    expect(n.repos.map((r) => r.name).sort()).toEqual(['dags-repo', 'dagsrv', 'kite-dagsrv']);
    expect(nodeAt(m, ['nope'])).toBeNull();
  });
  it('totals are recursive; latest push and issues roll up', () => {
    const infra = nodeAt(m, ['infra'])!;
    expect(infra.total).toBe(6);
    expect(infra.subgroups).toBe(3);
    expect(m.root.subgroups).toBe(6);
    expect(nodeAt(m, ['ai'])!.issues).toBe(3);
    expect(nodeAt(m, ['ai'])!.latest).toBe(at(31));
    expect(allRepos(infra)).toHaveLength(6);
  });
  it('sorts repos by last push, newest first', () => {
    expect(nodeAt(m, ['infra', 'dagsrv'])!.repos.map((r) => r.name)).toEqual(['kite-dagsrv', 'dagsrv', 'dags-repo']);
  });
});

describe('rows, search, defaults', () => {
  const m = buildTree(example().groups, repos);
  it('lists subgroups first, expands inline with depth, then own repos', () => {
    const rows = treeRows(m.root, new Set(['infra']));
    expect(rows.map((r) => (r.kind === 'group' ? `g:${r.node.key}@${r.depth}${r.open ? '+' : ''}` : `r:${r.repo.name}@${r.depth}`))).toEqual([
      'g:infra@0+', 'g:infra/dagsrv@1', 'g:infra/authn@1', 'g:infra/cmonitor@1', 'g:ai@0', 'r:keep_alive_job@0',
    ]);
  });
  it('searches name and description recursively, flat, with a path prefix', () => {
    const rows = searchRows(m, m.root, 'authn');
    expect(rows.map((r) => r.kind === 'repo' && r.repo.name)).toEqual(['kite-authn', 'kite-cmonitor', 'authn']);
    expect((rows[0] as any).prefix).toBe('infra / authn / ');
    const inInfra = searchRows(m, nodeAt(m, ['infra'])!, 'dagsrv');
    expect((inInfra[0] as any).prefix).toBe('dagsrv / ');
    expect(searchRows(m, m.root, '  ')).toEqual([]);
    expect(searchRows(m, m.root, 'zzz')).toEqual([]);
  });
  it('first-level groups start collapsed except the first; all collapsed above 200 repos', () => {
    expect([...defaultExpanded(m)]).toEqual(['infra']);
    const big = buildTree(example().groups, Array.from({ length: 201 }, (_, i) => ({ name: `r${i}` })));
    expect(defaultExpanded(big).size).toBe(0);
    expect(defaultExpanded(buildTree([], [])).size).toBe(0);
  });
  it('builds sidebar items with counts', () => {
    const s = sideItems(m);
    expect(s[0]).toMatchObject({ key: '', name: 'All groups', total: 10, depth: 0 });
    expect(s.map((i) => `${i.key}:${i.total}@${i.depth}`)).toEqual(['', 'infra', 'infra/dagsrv', 'infra/authn', 'infra/cmonitor', 'ai', 'ai/llm-proxy'].map((k, i) => `${k}:${[10, 6, 3, 2, 1, 3, 2][i]}@${[0, 1, 2, 2, 2, 1, 2][i]}`));
  });
  it('picks avatar tones by char-code sum mod 5', () => {
    expect(avatarTone('a')).toBe((97 % 5) + 1);
    expect(avatarTone('ab')).toBe(((97 + 98) % 5) + 1);
  });
  it('memoizes placement per (sha, version)', () => {
    const g = example().groups;
    const a = memoTree('s1', 1, g, repos);
    expect(memoTree('s1', 1, g, repos)).toBe(a);
    expect(memoTree('s1', 2, g, repos)).not.toBe(a);
    expect(memoTree('s2', 2, g, repos)).not.toBe(a);
  });
  it('computes the virtual window', () => {
    expect(windowRange(0, 600, 76, 1000, 0)).toEqual({ start: 0, end: 8 });
    expect(windowRange(7600, 600, 76, 1000, 2)).toEqual({ start: 98, end: 110 });
    expect(windowRange(1e9, 600, 76, 50)).toEqual({ start: 50, end: 50 });
    void REPOS;
  });
});

describe('"All repositories" flat list and sort orders', () => {
  const m = buildTree(example().groups, [
    { name: 'beta', pushedAt: at(10), stars: 5, openIssuesAndPrs: 1 },
    { name: 'Alpha', pushedAt: at(30), stars: 9, openIssuesAndPrs: 7 },
    { name: 'dagsrv', pushedAt: at(20), stars: 5, openIssuesAndPrs: 7, description: 'Jobs and crons' },
    { name: 'dags-repo', pushedAt: at(5), stars: 0, openIssuesAndPrs: 0 },
    { name: 'authn', pushedAt: at(60), stars: 1, openIssuesAndPrs: 3 },
    { name: 'archived-one', archived: true, pushedAt: at(1) },
  ]);
  const names = (key: string, sort: any, q = '') => flatRows(nodeAt(m, key ? key.split('/') : [])!, sort, q).map((r) => (r.kind === 'repo' ? r.repo.name : '?'));
  it('lists every repository of the group, subgroups included, in the orders GitHub offers', async () => {
    const { SORT_KEYS, SORT_LABEL } = await import('../src/core/tree');
    expect(SORT_KEYS).toEqual(['pushed', 'name', 'stars', 'issues']);
    expect(SORT_KEYS.map((k) => SORT_LABEL[k])).toEqual(['Last pushed', 'Name', 'Stars', 'Open issues & PRs']);
  });
  it('last pushed (default) is newest first; archived repositories stay hidden', () => {
    expect(names('', 'pushed')).toEqual(['dags-repo', 'beta', 'dagsrv', 'Alpha', 'authn']);
  });
  it('name is alphabetical ignoring case; stars and issues are descending with newest push as tie-break', () => {
    expect(names('', 'name')).toEqual(['Alpha', 'authn', 'beta', 'dags-repo', 'dagsrv']);
    expect(names('', 'stars')).toEqual(['Alpha', 'beta', 'dagsrv', 'authn', 'dags-repo']); // beta and dagsrv tie on 5: beta is newer
    expect(names('', 'issues')).toEqual(['dagsrv', 'Alpha', 'authn', 'beta', 'dags-repo']); // dagsrv and Alpha tie on 7: dagsrv is newer
  });
  it('is recursive and flat: a group page lists its subgroups\' repositories as one list', () => {
    expect(names('infra', 'name')).toEqual(['authn', 'dags-repo', 'dagsrv']);
    expect(names('infra/dagsrv', 'name')).toEqual(['dags-repo', 'dagsrv']);
  });
  it('a query filters by name and description and keeps the chosen order', () => {
    expect(names('', 'name', 'DAG')).toEqual(['dags-repo', 'dagsrv']);
    expect(names('', 'pushed', 'crons')).toEqual(['dagsrv']);
    expect(names('', 'pushed', 'zzz')).toEqual([]);
  });
  it('sortRepos does not mutate its input', async () => {
    const { sortRepos } = await import('../src/core/tree');
    const input = [{ name: 'b' }, { name: 'a' }];
    sortRepos(input, 'name');
    expect(input.map((r) => r.name)).toEqual(['b', 'a']);
  });
});
