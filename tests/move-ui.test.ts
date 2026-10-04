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

const dialog = () => $('[role=alertdialog]');
const edits = (fc: { log: any[] }) => fc.log.filter((r) => r.type === 'org:edit').map((r) => r.edit);
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

/** Opens "⋯ > Send to…" on a row and returns the picker list. */
async function sendTo(repo: string) {
  (rowOf(repo).querySelector('.rg-kebab') as HTMLElement).click();
  await vi.waitFor(() => expect($('[role=menuitem]')).toBeTruthy());
  ($('[role=menuitem]') as HTMLElement).click();
  await vi.waitFor(() => expect($('[role=listbox].rg-move-pop')).toBeTruthy());
  return $('[role=listbox].rg-move-pop')!;
}
const pickOption = (list: HTMLElement, name: string) => [...list.querySelectorAll('[role=option]')].find((o) => o.id === 'rg-mv-' + name)! as HTMLElement;

describe('Send to… menu and confirmation (A4)', () => {
  it('the menu entry is "Send to…" and opens a keyboard-accessible picker of every group', async () => {
    await open('#infra/dagsrv');
    const kebab = rowOf('kite-dagsrv').querySelector('.rg-kebab') as HTMLButtonElement;
    expect(kebab.getAttribute('aria-haspopup')).toBe('menu');
    kebab.click();
    await vi.waitFor(() => expect($('[role=menu] [role=menuitem]')?.textContent).toBe('Send to…'));
    ($('[role=menuitem]') as HTMLElement).click();
    await vi.waitFor(() => expect($('[role=listbox].rg-move-pop')).toBeTruthy());
    const list = $('[role=listbox].rg-move-pop')!;
    expect([...list.querySelectorAll('[role=option]')].map((o) => o.querySelector('span:not(.rg-mini-av)')?.textContent)).toEqual(['Ungrouped (top level)', 'infra', 'dagsrv', 'authn', 'cmonitor', 'ai', 'llm-proxy']);
    expect(list.querySelector('[aria-selected=true]')?.id).toBe('rg-mv-infra_dagsrv');
    expect(list.getAttribute('aria-activedescendant')).toBe('rg-mv-infra_dagsrv');
    key(list, 'End');
    await vi.waitFor(() => expect(list.getAttribute('aria-activedescendant')).toBe('rg-mv-ai_llm-proxy'));
    key(list, 'Home');
    await vi.waitFor(() => expect(list.getAttribute('aria-activedescendant')).toBe('rg-mv-root'));
    key(list, 'Escape');
    await vi.waitFor(() => expect($('[role=listbox]')).toBeNull());
    expect(document.activeElement).toBe(kebab);
  });

  it('picking a group only stages the move: nothing is committed until OK, and the toast waits for the API', async () => {
    const seen: any[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const server = serverEdit(seen);
    const fc = await open('#infra/dagsrv', { edit: async (req: any) => (await gate, server(req)) });
    const list = await sendTo('kite-dagsrv');
    pickOption(list, 'infra_cmonitor').click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect($('#rg-mv-title')!.textContent).toBe('Move 1 repository to thekonnen / infra / cmonitor');
    expect(d.textContent).toContain('kite-dagsrv');
    expect(document.activeElement?.id).toBe('rg-mv-ok');
    expect(($('#rg-mv-ok') as HTMLElement).textContent).toBe('OK, commit to repo-groups.yml');
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(edits(fc)).toHaveLength(1));
    expect(toast()).toBe(''); // the commit has not answered yet
    expect(dialog()).toBeTruthy();
    release();
    await vi.waitFor(() => expect(toast()).toContain('Moved kite-dagsrv to infra / cmonitor'));
    expect(toast()).toContain('thekonnen/.github/repo-groups.yml');
    expect(dialog()).toBeNull();
    expect(edits(fc)).toEqual([{ kind: 'move', repos: ['kite-dagsrv'], to: ['infra', 'cmonitor'] }]);
  });

  it('Cancel, Esc and the backdrop close the dialog without any request', async () => {
    const fc = await open('#infra/dagsrv');
    for (const how of ['cancel', 'esc', 'backdrop']) {
      pickOption(await sendTo('dagsrv'), 'ai').click();
      await vi.waitFor(() => expect(dialog()).toBeTruthy());
      if (how === 'cancel') ($('#rg-mv-cancel') as HTMLElement).click();
      else if (how === 'esc') key(dialog()!, 'Escape');
      else $('.rg-dialog-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await vi.waitFor(() => expect(dialog()).toBeNull());
    }
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
  });

  it('choosing the group it is already in shows a notice and offers no commit', async () => {
    const fc = await open('#infra/dagsrv');
    pickOption(await sendTo('dagsrv'), 'infra_dagsrv').click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialog()!.textContent).toContain('dagsrv is already in infra / dagsrv. There is nothing to commit.');
    expect($('#rg-mv-ok')).toBeNull();
    ($('#rg-mv-cancel') as HTMLElement).click();
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
  });

  it('warns when a pattern still catches a repository sent to Ungrouped', async () => {
    const fc = await open('#infra/dagsrv');
    pickOption(await sendTo('dags-repo'), 'root').click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialog()!.textContent).toContain('A rule still catches this repository.');
    expect(dialog()!.textContent).toContain('dags-repo stays in infra / dagsrv (rule dags-*)');
    expect($('#rg-mv-ok')).toBeNull(); // no exact name to remove: nothing to commit
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
  });

  it('a failed commit keeps the dialog open with the error inline', async () => {
    const fc = await open('#infra/dagsrv', {
      edit: () => {
        throw new Error('You cannot write to thekonnen/.github.');
      },
    });
    pickOption(await sendTo('dagsrv'), 'ai').click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(dialog()!.querySelector('.rg-error')?.textContent).toContain('You cannot write'));
    expect(toast()).toBe('');
    expect(($('#rg-mv-ok') as HTMLButtonElement).disabled).toBe(false); // can retry
    expect(edits(fc)).toHaveLength(1);
  });

  it('is not offered to members who cannot write the org file', async () => {
    await open('#infra/dagsrv', { access: memberAccess });
    expect($$('.rg-kebab')).toHaveLength(0);
    expect($$('.rg-check')).toHaveLength(0);
    expect($$('.rg-grip')).toHaveLength(0);
  });
});

