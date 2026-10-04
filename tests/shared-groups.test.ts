import { describe, expect, it } from 'vitest';
import { load } from './fixtures';
import { readConfig } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';
import { placement, sharedPlacement } from '../src/core/placement';
import { diffTrees } from '../src/core/diff';
import { applyEdit } from '../src/core/edit';
import { allRepos, buildTree, flatRows, searchRows, treeRows } from '../src/core/tree';
import { syncPlan } from '../src/core/teams';
import { aiPrompt } from '../src/core/ai-prompt';
import type { Config, RepoInfo } from '../src/core/types';

const TEXT = `version: 1
groups:
  - name: platform
    match: ["lib-core", "plat-*"]
  - name: payments
    match: ["pay-*"]
    shared: ["lib-core", "ui-*"]
    teams: ["pay_team"]
    groups:
      - name: web
        match: ["pay-web"]
        shared: ["pay-api"]
  - name: docs
    shared: lib-core
`;
const read = (t: string) => readConfig(t, load, { org: 'o' });
const cfg = (): Config => read(TEXT).config!;
const repos: RepoInfo[] = ['lib-core', 'plat-x', 'pay-api', 'pay-web', 'ui-kit', 'solo'].map((name, i) => ({
  name,
  pushedAt: new Date(Date.UTC(2026, 0, 10 - i)).toISOString(),
  openIssuesAndPrs: 1,
}));

describe('A3 shared rules: reading', () => {
  it('parses shared as list or single string and keeps the key out when absent', () => {
    const c = cfg();
    expect(c.groups[1].shared).toEqual(['lib-core', 'ui-*']);
    expect(c.groups[2].shared).toEqual(['lib-core']);
    expect('shared' in c.groups[0]).toBe(false);
  });
  it('rejects a bad shared value', () => {
    expect(read('groups:\n  - name: a\n    shared: [1]\n').error).toBe('"a": shared must be a list of names or patterns.');
  });
  it('older files parse identically (no shared key anywhere)', () => {
    const c = read('groups:\n  - name: a\n    match: ["x"]\n').config!;
    expect(c.groups).toEqual([{ name: 'a', description: '', logo: null, teams: [], match: ['x'], groups: [] }]);
  });
});

describe('A3 shared rules: writing', () => {
  it('writes shared right after match and round-trips', () => {
    const out = writeConfig(cfg(), 'o/.github/repo-groups.yml');
    expect(out).toContain('    match: ["pay-*"]\n    shared: ["lib-core", "ui-*"]\n    groups:');
    const back = read(out).config!;
    expect(back).toEqual(cfg());
    expect(writeConfig(back, 'o/.github/repo-groups.yml')).toBe(out);
  });
  it('a file without shared is written unchanged', () => {
    const out = writeConfig(read('groups:\n  - name: a\n    match: ["x"]\n').config!, 'h');
    expect(out).not.toContain('shared');
  });
});

describe('A3 shared placement', () => {
  const groups = cfg().groups;
  const sp = sharedPlacement(groups, repos);
  it('keeps the primary placement exactly as placement()', () => {
    expect(sp.primary).toEqual(placement(groups, repos));
    expect(sp.primary['lib-core']).toBe('platform');
    expect(sp.primary['ui-kit']).toBe('');
  });
  it('lists extra memberships in file order, excluding the primary and its ancestors', () => {
    expect(sp.secondary.get('lib-core')).toEqual(['payments', 'docs']);
    expect(sp.secondary.get('ui-kit')).toEqual(['payments']);
    expect(sp.secondary.get('pay-api')).toEqual(['payments/web']);
    expect(sp.secondary.has('pay-web')).toBe(false);
    expect(sp.secondary.has('solo')).toBe(false);
  });
  it('skips a shared group that already contains the primary group', () => {
    const g = read('groups:\n  - name: a\n    shared: ["x"]\n    groups:\n      - name: b\n        match: ["x"]\n').config!.groups;
    expect(sharedPlacement(g, [{ name: 'x' }]).secondary.size).toBe(0);
  });
  it('is empty when no group uses shared', () => {
    const g = read('groups:\n  - name: a\n    match: ["x"]\n').config!.groups;
    expect(sharedPlacement(g, [{ name: 'x' }]).secondary.size).toBe(0);
  });
});

