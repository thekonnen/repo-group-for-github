import { describe, expect, it } from 'vitest';
import { applyEdit, commitMessage, editPath, moveRepo, moveRepos, type Edit } from '../src/core/edit';
import { findGroup, placement } from '../src/core/placement';
import { example } from './fixtures';

const base = () => example().groups;
const where = (groups: ReturnType<typeof base>, name: string) => placement(groups, [{ name }])[name];
const ok = (r: ReturnType<typeof moveRepo>) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('moveRepo (A4)', () => {
  it('removes the exact name from the group it was listed in and adds it to the destination', () => {
    const r = ok(moveRepo(base(), 'kite-dagsrv', ['ai']));
    expect(r.changed).toBe(true);
    expect(r.removedFrom).toEqual(['infra/dagsrv']);
    expect(findGroup(r.groups, ['infra', 'dagsrv'])!.match).toEqual(['dagsrv', 'dags-*']);
    expect(findGroup(r.groups, ['ai'])!.match).toEqual(['oroute', 'kite-dagsrv']);
    expect(where(r.groups, 'kite-dagsrv')).toBe('ai');
  });

  it('a repo caught by a pattern only gets the exact name at the destination (exact names win)', () => {
    const r = ok(moveRepo(base(), 'kite-authn', ['ai', 'llm-proxy']));
    expect(r.removedFrom).toEqual([]);
    expect(findGroup(r.groups, ['infra', 'authn'])!.match).toEqual(['*authn*']); // patterns are never edited
    expect(findGroup(r.groups, ['ai', 'llm-proxy'])!.match).toEqual(['*llm-proxy*', 'kite-authn']);
    expect(where(r.groups, 'kite-authn')).toBe('ai/llm-proxy');
  });

  it('removes the name from every group that listed it, matching case-insensitively', () => {
    const groups = base();
    findGroup(groups, ['infra', 'cmonitor'])!.match.push('DagSrv');
    const r = ok(moveRepo(groups, 'dagsrv', ['infra', 'authn']));
    expect(r.removedFrom.sort()).toEqual(['infra/cmonitor', 'infra/dagsrv']);
    expect(findGroup(r.groups, ['infra', 'cmonitor'])!.match).toEqual(['*cmonitor*']);
    expect(findGroup(r.groups, ['infra', 'dagsrv'])!.match).toEqual(['dags-*', 'kite-dagsrv']);
    expect(where(r.groups, 'dagsrv')).toBe('infra/authn');
  });

  it('is a no-op when the exact name is already only at the destination', () => {
    const groups = base();
    const r = ok(moveRepo(groups, 'dagsrv', ['infra', 'dagsrv']));
    expect(r.changed).toBe(false);
    expect(r.groups).toEqual(groups);
  });

  it('still cleans the other groups when the destination already lists the name', () => {
    const groups = base();
    findGroup(groups, ['ai'])!.match.push('dagsrv');
    const r = ok(moveRepo(groups, 'dagsrv', ['ai']));
    expect(r.changed).toBe(true);
    expect(findGroup(r.groups, ['ai'])!.match.filter((m) => m === 'dagsrv')).toHaveLength(1);
    expect(findGroup(r.groups, ['infra', 'dagsrv'])!.match).not.toContain('dagsrv');
  });

  it('to Ungrouped only removes exact names', () => {
    const r = ok(moveRepo(base(), 'kite-dagsrv', []));
    expect(r.changed).toBe(true);
    expect(r.stillCaught).toBeUndefined();
    expect(where(r.groups, 'kite-dagsrv')).toBe('');
    expect(findGroup(r.groups, ['ai'])!.match).toEqual(['oroute']);
  });

  it('to Ungrouped warns when a pattern still catches the repo', () => {
    const r = ok(moveRepo(base(), 'dags-repo', []));
    expect(r.changed).toBe(false); // nothing exact to remove
    expect(r.stillCaught).toEqual({ key: 'infra/dagsrv', rule: 'dags-*' });
    const exact = ok(moveRepo(base(), 'oroute', []));
    expect(exact.changed).toBe(true);
    expect(exact.stillCaught).toBeUndefined();
    const both = base();
    findGroup(both, ['ai'])!.match.push('dags-repo');
    const mixed = ok(moveRepo(both, 'dags-repo', []));
    expect(mixed.changed).toBe(true); // the exact name goes away, the pattern stays
    expect(mixed.stillCaught).toEqual({ key: 'infra/dagsrv', rule: 'dags-*' });
  });

  it('moving something that is already ungrouped to Ungrouped changes nothing', () => {
    const r = ok(moveRepo(base(), 'keep_alive_job', []));
    expect(r.changed).toBe(false);
    expect(r.stillCaught).toBeUndefined();
  });

  it('fails for a destination that no longer exists, and never mutates the input', () => {
    const groups = base();
    const before = JSON.stringify(groups);
    expect(moveRepo(groups, 'dagsrv', ['nope'])).toEqual({ error: 'The group "nope" no longer exists. Reload the page and try again.' });
    moveRepo(groups, 'kite-dagsrv', ['ai']);
    expect(JSON.stringify(groups)).toBe(before);
  });

  it('works as an Edit (re-applied to a fresh tree on conflict), with its commit message', () => {
    const edit: Edit = { kind: 'move', repos: ['kite-dagsrv'], to: ['ai'] };
    const r = applyEdit(base(), edit);
    expect('groups' in r && where(r.groups, 'kite-dagsrv')).toBe('ai');
    expect(commitMessage(edit)).toBe('chore(repo-groups): move kite-dagsrv to ai');
    expect(commitMessage({ kind: 'move', repos: ['x'], to: ['infra', 'authn'] })).toBe('chore(repo-groups): move x to infra/authn');
    expect(commitMessage({ kind: 'move', repos: ['x'], to: [] })).toBe('chore(repo-groups): move x to ungrouped');
    expect(commitMessage({ kind: 'move', repos: ['a', 'b', 'c'], to: ['ai'] })).toBe('chore(repo-groups): move 3 repositories to ai');
    expect(editPath(edit)).toBe('ai');
  });
});

