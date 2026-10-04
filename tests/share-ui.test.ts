// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEdit } from '../src/core/edit';
import { findGroup } from '../src/core/placement';
import { mountOrgRepos, type Mounted } from '../src/features/mount';
import { DRAG_TYPE } from '../src/features/grouped-view/dnd';
import { example } from './fixtures';
import { fakeCall, memberAccess, repos as baseRepos } from './page-helpers';

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
const dialog = () => $('[role=alertdialog]');
const toast = () => $('.rg-toast')?.textContent ?? '';
const rowOf = (repo: string) => $$('.rg-root[data-rg="view"] .rg-row').find((r) => r.querySelector('.rg-row-title a')?.textContent?.replace(/^.* \/ /, '').trim() === repo)!;
const sideItem = (name: string) => $$('[data-rg="side"] .rg-nav-item').find((b) => b.querySelector('span')?.textContent === name)!;
const edits = (fc: { log: any[] }) => fc.log.filter((r) => r.type === 'org:edit').map((r) => r.edit);

/** The org file: the example, with `dagsrv` also listed in `ai`. */
const sharedConfig = () => {
  const cfg = example();
  findGroup(cfg.groups, ['ai'])!.shared = ['dagsrv'];
  return cfg;
};

/** The "server": applies the edit it receives to the shared example, like the background does. */
const server = (seen: any[] = []) => (req: any) => {
  seen.push(req.edit);
  const cfg = sharedConfig();
  const r = applyEdit(cfg.groups, req.edit) as any;
  return { status: 'ok', sha: 'sha-2', config: { ...cfg, groups: r.groups }, warnings: [] };
};

async function open(hash: string, opts: Parameters<typeof fakeCall>[0] = {}) {
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories' + hash);
  const fc = fakeCall({ config: { exists: true, sha: 'sha1', config: sharedConfig(), warnings: [] }, edit: server(), ...opts });
  mounted = (await mountOrgRepos('thekonnen', { call: fc.call }, document, 200))!;
  await vi.waitFor(() => expect($('.rg-g-head')).toBeTruthy());
  await vi.waitFor(() => expect($$('.rg-row').length).toBeGreaterThan(0));
  return fc;
}

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
const fire = (el: Element, type: string, dt: unknown, altKey = false) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: dt });
  Object.defineProperty(e, 'altKey', { value: altKey });
  el.dispatchEvent(e);
  return e;
};

async function menuTo(repo: string, entry: string) {
  (rowOf(repo).querySelector('.rg-kebab') as HTMLElement).click();
  await vi.waitFor(() => expect($('[role=menuitem]')).toBeTruthy());
  const item = $$('[role=menuitem]').find((m) => m.textContent === entry)!;
  item.click();
  await vi.waitFor(() => expect($('[role=listbox].rg-move-pop')).toBeTruthy());
  return $('[role=listbox].rg-move-pop')!;
}
const pick = (list: HTMLElement, key: string) => [...list.querySelectorAll('[role=option]')].find((o) => o.id === 'rg-mv-' + key)! as HTMLElement;

describe('shared rows (A3)', () => {
  it('show where the repo lives and have no checkbox, drag handle or menu', async () => {
    await open('#ai');
    const shared = rowOf('dagsrv');
    expect(shared.textContent).toContain('linked from infra / dagsrv');
    expect(shared.querySelector('.rg-check')).toBeNull();
    expect(shared.querySelector('.rg-grip')).toBeNull();
    expect(shared.querySelector('.rg-kebab')).toBeNull();
    expect(shared.querySelector('.rg-link-chip')!.getAttribute('title')).toBe('Linked from infra / dagsrv. Remove the link here, or move it from there.');
    // A primary row of the same page keeps all three.
    const own = rowOf('oroute');
    expect(own.querySelector('.rg-check')).toBeTruthy();
    expect(own.querySelector('.rg-grip')).toBeTruthy();
    expect(own.querySelector('.rg-kebab')).toBeTruthy();
  });

  it('select all ignores shared rows', async () => {
    await open('#ai');
    ($('.rg-box-head .rg-check') as HTMLInputElement).click();
    await vi.waitFor(() => expect($('.rg-selbar')).toBeTruthy());
    const n = $$('.rg-root[data-rg="view"] .rg-row .rg-check').length;
    expect($('.rg-selbar')!.textContent).toContain(`${n} selected`);
    expect(n).toBeGreaterThan(0);
    // dagsrv is shared here, so it is not among the selected rows.
    expect(rowOf('dagsrv').getAttribute('data-selected')).toBeNull();
  });
});

