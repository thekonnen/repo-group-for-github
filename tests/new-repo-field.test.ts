// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountNewRepo, mountRepoToast, type Disposable } from '../src/features/new-repo-field/mount';
import { findOwnerLogin, locateNewRepo } from '../src/github/selectors';
import type { Request } from '../src/github/messages';
import { example } from './fixtures';
import { memberAccess, ownerAccess, repos } from './page-helpers';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/new-repo.html'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
let mounted: Disposable | null = null;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const nameInput = () => $('#repository-name-input') as HTMLInputElement;
const type = (v: string) => ((nameInput().value = v), nameInput().dispatchEvent(new Event('input', { bubbles: true })));
const clean = (el: Element, drop: string) => {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll(drop).forEach((n) => n.remove());
  return c;
};
const dest = () => {
  const box = clean($('#rg-nr-dest')!, '.rg-mini-av, .rg-nr-warn svg');
  box.querySelectorAll('[aria-hidden]').forEach((n) => (n.textContent = ' / '));
  const path = box.querySelector('.rg-dest-path')!.textContent!;
  const hint = (box.querySelector('.rg-hint') ?? box.querySelector('.rg-nr-warn'))!.textContent!;
  return `${path} ${hint}`.replace(/\s+/g, ' ').trim();
};
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const pop = () => $('#rg-nr-pop') as HTMLElement;
const active = () => pop().getAttribute('aria-activedescendant');

function fake(opts: { access?: any; config?: any } = {}) {
  const log: Request[] = [];
  const call = vi.fn(async (req: Request): Promise<any> => {
    log.push(req);
    switch (req.type) {
      case 'org:config': return opts.config ?? { exists: true, sha: 's', config: example(), warnings: [] };
      case 'org:cached': return { repos, meta: {} };
      case 'org:access': return opts.access ?? ownerAccess;
      case 'newrepo:discard': return { discarded: true };
      case 'newrepo:pending': return { saved: true };
      default: throw new Error('unexpected ' + req.type);
    }
  });
  return { call: call as any, log };
}

async function open(url = '/organizations/thekonnen/repositories/new', opts: Parameters<typeof fake>[0] = {}, org: string | null = 'thekonnen') {
  window.history.replaceState(null, '', url);
  const f = fake(opts);
  mounted = await mountNewRepo(org, { call: f.call, location: window.location }, document, 200);
  return f;
}
const ready = () => vi.waitFor(() => expect($('#rg-nr-picker')).toBeTruthy());

beforeEach(() => {
  document.documentElement.innerHTML = html;
});
afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.documentElement.innerHTML = '';
});

