import { describe, expect, it } from 'vitest';
import { load } from './fixtures';
import { readConfig } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';
import { applyEdit, commitMessage, editPath, moveRepo, moveRepos, shareRepos, unshareRepos } from '../src/core/edit';
import { findGroup, sharedPlacement } from '../src/core/placement';
import { buildTree } from '../src/core/tree';
import { teamTargetChanges } from '../src/core/teams';
import type { RepoInfo } from '../src/core/types';

const TEXT = `version: 1
groups:
  - name: platform
    match: ["lib-core", "plat-*"]
    teams: ["plat_team"]
  - name: payments
    match: ["pay-*"]
    shared: ["lib-core", "topic:backend", "prop:client=Acme", "fork-of:macfuse"]
    teams: [{ slug: "pay_team", permission: "maintain" }, "plat_team"]
    groups:
      - name: web
        match: ["pay-web"]
        shared: ["pay-api"]
  - name: docs
    shared: ["lib-core", "solo"]
`;
const groups = () => readConfig(TEXT, load, { org: 'o' }).config!.groups;
const ok = <T>(r: T | { error: string }): T => {
  if (r && typeof r === 'object' && 'error' in r) throw new Error((r as any).error);
  return r as T;
};

const repos: RepoInfo[] = [
  { name: 'lib-core' },
  { name: 'plat-x' },
  { name: 'pay-api' },
  { name: 'pay-web' },
  { name: 'api-svc', topics: ['backend'] },
  { name: 'acme-site', props: { client: 'Acme' } },
  { name: 'fuse', fork: true, parent: 'macfuse/macfuse' },
  { name: 'other-fork', fork: true, parent: 'someone/else' },
  { name: 'solo' },
];

describe('A3 shared rules with topic:, prop: and fork-of:', () => {
  const sp = sharedPlacement(groups(), repos);
  it('uses the whole repository, not only its name', () => {
    expect(sp.secondary.get('api-svc')).toEqual(['payments']);
    expect(sp.secondary.get('acme-site')).toEqual(['payments']);
    expect(sp.secondary.get('fuse')).toEqual(['payments']);
    expect(sp.secondary.has('other-fork')).toBe(false);
    expect(sp.primary['api-svc']).toBe(''); // the primary placement is unchanged
  });
  it('the tree lists them in the group, once, and counts them once', () => {
    const m = buildTree(groups(), repos);
    expect(m.byKey.get('payments')!.shared.map((r) => r.name).sort()).toEqual(['acme-site', 'api-svc', 'fuse', 'lib-core']);
    expect(m.root.total).toBe(9);
    expect(m.root.repos.map((r) => r.name)).toContain('api-svc');
  });
  it('validates the three rule kinds in shared as in match', () => {
    const bad = (rule: string) => readConfig(`groups:\n  - name: a\n    shared: ["${rule}"]\n`, load).error;
    expect(bad('fork-of:')).toBe('"a": rule "fork-of:" needs an owner, like fork-of:macfuse or fork-of:macfuse/macfuse.');
    expect(bad('prop:client')).toBe('"a": rule "prop:client" needs a property and a value, like prop:client=Acme.');
    expect(bad('topic:')).toBe('"a": the rule "topic:" needs a topic name, like topic:kubernetes.');
    expect(readConfig('groups:\n  - name: a\n    shared: ["topic:x", "prop:c=v", "fork-of:o"]\n', load).error).toBeUndefined();
  });
});

