import { describe, expect, it } from 'vitest';
import { applyEdit, cleanTeams } from '../src/core/edit';
import { classifyGrantError } from '../src/core/grant';
import { runPool } from '../src/core/pool';
import { buildTeamTree, pruneEmptyGroups, teamRepos } from '../src/core/team-view';
import { chipTeams, edgesToAccess, inGroup, withGranted, type TeamAccess } from '../src/core/teams';
import { buildTree } from '../src/core/tree';
import { readConfig } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';
import { example, load, REPOS } from './fixtures';

describe('chips and access helpers', () => {
  const g = example().groups;
  it('chipTeams lists own teams first, then inherited ones', () => {
    expect(chipTeams(g, ['ai', 'litellm']).map((t) => [t.slug, t.inherited])).toEqual([['konnen_team', false], ['ai-squad', true]]);
    expect(chipTeams(g, ['infra', 'dagu']).map((t) => [t.slug, t.inherited, t.from])).toEqual([['konnen_team', true, 'infra']]);
    expect(chipTeams(g, [])).toEqual([]);
  });
  it('edgesToAccess maps GraphQL permissions and skips nodes without a name', () => {
    expect(edgesToAccess([{ permission: 'ADMIN', node: { name: 'a' } }, { permission: 'READ', node: null }, { permission: 'TRIAGE', node: { name: 'b' } }])).toEqual({ a: 'admin', b: 'triage' });
  });
  it('withGranted only raises', () => {
    const a = { t: { r: 'push' } };
    expect(withGranted(a, 't', 'r', 'pull')).toBe(a);
    expect(withGranted(a, 't', 'r', 'admin').t.r).toBe('admin');
    expect(withGranted(a, 't', 's', 'pull').t).toEqual({ r: 'push', s: 'pull' });
  });
  it('inGroup is recursive but not by name prefix', () => {
    expect(inGroup('infra/dagu', 'infra')).toBe(true);
    expect(inGroup('infra', 'infra')).toBe(true);
    expect(inGroup('infrastructure', 'infra')).toBe(false);
    expect(inGroup('', 'infra')).toBe(false);
  });
});

describe('team repositories view', () => {
  const g = example().groups;
  const access: TeamAccess = { konnen_team: { dagu: 'push', 'konnen-dagu': 'push', authentik: 'pull', keep_supabase_alive: 'push' } };
  it('keeps only the repos the team can access and hides groups without any', () => {
    expect(teamRepos(REPOS, access, 'konnen_team').map((r) => r.name).sort()).toEqual(['authentik', 'dagu', 'keep_supabase_alive', 'konnen-dagu']);
    const m = buildTeamTree(g, REPOS, access, 'konnen_team');
    expect([...m.byKey.keys()].sort()).toEqual(['', 'infra', 'infra/authentik', 'infra/dagu']);
    expect(m.root.children.map((c) => c.key)).toEqual(['infra']);
    expect(m.root.repos.map((r) => r.name)).toEqual(['keep_supabase_alive']); // reachable, but outside every group
    expect(m.root.subgroups).toBe(3);
    expect(m.root.total).toBe(4);
  });
  it('skips archived repos; pruning an all-empty tree leaves only the root', () => {
    expect(teamRepos([{ name: 'a', archived: true }], { t: { a: 'push' } }, 't')).toEqual([]);
    expect([...pruneEmptyGroups(buildTree(g, [])).byKey.keys()]).toEqual(['']);
  });
});

describe('edit with teams', () => {
  it('replaces the own teams of a group, keeps them when absent, and writes both forms', () => {
    const g = example().groups;
    const base = { kind: 'edit' as const, path: ['infra'], name: 'infra', description: 'x', match: [] };
    const kept = applyEdit(g, base) as { groups: typeof g };
    expect(kept.groups[0].teams).toEqual([{ slug: 'konnen_team', permission: 'push' }]);
    const next = applyEdit(g, { ...base, teams: [{ slug: ' a ', permission: 'push' }, { slug: 'b', permission: 'admin' }, { slug: 'a', permission: 'triage' }, { slug: '', permission: 'pull' }] }) as { groups: typeof g };
    expect(next.groups[0].teams).toEqual([{ slug: 'a', permission: 'triage' }, { slug: 'b', permission: 'admin' }]);
    const yaml = writeConfig({ version: 1, index: 'api', groups: next.groups }, 'o/.github/repo-groups.yml');
    expect(yaml).toContain('teams: [{ slug: "a", permission: "triage" }, { slug: "b", permission: "admin" }]');
    expect((applyEdit(g, { ...base, teams: [] }) as { groups: typeof g }).groups[0].teams).toEqual([]);
    expect(cleanTeams([{ slug: 'x', permission: '' }])).toEqual([{ slug: 'x', permission: 'push' }]);
  });
  it('a new group can be created with teams', () => {
    const r = applyEdit([], { kind: 'new', parent: [], name: 'a', description: '', match: [], teams: [{ slug: 't', permission: 'push' }] }) as any;
    expect(r.groups[0].teams).toEqual([{ slug: 't', permission: 'push' }]);
  });
});

describe('runPool and grant errors', () => {
  it('never runs more than the limit at once and keeps result order', async () => {
    let now = 0;
    let max = 0;
    const out = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      max = Math.max(max, ++now);
      await new Promise((r) => setTimeout(r, 2));
      now--;
      return n * 2;
    });
    expect(max).toBe(3);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(await runPool([], 3, async () => 1)).toEqual([]);
  });
  it('classifies errors', () => {
    const c = (status: number, message: string, kind = 'x') => classifyGrantError({ status, kind, message }, 'o');
    expect(c(403, 'Must have admin rights').kind).toBe('admin');
    expect(c(404, 'Not Found').kind).toBe('admin');
    expect(c(422, 'bad').kind).toBe('validation');
    expect(c(403, 'Resource not accessible by integration').kind).toBe('permissions');
    expect(c(403, 'API rate limit', 'rate-limit').kind).toBe('rate-limit');
    expect(c(500, 'boom').kind).toBe('other');
  });
});

describe('unknown team slug', () => {
  it('is only a warning, with the spec wording', () => {
    const r = readConfig('groups:\n  - name: a\n    teams: ["ok", "ghost"]\n', load, { org: 'o', knownTeams: ['ok'] });
    expect(r.config).toBeTruthy();
    expect(r.warnings).toEqual(['"a": team "ghost" was not found in o.']);
  });
});
