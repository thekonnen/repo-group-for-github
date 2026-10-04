// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountOrgRepos } from '../src/features/mount';
import type { Request } from '../src/github/messages';
import type { RepoWork, WorkItem } from '../src/core/work-items';
import { clearWorkCache } from '../src/features/grouped-view/WorkPanel';
import { fakeCall } from './page-helpers';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/org-repos.html'), 'utf8').replace(/<!--[\s\S]*?-->/, '');

beforeEach(() => {
  clearWorkCache();
  document.documentElement.innerHTML = html;
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories#infra/dagsrv');
});
afterEach(() => {
  document.documentElement.innerHTML = '';
});

const it_ = (repo: string, number: number, min: number, kind: 'issue' | 'pr' = 'issue'): WorkItem => ({
  repo, kind, number, title: `${repo} ${kind} ${number}`, url: `https://github.com/thekonnen/${repo}/${kind === 'pr' ? 'pull' : 'issues'}/${number}`,
  updatedAt: new Date(Date.parse('2026-01-10T12:00:00Z') - min * 60000).toISOString(), author: 'ana', labels: kind === 'issue' ? [{ name: 'bug', color: 'd73a4a' }] : [],
});

type WorkReq = Extract<Request, { type: 'org:work-items' }>;
type Answer = { repos: Record<string, RepoWork>; paused?: { resumeAt: number | null } };
const rows = () => [...document.querySelectorAll('.rg-work-row')].map((r) => r.querySelectorAll('.rg-row-title a')[1].textContent);
const tabs = () => [...document.querySelectorAll('.rg-tab')].map((t) => t.textContent);

function setup(answer: (req: WorkReq) => Answer, opts: { repos?: any[] } = {}) {
  const base = fakeCall({ repos: opts.repos });
  const asked: WorkReq[] = [];
  const call: any = vi.fn(async (req: Request) => {
    if (req.type === 'org:work-items') {
      asked.push(req);
      return answer(req);
    }
    if (req.type === 'org:details') return {};
    return base.call(req);
  });
  return { call, asked };
}
const open = async (call: any) => {
  const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
  await vi.waitFor(() => expect(tabs().some((t) => t!.startsWith('Issues & PRs'))).toBe(true));
  ([...document.querySelectorAll('.rg-tab')] as HTMLElement[]).find((t) => t.textContent!.startsWith('Issues & PRs'))!.click();
  return m;
};
const empty = (): RepoWork => ({ issues: [], prs: [], moreIssues: false, morePrs: false });

describe('Issues & PRs tab', () => {
  it('lists open issues and PRs of the group and its repos, newest first, with the filter and search', async () => {
    const { call, asked } = setup((req) => ({
      repos: Object.fromEntries(req.repos.map((n, i) => [n, { issues: [it_(n, 1, 10 + i)], prs: [it_(n, 2, 5 + i * 20, 'pr')], moreIssues: false, morePrs: false }])),
    }));
    const m = await open(call);
    await vi.waitFor(() => expect(rows().length).toBe(6));
    expect(asked).toHaveLength(1);
    expect(asked[0].repos.slice().sort()).toEqual(['dags-repo', 'dagsrv', 'kite-dagsrv']);
    expect(asked[0].depth).toBe(20);
    expect(rows()[0]).toMatch(/pr 2$/); // 5 minutes ago is the newest
    const seg = [...document.querySelectorAll('.rg-work-kind')] as HTMLElement[];
    expect(seg.map((b) => b.textContent!.replace(/\d/g, '').trim())).toEqual(['All', 'Issues', 'Pull requests']);
    seg[1].click();
    await vi.waitFor(() => expect(rows().length).toBe(3));
    expect(rows().every((t) => t!.includes('issue'))).toBe(true);
    seg[2].click();
    await vi.waitFor(() => expect(rows().length).toBe(3));
    expect(document.querySelector('.rg-work-row a[href*="/pull/"]')).toBeTruthy();
    seg[0].click();
    const input = document.getElementById('rg-search') as HTMLInputElement;
    input.value = 'kite-dagsrv';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(rows().length).toBe(2));
    expect(document.querySelector('.rg-work-label')!.textContent).toBe('bug');
    m.dispose();
  });

  it('shows Load more, reveals 25 at a time and deepens the repos that were cut', async () => {
    const many = (n: string, count: number) => Array.from({ length: count }, (_, i) => it_(n, i + 1, i + 1));
    const { call, asked } = setup((req) => ({
      repos: Object.fromEntries(
        req.repos.map((n) => [n, n === 'dagsrv' ? { issues: many(n, req.depth > 20 ? 60 : 30), prs: [], moreIssues: req.depth <= 20, morePrs: false } : empty()]),
      ),
    }));
    const m = await open(call);
    await vi.waitFor(() => expect(rows().length).toBe(25));
    const btn = () => document.querySelector('.rg-work-more .rg-btn') as HTMLButtonElement | null;
    expect(asked).toHaveLength(1);
    btn()!.click(); // 30 rows are loaded but 50 are wanted: the cut repo is fetched deeper
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].depth).toBe(40);
    expect(asked[1].repos).toEqual(['dagsrv']); // only the repo that was cut
    await vi.waitFor(() => expect(rows().length).toBe(50));
    btn()!.click(); // 60 loaded and complete: no more requests
    await vi.waitFor(() => expect(rows().length).toBe(60));
    expect(asked).toHaveLength(2);
    expect(btn()).toBeNull();
    m.dispose();
  });

  it('asks for a subgroup on groups with more than 200 repositories and makes no request', async () => {
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories');
    const big = Array.from({ length: 260 }, (_, i) => ({ name: `bulk-${i}`, description: '', pushedAt: '2026-01-10T00:00:00Z', private: false, stars: 0, forks: 0, openIssuesAndPrs: 0 }));
    const { call, asked } = setup(() => ({ repos: {} }), { repos: big });
    const m = await open(call);
    await vi.waitFor(() => expect(document.querySelector('.rg-empty b')!.textContent).toBe('This group is too big to list its issues'));
    expect(asked).toHaveLength(0);
    m.dispose();
  });

  it('opens from the Open issues & PRs stat and says when GitHub paused the work', async () => {
    const { call } = setup(() => ({ repos: {}, paused: { resumeAt: Date.parse('2026-01-10T13:00:00Z') } }));
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-stat-link')).toBeTruthy());
    (document.querySelector('.rg-stat-link') as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('.rg-banner-warn')!.textContent).toContain('Paused to respect GitHub’s rate limit'));
    m.dispose();
  });
});