describe('moveRepos (A4, several repositories in one edit)', () => {
  const plan = (r: ReturnType<typeof moveRepos>) => {
    if ('error' in r) throw new Error(r.error);
    return r;
  };

  it('folds every move into one tree and lists what changes', () => {
    const r = plan(moveRepos(base(), ['kite-dagsrv', 'kite-authn', 'oroute'], ['infra', 'cmonitor']));
    expect(r.moved).toEqual(['kite-dagsrv', 'kite-authn', 'oroute']);
    expect(r.already).toEqual([]);
    expect(r.changed).toBe(true);
    for (const n of r.moved) expect(where(r.groups, n)).toBe('infra/cmonitor');
    expect(findGroup(r.groups, ['infra', 'dagsrv'])!.match).toEqual(['dagsrv', 'dags-*']);
    expect(findGroup(r.groups, ['ai'])!.match).toEqual([]);
  });

  it('skips repositories already at the destination and says so', () => {
    const r = plan(moveRepos(base(), ['dagsrv', 'dags-repo', 'oroute'], ['infra', 'dagsrv']));
    expect(r.already).toEqual(['dagsrv', 'dags-repo']); // dags-repo is placed there by its pattern
    expect(r.moved).toEqual(['oroute']);
    const none = plan(moveRepos(base(), ['dagsrv', 'dags-repo'], ['infra', 'dagsrv']));
    expect(none.changed).toBe(false);
    expect(none.groups).toEqual(base());
  });

  it('collects the repos a pattern still catches when sending to Ungrouped', () => {
    const r = plan(moveRepos(base(), ['kite-dagsrv', 'dags-repo', 'keep_alive_job'], []));
    expect(r.moved).toEqual(['kite-dagsrv']);
    expect(r.already).toEqual(['keep_alive_job']);
    expect(r.stillCaught).toEqual([{ repo: 'dags-repo', key: 'infra/dagsrv', rule: 'dags-*' }]);
  });

  it('ignores duplicate names, reports a missing destination, and never mutates the input', () => {
    const groups = base();
    const before = JSON.stringify(groups);
    const r = plan(moveRepos(groups, ['oroute', 'oroute'], ['infra']));
    expect(r.moved).toEqual(['oroute']);
    expect(moveRepos(groups, ['oroute'], ['nope'])).toEqual({ error: 'The group "nope" no longer exists. Reload the page and try again.' });
    expect(JSON.stringify(groups)).toBe(before);
  });
});