describe('selection and bulk move (A4)', () => {
  it('rows have a checkbox and a drag handle before the ⋯ button; only the handle is draggable', async () => {
    await open('#infra/dagsrv');
    const row = rowOf('dagsrv');
    const kids = [...row.querySelector('.rg-row-menu')!.children].map((c) => c.className.split(' ')[0]);
    expect(kids).toEqual(['rg-check', 'rg-grip', 'rg-kebab-wrap']);
    expect(row.getAttribute('draggable')).toBeNull();
    expect(row.querySelector('.rg-grip')!.getAttribute('draggable')).toBe('true');
    expect((row.querySelector('.rg-check') as HTMLInputElement).getAttribute('aria-label')).toBe('Select dagsrv');
  });

  it('select two, Send to… in the bar, OK: exactly one request with both repositories', async () => {
    const seen: any[] = [];
    const fc = await open('#infra/dagsrv', { edit: serverEdit(seen) });
    expect($('.rg-selbar')).toBeNull();
    (rowOf('kite-dagsrv').querySelector('.rg-check') as HTMLElement).click();
    (rowOf('dags-repo').querySelector('.rg-check') as HTMLElement).click();
    await vi.waitFor(() => expect($('.rg-selbar')?.textContent).toContain('2 selected'));
    const bar = $('.rg-selbar')!;
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Send to…', 'Clear']);
    (bar.querySelector('button') as HTMLElement).click();
    await vi.waitFor(() => expect($('[role=listbox].rg-move-pop')).toBeTruthy());
    pickOption($('[role=listbox].rg-move-pop')!, 'ai').click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect($('#rg-mv-title')!.textContent).toBe('Move 2 repositories to thekonnen / ai');
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(toast()).toContain('Moved 2 repositories to ai'));
    expect(edits(fc)).toHaveLength(1);
    expect(edits(fc)[0].kind).toBe('move');
    expect([...edits(fc)[0].repos].sort()).toEqual(['dags-repo', 'kite-dagsrv']);
    expect(edits(fc)[0].to).toEqual(['ai']);
    expect($('.rg-selbar')).toBeNull(); // selection cleared after the commit
  });

  it('Clear and select-all work, and changing the group clears the selection', async () => {
    await open('#infra/dagsrv');
    const all = $('.rg-box-head .rg-check') as HTMLInputElement;
    all.click();
    await vi.waitFor(() => expect($('.rg-selbar')?.textContent).toContain('3 selected'));
    ([...$('.rg-selbar')!.querySelectorAll('button')].find((b) => b.textContent === 'Clear') as HTMLElement).click();
    await vi.waitFor(() => expect($('.rg-selbar')).toBeNull());
    (rowOf('dagsrv').querySelector('.rg-check') as HTMLElement).click();
    await vi.waitFor(() => expect($('.rg-selbar')).toBeTruthy());
    sideItem('authn').click();
    await vi.waitFor(() => expect($('.rg-selbar')).toBeNull());
  });
});

