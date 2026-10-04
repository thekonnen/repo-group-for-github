// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markSeen, newUngrouped, visitUngrouped } from '../src/core/unassigned';
import { mountOrgRepos } from '../src/features/mount';
import { fakeCall, repos } from './page-helpers';
import { unassignedText } from '../src/features/grouped-view/UnassignedNotice';

describe('core/unassigned', () => {
  it('first visit: nothing is new', () => {
    expect(newUngrouped(null, ['a', 'b'])).toEqual([]);
    expect(newUngrouped(undefined, ['a'])).toEqual([]);
  });
  it('returns the ungrouped repos not seen before', () => {
    expect(newUngrouped({ names: ['a', 'b'], at: 1 }, ['b', 'c', 'd'])).toEqual(['c', 'd']);
    expect(newUngrouped({ names: ['a'], at: 1 }, [])).toEqual([]);
  });
  it('markSeen keeps exactly the current set, deduplicated, with the time', () => {
    expect(markSeen(['a', 'b', 'a'], 42)).toEqual({ names: ['a', 'b'], at: 42 });
  });
  it('visitUngrouped keeps earlier flags that are still ungrouped and stores the current set', () => {
    const v = visitUngrouped({ names: ['a'], at: 1 }, ['x', 'gone'], ['a', 'x', 'n'], 9);
    expect(v.newNames).toEqual(['x', 'n']);
    expect(v.seen).toEqual({ names: ['a', 'x', 'n'], at: 9 });
    expect(visitUngrouped(null, [], ['a'], 9)).toEqual({ newNames: [], seen: { names: ['a'], at: 9 } });
  });
  it('uses “Not in My groups” wording on the personal layer', () => {
    expect(unassignedText(12)).toBe('12 repositories are not in any group yet');
    expect(unassignedText(1)).toBe('1 repository is not in any group yet');
    expect(unassignedText(12, true)).toBe('12 repositories are not in My groups yet');
    expect(unassignedText(1, true)).toBe('1 repository is not in My groups yet');
  });
});

const html = readFileSync(join(process.cwd(), 'tests/fixtures/org-repos.html'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
const settle = () => vi.waitFor(() => expect(document.querySelector('.rg-root[data-rg="view"] .rg-view .rg-stats')).toBeTruthy());
const extra = (name: string, extraProps: object = {}) => ({ ...repos[0], name, ...extraProps });

/** fakeCall with stored prefs, recording what the page saves. */
function withPrefs(prefs: object, rs: any[]) {
  const f = fakeCall({ repos: rs });
  const saved: any[] = [];
  const call = vi.fn(async (req: any) => {
    if (req.type === 'prefs:get') return prefs;
    if (req.type === 'prefs:set') return void saved.push(req.prefs);
    return f.call(req);
  });
  return { call: call as any, saved };
}

beforeEach(() => {
  document.documentElement.innerHTML = html;
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories');
  sessionStorage.clear();
});
afterEach(() => {
  document.documentElement.innerHTML = '';
});

describe('unassigned notice on the root', () => {
  it('shows the callout (role=status) with counts, and archived repos are not counted', async () => {
    const { call } = withPrefs({}, [...repos, extra('lonely-1'), extra('old-one', { archived: true })]);
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await settle();
    const box = await vi.waitFor(() => {
      const el = document.querySelector('.rg-unassigned');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(box.getAttribute('role')).toBe('status');
    expect(box.textContent).toContain('2 repositories are not in any group yet');
    expect(box.textContent).not.toContain('new since'); // first visit: nothing is new
    m.dispose();
  });

  it('Review ungrouped switches to the Ungrouped tab; Dismiss hides it for the session', async () => {
    const { call } = withPrefs({}, [...repos, extra('lonely-1')]);
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await settle();
    await vi.waitFor(() => expect(document.querySelector('.rg-unassigned')).toBeTruthy());
    const btn = [...document.querySelectorAll('.rg-unassigned button')].find((b) => b.textContent === 'Review ungrouped') as HTMLElement;
    btn.click();
    await vi.waitFor(() => expect(document.querySelector('.rg-tab[aria-selected="true"]')!.textContent).toContain('Ungrouped'));
    expect(document.querySelector('.rg-unassigned')).toBeNull(); // already on the tab
    (document.querySelector('.rg-tab') as HTMLElement).click(); // back to the items tab
    await vi.waitFor(() => expect(document.querySelector('.rg-unassigned')).toBeTruthy());
    (document.querySelector('.rg-unassigned-x') as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('.rg-unassigned')).toBeNull());
    expect(sessionStorage.getItem('rg:unassigned-dismissed:thekonnen')).toBe('1');
    m.dispose();
  });

  it('the sidebar badge shows the count and reviews the ungrouped repositories', async () => {
    const { call } = withPrefs({}, [...repos, extra('lonely-1')]);
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await settle();
    const badge = await vi.waitFor(() => {
      const el = document.querySelector('.rg-unassigned-badge') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(badge.textContent).toContain('2');
    badge.click();
    await vi.waitFor(() => expect(document.querySelector('.rg-tab[aria-selected="true"]')!.textContent).toContain('Ungrouped'));
    m.dispose();
  });

  it('Start with AI opens the YAML editor scoped to Ungrouped only', async () => {
    const { call } = withPrefs({}, [...repos, extra('lonely-1')]);
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await settle();
    await vi.waitFor(() => expect(document.querySelector('.rg-unassigned')).toBeTruthy());
    ([...document.querySelectorAll('.rg-unassigned button')].find((b) => b.textContent?.includes('Start with AI')) as HTMLElement).click();
    const sel = await vi.waitFor(() => {
      const el = document.querySelector('select.rg-y-scope') as HTMLSelectElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(sel.value).toBe('ungrouped');
    m.dispose();
  });

  it('marks ungrouped repos that appeared since the last visit with “New”, and stores the new seen set', async () => {
    const { call, saved } = withPrefs({ unassignedSeen: { names: ['keep_alive_job'], at: 1 } }, [...repos, extra('lonely-1')]);
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await settle();
    await vi.waitFor(() => expect(document.querySelector('.rg-unassigned')!.textContent).toContain('1 new since your last visit'));
    (document.querySelector('.rg-unassigned button') as HTMLElement).click();
    await vi.waitFor(() => {
      const rows = [...document.querySelectorAll('.rg-row')];
      expect(rows.map((r) => !!r.querySelector('.rg-new'))).toEqual([true, false]);
      expect(rows[0].textContent).toContain('lonely-1');
    });
    expect(saved.some((p) => [...(p.unassignedSeen?.names ?? [])].sort().join() === 'keep_alive_job,lonely-1')).toBe(true);
    m.dispose();
  });

  it('shows nothing when every repository is in a group', async () => {
    const grouped = repos.filter((r) => r.name !== 'keep_alive_job');
    const { call } = withPrefs({}, grouped);
    const m = (await mountOrgRepos('thekonnen', { call }, document, 200))!;
    await settle();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('.rg-unassigned')).toBeNull();
    expect(document.querySelector('.rg-unassigned-badge')).toBeNull();
    m.dispose();
  });
});