describe('A3 moveRepo / moveRepos with the whole repository', () => {
  it('"already there" and stillCaught honor topic: rules', () => {
    const g = readConfig('groups:\n  - name: back\n    match: ["topic:backend"]\n  - name: other\n', load).config!.groups;
    const api = repos.find((r) => r.name === 'api-svc')!;
    const p = ok(moveRepos(g, [api], ['back']));
    expect(p.already).toEqual(['api-svc']); // names alone would have said "ungrouped"
    expect(p.changed).toBe(false);
    const to = ok(moveRepo(g, api, []));
    expect(to.stillCaught).toEqual({ key: 'back', rule: 'topic:backend' });
  });
  it('"already there" and stillCaught honor prop: and fork-of: rules', () => {
    const g = readConfig('groups:\n  - name: acme\n    match: ["prop:client=Acme", "fork-of:macfuse"]\n', load).config!.groups;
    const site = repos.find((r) => r.name === 'acme-site')!;
    const fuse = repos.find((r) => r.name === 'fuse')!;
    expect(ok(moveRepos(g, [site, fuse], ['acme'])).already).toEqual(['acme-site', 'fuse']);
    expect(ok(moveRepo(g, site, [])).stillCaught).toEqual({ key: 'acme', rule: 'prop:client=Acme' });
    expect(ok(moveRepo(g, fuse, [])).stillCaught).toEqual({ key: 'acme', rule: 'fork-of:macfuse' });
  });
  it('a name-only move still works', () => {
    const p = ok(moveRepos(groups(), ['plat-x'], ['docs']));
    expect(p.moved).toEqual(['plat-x']);
    expect(findGroup(p.groups, ['docs'])!.match).toEqual(['plat-x']);
  });

  it('removes the exact shared names of the destination and its ancestors', () => {
    const g = groups();
    findGroup(g, ['payments'])!.shared!.push('plat-x');
    findGroup(g, ['payments', 'web'])!.shared!.push('plat-x');
    const r = ok(moveRepo(g, 'plat-x', ['payments', 'web']));
    expect(findGroup(r.groups, ['payments'])!.shared).not.toContain('plat-x');
    expect(findGroup(r.groups, ['payments', 'web'])!.shared).toEqual(['pay-api']);
    expect(findGroup(r.groups, ['payments', 'web'])!.match).toEqual(['pay-web', 'plat-x']);
    // The input is not touched, and patterns / rules of other kinds stay.
    expect(findGroup(g, ['payments'])!.shared).toContain('plat-x');
    expect(findGroup(r.groups, ['payments'])!.shared).toEqual(['lib-core', 'topic:backend', 'prop:client=Acme', 'fork-of:macfuse']);
  });

  it('a repo listed at the destination only through shared is moved, not "already there"', () => {
    const p = ok(moveRepos(groups(), ['lib-core'], ['payments']));
    expect(p.already).toEqual([]);
    expect(p.moved).toEqual(['lib-core']);
    expect(p.wasListed).toEqual(['lib-core']);
    expect(findGroup(p.groups, ['payments'])!.match).toEqual(['pay-*', 'lib-core']);
    expect(findGroup(p.groups, ['payments'])!.shared).not.toContain('lib-core');
    expect(sharedPlacement(p.groups, [{ name: 'lib-core' }]).primary['lib-core']).toBe('payments');
  });
  it('a repo whose home already is the destination stays "already there"', () => {
    const p = ok(moveRepos(groups(), ['pay-api'], ['payments']));
    expect(p.already).toEqual(['pay-api']);
    expect(p.wasListed).toEqual([]);
  });

  it('Ungrouped: reports the groups that still list the repo, and dropShared removes the exact names only', () => {
    const g = groups();
    const r = ok(moveRepo(g, 'solo', []));
    expect(r.stillShared).toEqual([{ key: 'docs', rule: 'solo', exact: true }]);
    expect(findGroup(r.groups, ['docs'])!.shared).toEqual(['lib-core', 'solo']);
    const d = ok(moveRepo(g, 'solo', [], { dropShared: true }));
    expect(d.stillShared).toEqual([]);
    expect(d.changed).toBe(true);
    expect(findGroup(d.groups, ['docs'])!.shared).toEqual(['lib-core']);

    const api = repos.find((x) => x.name === 'api-svc')!;
    const t = ok(moveRepo(g, api, [], { dropShared: true }));
    expect(t.stillShared).toEqual([{ key: 'payments', rule: 'topic:backend', exact: false }]); // rules only warn
    expect(findGroup(t.groups, ['payments'])!.shared).toContain('topic:backend');
  });
  it('moveRepos collects stillShared per repo and applyEdit honors dropShared', () => {
    const p = ok(moveRepos(groups(), ['solo', 'lib-core'], []));
    expect(p.stillShared.map((x) => `${x.repo}@${x.key}:${x.exact}`).sort()).toEqual(['lib-core@docs:true', 'lib-core@payments:true']);
    expect(p.already).toEqual(['solo']); // already Ungrouped: nothing to move
    const e = ok(applyEdit(groups(), { kind: 'move', repos: ['lib-core'], to: [], dropShared: true })) as { groups: ReturnType<typeof groups> };
    expect(findGroup(e.groups, ['docs'])!.shared).toEqual(['solo']);
    expect(findGroup(e.groups, ['payments'])!.shared).not.toContain('lib-core');
    const keep = ok(applyEdit(groups(), { kind: 'move', repos: ['lib-core'], to: [] })) as { groups: ReturnType<typeof groups> };
    expect(findGroup(keep.groups, ['docs'])!.shared).toEqual(['lib-core', 'solo']);
  });
});