describe('injection (F9)', () => {
  it('places the Group block directly under the "0 / 350 characters" counter', async () => {
    await open();
    await ready();
    const counter = $('#counter')!;
    expect(counter.nextElementSibling).toBe($('.rg-nr-host'));
    expect($('.rg-nr-host')!.parentElement).toBe($('#desc-field'));
    expect($('#rg-nr-label')!.textContent).toBe('Group');
    expect($('.rg-ext-tag')!.textContent).toBe('Repository Group');
    expect($$('section')[0].contains($('.rg-nr-host'))).toBe(true);
  });
  it('injects nothing and does not throw when the Description field is missing', async () => {
    $('#desc-field')!.remove();
    expect(locateNewRepo(document)).toBeNull();
    const f = await open();
    expect(mounted).toBeNull();
    expect($('.rg-nr-host')).toBeNull();
    expect(f.log).toHaveLength(0);
  });
  it('falls back to the Description input when the counter is missing', async () => {
    $('#counter')!.remove();
    await open();
    await ready();
    expect($('#repository_description')!.nextElementSibling).toBe($('.rg-nr-host'));
  });
  it('stays hidden for an org without repo-groups.yml', async () => {
    await open(undefined, { config: { exists: false } });
    await vi.waitFor(() => expect(mounted).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect($('.rg-nr-host')!.hidden).toBe(true);
    expect($('#rg-nr-picker')).toBeNull();
  });
  it('reads the owner from the dropdown on /new', () => {
    expect(findOwnerLogin(document)).toBe('thekonnen');
  });
  it('on /new, uses the Owner dropdown to pick the org', async () => {
    const f = await open('/new', {}, null);
    await ready();
    expect(f.log.find((r) => r.type === 'org:config')).toMatchObject({ org: 'thekonnen' });
  });
});

describe('live destination (F9)', () => {
  it('follows the name typed in GitHub\'s own input, with GitHub\'s normalization', async () => {
    await open();
    await ready();
    expect(dest()).toContain('thekonnen / new-repository');
    expect(dest()).toContain('Type a name');
    type('dags-new');
    await vi.waitFor(() => expect(dest()).toContain('thekonnen / infra / dagu / dags-new'));
    expect(dest()).toContain('Lands here because it matches the rule dags-*. Pick another group to override.');
    type('brand new!');
    await vi.waitFor(() => expect(dest()).toContain('thekonnen / brand-new Not in any group yet.'));
    expect(dest()).toContain('No rule matches this name yet, so it will show under Ungrouped.');
    // evidenced as a warning, and only in this case
    expect(document.querySelector('#rg-nr-dest .rg-nr-warn')!.textContent).toContain('No rule matches this name yet');
    type('dags-new');
    await vi.waitFor(() => expect(dest()).toContain('thekonnen / infra / dagu / dags-new'));
    expect(document.querySelector('#rg-nr-dest .rg-nr-warn')).toBeNull();
  });
  it('shows Automatic with the group the rules would pick', async () => {
    await open();
    await ready();
    type('dags-x');
    await vi.waitFor(() => expect($('#rg-nr-picker-lbl')!.textContent).toBe('Automatic → infra / dagu'));
  });
});

describe('picker (F9)', () => {
  it('is a listbox with Automatic first, then every group indented, with counts', async () => {
    await open();
    await ready();
    const btn = $('#rg-nr-picker')!;
    expect(btn.getAttribute('aria-haspopup')).toBe('listbox');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(pop().getAttribute('role')).toBe('listbox');
    const opts = $$('#rg-nr-pop [role="option"]');
    expect(opts.map((o) => clean(o, '.rg-mini-av, .rg-tick').textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Automatic · by match rules', 'infra6', 'dagu3', 'authentik2', 'checkmate1', 'ai3', 'litellm2',
    ]);
    expect(opts[0].getAttribute('aria-selected')).toBe('true');
    expect(opts[2].style.paddingLeft).toBe('26px');
  });

  it('opens with the arrow keys, moves with arrows/Home/End, selects with Enter and returns focus', async () => {
    await open();
    await ready();
    const btn = $('#rg-nr-picker') as HTMLButtonElement;
    btn.focus();
    key(btn, 'ArrowDown');
    await vi.waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('true'));
    expect(pop().hidden).toBe(false);
    expect(active()).toBe('rg-opt-auto');
    key(pop(), 'ArrowDown');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-infra'));
    key(pop(), 'ArrowDown');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-infra_dagu'));
    key(pop(), 'End');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-ai_litellm'));
    key(pop(), 'ArrowDown');
    expect(active()).toBe('rg-opt-ai_litellm'); // clamped
    key(pop(), 'Home');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-auto'));
    key(pop(), 'ArrowUp');
    expect(active()).toBe('rg-opt-auto');
    key(pop(), 'End');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-ai_litellm'));
    key(pop(), 'ArrowUp');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-ai'));
    key(pop(), 'Enter');
    await vi.waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('false'));
    expect(btn.textContent).toContain('ai');
    expect(document.activeElement).toBe(btn);
    expect($$('#rg-nr-pop [role="option"]')[5].getAttribute('aria-selected')).toBe('true');
  });

  it('with a rule hit, opening the list marks and focuses the group the rules chose', async () => {
    await open();
    await ready();
    type('dags-new');
    await vi.waitFor(() => expect(dest()).toContain('Lands here'));
    const btn = $('#rg-nr-picker') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    expect(active()).toBe('rg-opt-infra_dagu');
    const row = $('#rg-opt-infra_dagu')!;
    expect(row.classList.contains('rg-auto-pick')).toBe(true);
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.textContent).toContain('matched by dags-*');
    expect(row.querySelector('.rg-tick svg')).toBeTruthy();
    expect($('#rg-opt-auto')!.getAttribute('aria-selected')).toBe('true'); // single selection: still Automatic
    expect($$('#rg-nr-pop .rg-auto-pick')).toHaveLength(1);
    // picking another group removes the marker and selects that group
    key(pop(), 'ArrowDown');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-infra_authentik'));
    key(pop(), 'Enter');
    await vi.waitFor(() => expect(pop().hidden).toBe(true));
    expect($$('#rg-nr-pop .rg-auto-pick')).toHaveLength(0);
    expect($('#rg-opt-infra_authentik')!.getAttribute('aria-selected')).toBe('true');
  });
  it('with no rule hit nothing is marked and the cursor starts on Automatic', async () => {
    await open();
    await ready();
    type('brand-new');
    await vi.waitFor(() => expect(dest()).toContain('Not in any group yet.'));
    ($('#rg-nr-picker') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    expect(active()).toBe('rg-opt-auto');
    expect($$('#rg-nr-pop .rg-auto-pick')).toHaveLength(0);
  });

  it('Escape closes without changing the pick, Tab closes, a click picks', async () => {
    await open();
    await ready();
    const btn = $('#rg-nr-picker') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    key(pop(), 'ArrowDown');
    key(pop(), 'Escape');
    await vi.waitFor(() => expect(pop().hidden).toBe(true));
    expect(btn.textContent).toContain('Automatic');
    expect(document.activeElement).toBe(btn);
    btn.click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    key(pop(), 'Tab');
    await vi.waitFor(() => expect(pop().hidden).toBe(true));
    btn.click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    ($$('#rg-nr-pop [role="option"]')[2] as HTMLElement).click();
    await vi.waitFor(() => expect(btn.textContent).toContain('infra / dagu'));
  });

  it('explains a different pick and an already-matching pick', async () => {
    await open();
    await ready();
    type('konnen-authentik');
    const btn = $('#rg-nr-picker') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    ($$('#rg-nr-pop [role="option"]')[2] as HTMLElement).click(); // infra / dagu
    await vi.waitFor(() => expect(dest()).toContain('Adds konnen-authentik to the match list of infra / dagu in repo-groups.yml (otherwise it would land in infra / authentik).'));
    btn.click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    ($$('#rg-nr-pop [role="option"]')[3] as HTMLElement).click(); // infra / authentik
    await vi.waitFor(() => expect(dest()).toContain('Already matches the rule *authentik* of this group. repo-groups.yml stays the same.'));
  });

  it('preselects the group of ?rg_group=', async () => {
    await open('/organizations/thekonnen/repositories/new?rg_group=infra%2Fdagu');
    await ready();
    expect($('#rg-nr-picker')!.textContent).toContain('infra / dagu');
    expect($$('#rg-nr-pop [role="option"]')[2].getAttribute('aria-selected')).toBe('true');
    expect(dest()).toContain('thekonnen / infra / dagu / new-repository');
  });
  it('ignores an unknown ?rg_group=', async () => {
    await open('/organizations/thekonnen/repositories/new?rg_group=nope');
    await ready();
    expect($('#rg-nr-picker')!.textContent).toContain('Automatic');
  });
});