describe('drag & drop (A4)', () => {
  it('only the handle drags; dropping on a group row highlights it and stages (no commit)', async () => {
    const fc = await open('', { edit: serverEdit() });
    ($('.rg-row .rg-chev') as HTMLElement).click(); // expand infra
    await vi.waitFor(() => expect($$('.rg-row .rg-grip').length).toBeGreaterThan(0));
    const grip = $('.rg-row .rg-grip')!;
    const name = grip.closest('.rg-row')!.querySelector('.rg-row-title a')!.textContent!.trim();
    const target = $$('.rg-row').find((r) => r.querySelector('a.rg-grp')?.textContent === 'ai')!;
    const dt = transfer();
    fire(grip, 'dragstart', dt);
    expect(JSON.parse(dt.getData(DRAG_TYPE))).toEqual([name]);
    expect(dt.effectAllowed).toBe('move');
    const over = fire(target, 'dragover', dt);
    expect(over.defaultPrevented).toBe(true);
    expect(target.classList.contains('rg-drop-over')).toBe(true);
    fire(target, 'dragleave', dt);
    expect(target.classList.contains('rg-drop-over')).toBe(false);
    fire(target, 'dragover', dt);
    fire(target, 'drop', dt);
    expect(target.classList.contains('rg-drop-over')).toBe(false);
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect($('#rg-mv-title')!.textContent).toBe('Move 1 repository to thekonnen / ai');
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
  });

  it('dragging the handle of a selected row drags all selected; an unselected row drags just itself', async () => {
    const fc = await open('#infra/dagsrv', { edit: serverEdit() });
    (rowOf('kite-dagsrv').querySelector('.rg-check') as HTMLElement).click();
    (rowOf('dags-repo').querySelector('.rg-check') as HTMLElement).click();
    await vi.waitFor(() => expect($('.rg-selbar')?.textContent).toContain('2 selected'));
    const dt = transfer();
    fire(rowOf('kite-dagsrv').querySelector('.rg-grip')!, 'dragstart', dt);
    expect(JSON.parse(dt.getData(DRAG_TYPE)).sort()).toEqual(['dags-repo', 'kite-dagsrv']);
    fire(sideItem('ai'), 'drop', dt);
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect($('#rg-mv-title')!.textContent).toBe('Move 2 repositories to thekonnen / ai');
    expect(dialog()!.textContent).toContain('dags-repo');
    ($('#rg-mv-cancel') as HTMLElement).click();
    const dt2 = transfer();
    fire(rowOf('dagsrv').querySelector('.rg-grip')!, 'dragstart', dt2);
    expect(JSON.parse(dt2.getData(DRAG_TYPE))).toEqual(['dagsrv']);
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
  });

  it('dropping on "All groups" stages a move to Ungrouped', async () => {
    await open('#infra/dagsrv', { edit: serverEdit() });
    const dt = transfer();
    fire(rowOf('kite-dagsrv').querySelector('.rg-grip')!, 'dragstart', dt);
    fire(sideItem('All groups'), 'drop', dt);
    await vi.waitFor(() => expect($('#rg-mv-title')!.textContent).toBe('Move 1 repository to Ungrouped'));
  });

  it('ignores drags that are not repository drags', async () => {
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
  it('dragSource packs the selection when the row is selected; dropTarget stages the move with the path', () => {
    const calls: [string[], string[]][] = [];
    const ctl = { stageMove: (r: string[], to: string[]) => void calls.push([r, to]) };
    const dt = transfer();
    dragSource(() => ['a', 'x'], 'x').onDragStart({ dataTransfer: dt } as any);
    const el = document.createElement('div');
    dropTarget(ctl, ['a', 'b']).onDrop({ dataTransfer: dt, currentTarget: el, preventDefault() {} } as any);
    const solo = transfer();
    dragSource(() => ['a'], 'x').onDragStart({ dataTransfer: solo } as any);
    dropTarget(ctl, []).onDrop({ dataTransfer: solo, currentTarget: el, preventDefault() {} } as any);
    expect(calls).toEqual([[['a', 'x'], ['a', 'b']], [['x'], []]]);
  });
});