describe('A3 shareRepos ("Also list in…")', () => {
  it('adds the exact name to the destination shared list and leaves the home alone', () => {
    const g = groups();
    const p = ok(shareRepos(g, ['plat-x'], ['docs']));
    expect(p.added).toEqual(['plat-x']);
    expect(p.changed).toBe(true);
    expect(findGroup(p.groups, ['docs'])!.shared).toEqual(['lib-core', 'solo', 'plat-x']);
    expect(findGroup(p.groups, ['docs'])!.match).toEqual([]);
    expect(sharedPlacement(p.groups, [{ name: 'plat-x' }]).primary['plat-x']).toBe('platform');
    expect(sharedPlacement(p.groups, [{ name: 'plat-x' }]).secondary.get('plat-x')).toEqual(['docs']);
    expect(findGroup(g, ['docs'])!.shared).toEqual(['lib-core', 'solo']); // input untouched
  });
  it('creates the shared list when the destination has none', () => {
    const p = ok(shareRepos(groups(), ['pay-api'], ['platform']));
    expect(findGroup(p.groups, ['platform'])!.shared).toEqual(['pay-api']);
  });
  it('skips repos already listed (exact name or a rule that catches them) and repos living there or below', () => {
    const api = repos.find((r) => r.name === 'api-svc')!;
    const p = ok(shareRepos(groups(), [api, 'lib-core', 'pay-api', 'pay-web', 'plat-x'], ['payments']));
    expect(p.already).toEqual(['api-svc', 'lib-core']); // topic:backend rule, exact name
    expect(p.redundant).toEqual(['pay-api', 'pay-web']); // home is payments, or inside it
    expect(p.added).toEqual(['plat-x']);
    const nothing = ok(shareRepos(groups(), ['lib-core', 'pay-web'], ['payments']));
    expect(nothing.changed).toBe(false);
    expect(nothing.added).toEqual([]);
  });
  it('never edits patterns and needs a real group', () => {
    const p = ok(shareRepos(groups(), ['plat-x'], ['payments']));
    expect(findGroup(p.groups, ['payments'])!.shared).toEqual(['lib-core', 'topic:backend', 'prop:client=Acme', 'fork-of:macfuse', 'plat-x']);
    expect(shareRepos(groups(), ['x'], [])).toEqual({ error: 'Pick a group: a repository cannot be listed in Ungrouped.' });
    expect('error' in shareRepos(groups(), ['x'], ['nope'])).toBe(true);
  });
  it('is an Edit: applyEdit, editPath and the commit message', () => {
    const e = { kind: 'share' as const, repos: ['plat-x'], to: ['docs'] };
    const r = ok(applyEdit(groups(), e)) as { groups: ReturnType<typeof groups> };
    expect(findGroup(r.groups, ['docs'])!.shared).toContain('plat-x');
    expect(editPath(e)).toBe('docs');
    expect(commitMessage(e)).toBe('chore(repo-groups): also list plat-x in docs');
    expect(commitMessage({ ...e, repos: ['a', 'b', 'c'], to: ['payments', 'web'] })).toBe('chore(repo-groups): also list 3 repositories in payments/web');
  });
});

