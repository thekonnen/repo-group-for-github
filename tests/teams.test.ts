import { describe, expect, it } from 'vitest';
import { example, load, REPOS } from './fixtures';
import { effectiveTeams, syncPlan, teamSlugs, untaggedAccess, type TeamAccess } from '../src/core/teams';
import { fromGraphql, rankOf } from '../src/core/permissions';
import { readConfig } from '../src/core/yaml-read';

describe('effective teams', () => {
  const g = example().groups;
  it('inherits and lets the closest definition win', () => {
    expect(effectiveTeams(g, ['infra', 'dagsrv'])).toEqual({ core_team: { permission: 'push', from: 'infra' } });
    expect(effectiveTeams(g, ['ai', 'llm-proxy'])).toEqual({
      'ai-squad': { permission: 'maintain', from: 'ai' },
      core_team: { permission: 'pull', from: 'ai/llm-proxy' },
    });
    expect(teamSlugs(g)).toEqual(['ai-squad', 'core_team']);
  });
  it('maps GraphQL permissions', () => {
    expect(['READ', 'TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'].map(fromGraphql)).toEqual(['pull', 'triage', 'push', 'maintain', 'admin']);
  });
});

describe('sync plan (F12 done-when)', () => {
  const g = example().groups;
  const access: TeamAccess = {
    core_team: { dagsrv: 'push', 'kite-dagsrv': 'push', authn: 'pull', keep_alive_job: 'push' },
  };
  it('lists exactly the four rows for core_team and leaves keep_alive_job alone', () => {
    const rows = syncPlan(g, REPOS, access, 'core_team').filter((r) => r.from === 'infra');
    expect(rows.map((r) => [r.repo, r.current, r.target]).sort()).toEqual([
      ['authn', 'pull', 'push'],
      ['dags-repo', 'none', 'push'],
      ['kite-authn', 'none', 'push'],
      ['kite-cmonitor', 'none', 'push'],
    ]);
    expect(rows.find((r) => r.repo === 'keep_alive_job')).toBeUndefined();
  });
  it('never downgrades or removes, skips archived and ungrouped', () => {
    const rows = syncPlan(g, [{ name: 'llm-proxy' }, { name: 'dagsrv', archived: true }, { name: 'keep_alive_job' }], { core_team: { 'llm-proxy': 'admin' } }, 'core_team');
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
    expect(untaggedAccess(g, REPOS, access, 'core_team')).toEqual(['keep_alive_job']);
  });
});
