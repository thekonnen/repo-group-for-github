// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountOrgRepos, type Mounted } from '../src/features/mount';
import { findGroup } from '../src/core/placement';
import { example } from './fixtures';
import { fakeCall, memberAccess } from './page-helpers';

const body = readFileSync(join(process.cwd(), 'tests/fixtures/org-repos.html'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
let mounted: Mounted | null = null;
beforeEach(() => {
  document.documentElement.innerHTML = body;
});
afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.documentElement.innerHTML = '';
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const names = () => $$('.rg-root[data-rg="view"] .rg-row .rg-row-title a').map((a) => a.textContent!.trim());
const withPins = (mut: (g: any) => void) => {
  const cfg = example();
  mut(findGroup(cfg.groups, ['infra', 'dagsrv']));
  return { exists: true, sha: 'sha1', config: cfg, warnings: [] };
};

async function open(opts: Parameters<typeof fakeCall>[0] = {}) {
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories#infra/dagsrv');
  const fc = fakeCall(opts);
  mounted = (await mountOrgRepos('thekonnen', { call: fc.call }, document, 200))!;
  await vi.waitFor(() => expect($('.rg-g-head')).toBeTruthy());
  await vi.waitFor(() => expect(names().length).toBeGreaterThan(0));
  return fc;
}
const editReq = (fc: { log: any[] }) => fc.log.find((r) => r.type === 'org:edit');

describe('pinned repos and group sort (C5)', () => {
  it('lists pinned repos first with a pin icon, then the group order', async () => {
    await open({ config: withPins((g) => (g.pinned = ['dags-repo'])) });
    expect(names()).toEqual(['dags-repo', 'kite-dagsrv', 'dagsrv']);
    expect($$('.rg-pin')).toHaveLength(1);
    expect($('.rg-pin')!.closest('.rg-row')!.textContent).toContain('dags-repo');
  });
  it('uses the group sort and keeps pins on top', async () => {
    await open({ config: withPins((g) => ((g.sort = 'name'), (g.pinned = ['kite-dagsrv']))) });
    expect(names()).toEqual(['kite-dagsrv', 'dags-repo', 'dagsrv']);
    expect(($('.rg-sort-select') as HTMLSelectElement).value).toBe('name');
  });
  it('the ⋯ menu pins a repo through the org commit path', async () => {
    const fc = await open({ edit: () => ({ status: 'ok', sha: 'sha2', config: withPins((g) => (g.pinned = ['dagsrv'])).config, warnings: [] }) });
    const row = $$('.rg-row').find((r) => r.querySelector('.rg-row-title a')?.textContent === 'dagsrv')!;
    (row.querySelector('.rg-menu button') as HTMLElement).click();
    const item = await vi.waitFor(() => {
      const i = $('.rg-menu-list [role=menuitem]');
      expect(i).toBeTruthy();
      return i!;
    });
    expect(item.textContent).toContain('Pin to top of dagsrv');
    item.click();
    await vi.waitFor(() => expect(editReq(fc)).toBeTruthy());
    expect(editReq(fc).edit).toEqual({ kind: 'pin', path: ['infra', 'dagsrv'], repo: 'dagsrv', pinned: true });
    await vi.waitFor(() => expect(names()[0]).toBe('dagsrv'));
  });
  it('offers Unpin for a pinned repo', async () => {
    await open({ config: withPins((g) => (g.pinned = ['dagsrv'])) });
    const row = $$('.rg-row').find((r) => r.querySelector('.rg-row-title a')?.textContent === 'dagsrv')!;
    (row.querySelector('.rg-menu button') as HTMLElement).click();
    await vi.waitFor(() => expect($('.rg-menu-list [role=menuitem]')!.textContent).toContain('Unpin'));
  });
  it('an editor changing the sort writes sort: through the org commit path', async () => {
    const fc = await open({ edit: () => ({ status: 'ok', sha: 'sha2', config: withPins((g) => (g.sort = 'stars')).config, warnings: [] }) });
    const sel = $('.rg-sort-select') as HTMLSelectElement;
    sel.value = 'stars';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(editReq(fc)).toBeTruthy());
    expect(editReq(fc).edit).toEqual({ kind: 'sort', path: ['infra', 'dagsrv'], sort: 'stars' });
  });
  it('a read-only member gets no pin menu; the sort is only a local override saved in prefs', async () => {
    const fc = await open({ access: memberAccess });
    await new Promise((r) => setTimeout(r, 30));
    expect($$('.rg-menu')).toHaveLength(0);
    const sel = $('.rg-sort-select') as HTMLSelectElement;
    sel.value = 'name';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(names()).toEqual(['dags-repo', 'dagsrv', 'kite-dagsrv']));
    expect(editReq(fc)).toBeUndefined();
    expect(fc.log.filter((r) => r.type === 'prefs:set').pop()).toMatchObject({ org: 'thekonnen', prefs: { groupSort: { 'infra/dagsrv': 'name' } } });
  });
});
