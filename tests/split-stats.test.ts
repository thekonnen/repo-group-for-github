// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountOrgRepos } from '../src/features/mount';
import type { Request } from '../src/github/messages';
import { fakeCall } from './page-helpers';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/org-repos.html'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
const stats = () => [...document.querySelectorAll('.rg-root[data-rg="view"] .rg-stat')].map((e) => e.textContent);

beforeEach(() => {
  document.documentElement.innerHTML = html;
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories#infra/dagu');
});
afterEach(() => {
  document.documentElement.innerHTML = '';
});

describe('split issue and PR stats', () => {
  it('shows "Open issues & PRs" until details exist for every repo of the group, then two stats', async () => {
    const base = fakeCall();
    const asked: Extract<Request, { type: 'org:details' }>[] = [];
    const call: any = vi.fn(async (req: Request) => {
      if (req.type === 'org:details') {
        asked.push(req);
        return Object.fromEntries(req.repos.map((n) => [n, { issues: 2, prs: 3 }]));
      }
      return base.call(req);
    });
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(stats().some((s) => s!.startsWith('Open issues') && !s!.includes('&'))).toBe(true));
    const s = stats();
    expect(s.some((t) => t!.startsWith('Open pull requests'))).toBe(true);
    expect(s.find((t) => t!.startsWith('Open issues'))).toBe('Open issues6'); // dagu, dags-repo, konnen-dagu x 2
    expect(s.find((t) => t!.startsWith('Open pull requests'))).toBe('Open pull requests9');
    expect(asked).toHaveLength(1); // one request for the whole group
    expect(asked[0].repos.slice().sort()).toEqual(['dags-repo', 'dagu', 'konnen-dagu']);
    m.dispose();
  });

  it('keeps the combined stat when details are not available', async () => {
    const base = fakeCall();
    const call: any = vi.fn(async (req: Request) => {
      if (req.type === 'org:details') throw new Error('rate limited');
      return base.call(req);
    });
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await vi.waitFor(() => expect(stats().length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    expect(stats().some((t) => t!.startsWith('Open issues & PRs'))).toBe(true);
    expect(stats().some((t) => t!.startsWith('Open pull requests'))).toBe(false);
    m.dispose();
  });

  it('shows "Loading the organization index…" while an Action index is confirmed', async () => {
    const base = fakeCall();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const call: any = vi.fn(async (req: Request) => {
      if (req.type === 'org:refresh') (await held, undefined);
      if (req.type === 'org:progress') return { loaded: 40, estimatedTotal: 100, phase: 'action' };
      if (req.type === 'org:cached') return null;
      return base.call(req);
    });
    const m = (await mountOrgRepos('thekonnen', { call, sleep: async () => { await new Promise((r) => setTimeout(r, 5)); } }, document, 200))!;
    await vi.waitFor(() => expect(document.querySelector('.rg-status')!.textContent).toBe('Loading the organization index…'));
    expect((document.querySelector('.rg-status .rg-bar i') as HTMLElement).style.width).toBe('40%');
    release();
    m.dispose();
  });
});