describe('Also list in… (A3)', () => {
  it('the row menu offers it next to Send to… and the picker has no Ungrouped', async () => {
    await open('#ai');
    (rowOf('oroute').querySelector('.rg-kebab') as HTMLElement).click();
    await vi.waitFor(() => expect($$('[role=menuitem]').map((m) => m.textContent)).toEqual(['Send to…', 'Also list in…']));
    $$('[role=menuitem]')[1].click();
    await vi.waitFor(() => expect($('[role=listbox].rg-move-pop')).toBeTruthy());
    const ids = [...$('[role=listbox].rg-move-pop')!.querySelectorAll('[role=option]')].map((o) => o.id);
    expect(ids).not.toContain('rg-mv-root');
    expect(ids).toContain('rg-mv-infra');
  });

  it('stages a confirmation, commits nothing before OK, then ONE share edit', async () => {
    const seen: any[] = [];
    const fc = await open('#ai', { edit: server(seen) });
    const list = await menuTo('oroute', 'Also list in…');
    pick(list, 'infra').click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
    expect($('#rg-mv-title')!.textContent).toBe('Also list 1 repository in thekonnen / infra');
    expect(dialog()!.textContent).toContain('Its home stays in ai; it will be listed here too');
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(edits(fc)).toHaveLength(1));
    await vi.waitFor(() => expect(toast()).toContain('Also listed oroute in infra'));
    expect(edits(fc)[0]).toMatchObject({ kind: 'share', repos: ['oroute'], to: ['infra'] });
    expect(dialog()).toBeNull();
  });

  it('the selection bar has it too, and several repositories are one commit', async () => {
    const fc = await open('#infra/dagsrv');
    (rowOf('kite-dagsrv').querySelector('.rg-check') as HTMLElement).click();
    (rowOf('dags-repo').querySelector('.rg-check') as HTMLElement).click();
    await vi.waitFor(() => expect($('.rg-selbar')?.textContent).toContain('2 selected'));
    const bar = $('.rg-selbar')!;
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Send to…', 'Also list in…', 'Clear']);
    ([...bar.querySelectorAll('button')].find((b) => b.textContent === 'Also list in…') as HTMLElement).click();
    await vi.waitFor(() => expect($('[role=listbox].rg-move-pop')).toBeTruthy());
    pick($('[role=listbox].rg-move-pop')!, 'ai_llm-proxy').click();
    await vi.waitFor(() => expect($('#rg-mv-title')?.textContent).toBe('Also list 2 repositories in thekonnen / ai / llm-proxy'));
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(edits(fc)).toHaveLength(1));
    expect(edits(fc)[0].kind).toBe('share');
    expect([...edits(fc)[0].repos].sort()).toEqual(['dags-repo', 'kite-dagsrv']);
  });

  it('Alt-drag onto a group stages a share instead of a move (copy effect), and a plain drag still moves', async () => {
    const fc = await open('#ai');
    const grip = rowOf('oroute').querySelector('.rg-grip')!;
    const dt = transfer();
    fire(grip, 'dragstart', dt);
    expect(JSON.parse(dt.getData(DRAG_TYPE))).toEqual(['oroute']);
    const target = sideItem('infra');
    const over = fire(target, 'dragover', dt, true);
    expect(over.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe('copy');
    expect(target.classList.contains('rg-drop-copy')).toBe(true);
    fire(target, 'drop', dt, true);
    await vi.waitFor(() => expect($('#rg-mv-title')?.textContent).toBe('Also list 1 repository in thekonnen / infra'));
    expect(target.classList.contains('rg-drop-copy')).toBe(false);
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
    ($('#rg-mv-cancel') as HTMLElement).click();
    const dt2 = transfer();
    fire(grip, 'dragstart', dt2);
    expect(fire(target, 'dragover', dt2).defaultPrevented).toBe(true);
    expect(dt2.dropEffect).toBe('move');
    fire(target, 'drop', dt2);
    await vi.waitFor(() => expect($('#rg-mv-title')?.textContent).toBe('Move 1 repository to thekonnen / infra'));
  });

  it('Alt-drag onto "All groups" (Ungrouped) is not a drop target', async () => {
    await open('#ai');
    const dt = transfer();
    fire(rowOf('oroute').querySelector('.rg-grip')!, 'dragstart', dt);
    const over = fire(sideItem('All groups'), 'dragover', dt, true);
    expect(over.defaultPrevented).toBe(false);
    fire(sideItem('All groups'), 'drop', dt, true);
    expect(dialog()).toBeNull();
  });

  it('says nothing to commit, with no OK, when the group already lists or contains every repo', async () => {
    const fc = await open('#infra/dagsrv');
    const list = await menuTo('dagsrv', 'Also list in…');
    pick(list, 'ai').click(); // ai already lists dagsrv through its shared rule
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialog()!.textContent).toContain('Already listed in ai, skipped: dagsrv');
    expect(dialog()!.textContent).toContain('There is nothing to commit.');
    expect($('#rg-mv-ok')).toBeNull();
    ($('#rg-mv-cancel') as HTMLElement).click();
    const l2 = await menuTo('dagsrv', 'Also list in…');
    pick(l2, 'infra').click(); // its home is below infra
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Already live in infra or below it, skipped: dagsrv'));
    expect($('#rg-mv-ok')).toBeNull();
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
  });
});

