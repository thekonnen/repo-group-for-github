import { describe, expect, it } from 'vitest';
import { example, load, REPOS } from './fixtures';
import { effectiveTeams, syncPlan, teamSlugs, untaggedAccess, type TeamAccess } from '../src/core/teams';
import { fromGraphql, rankOf } from '../src/core/permissions';
import { readConfig } from '../src/core/yaml-read';

describe('effective teams', () => {
  const g = example().groups;
  it('inherits and lets the closest definition win', () => {
    expect(effectiveTeams(g, ['infra', 'dagu'])).toEqual({ konnen_team: { permission: 'push', from: 'infra' } });
    expect(effectiveTeams(g, ['ai', 'litellm'])).toEqual({
      'ai-squad': { permission: 'maintain', from: 'ai' },
      konnen_team: { permission: 'pull', from: 'ai/litellm' },
    });
    expect(teamSlugs(g)).toEqual(['ai-squad', 'konnen_team']);
  });
  it('maps GraphQL permissions', () => {
    expect(['READ', 'TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'].map(fromGraphql)).toEqual(['pull', 'triage', 'push', 'maintain', 'admin']);
  });
});

describe('sync plan (F12 done-when)', () => {
  const g = example().groups;
  const access: TeamAccess = {
    konnen_team: { dagu: 'push', 'konnen-dagu': 'push', authentik: 'pull', keep_supabase_alive: 'push' },
  };
  it('lists exactly the four rows for konnen_team and leaves keep_supabase_alive alone', () => {
    const rows = syncPlan(g, REPOS, access, 'konnen_team').filter((r) => r.from === 'infra');
    expect(rows.map((r) => [r.repo, r.current, r.target]).sort()).toEqual([
      ['authentik', 'pull', 'push'],
      ['dags-repo', 'none', 'push'],
      ['konnen-authentik', 'none', 'push'],
      ['konnen-checkmate', 'none', 'push'],
    ]);
    expect(rows.find((r) => r.repo === 'keep_supabase_alive')).toBeUndefined();
  });
  it('never downgrades or removes, skips archived and ungrouped', () => {
    const rows = syncPlan(g, [{ name: 'litellm' }, { name: 'dagu', archived: true }, { name: 'keep_supabase_alive' }], { konnen_team: { litellm: 'admin' } }, 'konnen_team');
    expect(rows).toEqual([]);
  });
  it('raises access, and proposes custom roles only when ranks are known or access is none', () => {
    const c = readConfig('groups:\n  - name: a\n    teams: [{ slug: t, permission: reviewer }]\n    match: ["r*"]\n', load).config!.groups;
    expect(syncPlan(c, [{ name: 'r1' }], { t: { r1: 'pull' } }, 't')).toEqual([]);
    expect(syncPlan(c, [{ name: 'r1' }], {}, 't')).toHaveLength(1);
    expect(syncPlan(c, [{ name: 'r1' }], { t: { r1: 'pull' } }, 't', { reviewer: 'triage' })).toHaveLength(1);
    expect(rankOf('reviewer', { reviewer: 'maintain' })).toBe(4);
  });
  it('finds access in groups not tagged for the team', () => {
    expect(untaggedAccess(g, REPOS, access, 'konnen_team')).toEqual(['keep_supabase_alive']);
  });
});
