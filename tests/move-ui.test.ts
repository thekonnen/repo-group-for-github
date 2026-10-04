// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEdit } from '../src/core/edit';
import { mountOrgRepos, type Mounted } from '../src/features/mount';
import { DRAG_TYPE, dropTarget, dragSource } from '../src/features/grouped-view/dnd';
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
const toast = () => $('.rg-toast')?.textContent ?? '';
const rowOf = (repo: string) => $$('.rg-root[data-rg="view"] .rg-row').find((r) => r.querySelector('.rg-row-title a')?.textContent?.trim() === repo)!;
const sideItem = (name: string) => $$('[data-rg="side"] .rg-nav-item').find((b) => b.querySelector('span')?.textContent === name)!;

/** The "server": applies the edit it receives to the example file, like the background does. */
const serverEdit = (seen: any[] = []) => (req: any) => {
  seen.push(req.edit);
  const cfg = example();
  const r = applyEdit(cfg.groups, req.edit) as any;
  return { status: 'ok', sha: 'sha-2', config: { ...cfg, groups: r.groups }, warnings: [] };
};

async function open(hash: string, opts: Parameters<typeof fakeCall>[0] = {}) {
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories' + hash);
  const fc = fakeCall(opts);
  mounted = (await mountOrgRepos('thekonnen', { call: fc.call }, document, 200))!;
  await vi.waitFor(() => expect($('.rg-g-head')).toBeTruthy());
  await vi.waitFor(() => expect($$('.rg-kebab').length + $$('.rg-row').length).toBeGreaterThan(0));
  return fc;
}

/** DataTransfer is incomplete in happy-dom: a small stand-in with the same surface the handlers use. */
function transfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    get types() { return [...data.keys()]; },
    setData: (t: string, v: string) => void data.set(t, v),
    getData: (t: string) => data.get(t) ?? '',
  };
}
const fire = (el: Element, type: string, dt: unknown) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: dt });
  el.dispatchEvent(e);
  return e;
};