describe('Move with shared memberships (A3)', () => {
  it('already listed through a shared rule: says so, and OK moves it and drops the redundant name', async () => {
    const seen: any[] = [];
    const fc = await open('#infra/dagsrv', { edit: server(seen) });
    const list = await menuTo('dagsrv', 'Send to…');
    pick(list, 'ai').click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialog()!.textContent).toContain('Already listed here through a shared rule. Moving makes it live here');
    expect($('#rg-mv-title')!.textContent).toBe('Move 1 repository to thekonnen / ai');
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(edits(fc)).toHaveLength(1));
    const result = applyEdit(sharedConfig().groups, edits(fc)[0]) as any;
    expect(findGroup(result.groups, ['ai'])!.match).toContain('dagsrv');
    expect(findGroup(result.groups, ['ai'])!.shared).toBeUndefined();
  });

  it('to Ungrouped it offers to stop listing the repo in groups that share it (checked by default), and passes the choice', async () => {
    const fc = await open('#infra/dagsrv');
    let list = await menuTo('dagsrv', 'Send to…');
    pick(list, 'root').click();
    await vi.waitFor(() => expect($('#rg-mv-drop-shared')).toBeTruthy());
    const box = $('#rg-mv-drop-shared') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.closest('label')!.textContent).toContain('Also stop listing it in groups that share it (1)');
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(edits(fc)).toHaveLength(1));
    expect(edits(fc)[0]).toMatchObject({ kind: 'move', repos: ['dagsrv'], to: [], dropShared: true });
    const result = applyEdit(sharedConfig().groups, edits(fc)[0]) as any;
    expect(findGroup(result.groups, ['ai'])!.shared).toBeUndefined();
  });

  it('unchecking the box sends no dropShared', async () => {
    const fc = await open('#infra/dagsrv');
    const list = await menuTo('dagsrv', 'Send to…');
    pick(list, 'root').click();
    await vi.waitFor(() => expect($('#rg-mv-drop-shared')).toBeTruthy());
    ($('#rg-mv-drop-shared') as HTMLInputElement).click();
    await vi.waitFor(() => expect(($('#rg-mv-drop-shared') as HTMLInputElement).checked).toBe(false));
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(edits(fc)).toHaveLength(1));
    expect(edits(fc)[0].dropShared).toBeUndefined();
  });

  it('pattern and topic shared rules are only warned about, never offered for removal', async () => {
    const cfg = example();
    findGroup(cfg.groups, ['ai'])!.shared = ['topic:backend'];
    const list: any[] = baseRepos.map((r) => (r.name === 'dagsrv' ? { ...r, topics: ['backend'] } : r));
    await open('#infra/dagsrv', { repos: list, config: { exists: true, sha: 's', config: cfg, warnings: [] } });
    const picker = await menuTo('dagsrv', 'Send to…');
    pick(picker, 'root').click();
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('A shared rule still lists this repository'));
    expect(dialog()!.textContent).toContain('rule topic:backend');
    expect($('#rg-mv-drop-shared')).toBeNull();
  });

  it('notes how the target team access changes with the new home, for moves only', async () => {
    await open('#infra/dagsrv');
    const picker = await menuTo('kite-dagsrv', 'Send to…');
    pick(picker, 'ai').click();
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Team access targets change.'));
    const text = dialog()!.textContent!;
    expect(text).toContain('core_team: Write -> no access target');
    expect(text).toContain('ai-squad: no access target -> Maintain');
    expect(text).toContain('Nothing is granted or removed by a move');
  });

  it('an Also list in… dialog has no team note: the home does not change', async () => {
    await open('#ai');
    const l2 = await menuTo('oroute', 'Also list in…');
    pick(l2, 'infra').click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialog()!.textContent).not.toContain('Team access targets');
  });
});

