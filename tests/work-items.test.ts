import { describe, expect, it } from 'vitest';
import { createClient } from '../src/background/api';
import { loadWorkItems, newWorkCache } from '../src/background/work-items';
import { chunkRepos, filterWork, labelText, mergeWork, nextDepth, reposWithMore, workCounts, type RepoWork, type WorkItem, type WorkMap } from '../src/core/work-items';
import { fakeFetch, type Route } from './fake-github';

const item = (repo: string, number: number, updatedAt: string, kind: 'issue' | 'pr' = 'issue', extra: Partial<WorkItem> = {}): WorkItem => ({
  repo, kind, number, title: `${repo} item ${number}`, url: `https://github.com/o/${repo}/${kind === 'pr' ? 'pull' : 'issues'}/${number}`, updatedAt, author: 'ana', labels: [], ...extra,
});
const work = (issues: WorkItem[], prs: WorkItem[] = [], more: { i?: boolean; p?: boolean } = {}): RepoWork => ({ issues, prs, moreIssues: !!more.i, morePrs: !!more.p });

describe('chunkRepos', () => {
  it('splits into batches of 50 and drops duplicates', () => {
    const names = Array.from({ length: 120 }, (_, i) => `r${i}`);
    const c = chunkRepos([...names, 'r0', 'r1']);
    expect(c.map((x) => x.length)).toEqual([50, 50, 20]);
    expect(chunkRepos([])).toEqual([]);
  });
});

describe('mergeWork', () => {
  it('sorts issues and PRs of every repo by last update, newest first', () => {
    const map: WorkMap = {
      a: work([item('a', 1, '2026-01-01T00:00:00Z'), item('a', 2, '2026-01-05T00:00:00Z')], [item('a', 3, '2026-01-03T00:00:00Z', 'pr')]),
      b: work([item('b', 7, '2026-01-04T00:00:00Z')]),
    };
    const m = mergeWork(map);
    expect(m.items.map((i) => `${i.repo}#${i.number}`)).toEqual(['a#2', 'b#7', 'a#3', 'a#1']);
    expect(m.incomplete).toBe(false);
    expect(m.hidden).toBe(0);
  });

  it('holds back rows older than the cut-off of a repo that has more, so the order stays exact', () => {
    const map: WorkMap = {
      busy: work([item('busy', 9, '2026-01-10T00:00:00Z'), item('busy', 8, '2026-01-08T00:00:00Z')], [], { i: true }), // more exist, all older than Jan 8
      quiet: work([item('quiet', 1, '2026-01-09T00:00:00Z'), item('quiet', 2, '2026-01-02T00:00:00Z')]),
    };
    const m = mergeWork(map);
    expect(m.items.map((i) => `${i.repo}#${i.number}`)).toEqual(['busy#9', 'quiet#1', 'busy#8']);
    expect(m.hidden).toBe(1); // quiet#2 could be older than an unfetched busy item
    expect(m.incomplete).toBe(true);
    expect(reposWithMore(map)).toEqual(['busy']);
  });

  it('uses the newest cut-off when several lists were cut', () => {
    const map: WorkMap = {
      a: work([item('a', 1, '2026-01-05T00:00:00Z')], [], { i: true }),
      b: work([], [item('b', 1, '2026-01-07T00:00:00Z', 'pr')], { p: true }),
    };
    expect(mergeWork(map).items.map((i) => i.repo)).toEqual(['b']);
  });

  it('handles an empty map', () => {
    expect(mergeWork({})).toEqual({ items: [], hidden: 0, incomplete: false });
  });
});

describe('filterWork', () => {
  const items = [
    item('api', 12, '2026-01-03T00:00:00Z', 'issue', { title: 'Crash on login', labels: [{ name: 'bug', color: 'd73a4a' }] }),
    item('web', 40, '2026-01-02T00:00:00Z', 'pr', { title: 'Add dark mode', author: 'bruno' }),
  ];
  it('filters by kind', () => {
    expect(filterWork(items, 'issue', '').map((i) => i.number)).toEqual([12]);
    expect(filterWork(items, 'pr', '').map((i) => i.number)).toEqual([40]);
    expect(filterWork(items, 'all', '')).toHaveLength(2);
  });
  it('searches title, repo, number, author and labels', () => {
    expect(filterWork(items, 'all', 'LOGIN')).toHaveLength(1);
    expect(filterWork(items, 'all', 'web')).toHaveLength(1);
    expect(filterWork(items, 'all', '#40')).toHaveLength(1);
    expect(filterWork(items, 'all', 'bruno')).toHaveLength(1);
    expect(filterWork(items, 'all', 'bug')).toHaveLength(1);
    expect(filterWork(items, 'pr', 'login')).toHaveLength(0);
  });
  it('counts and helpers', () => {
    expect(workCounts(items)).toEqual({ issues: 1, prs: 1 });
    expect(nextDepth(20)).toBe(40);
    expect(nextDepth(90)).toBe(100);
    expect(nextDepth(100)).toBeNull();
    expect(labelText('ffffff')).toBe('#1f2328');
    expect(labelText('000000')).toBe('#ffffff');
    expect(labelText('nope')).toBe('#1f2328');
  });
});