describe('Move to… menu (A4)', () => {
  it('opens a keyboard-accessible picker and commits a move, toasting only after the API answers', async () => {
    const seen: any[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const edit = serverEdit(seen);
    const fc = await open('#infra/dagsrv', { edit: async (req: any) => (await gate, edit(req)) });
    const kebab = rowOf('kite-dagsrv').querySelector('.rg-kebab') as HTMLButtonElement;
    expect(kebab.getAttribute('aria-haspopup')).toBe('menu');
    kebab.click();
    await vi.waitFor(() => expect($('[role=menu] [role=menuitem]')?.textContent).toBe('Move to…'));
    ($('[role=menuitem]') as HTMLElement).click();
    await vi.waitFor(() => expect($('[role=listbox].rg-move-pop')).toBeTruthy());
    const list = $('[role=listbox].rg-move-pop')!;
    const opts = [...list.querySelectorAll('[role=option]')];
    expect(opts.map((o) => o.querySelector('span:not(.rg-mini-av)')?.textContent)).toEqual(['Ungrouped (top level)', 'infra', 'dagsrv', 'authn', 'cmonitor', 'ai', 'llm-proxy']);
    // the group it is in now is active and marked
    expect(list.querySelector('[aria-selected=true]')?.id).toBe('rg-mv-infra_dagsrv');
    expect(list.getAttribute('aria-activedescendant')).toBe('rg-mv-infra_dagsrv');
    const key = (k: string) => list.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('End');
    await vi.waitFor(() => expect(list.getAttribute('aria-activedescendant')).toBe('rg-mv-ai_llm-proxy'));
    key('Home');
    await vi.waitFor(() => expect(list.getAttribute('aria-activedescendant')).toBe('rg-mv-root'));
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    await vi.waitFor(() => expect(list.getAttribute('aria-activedescendant')).toBe('rg-mv-infra_cmonitor'));
    key('Enter');
    await vi.waitFor(() => expect((fc.log.find((r) => r.type === 'org:edit') as any)?.edit).toEqual({ kind: 'move', repo: 'kite-dagsrv', to: ['infra', 'cmonitor'] }));
    expect($('[role=listbox]')).toBeNull();
    expect(toast()).toBe(''); // not yet: the commit has not answered
    release();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await vi.waitFor(() => expect(toast()).toContain('Moved kite-dagsrv to infra / cmonitor'));
    expect(toast()).toContain('thekonnen/.github/repo-groups.yml');
    expect(fc.log.filter((r) => r.type === 'org:edit')).toHaveLength(1);
  });

  it('Escape closes the picker and returns focus to the button', async () => {
    await open('#infra/dagsrv');
    const kebab = rowOf('dagsrv').querySelector('.rg-kebab') as HTMLButtonElement;
    kebab.click();
    await vi.waitFor(() => expect($('[role=menuitem]')).toBeTruthy());
    ($('[role=menuitem]') as HTMLElement).click();
    await vi.waitFor(() => expect($('[role=listbox]')).toBeTruthy());
    $('[role=listbox]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect($('[role=listbox]')).toBeNull());
    expect(document.activeElement).toBe(kebab);
  });

  it('choosing the current group says so and commits nothing', async () => {
    const fc = await open('#infra/dagsrv');
    (rowOf('dagsrv').querySelector('.rg-kebab') as HTMLElement).click();
    await vi.waitFor(() => expect($('[role=menuitem]')).toBeTruthy());
    ($('[role=menuitem]') as HTMLElement).click();
    await vi.waitFor(() => expect($('[role=listbox]')).toBeTruthy());
    $('[role=listbox]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(toast()).toContain('dagsrv is already in infra / dagsrv.'));
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
  });

  it('shows an error toast when the commit fails', async () => {
    await open('#infra/dagsrv', { edit: () => { throw new Error('You cannot write to thekonnen/.github.'); } });
    (rowOf('dagsrv').querySelector('.rg-kebab') as HTMLElement).click();
    await vi.waitFor(() => expect($('[role=menuitem]')).toBeTruthy());
    ($('[role=menuitem]') as HTMLElement).click();
    await vi.waitFor(() => expect($('[role=listbox]')).toBeTruthy());
    $$('[role=option]')[0].click();
    await vi.waitFor(() => expect($('.rg-toast.rg-err')?.textContent).toContain('You cannot write'));
  });

  it('is not offered to members who cannot write the org file', async () => {
    await open('#infra/dagsrv', { access: memberAccess });
    expect($$('.rg-kebab')).toHaveLength(0);
    expect(rowOf('dagsrv').getAttribute('draggable')).toBeNull();
  });
});

describe('drag & drop (A4)', () => {
  it('dropping a repo row on a group row moves it, with a visible highlight while over', async () => {
    const seen: any[] = [];
    await open('', { edit: serverEdit(seen) });
    // expand infra so the dagsrv repo rows and the group rows are visible
    ($('.rg-row .rg-chev') as HTMLElement).click();
    await vi.waitFor(() => expect($$('.rg-row .rg-row-title a.rg-grp').length).toBeGreaterThan(1));
    const repo = $$('.rg-row').find((r) => r.getAttribute('draggable') === 'true')!;
    const name = repo.querySelector('.rg-row-title a')!.textContent!.trim();
    const target = $$('.rg-row').find((r) => r.querySelector('a.rg-grp')?.textContent === 'ai')!;
    const dt = transfer();
    fire(repo, 'dragstart', dt);
    expect(dt.getData(DRAG_TYPE)).toBe(name);
    expect(dt.effectAllowed).toBe('move');
    const over = fire(target, 'dragover', dt);
    expect(over.defaultPrevented).toBe(true); // lets the drop happen
    expect(dt.dropEffect).toBe('move');
    expect(target.classList.contains('rg-drop-over')).toBe(true);
    fire(target, 'dragleave', dt);
    expect(target.classList.contains('rg-drop-over')).toBe(false);
    fire(target, 'dragover', dt);
    fire(target, 'drop', dt);
    expect(target.classList.contains('rg-drop-over')).toBe(false);
    await vi.waitFor(() => expect(seen).toEqual([{ kind: 'move', repo: name, to: ['ai'] }]));
    await vi.waitFor(() => expect(toast()).toContain(`Moved ${name} to ai`));
  });

  it('dropping on a sidebar item moves to that group; "All groups" moves to Ungrouped', async () => {
    const seen: any[] = [];
    await open('#infra/dagsrv', { edit: serverEdit(seen) });
    const dt = transfer();
    fire(rowOf('kite-dagsrv'), 'dragstart', dt);
    const item = sideItem('authn');
    fire(item, 'dragover', dt);
    expect(item.classList.contains('rg-drop-over')).toBe(true);
    fire(item, 'drop', dt);
    await vi.waitFor(() => expect(seen).toEqual([{ kind: 'move', repo: 'kite-dagsrv', to: ['infra', 'authn'] }]));
    await vi.waitFor(() => expect(toast()).toContain('Moved kite-dagsrv to infra / authn'));
    const dt2 = transfer();
    fire(rowOf('dagsrv'), 'dragstart', dt2);
    fire(sideItem('All groups'), 'drop', dt2);
    await vi.waitFor(() => expect(seen[1]).toEqual({ kind: 'move', repo: 'dagsrv', to: [] }));
  });

  it('ignores drags that are not repository rows', async () => {
    await open('#infra/dagsrv');
    const item = sideItem('authn');
    const dt = transfer();
    dt.setData('text/plain', 'hello');
    const e = fire(item, 'dragover', dt);
    expect(e.defaultPrevented).toBe(false);
    expect(item.classList.contains('rg-drop-over')).toBe(false);
  });
});

describe('dnd handlers (unit)', () => {
  it('dragSource sets the repo name; dropTarget calls moveRepo with the path', () => {
    const calls: [string, string[]][] = [];
    const ctl = { moveRepo: async (r: string, to: string[]) => (calls.push([r, to]), { ok: true as const }) };
    const dt = transfer();
    dragSource('x').onDragStart({ dataTransfer: dt } as any);
    const el = document.createElement('div');
    const handlers = dropTarget(ctl, ['a', 'b']);
    handlers.onDrop({ dataTransfer: dt, currentTarget: el, preventDefault() {} } as any);
    expect(calls).toEqual([['x', ['a', 'b']]]);
  });
});