describe('A3 tree, counts, rows and search', () => {
  const m = buildTree(cfg().groups, repos);
  it('does not double count in the root or parents', () => {
    expect(m.root.total).toBe(6);
    expect(m.byKey.get('platform')!.total).toBe(2);
    expect(m.byKey.get('payments')!.total).toBe(4); // pay-api, pay-web, plus lib-core and ui-kit shared
    expect(m.byKey.get('payments/web')!.total).toBe(2); // pay-web + pay-api shared
    expect(m.byKey.get('docs')!.total).toBe(1);
    expect(m.root.repos.map((r) => r.name).sort()).toEqual(['solo', 'ui-kit']); // ungrouped stays primary-only
    expect(m.root.issues).toBe(6);
  });
  it('allRepos has each repo once', () => {
    const names = allRepos(m.root).map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(6);
  });
  it('shows shared repos in each group with an also marker', () => {
    const rows = treeRows(m.byKey.get('payments')!, new Set());
    const shared = rows.filter((r) => r.kind === 'repo' && r.also !== undefined).map((r: any) => [r.repo.name, r.also]);
    expect(shared).toEqual([['lib-core', 'platform'], ['ui-kit', '']]);
    expect(rows.filter((r) => r.kind === 'repo' && r.also === undefined).map((r: any) => r.repo.name)).toEqual(['pay-api']);
  });
  it('flat list and search list a shared repo once, with its location', () => {
    const node = m.byKey.get('docs')!;
    expect(flatRows(node, 'name').map((r: any) => r.repo.name)).toEqual(['lib-core']);
    const hit: any = searchRows(m, node, 'lib')[0];
    expect(hit.repo.name).toBe('lib-core');
    expect(hit.also).toBe('platform');
    const root = searchRows(m, m.root, 'lib-core');
    expect(root).toHaveLength(1);
    expect((root[0] as any).also).toBeUndefined();
    expect((root[0] as any).prefix).toBe('platform / ');
  });
});

describe('A3 diff', () => {
  it('reports changed shared rules and the repos they affect', () => {
    const a = cfg().groups;
    const b = structuredClone(a);
    b[1].shared = ['ui-*'];
    const d = diffTrees(a, b, repos);
    expect(d.items.map((i) => `${i.k} ${i.text} -> ${i.to}`)).toEqual([
      '~ Shared rules of payments -> ui-*',
      '~ lib-core also in -> docs',
    ]);
    expect(d.ungrouped).toBe(2);
  });
  it('is silent when neither side uses shared', () => {
    const a = read('groups:\n  - name: a\n    match: ["x"]\n').config!.groups;
    expect(diffTrees(a, a, [{ name: 'x' }]).items).toEqual([]);
  });
});

describe('A3 edit', () => {
  it('sets, keeps and clears shared rules on edit', () => {
    const g = cfg().groups;
    const base = { kind: 'edit' as const, path: ['docs'], name: 'docs', description: '', match: [] as string[] };
    const kept = applyEdit(g, base) as { groups: typeof g };
    expect(kept.groups[2].shared).toEqual(['lib-core']);
    const set = applyEdit(g, { ...base, shared: [' ui-* ', 'a'] }) as { groups: typeof g };
    expect(set.groups[2].shared).toEqual(['ui-*', 'a']);
    const cleared = applyEdit(g, { ...base, shared: [] }) as { groups: typeof g };
    expect('shared' in cleared.groups[2]).toBe(false);
  });
  it('creates a group with shared rules', () => {
    const r = applyEdit([], { kind: 'new', parent: [], name: 'n', description: '', match: [], shared: ['x'] }) as any;
    expect(r.groups[0].shared).toEqual(['x']);
  });
});

describe('A3 teams and prompt', () => {
  it('sync plan uses the primary placement only', () => {
    const plan = syncPlan(cfg().groups, repos, {}, 'pay_team');
    // lib-core is also listed in payments, but its primary group is platform (no team): not a target.
    expect(plan.map((r) => r.repo).sort()).toEqual(['pay-api', 'pay-web']);
  });
  it('the AI prompt documents shared', () => {
    expect(aiPrompt('o')).toContain('shared');
  });
});
