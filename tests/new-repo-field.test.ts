// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountNewRepo, mountRepoToast, type Disposable } from '../src/features/new-repo-field/mount';
import { findOwnerLogin, locateNewRepo } from '../src/github/selectors';
import type { Request } from '../src/github/messages';
import { applyEdit } from '../src/core/edit';
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

function fake(opts: { access?: any; config?: any; extra?: (req: Request) => any } = {}) {
  const log: Request[] = [];
  const call = vi.fn(async (req: Request): Promise<any> => {
    log.push(req);
    switch (req.type) {
      case 'org:config': return opts.config ?? { exists: true, sha: 's', config: example(), warnings: [] };
      case 'org:cached': return { repos, meta: {} };
      case 'org:access': return opts.access ?? ownerAccess;
      case 'newrepo:discard': return { discarded: true };
      case 'newrepo:pending': return { saved: true };
      default:
        if (opts.extra) return opts.extra(req);
        throw new Error('unexpected ' + req.type);
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
    await vi.waitFor(() => expect(dest()).toContain('thekonnen / infra / dagsrv / dags-new'));
    expect(dest()).toContain('Lands here because it matches the rule dags-*. Pick another group to override.');
    type('brand new!');
    await vi.waitFor(() => expect(dest()).toContain('thekonnen / brand-new Not in any group yet.'));
    expect(dest()).toContain('No rule matches this name yet, so it will show under Ungrouped.');
    // evidenced as a warning, and only in this case
    expect(document.querySelector('#rg-nr-dest .rg-nr-warn')!.textContent).toContain('No rule matches this name yet');
    type('dags-new');
    await vi.waitFor(() => expect(dest()).toContain('thekonnen / infra / dagsrv / dags-new'));
    expect(document.querySelector('#rg-nr-dest .rg-nr-warn')).toBeNull();
  });
  it('shows Automatic with the group the rules would pick', async () => {
    await open();
    await ready();
    type('dags-x');
    await vi.waitFor(() => expect($('#rg-nr-picker-lbl')!.textContent).toBe('Automatic → infra / dagsrv'));
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
      'Automatic · by match rules', 'infra6', 'dagsrv3', 'authn2', 'cmonitor1', 'ai3', 'llm-proxy2',
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
    await vi.waitFor(() => expect(active()).toBe('rg-opt-infra_dagsrv'));
    key(pop(), 'End');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-ai_llm-proxy'));
    key(pop(), 'ArrowDown');
    expect(active()).toBe('rg-opt-ai_llm-proxy'); // clamped
    key(pop(), 'Home');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-auto'));
    key(pop(), 'ArrowUp');
    expect(active()).toBe('rg-opt-auto');
    key(pop(), 'End');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-ai_llm-proxy'));
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
    expect(active()).toBe('rg-opt-infra_dagsrv');
    const row = $('#rg-opt-infra_dagsrv')!;
    expect(row.classList.contains('rg-auto-pick')).toBe(true);
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.textContent).toContain('matched by dags-*');
    expect(row.querySelector('.rg-tick svg')).toBeTruthy();
    expect($('#rg-opt-auto')!.getAttribute('aria-selected')).toBe('true'); // single selection: still Automatic
    expect($$('#rg-nr-pop .rg-auto-pick')).toHaveLength(1);
    // picking another group removes the marker and selects that group
    key(pop(), 'ArrowDown');
    await vi.waitFor(() => expect(active()).toBe('rg-opt-infra_authn'));
    key(pop(), 'Enter');
    await vi.waitFor(() => expect(pop().hidden).toBe(true));
    expect($$('#rg-nr-pop .rg-auto-pick')).toHaveLength(0);
    expect($('#rg-opt-infra_authn')!.getAttribute('aria-selected')).toBe('true');
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
    await vi.waitFor(() => expect(btn.textContent).toContain('infra / dagsrv'));
  });

  it('explains a different pick and an already-matching pick', async () => {
    await open();
    await ready();
    type('kite-authn');
    const btn = $('#rg-nr-picker') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    ($$('#rg-nr-pop [role="option"]')[2] as HTMLElement).click(); // infra / dagsrv
    await vi.waitFor(() => expect(dest()).toContain('Adds kite-authn to the match list of infra / dagsrv in repo-groups.yml (otherwise it would land in infra / authn).'));
    btn.click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    ($$('#rg-nr-pop [role="option"]')[3] as HTMLElement).click(); // infra / authn
    await vi.waitFor(() => expect(dest()).toContain('Already matches the rule *authn* of this group. repo-groups.yml stays the same.'));
  });

  it('preselects the group of ?rg_group=', async () => {
    await open('/organizations/thekonnen/repositories/new?rg_group=infra%2Fdagsrv');
    await ready();
    expect($('#rg-nr-picker')!.textContent).toContain('infra / dagsrv');
    expect($$('#rg-nr-pop [role="option"]')[2].getAttribute('aria-selected')).toBe('true');
    expect(dest()).toContain('thekonnen / infra / dagsrv / new-repository');
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
    type('kite-x');
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
    type('kite-nflow');
    $('#rg-nr-picker')!.click();
    await vi.waitFor(() => expect(pop().hidden).toBe(false));
    ($$('#rg-nr-pop [role="option"]')[2] as HTMLElement).click();
    await vi.waitFor(() => expect($('#rg-nr-picker')!.textContent).toContain('infra / dagsrv'));

    const form = $('#new_repository') as HTMLFormElement;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false); // GitHub's form goes on
    const pending = f.log.filter((r) => r.type === 'newrepo:pending') as any[];
    expect(pending).toHaveLength(1);
    expect(pending[0].entry).toEqual({ org: 'thekonnen', repo: 'kite-nflow', groupPath: 'infra/dagsrv', explicit: true, teams: [{ slug: 'core_team', permission: 'push' }] });
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
    const call = landed({ groupKey: 'infra/dagsrv', committed: true, teams: [] });
    mounted = await mountRepoToast('thekonnen', 'kite-nflow', { call: call as any });
    expect(call).toHaveBeenCalledWith({ type: 'newrepo:landed', org: 'thekonnen', repo: 'kite-nflow' });
    const t = $('.rg-toast')!;
    expect(t.getAttribute('role')).toBe('status');
    expect(t.textContent).toBe('Filed in infra / dagsrv · repo-groups.yml updated');
  });
  it('says so when the commit failed', async () => {
    mounted = await mountRepoToast('o', 'r', { call: landed({ groupKey: 'infra/dagsrv', committed: false, error: 'You cannot write to o/.github.', teams: [] }) as any });
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

describe('classify by method (pills)', () => {
  const pill = (m: string) => $(`.rg-pill[data-method="${m}"]`) as HTMLButtonElement;
  const note = () => $('.rg-nr-method-note')?.textContent ?? '';
  const withAi = (suggest: (req: any) => any, configured = true) => ({
    extra: (req: Request) => {
      if (req.type === 'llm:status') return { configured };
      if (req.type === 'suggest:group') return suggest(req);
      throw new Error('unexpected ' + req.type);
    },
  });

  it('shows Rules lit and locked when a rule catches the name, and no pills for an empty name', async () => {
    await open();
    await ready();
    expect($('#rg-nr-methods')).toBeNull();
    type('dags-new');
    await vi.waitFor(() => expect(pill('rules')).toBeTruthy());
    expect(pill('rules').getAttribute('aria-pressed')).toBe('true');
    expect(pill('rules').disabled).toBe(true);
    expect(pill('keywords').getAttribute('aria-pressed')).toBe('false');
  });

  it('disables Rules when nothing matches the name', async () => {
    await open();
    await ready();
    type('zzz-brand-new');
    await vi.waitFor(() => expect(pill('rules')).toBeTruthy());
    expect(pill('rules').disabled).toBe(true);
    expect(pill('rules').getAttribute('aria-pressed')).toBe('false');
  });

  it('AI pill files the repo in the group the AI chose, lights up, and the picker follows', async () => {
    const f = await open(undefined, withAi(() => ({ source: 'llm', key: 'infra/dagsrv', model: 'm-1', score: 0, margin: 0, ranking: [] })));
    await ready();
    type('zzz-brand-new');
    await vi.waitFor(() => expect(pill('llm')).toBeTruthy());
    await vi.waitFor(() => expect(f.log.some((r) => r.type === 'llm:status')).toBe(true));
    pill('llm').click();
    await vi.waitFor(() => expect(pill('llm').getAttribute('aria-pressed')).toBe('true'));
    expect(f.log.find((r) => r.type === 'suggest:group')).toMatchObject({ org: 'thekonnen', repo: { name: 'zzz-brand-new' }, method: 'llm' });
    expect(note()).toContain('AI filed it in');
    expect(note()).toContain('(m-1)');
    expect($('#rg-nr-picker')!.textContent).toContain('infra / dagsrv');
    expect(f.log.find((r) => r.type === 'newrepo:pending')).toBeUndefined(); // only on submit
  });

  it('Keywords pill runs the local method and says so when it is not sure', async () => {
    const f = await open(undefined, withAi(() => ({ source: 'uncertain', key: null, score: 0, margin: 0, ranking: [] })));
    await ready();
    type('zzz-brand-new');
    await vi.waitFor(() => expect(pill('keywords')).toBeTruthy());
    pill('keywords').click();
    await vi.waitFor(() => expect(note()).toContain('Keywords is not sure'));
    expect(f.log.find((r) => r.type === 'suggest:group')).toMatchObject({ method: 'keywords' });
    expect(pill('keywords').getAttribute('aria-pressed')).toBe('false');
    expect($('#rg-nr-picker')!.textContent).toContain('Automatic');
  });

  it('AI without a key explains what to do and sends nothing', async () => {
    const f = await open(undefined, withAi(() => { throw new Error('must not be called'); }, false));
    await ready();
    type('zzz-brand-new');
    await vi.waitFor(() => expect(pill('llm')).toBeTruthy());
    await vi.waitFor(() => expect(f.log.some((r) => r.type === 'llm:status')).toBe(true));
    pill('llm').click();
    await vi.waitFor(() => expect(note()).toContain('Options > AI assistant'));
    expect(f.log.some((r) => r.type === 'suggest:group')).toBe(false);
  });

  it('shows why the AI failed and keeps the group unchanged', async () => {
    await open(undefined, withAi(() => ({ source: 'uncertain', key: null, score: 0, margin: 0, ranking: [], llmError: 'No Gemini model answered. Last error: quota' })));
    await ready();
    type('zzz-brand-new');
    await vi.waitFor(() => expect(pill('llm')).toBeTruthy());
    await vi.waitFor(() => expect(pill('llm').title).toMatch(/sends the name/));
    pill('llm').click();
    await vi.waitFor(() => expect(note()).toContain('quota'));
    expect($('.rg-nr-method-note')!.className).toContain('rg-warn');
    expect($('#rg-nr-picker')!.textContent).toContain('Automatic');
  });

  it('forgets the answer when the name changes, even if a slow one arrives later', async () => {
    let release!: (v: any) => void;
    await open(undefined, withAi(() => new Promise((r) => (release = r))));
    await ready();
    type('zzz-brand-new');
    await vi.waitFor(() => expect(pill('llm')).toBeTruthy());
    await vi.waitFor(() => expect(pill('llm').title).toMatch(/sends the name/));
    pill('llm').click();
    await vi.waitFor(() => expect(note()).toContain('Asking the AI'));
    type('zzz-other-name');
    await vi.waitFor(() => expect(note()).toBe(''));
    release({ source: 'llm', key: 'infra/dagsrv', model: 'm', score: 0, margin: 0, ranking: [] });
    await new Promise((r) => setTimeout(r, 10));
    expect($('#rg-nr-picker')!.textContent).toContain('Automatic');
    expect(note()).toBe('');
  });

  it('offers no pills to a member who cannot write the org file', async () => {
    await open(undefined, { access: memberAccess });
    await vi.waitFor(() => expect($('#rg-nr-note')).toBeTruthy());
    type('zzz-brand-new');
    await new Promise((r) => setTimeout(r, 10));
    expect($('#rg-nr-methods')).toBeNull();
  });
});

describe('new group from the AI and AI by default', () => {
  const pill = (m: string) => $(`.rg-pill[data-method="${m}"]`) as HTMLButtonElement;
  const note = () => $('.rg-nr-method-note')?.textContent ?? '';
  const NEW = { path: ['selfhosted-infra', 'storage'], titles: ['Self-hosted infra', 'Storage'], descriptions: ['Services you host yourself', 'Self-hosted storage services'] };

  /** Backend with a stateful groups file: org:edit really applies the edit, like a commit would. */
  function backend(opts: { auto?: boolean; suggest?: (req: any) => any } = {}) {
    let groups = example().groups;
    const edits: any[] = [];
    return {
      edits,
      extra: (req: Request): any => {
        if (req.type === 'llm:status') return { configured: true, auto: opts.auto ?? true };
        if (req.type === 'suggest:group') return (opts.suggest ?? (() => ({ source: 'uncertain', key: null, score: 0, margin: 0, ranking: [], newGroup: NEW, model: 'm-1' })))(req);
        if (req.type === 'org:edit') {
          edits.push(req.edit);
          const r = applyEdit(groups, req.edit);
          if ('error' in r) throw new Error(r.error);
          groups = r.groups;
          return { status: 'ok', sha: 's2', config: { version: 1, index: 'api', groups }, warnings: [] };
        }
        throw new Error('unexpected ' + req.type);
      },
    };
  }
  const settled = () => new Promise((r) => setTimeout(r, 30));

  it('suggests a new group when none fits, and creating it files the repo there', async () => {
    const b = backend();
    const f = await open(undefined, { extra: b.extra });
    await ready();
    type('minio');
    await vi.waitFor(() => expect(pill('llm').title).toMatch(/sends the name/));
    pill('llm').click();
    await vi.waitFor(() => expect($('.rg-create-group.rg-rec')).toBeTruthy());
    expect($('#rg-nr-proposal')!.textContent).toContain('Self-hosted infra');
    expect($('.rg-prop-seg.rg-last')!.textContent).toContain('Storage');
    expect($('#rg-nr-proposal')!.textContent).toContain('Self-hosted storage services');
    expect($('#rg-nr-picker')!.textContent).toContain('Automatic'); // nothing is created until asked
    expect(b.edits).toHaveLength(0);

    $('.rg-create-group.rg-rec')!.click();
    await vi.waitFor(() => expect($('#rg-nr-picker')!.textContent).toContain('Storage'));
    // parent first, then the child, each as a normal "new group" edit
    expect(b.edits.map((e) => [e.kind, e.parent, e.name, e.title])).toEqual([
      ['new', [], 'selfhosted-infra', 'Self-hosted infra'],
      ['new', ['selfhosted-infra'], 'storage', 'Storage'],
    ]);
    expect(b.edits[0].description).toBe('Services you host yourself'); // each level keeps its own sentence
    expect(b.edits[1].description).toBe('Self-hosted storage services');
    expect(note()).toContain('Created and filed');
    expect($('.rg-create-group.rg-rec')).toBeNull();
    expect(dest()).toContain('Adds minio to the match list of Self-hosted infra / Storage');
    const submit = f.log.filter((r) => r.type === 'newrepo:pending');
    expect(submit).toHaveLength(0); // filed when the form is submitted, as for any explicit pick
  });

  it('reuses a parent that already exists and creates only the missing part', async () => {
    const b = backend({ suggest: () => ({ source: 'uncertain', key: null, score: 0, margin: 0, ranking: [], newGroup: { path: ['infra', 'object-store'], titles: ['Infra', 'Object store'], descriptions: ['', 'd'] } }) });
    await open(undefined, { extra: b.extra });
    await ready();
    type('minio');
    await vi.waitFor(() => expect(pill('llm').title).toMatch(/sends the name/));
    pill('llm').click();
    await vi.waitFor(() => expect($('.rg-create-group.rg-rec')).toBeTruthy());
    $('.rg-create-group.rg-rec')!.click();
    await vi.waitFor(() => expect($('#rg-nr-picker')!.textContent).toContain('Object store'));
    expect(b.edits.map((e) => [e.parent, e.name])).toEqual([[['infra'], 'object-store']]);
  });

  it('shows the reason when the group cannot be created and leaves the choice alone', async () => {
    const b = backend();
    const extra = (req: Request) => (req.type === 'org:edit' ? { status: 'conflict', sha: 'x', config: null } : b.extra(req));
    await open(undefined, { extra });
    await ready();
    type('minio');
    await vi.waitFor(() => expect(pill('llm').title).toMatch(/sends the name/));
    pill('llm').click();
    await vi.waitFor(() => expect($('.rg-create-group.rg-rec')).toBeTruthy());
    $('.rg-create-group.rg-rec')!.click();
    await vi.waitFor(() => expect(note()).toContain('changed on GitHub'));
    expect($('#rg-nr-picker')!.textContent).toContain('Automatic');
  });

  const leave = () => nameInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  const aiCalls = (f: { log: Request[] }) => f.log.filter((r) => r.type === 'suggest:group') as any[];

  it('by default, asks the AI on its own once the person leaves the name field and no rule matches', async () => {
    const b = backend({ suggest: () => ({ source: 'llm', key: 'infra/dagsrv', model: 'm-1', score: 0, margin: 0, ranking: [] }) });
    const f = await open(undefined, { extra: b.extra });
    await ready();
    await vi.waitFor(() => expect(f.log.some((r) => r.type === 'llm:status')).toBe(true));
    type('zzz-brand-new');
    await settled();
    expect(aiCalls(f)).toHaveLength(0); // still typing: nothing is sent
    leave();
    await vi.waitFor(() => expect(pill('llm').getAttribute('aria-pressed')).toBe('true'));
    expect(aiCalls(f)[0]).toMatchObject({ method: 'llm', auto: true, repo: { name: 'zzz-brand-new' } });
    expect(note()).toContain('(by default)');
    expect($('#rg-nr-picker')!.textContent).toContain('infra / dagsrv');
  });

  it('D2: shows "Suggested: group - why" marked AI, applied, and sends the description', async () => {
    const b = backend({ suggest: () => ({ source: 'llm', key: 'infra/dagsrv', reason: 'DAG server code', score: 0, margin: 0, ranking: [] }) });
    const f = await open(undefined, { extra: b.extra });
    await ready();
    await vi.waitFor(() => expect(f.log.some((r) => r.type === 'llm:status')).toBe(true));
    const desc = document.querySelector('input[name="repository[description]"]') as HTMLInputElement;
    desc.value = 'Runs DAGs';
    type('zzz-brand-new');
    leave();
    await vi.waitFor(() => expect($('#rg-nr-suggestion')).toBeTruthy());
    const chip = $('#rg-nr-suggestion')!;
    expect(chip.getAttribute('data-source')).toBe('ai');
    expect(chip.textContent).toContain('AI');
    expect(chip.textContent).toContain('Suggested: infra / dagsrv');
    expect(chip.textContent).toContain('DAG server code');
    expect($('#rg-nr-suggestion-applied')).toBeTruthy();
    expect(aiCalls(f)[0].repo).toMatchObject({ name: 'zzz-brand-new', description: 'Runs DAGs' });
  });

  it('D2: when the AI fails, the keyword candidate is offered with Accept, not applied until accepted', async () => {
    const b = backend({ suggest: () => ({ source: 'uncertain', key: null, score: 0.1, margin: 0, ranking: [{ key: 'infra/dagsrv', score: 0.1 }], llmError: 'The AI did not answer within 4 seconds.', fallbackKey: 'infra/dagsrv' }) });
    const f = await open(undefined, { extra: b.extra });
    await ready();
    await vi.waitFor(() => expect(f.log.some((r) => r.type === 'llm:status')).toBe(true));
    type('zzz-brand-new');
    leave();
    await vi.waitFor(() => expect($('#rg-nr-accept')).toBeTruthy());
    expect($('#rg-nr-suggestion')!.getAttribute('data-source')).toBe('keywords');
    expect($('#rg-nr-picker')!.textContent).not.toContain('infra / dagsrv');
    ($('#rg-nr-accept') as HTMLButtonElement).click();
    await vi.waitFor(() => expect($('#rg-nr-picker')!.textContent).toContain('infra / dagsrv'));
    expect($('#rg-nr-accept')).toBeNull();
  });

  it('also asks after a pause in typing (2.5 s), once', async () => {
    const b = backend({ suggest: () => ({ source: 'llm', key: 'infra/dagsrv', score: 0, margin: 0, ranking: [] }) });
    const f = await open(undefined, { extra: b.extra });
    await ready();
    await vi.waitFor(() => expect(f.log.some((r) => r.type === 'llm:status')).toBe(true));
    type('zzz-brand-new');
    await new Promise((r) => setTimeout(r, 1500));
    expect(aiCalls(f)).toHaveLength(0);
    await vi.waitFor(() => expect(aiCalls(f)).toHaveLength(1), { timeout: 3000 });
  }, 8000);

  it('typing with pauses and leaving the field sends one request, with the final name', async () => {
    const b = backend({ suggest: () => ({ source: 'llm', key: 'infra/dagsrv', score: 0, margin: 0, ranking: [] }) });
    const f = await open(undefined, { extra: b.extra });
    await ready();
    await vi.waitFor(() => expect(f.log.some((r) => r.type === 'llm:status')).toBe(true));
    for (const v of ['zzz', 'zzz-n', 'zzz-ne', 'zzz-new']) {
      type(v);
      await new Promise((r) => setTimeout(r, 40));
    }
    leave();
    await vi.waitFor(() => expect(aiCalls(f)).toHaveLength(1));
    expect(aiCalls(f)[0].repo.name).toBe('zzz-new');
    leave(); // a second blur with the answer already there does not ask again
    await settled();
    expect(aiCalls(f)).toHaveLength(1);
  });

  it('ignores names shorter than 3 characters', async () => {
    const f = await open(undefined, { extra: backend().extra });
    await ready();
    await vi.waitFor(() => expect(f.log.some((r) => r.type === 'llm:status')).toBe(true));
    type('ab');
    leave();
    await settled();
    expect(aiCalls(f)).toHaveLength(0);
  });

  it('does not run by default when turned off, when a rule matches, or after a manual pick', async () => {
    const off = backend({ auto: false });
    const f1 = await open(undefined, { extra: off.extra });
    await ready();
    await vi.waitFor(() => expect(f1.log.some((r) => r.type === 'llm:status')).toBe(true));
    type('zzz-brand-new');
    leave();
    await settled();
    expect(aiCalls(f1)).toHaveLength(0);
    mounted?.dispose();

    document.documentElement.innerHTML = html;
    const f2 = await open(undefined, { extra: backend().extra });
    await ready();
    await vi.waitFor(() => expect(f2.log.some((r) => r.type === 'llm:status')).toBe(true));
    type('dags-new'); // a rule catches it
    leave();
    await settled();
    expect(aiCalls(f2)).toHaveLength(0);
  });

  it('does not override a group the person picked by hand', async () => {
    const f = await open(undefined, { extra: backend().extra });
    await ready();
    await vi.waitFor(() => expect(f.log.some((r) => r.type === 'llm:status')).toBe(true));
    type('zzz-brand-new');
    $('#rg-nr-picker')!.click();
    ($$('#rg-nr-pop [role="option"]')[2] as HTMLElement).click();
    leave();
    await settled();
    expect(aiCalls(f)).toHaveLength(0);
  });

  it('a click on AI is not marked automatic', async () => {
    const f = await open(undefined, { extra: backend({ suggest: () => ({ source: 'llm', key: 'infra/dagsrv', score: 0, margin: 0, ranking: [] }) }).extra });
    await ready();
    type('zzz-brand-new');
    await vi.waitFor(() => expect(pill('llm').title).toMatch(/sends the name/));
    pill('llm').click();
    await vi.waitFor(() => expect(aiCalls(f)).toHaveLength(1));
    expect(aiCalls(f)[0].auto).toBeUndefined();
  });

  const levelButtons = () => $$('.rg-create-group').map((b) => [b.dataset.depth, b.textContent, b.classList.contains('rg-rec')]);
  const proposeAndWait = async (b: ReturnType<typeof backend>) => {
    await open(undefined, { extra: b.extra });
    await ready();
    type('minio');
    await vi.waitFor(() => expect(pill('llm').title).toMatch(/sends the name/));
    pill('llm').click();
    await vi.waitFor(() => expect($('#rg-nr-proposal')).toBeTruthy());
  };

  it('offers one button per level, the deepest one recommended', async () => {
    await proposeAndWait(backend());
    expect(levelButtons()).toEqual([
      ['1', 'Create “Self-hosted infra”', false],
      ['2', 'Create “Self-hosted infra / Storage”', true],
    ]);
  });

  it('accepting only the top group creates just that one and files the repo in it', async () => {
    const b = backend();
    await proposeAndWait(b);
    ($$('.rg-create-group')[0]).click();
    await vi.waitFor(() => expect($('#rg-nr-proposal')).toBeNull());
    expect(b.edits.map((e) => [e.parent, e.name, e.description])).toEqual([[[], 'selfhosted-infra', 'Services you host yourself']]);
    expect($('#rg-nr-picker')!.textContent).toContain('Self-hosted infra');
    expect($('#rg-nr-picker')!.textContent).not.toContain('Storage');
    expect(dest()).toContain('Adds minio to the match list of Self-hosted infra');
    expect(note()).toContain('Created and filed in Self-hosted infra');
  });

  it('shows a level that already exists as "Use", and picking it commits nothing', async () => {
    const b = backend({ suggest: () => ({ source: 'uncertain', key: null, score: 0, margin: 0, ranking: [], newGroup: { path: ['infra', 'object-store'], titles: ['Infra', 'Object store'], descriptions: ['x', 'y'] } }) });
    await proposeAndWait(b);
    expect(levelButtons().map((x) => x[1])).toEqual(['Use “Infra”', 'Create “Infra / Object store”']);
    expect($('.rg-prop-exists')!.textContent).toBe('exists');
    ($$('.rg-create-group')[0]).click();
    await vi.waitFor(() => expect($('#rg-nr-proposal')).toBeNull());
    expect(b.edits).toHaveLength(0);
    expect($('#rg-nr-picker')!.textContent).toContain('infra'); // the existing group keeps its own display name
  });

  it('works with three levels', async () => {
    const b = backend({ suggest: () => ({ source: 'uncertain', key: null, score: 0, margin: 0, ranking: [], newGroup: { path: ['a1', 'b1', 'c1'], titles: ['A', 'B', 'C'], descriptions: ['da', 'db', 'dc'] } }) });
    await proposeAndWait(b);
    expect(levelButtons().map((x) => x[1])).toEqual(['Create “A”', 'Create “A / B”', 'Create “A / B / C”']);
    ($$('.rg-create-group')[1]).click();
    await vi.waitFor(() => expect($('#rg-nr-proposal')).toBeNull());
    expect(b.edits.map((e) => [e.parent, e.name])).toEqual([[[], 'a1'], [['a1'], 'b1']]);
  });
});