describe('A3 teamTargetChanges', () => {
  it('lists the slugs whose target permission differs between two homes', () => {
    expect(teamTargetChanges(groups(), 'platform', 'payments')).toEqual([{ slug: 'pay_team', from: undefined, to: 'maintain' }]);
    expect(teamTargetChanges(groups(), 'payments', 'platform')).toEqual([{ slug: 'pay_team', from: 'maintain', to: undefined }]);
  });
  it('treats Ungrouped as no targets, inherited teams count, and equal permissions are skipped', () => {
    expect(teamTargetChanges(groups(), 'payments/web', '')).toEqual([
      { slug: 'pay_team', from: 'maintain', to: undefined },
      { slug: 'plat_team', from: 'push', to: undefined },
    ]);
    expect(teamTargetChanges(groups(), '', 'platform')).toEqual([{ slug: 'plat_team', from: undefined, to: 'push' }]);
    expect(teamTargetChanges(groups(), 'payments', 'payments/web')).toEqual([]);
    expect(teamTargetChanges(groups(), 'docs', 'docs')).toEqual([]);
  });
});

describe('A3 unshareRepos ("Remove link")', () => {
  it('removes the exact name from the shared list of the group, case-insensitively, and leaves the rest', () => {
    const g = groups();
    const p = ok(unshareRepos(g, ['LIB-Core'], ['payments']));
    expect(p.removed).toEqual(['LIB-Core']);
    expect(p.changed).toBe(true);
    expect(findGroup(p.groups, ['payments'])!.shared).toEqual(['topic:backend', 'prop:client=Acme', 'fork-of:macfuse']);
    expect(findGroup(p.groups, ['payments'])!.match).toEqual(['pay-*']);
    expect(findGroup(p.groups, ['platform'])!.match).toEqual(['lib-core', 'plat-*']); // the home is untouched
    expect(findGroup(g, ['payments'])!.shared).toContain('lib-core'); // input untouched
  });
  it('deletes the shared key when the list becomes empty (canonical output)', () => {
    const p = ok(unshareRepos(groups(), ['pay-api'], ['payments', 'web']));
    expect('shared' in findGroup(p.groups, ['payments', 'web'])!).toBe(false);
    expect(writeConfig({ version: 1, index: 'api', groups: p.groups }, 'h')).not.toContain('shared: ["pay-api"]');
  });
  it('rule-only: notLinked and stillShared, nothing to commit', () => {
    const api = repos.find((r) => r.name === 'api-svc')!;
    const p = ok(unshareRepos(groups(), [api], ['payments']));
    expect(p.changed).toBe(false);
    expect(p.removed).toEqual([]);
    expect(p.notLinked).toEqual(['api-svc']);
    expect(p.stillShared).toEqual([{ repo: 'api-svc', rule: 'topic:backend' }]);
    expect(p.groups).toEqual(groups());
  });
  it('exact entry and a rule both: removes the exact one and reports the rule', () => {
    const g = groups();
    findGroup(g, ['payments'])!.shared!.push('api-svc');
    const api = repos.find((r) => r.name === 'api-svc')!;
    const p = ok(unshareRepos(g, [api], ['payments']));
    expect(p.removed).toEqual(['api-svc']);
    expect(p.stillShared).toEqual([{ repo: 'api-svc', rule: 'topic:backend' }]);
    expect(findGroup(p.groups, ['payments'])!.shared).not.toContain('api-svc');
  });
  it('no-op for a repo that is not listed at all, and an error for a missing group', () => {
    const p = ok(unshareRepos(groups(), ['plat-x'], ['payments']));
    expect(p.changed).toBe(false);
    expect(p.notLinked).toEqual(['plat-x']);
    expect(p.stillShared).toEqual([]);
    expect('error' in unshareRepos(groups(), ['x'], ['nope'])).toBe(true);
    expect('error' in unshareRepos(groups(), ['x'], [])).toBe(true);
  });
  it('is an Edit: applyEdit, editPath and the commit message', () => {
    const e = { kind: 'unshare' as const, repos: ['lib-core'], from: ['docs'] };
    const r = ok(applyEdit(groups(), e)) as { groups: ReturnType<typeof groups> };
    expect(findGroup(r.groups, ['docs'])!.shared).toEqual(['solo']);
    expect(editPath(e)).toBe('docs');
    expect(commitMessage(e)).toBe('chore(repo-groups): stop listing lib-core in docs');
    expect(commitMessage({ ...e, repos: ['a', 'b'], from: ['payments', 'web'] })).toBe('chore(repo-groups): stop listing 2 repositories in payments/web');
  });
});