const linkButton = (repo: string) => rowOf(repo).querySelector('.rg-unlink') as HTMLButtonElement | null;

describe('linked rows (A3)', () => {
  it('show the link icon, a distinct look and a "linked from" chip that opens the original', async () => {
    await open('#ai');
    const row = rowOf('dagsrv');
    expect(row.classList.contains('rg-linked')).toBe(true);
    expect(row.querySelector('.rg-av-link svg')).toBeTruthy();
    expect(rowOf('oroute').classList.contains('rg-linked')).toBe(false);
    expect(rowOf('oroute').querySelector('.rg-av-link')).toBeNull();
    (row.querySelector('.rg-link-chip') as HTMLElement).click();
    await vi.waitFor(() => expect(window.location.hash).toBe('#infra/dagsrv'));
    await vi.waitFor(() => expect(rowOf('dagsrv').classList.contains('rg-linked')).toBe(false)); // the real member
  });

  it('the chip of an ungrouped original opens the Ungrouped tab', async () => {
    const cfg = example();
    findGroup(cfg.groups, ['ai'])!.shared = ['keep_alive_job'];
    await open('#ai', { config: { exists: true, sha: 's', config: cfg, warnings: [] } });
    expect(rowOf('keep_alive_job').querySelector('.rg-link-chip')!.textContent).toContain('linked from Ungrouped');
    (rowOf('keep_alive_job').querySelector('.rg-link-chip') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 50));
    expect($('[role=tab][aria-selected=true]')?.textContent).toContain('Ungrouped');
  });

  it('"Remove link" is only there for people who can write the org file', async () => {
    await open('#ai');
    const b = linkButton('dagsrv')!;
    expect(b.getAttribute('aria-label')).toBe('Remove link to dagsrv from ai');
    expect(b.textContent).toContain('Remove link');
    mounted?.dispose();
    document.documentElement.innerHTML = body;
    await open('#ai', { access: memberAccess });
    expect(linkButton('dagsrv')).toBeNull();
    expect(rowOf('dagsrv').querySelector('.rg-link-chip')).toBeTruthy(); // the link itself is still visible
  });

  it('Cancel and Esc commit nothing; OK sends exactly one unshare edit and the home is untouched', async () => {
    const seen: any[] = [];
    const fc = await open('#ai', { edit: server(seen) });
    linkButton('dagsrv')!.click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialog()!.getAttribute('role')).toBe('alertdialog');
    expect($('#rg-mv-title')!.textContent).toBe('Remove link from thekonnen / ai');
    expect(dialog()!.textContent).toContain('dagsrv stays in infra / dagsrv; it just stops being listed here.');
    ($('#rg-mv-cancel') as HTMLElement).click();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    linkButton('dagsrv')!.click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
    linkButton('dagsrv')!.click();
    await vi.waitFor(() => expect($('#rg-mv-ok')).toBeTruthy());
    expect($('#rg-mv-ok')!.textContent).toBe('OK, commit to repo-groups.yml');
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(toast()).toContain('Stopped listing dagsrv in ai'));
    expect(edits(fc)).toHaveLength(1);
    expect(edits(fc)[0]).toMatchObject({ kind: 'unshare', repos: ['dagsrv'], from: ['ai'] });
    const after = applyEdit(sharedConfig().groups, edits(fc)[0]) as any;
    expect(findGroup(after.groups, ['ai'])!.shared).toBeUndefined();
    expect(findGroup(after.groups, ['infra', 'dagsrv'])!.match).toEqual(['dagsrv', 'dags-*', 'kite-dagsrv']);
    await vi.waitFor(() => expect($$('.rg-root[data-rg="view"] .rg-row').some((r) => r.classList.contains('rg-linked'))).toBe(false));
  });

  it('a failed commit keeps the dialog open with the error inline', async () => {
    const fc = await open('#ai', {
      edit: () => {
        throw new Error('You cannot write to thekonnen/.github.');
      },
    });
    linkButton('dagsrv')!.click();
    await vi.waitFor(() => expect($('#rg-mv-ok')).toBeTruthy());
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(dialog()!.querySelector('.rg-error')?.textContent).toContain('You cannot write'));
    expect(toast()).toBe('');
    expect(edits(fc)).toHaveLength(1);
  });

  it('a link that only comes from a rule explains it and offers Edit group instead of OK', async () => {
    const cfg = example();
    findGroup(cfg.groups, ['ai'])!.shared = ['topic:backend'];
    const list: any[] = baseRepos.map((r) => (r.name === 'dagsrv' ? { ...r, topics: ['backend'] } : r));
    const fc = await open('#ai', { repos: list, config: { exists: true, sha: 's', config: cfg, warnings: [] } });
    linkButton('dagsrv')!.click();
    await vi.waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialog()!.textContent).toContain('dagsrv is listed here by the shared rule `topic:backend` of ai. Remove or narrow that rule in Edit group.');
    expect($('#rg-mv-ok')).toBeNull();
    ($('#rg-mv-edit') as HTMLElement).click();
    await vi.waitFor(() => expect($('#rg-f-shared')).toBeTruthy());
    expect(dialog()).toBeNull();
    expect(fc.log.some((r) => r.type === 'org:edit')).toBe(false);
  });

  it('an exact entry plus a rule: OK removes the entry and the dialog warns about the rule', async () => {
    const cfg = example();
    findGroup(cfg.groups, ['ai'])!.shared = ['dagsrv', 'topic:backend'];
    const list: any[] = baseRepos.map((r) => (r.name === 'dagsrv' ? { ...r, topics: ['backend'] } : r));
    const seen: any[] = [];
    const fc = await open('#ai', { repos: list, config: { exists: true, sha: 's', config: cfg, warnings: [] }, edit: server(seen) });
    linkButton('dagsrv')!.click();
    await vi.waitFor(() => expect($('#rg-mv-ok')).toBeTruthy());
    expect(dialog()!.textContent).toContain('`topic:backend`');
    expect(dialog()!.textContent).toContain('still lists it');
    ($('#rg-mv-ok') as HTMLElement).click();
    await vi.waitFor(() => expect(edits(fc)).toHaveLength(1));
    expect(edits(fc)[0]).toMatchObject({ kind: 'unshare', from: ['ai'] });
  });
});