describe('members (F15)', () => {
  it('does not offer org filing and says why', async () => {
    const f = await open('/organizations/thekonnen/repositories/new?rg_group=infra', { access: memberAccess });
    await vi.waitFor(() => expect($('#rg-nr-note')).toBeTruthy());
    expect($('#rg-nr-picker')).toBeNull();
    expect($('#rg-nr-note')!.textContent).toContain('read-only for you');
    type('konnen-x');
    $('#create')!.click();
    const pending = f.log.find((r) => r.type === 'newrepo:pending') as any;
    expect(pending.entry).toMatchObject({ explicit: false, groupPath: '' });
  });
});

describe('submit (F9)', () => {
  it('discards a stale entry on load and saves the choice without blocking the form', async () => {
    const f = await open();
    await ready();
    expect(f.log[0]).toEqual({ type: 'newrepo:discard' });
    type('konnen-n8n');
    $('#rg-nr-picker')!.click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    ($$('#rg-nr-pop [role="option"]')[2] as HTMLElement).click();
    await vi.waitFor(() => expect($('#rg-nr-picker')!.textContent).toContain('infra / dagu'));

    const form = $('#new_repository') as HTMLFormElement;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false); // GitHub's form goes on
    const pending = f.log.filter((r) => r.type === 'newrepo:pending') as any[];
    expect(pending).toHaveLength(1);
    expect(pending[0].entry).toEqual({ org: 'thekonnen', repo: 'konnen-n8n', groupPath: 'infra/dagu', explicit: true, teams: [{ slug: 'konnen_team', permission: 'push' }] });
  });
  it('saves the normalized name, and an Automatic choice as not explicit', async () => {
    const f = await open();
    await ready();
    type('my new repo');
    await vi.waitFor(() => expect(dest()).toContain('my-new-repo'));
    $('#create')!.click();
    const pending = f.log.find((r) => r.type === 'newrepo:pending') as any;
    expect(pending.entry).toMatchObject({ repo: 'my-new-repo', groupPath: '', explicit: false });
  });
  it('saves nothing without a name', async () => {
    const f = await open();
    await ready();
    $('#create')!.click();
    expect(f.log.some((r) => r.type === 'newrepo:pending')).toBe(false);
  });
  it('stops listening after dispose', async () => {
    const f = await open();
    await ready();
    type('x1');
    mounted!.dispose();
    mounted = null;
    f.log.length = 0;
    $('#create')!.click();
    expect(f.log).toHaveLength(0);
    expect($('.rg-nr-host')).toBeNull();
  });
});