describe('loadWorkItems (GraphQL aliases)', () => {
  const client = (f: ReturnType<typeof fakeFetch>) => createClient({ fetch: f.fetch, getToken: async () => 't' });
  const answer: Route = (url, call) => {
    if (url.pathname !== '/graphql') return undefined;
    const { variables } = JSON.parse(call.body!);
    const data: Record<string, any> = {};
    let i = 0;
    while (`n${i}` in variables) {
      const name = variables[`n${i}`] as string;
      data[`r${i}`] =
        name === 'secret'
          ? null
          : {
              i: { pageInfo: { hasNextPage: name === 'busy' }, nodes: [{ number: 1, title: `${name} bug`, url: `https://github.com/o/${name}/issues/1`, updatedAt: '2026-01-02T00:00:00Z', author: { login: 'ana' }, labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] } }] },
              p: { pageInfo: { hasNextPage: false }, nodes: [{ number: 2, title: `${name} pr`, url: `https://github.com/o/${name}/pull/2`, updatedAt: '2026-01-03T00:00:00Z', isDraft: true, author: null, labels: { nodes: [] } }] },
            };
      i++;
    }
    return { json: { data } };
  };

  it('asks 50 repos per query, maps the answer and skips repos the user cannot open', async () => {
    const f = fakeFetch(answer);
    const names = [...Array.from({ length: 59 }, (_, i) => `r${i}`), 'secret'];
    const res = await loadWorkItems(client(f), newWorkCache(), 'o', names, 20);
    expect(f.calls).toHaveLength(2); // 50 + 10
    const q = JSON.parse(f.calls[0].body!).query as string;
    expect(q).toContain('first: 20');
    expect(q).toContain('states: OPEN');
    expect(Object.keys(res.repos)).toHaveLength(59);
    expect(res.repos.r0.issues[0]).toMatchObject({ repo: 'r0', kind: 'issue', number: 1, author: 'ana', labels: [{ name: 'bug', color: 'd73a4a' }] });
    expect(res.repos.r0.prs[0]).toMatchObject({ kind: 'pr', draft: true, author: null });
    expect(res.repos.secret).toBeUndefined();
  });

  it('flags repos with more than the depth', async () => {
    const f = fakeFetch(answer);
    const res = await loadWorkItems(client(f), newWorkCache(), 'o', ['busy', 'calm'], 20);
    expect(reposWithMore(res.repos)).toEqual(['busy']);
  });

  it('caches for 5 minutes per repo and depth', async () => {
    const f = fakeFetch(answer);
    const cache = newWorkCache();
    let now = 1000;
    const c = client(f);
    await loadWorkItems(c, cache, 'o', ['a', 'b'], 20, { now: () => now });
    now += 4 * 60000;
    await loadWorkItems(c, cache, 'o', ['a', 'b'], 20, { now: () => now });
    expect(f.calls).toHaveLength(1);
    await loadWorkItems(c, cache, 'o', ['a', 'b'], 40, { now: () => now }); // deeper: different key
    expect(f.calls).toHaveLength(2);
    now += 2 * 60000;
    await loadWorkItems(c, cache, 'o', ['a', 'b'], 20, { now: () => now }); // expired
    expect(f.calls).toHaveLength(3);
    await loadWorkItems(c, cache, 'o', ['a', 'c'], 20, { now: () => now }); // only c is new
    expect(JSON.parse(f.calls[3].body!).variables.n0).toBe('c');
  });

  it('pauses at the rate limit floor and returns only cached data', async () => {
    const f = fakeFetch(answer);
    const c = client(f);
    const cache = newWorkCache();
    await loadWorkItems(c, cache, 'o', ['a'], 20);
    c.rate.remaining = 50;
    c.rate.resetAt = 2_000_000_000;
    const res = await loadWorkItems(c, cache, 'o', ['a', 'z'], 20);
    expect(f.calls).toHaveLength(1);
    expect(Object.keys(res.repos)).toEqual(['a']);
    expect(res.paused).toEqual({ resumeAt: 2_000_000_000 * 1000 });
  });
});
