import { describe, expect, it } from 'vitest';
import {
  batches, lastPageFromLink, mergeIndex, needsFullSync, rateLimitPause, reconcile, remainingPages, shouldContinueIncremental,
} from '../src/core/index-sync';
import { canApplyRow, confirmActionIndex, detectAccess, editorUrl, suggestIssueUrl } from '../src/core/access';
import { joinChunks, splitChunks } from '../src/storage/sync-chunks';

describe('index sync (F14)', () => {
  it('plans pages from the Link header', () => {
    const link = '<https://api.github.com/orgs/o/repos?page=2>; rel="next", <https://api.github.com/orgs/o/repos?type=all&per_page=100&page=34>; rel="last"';
    expect(lastPageFromLink(link)).toBe(34);
    expect(lastPageFromLink(null)).toBe(1);
    expect(remainingPages(4)).toEqual([2, 3, 4]);
    expect(remainingPages(1)).toEqual([]);
    expect(batches(remainingPages(34), 6).length).toBe(6);
  });
  it('incremental stop rule', () => {
    const since = '2026-01-01T00:00:00Z';
    expect(shouldContinueIncremental([{ pushedAt: '2026-01-02T00:00:00Z' }], since)).toBe(true);
    expect(shouldContinueIncremental([{ pushedAt: '2026-01-02T00:00:00Z' }, { pushedAt: '2025-12-01T00:00:00Z' }], since)).toBe(false);
    expect(shouldContinueIncremental([], since)).toBe(false);
    expect(shouldContinueIncremental([{ pushedAt: '2026-01-02T00:00:00Z' }], null)).toBe(false);
  });
  it('merges and sorts newest first', () => {
    const out = mergeIndex([{ name: 'a', pushedAt: '2026-01-01T00:00:00Z', viewerIsAdmin: true }, { name: 'b', pushedAt: '2026-01-02T00:00:00Z' }], [{ name: 'a', pushedAt: '2026-01-03T00:00:00Z' }]);
    expect(out.map((r) => r.name)).toEqual(['a', 'b']);
    expect(out[0].viewerIsAdmin).toBe(true);
  });
  it('reconciliation drops deleted and renamed repos', () => {
    const out = reconcile([{ name: 'old', viewerIsAdmin: true }, { name: 'keep', viewerIsAdmin: true }], [{ name: 'new' }, { name: 'keep' }]);
    expect(out.map((r) => r.name).sort()).toEqual(['keep', 'new']);
    expect(out.find((r) => r.name === 'keep')!.viewerIsAdmin).toBe(true);
  });
  it('decides when a full sync is due', () => {
    const now = Date.parse('2026-01-10T00:00:00Z');
    const meta = { lastFullSync: '2026-01-09T12:00:00Z', lastIncrementalSync: null, total: 5 };
    expect(needsFullSync(null, null, now)).toBe(true);
    expect(needsFullSync(meta, 5, now)).toBe(false);
    expect(needsFullSync(meta, 6, now)).toBe(true);
    expect(needsFullSync({ ...meta, lastFullSync: '2026-01-01T00:00:00Z' }, 5, now)).toBe(true);
    expect(needsFullSync(meta, 5, now, true)).toBe(true);
  });
  it('pauses under the rate-limit floor', () => {
    expect(rateLimitPause(500, 1)).toEqual({ paused: false });
    expect(rateLimitPause(199, 1000).paused).toBe(true);
  });
});

describe('access levels (F15)', () => {
  const base = { membershipRole: 'member' as const, pushOnDotGithub: false, appInstalled: true };
  it('detects each level', () => {
    expect(detectAccess({ ...base, membershipRole: 'admin', pushOnDotGithub: true }).level).toBe('owner');
    expect(detectAccess({ ...base, pushOnDotGithub: true }).level).toBe('editor');
    expect(detectAccess(base).level).toBe('member');
    expect(detectAccess({ ...base, membershipRole: null, pushOnDotGithub: null }).level).toBe('outside');
    expect(detectAccess({ ...base, appInstalled: false }).level).toBe('no-app');
  });
  it('sets suggest-mode and org-file flags', () => {
    expect(detectAccess(base)).toMatchObject({ suggestMode: true, canWriteOrg: false, hasOrgFile: true, syncNeedsRepoAdmin: true });
    expect(detectAccess({ ...base, membershipRole: 'admin', pushOnDotGithub: true })).toMatchObject({ suggestMode: false, canWriteOrg: true, syncNeedsRepoAdmin: false });
    expect(detectAccess({ ...base, membershipRole: null, pushOnDotGithub: null })).toMatchObject({ hasOrgFile: false, suggestMode: false });
    expect(detectAccess({ ...base, appInstalled: false })).toMatchObject({ publicOnly: true });
    expect(detectAccess({ ...base, allowForking: false }).canForkSuggest).toBe(false);
  });
  it('only lets repo admins (or owners) apply sync rows', () => {
    const member = detectAccess(base);
    expect(canApplyRow(member, true)).toBe(true);
    expect(canApplyRow(member, false)).toBe(false);
    expect(canApplyRow(detectAccess({ ...base, membershipRole: 'admin', pushOnDotGithub: true }), false)).toBe(true);
    expect(canApplyRow(detectAccess({ ...base, appInstalled: false }), true)).toBe(false);
  });
  it('drops unconfirmed Action-index entries', () => {
    expect(confirmActionIndex([{ name: 'a' }, { name: 'secret' }], ['a'])).toEqual([{ name: 'a' }]);
    expect(confirmActionIndex([{ name: 'a' }], [])).toEqual([]);
  });
  it('builds suggest URLs', () => {
    expect(editorUrl('o', 'main')).toBe('https://github.com/o/.github/edit/main/repo-groups.yml');
    expect(suggestIssueUrl('o', 't', 'a b')).toBe('https://github.com/o/.github/issues/new?title=t&body=a%20b');
    expect(suggestIssueUrl('o', 't', 'x'.repeat(6001))).toBeNull();
  });
});

describe('My groups storage chunking (F13)', () => {
  it('round-trips, including multi-byte text and multiple chunks', () => {
    const text = '# ação\n' + 'é日本'.repeat(3000);
    const { items, tooLarge } = splitChunks('mygroups:o', text);
    expect(Object.keys(items).length).toBeGreaterThan(2);
    expect(tooLarge).toBe(false);
    for (const [k, v] of Object.entries(items)) expect(new TextEncoder().encode(k + v).length).toBeLessThan(8192);
    expect(joinChunks('mygroups:o', items)).toBe(text);
  });
  it('flags too-large content and rejects missing chunks', () => {
    expect(splitChunks('k', 'x'.repeat(120000)).tooLarge).toBe(true);
    const { items } = splitChunks('k', 'x'.repeat(20000));
    delete items['k:1'];
    expect(joinChunks('k', items)).toBeNull();
    expect(joinChunks('k', {})).toBeNull();
  });
});
