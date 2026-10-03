import { describe, expect, it } from 'vitest';
import { example, REPOS } from './fixtures';
import { allRepos, avatarTone, buildTree, defaultExpanded, memoTree, nodeAt, searchRows, sideItems, treeRows, windowRange } from '../src/core/tree';
import type { RepoInfo } from '../src/core/types';

const at = (min: number) => new Date(Date.parse('2026-01-10T12:00:00Z') - min * 60000).toISOString();
const repos: RepoInfo[] = [
  { name: 'konnen-litellm', description: 'AI Gateway', pushedAt: at(31), openIssuesAndPrs: 2 },
  { name: 'litellm', pushedAt: at(46), openIssuesAndPrs: 1 },
  { name: 'konnen-authentik', pushedAt: at(120) },
  { name: 'konnen-checkmate', description: 'Deploy checkmate using authentik as sso login', pushedAt: at(180) },
  { name: 'authentik', pushedAt: at(300) },
  { name: 'konnen-dagu', pushedAt: at(302) },
  { name: 'dagu', pushedAt: at(360) },
  { name: 'keep_supabase_alive', pushedAt: at(780) },
  { name: 'omniroute', pushedAt: at(900) },
  { name: 'dags-repo', pushedAt: at(2900) },
  { name: 'old-thing', archived: true, pushedAt: at(5000) },
];

describe('tree model (F1 done-when)', () => {
  const m = buildTree(example().groups, repos);
  it('shows infra and ai on the root with keep_supabase_alive ungrouped; hides archived', () => {
    expect(m.root.children.map((c) => c.key)).toEqual(['infra', 'ai']);
    expect(m.root.repos.map((r) => r.name)).toEqual(['keep_supabase_alive']);
    expect(m.visible).toBe(10);
    expect(m.root.total).toBe(10);
    expect(m.placed.has('old-thing')).toBe(false);
  });
  it('hash #infra/dagu has dagu, dags-repo and konnen-dagu', () => {
    const n = nodeAt(m, ['infra', 'dagu'])!;
    expect(n.repos.map((r) => r.name).sort()).toEqual(['dags-repo', 'dagu', 'konnen-dagu']);
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
    expect(nodeAt(m, ['infra', 'dagu'])!.repos.map((r) => r.name)).toEqual(['konnen-dagu', 'dagu', 'dags-repo']);
  });
});

describe('rows, search, defaults', () => {
  const m = buildTree(example().groups, repos);
  it('lists subgroups first, expands inline with depth, then own repos', () => {
    const rows = treeRows(m.root, new Set(['infra']));
    expect(rows.map((r) => (r.kind === 'group' ? `g:${r.node.key}@${r.depth}${r.open ? '+' : ''}` : `r:${r.repo.name}@${r.depth}`))).toEqual([
      'g:infra@0+', 'g:infra/dagu@1', 'g:infra/authentik@1', 'g:infra/checkmate@1', 'g:ai@0', 'r:keep_supabase_alive@0',
    ]);
  });
  it('searches name and description recursively, flat, with a path prefix', () => {
    const rows = searchRows(m, m.root, 'authentik');
    expect(rows.map((r) => r.kind === 'repo' && r.repo.name)).toEqual(['konnen-authentik', 'konnen-checkmate', 'authentik']);
    expect((rows[0] as any).prefix).toBe('infra / authentik / ');
    const inInfra = searchRows(m, nodeAt(m, ['infra'])!, 'dagu');
    expect((inInfra[0] as any).prefix).toBe('dagu / ');
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
    expect(s.map((i) => `${i.key}:${i.total}@${i.depth}`)).toEqual(['', 'infra', 'infra/dagu', 'infra/authentik', 'infra/checkmate', 'ai', 'ai/litellm'].map((k, i) => `${k}:${[10, 6, 3, 2, 1, 3, 2][i]}@${[0, 1, 2, 2, 2, 1, 2][i]}`));
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