describe('toast on the repo page (F9)', () => {
  const landed = (data: unknown) => vi.fn(async (req: Request): Promise<any> => (req.type === 'newrepo:landed' ? data : null));
  afterEach(() => {
    document.body.innerHTML = '';
  });
  it('shows where the repo was filed', async () => {
    const call = landed({ groupKey: 'infra/dagu', committed: true, teams: [] });
    mounted = await mountRepoToast('thekonnen', 'konnen-n8n', { call: call as any });
    expect(call).toHaveBeenCalledWith({ type: 'newrepo:landed', org: 'thekonnen', repo: 'konnen-n8n' });
    const t = $('.rg-toast')!;
    expect(t.getAttribute('role')).toBe('status');
    expect(t.textContent).toBe('Filed in infra / dagu · repo-groups.yml updated');
  });
  it('says so when the commit failed', async () => {
    mounted = await mountRepoToast('o', 'r', { call: landed({ groupKey: 'infra/dagu', committed: false, error: 'You cannot write to o/.github.', teams: [] }) as any });
    expect($('.rg-toast.rg-err')!.textContent).toContain('repo-groups.yml was not updated');
  });
  it('shows nothing when no entry was pending, or when the call fails', async () => {
    expect(await mountRepoToast('o', 'r', { call: landed(null) as any })).toBeNull();
    expect(await mountRepoToast('o', 'r', { call: vi.fn(async () => { throw new Error('x'); }) as any })).toBeNull();
    expect($('.rg-toast')).toBeNull();
  });
  it('goes away by itself', async () => {
    mounted = await mountRepoToast('o', 'r', { call: landed({ groupKey: '', committed: false, teams: [] }) as any }, document, 10);
    await vi.waitFor(() => expect($('.rg-toast')).toBeNull());
  });
});
