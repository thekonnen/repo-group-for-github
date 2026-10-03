// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountOrgRepos, type Mounted } from '../src/features/mount';
import { example } from './fixtures';
import { fakeCall, memberAccess } from './page-helpers';
import type { Request } from '../src/github/messages';

const body = readFileSync(join(process.cwd(), 'tests/fixtures/org-repos.html'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
let mounted: Mounted | null = null;

beforeEach(() => {
  document.documentElement.innerHTML = body;
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories');
});
afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.documentElement.innerHTML = '';
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const drawer = () => $('.rg-drawer');
const btn = (label: string | RegExp, within: ParentNode = document) =>
  ([...within.querySelectorAll('button, a')] as HTMLElement[]).find((b) => (typeof label === 'string' ? b.textContent!.trim() === label : label.test(b.textContent!.trim())))!;
const type = (el: HTMLInputElement, v: string) => ((el.value = v), el.dispatchEvent(new Event('input', { bubbles: true })));
const names = () => $$('.rg-root[data-rg="view"] .rg-row .rg-row-title a').map((a) => a.textContent!.trim());

/** The edited config the "server" returns: description changed on infra/dagu. */
const okEdit = (mut: (g: any) => void) => (req: any) => {
  const cfg = structuredClone(example());
  mut(cfg.groups);
  void req;
  return { status: 'ok', sha: 'sha-2', config: cfg, warnings: [] };
};

async function open(hash: string, opts: Parameters<typeof fakeCall>[0] = {}) {
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories' + hash);
  const fc = fakeCall(opts);
  mounted = (await mountOrgRepos('thekonnen', { call: fc.call }, document, 200))!;
  await vi.waitFor(() => expect($('.rg-g-head')).toBeTruthy());
  return fc;
}

describe('Edit group drawer (F5)', () => {
  it('opens prefilled from the group, as a modal dialog', async () => {
    await open('#infra/dagu');
    await vi.waitFor(() => expect(btn('Edit group')).toBeTruthy());
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    expect(drawer()!.getAttribute('role')).toBe('dialog');
    expect(drawer()!.getAttribute('aria-modal')).toBe('true');
    expect(drawer()!.getAttribute('aria-labelledby')).toBe('rg-drawer-title');
    expect($('#rg-drawer-title')!.textContent).toBe('Edit group infra / dagu');
    expect(($('#rg-f-name') as HTMLInputElement).value).toBe('dagu');
    expect(($('#rg-f-desc') as HTMLInputElement).value).toBe('Jobs and crons (Airflow alternative)');
    expect($$('.rg-drawer .rg-chip').map((c) => c.textContent!.trim())).toEqual(['dagu', 'dags-*', 'konnen-dagu']);
    expect($('.rg-drawer-foot')!.textContent).toContain('Saved as a commit to thekonnen/.github');
    expect(document.activeElement).toBe($('#rg-f-name'));
  });
  it('lists the matching repositories live and marks those that sit in another group', async () => {
    await open('#infra/dagu');
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    expect($$('.rg-match-list li').map((l) => l.textContent!.trim())).toEqual(['konnen-dagu', 'dagu', 'dags-repo']);
    expect($$('.rg-drawer .rg-field label').find((l) => /Matching/.test(l.textContent!))!.textContent).toBe('Matching repositories (3)');
    const ruleInput = $('#rg-f-rule') as HTMLInputElement;
    type(ruleInput, 'konnen-*');
    ruleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect($$('.rg-drawer .rg-chip').map((c) => c.textContent!.trim())).toContain('konnen-*'));
    const li = $$('.rg-match-list li').map((l) => l.textContent!.trim());
    expect(li).toContain('konnen-litellm' + 'now in ai / litellm');
    expect(li).toContain('konnen-authentik' + 'now in infra / authentik');
    expect(li).toContain('konnen-dagu'); // already here: no mark
    // remove a rule with its x
    (document.querySelector('[aria-label="Remove rule konnen-*"]') as HTMLElement).click();
    await vi.waitFor(() => expect($$('.rg-match-list li')).toHaveLength(3));
  });
  it('turns the name into a slug and shows the full path', async () => {
    await open('#infra/dagu');
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    type($('#rg-f-name') as HTMLInputElement, 'My Jobs!');
    await vi.waitFor(() => expect(($('#rg-f-name') as HTMLInputElement).value).toBe('my-jobs-'));
    expect($('#rg-f-name-hint')!.textContent).toContain('thekonnen / infra / my-jobs');
  });
  it('validates: required and no duplicate among siblings; Save stays disabled', async () => {
    await open('#infra/dagu');
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    type($('#rg-f-name') as HTMLInputElement, 'authentik');
    await vi.waitFor(() => expect($('#rg-f-name-hint')!.textContent).toBe('A group named "authentik" already exists here.'));
    expect(($('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement).disabled).toBe(true);
    type($('#rg-f-name') as HTMLInputElement, '');
    ($('#rg-f-name') as HTMLInputElement).dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect($('#rg-f-name-hint')!.textContent).toBe('Name is required.'));
    expect(($('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement).disabled).toBe(true);
  });
  it('Save is disabled until something changes; then commits the single edit and shows the toast', async () => {
    const fc = await open('#infra/dagu', { edit: okEdit((g) => (g[0].groups[0].description = 'Cron jobs')) });
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    const save = $('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    type($('#rg-f-desc') as HTMLInputElement, 'Cron jobs');
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    save.click();
    await vi.waitFor(() => expect(drawer()).toBeNull());
    const sent = fc.log.find((r) => r.type === 'org:edit') as any;
    expect(sent.edit).toEqual({ kind: 'edit', path: ['infra', 'dagu'], name: 'dagu', description: 'Cron jobs', match: ['dagu', 'dags-*', 'konnen-dagu'] });
    expect($('.rg-toast')!.textContent).toBe('Committed to thekonnen/.github/repo-groups.yml');
    expect($('.rg-toast code')!.textContent).toBe('thekonnen/.github/repo-groups.yml');
    expect($('.rg-toast')!.getAttribute('role')).toBe('status');
    await vi.waitFor(() => expect($('.rg-g-title p')!.textContent).toBe('Cron jobs'));
  });
  it('renaming the open group moves the URL to the new path', async () => {
    const fc = await open('#infra/dagu', { edit: okEdit((g) => (g[0].groups[0].name = 'jobs')) });
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    type($('#rg-f-name') as HTMLInputElement, 'jobs');
    await vi.waitFor(() => expect(($('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement).disabled).toBe(false));
    ($('.rg-drawer-foot .rg-btn-primary') as HTMLElement).click();
    await vi.waitFor(() => expect(window.location.hash).toBe('#infra/jobs'));
    expect((fc.log.find((r) => r.type === 'org:edit') as any).edit.name).toBe('jobs');
  });
  it('keeps the drawer open and shows the error when the commit fails', async () => {
    await open('#infra/dagu', { edit: () => { throw Object.assign(new Error('boom'), {}); } });
    // the fake rejects with a plain Error; the controller turns it into its message
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    type($('#rg-f-desc') as HTMLInputElement, 'x');
    await vi.waitFor(() => expect(($('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement).disabled).toBe(false));
    ($('.rg-drawer-foot .rg-btn-primary') as HTMLElement).click();
    await vi.waitFor(() => expect($('.rg-drawer p.rg-error')!.textContent).toBe('boom'));
    expect(drawer()).toBeTruthy();
    expect(($('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement).disabled).toBe(false);
    expect($('.rg-toast')).toBeNull();
  });
  it('closes with Esc, the backdrop, Cancel and the x; focus returns to the opener', async () => {
    await open('#infra/dagu');
    await vi.waitFor(() => btn('Edit group'));
    const opener = btn('Edit group');
    for (const how of ['esc', 'backdrop', 'cancel', 'x']) {
      opener.focus();
      opener.click();
      await vi.waitFor(() => expect(drawer()).toBeTruthy());
      if (how === 'esc') drawer()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (how === 'backdrop') $('.rg-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      if (how === 'cancel') btn('Cancel', drawer()!).click();
      if (how === 'x') (drawer()!.querySelector('[aria-label="Close"]') as HTMLElement).click();
      await vi.waitFor(() => expect(drawer()).toBeNull());
      expect(document.activeElement).toBe(opener);
    }
  });
  it('a click inside the drawer does not close it', async () => {
    await open('#infra/dagu');
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    drawer()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(drawer()).toBeTruthy();
  });
});

describe('match rules input', () => {
  it('one field, several rules: commas, spaces, semicolons and paste become separate chips', async () => {
    await open('#infra/dagu');
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    const rule = $('#rg-f-rule') as HTMLInputElement;
    type(rule, 'omni*, lite*;extra');
    await vi.waitFor(() => expect($$('.rg-drawer .rg-chip').map((c) => c.textContent!.trim())).toEqual(['dagu', 'dags-*', 'konnen-dagu', 'omni*', 'lite*', 'extra']));
    expect(rule.value).toBe('');
  });
  it('text still in the rule field is saved with the group', async () => {
    const fc = await open('', { edit: okEdit(() => {}) });
    await vi.waitFor(() => expect(btn('New group')).toBeTruthy());
    btn('New group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    type($('#rg-f-name') as HTMLInputElement, 'jobs');
    const rule = $('#rg-f-rule') as HTMLInputElement;
    rule.value = 'dagu'; // typed but never confirmed with Enter or Add
    rule.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(($('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement).disabled).toBe(false));
    ($('.rg-drawer-foot .rg-btn-primary') as HTMLElement).click();
    await vi.waitFor(() => expect(fc.log.some((r) => r.type === 'org:edit')).toBe(true));
    expect((fc.log.find((r) => r.type === 'org:edit') as any).edit.match).toEqual(['dagu']);
  });
});

describe('New group and subgroup (F6)', () => {
  it('root says New group; a group page says New subgroup', async () => {
    await open('');
    await vi.waitFor(() => expect(btn('New group')).toBeTruthy());
    expect($$('.rg-g-actions button').map((b) => b.textContent!.trim())).toEqual(['New group']); // no Edit group on the root
    mounted!.dispose();
    document.documentElement.innerHTML = body;
    await open('#infra');
    await vi.waitFor(() => expect(btn('New subgroup')).toBeTruthy());
    expect($$('.rg-g-actions button').map((b) => b.textContent!.trim())).toEqual(['Edit group', 'New subgroup']);
  });
  it('creates a subgroup under the current group and expands its parent', async () => {
    const fc = await open('', {
      edit: okEdit((g) => g[1].groups.push({ name: 'rag', description: 'RAG', logo: null, teams: [], match: ['rag-*'], groups: [] })),
    });
    await vi.waitFor(() => expect(names()).toContain('ai'));
    // go to ai (collapsed on the root), create a subgroup there
    window.history.pushState(null, '', '/orgs/thekonnen/repositories#ai');
    window.dispatchEvent(new Event('hashchange'));
    await vi.waitFor(() => expect(btn('New subgroup')).toBeTruthy());
    btn('New subgroup').click();
    await vi.waitFor(() => expect($('#rg-drawer-title')!.textContent).toBe('New subgroup'));
    expect(($('#rg-f-name') as HTMLInputElement).value).toBe('');
    expect($('#rg-f-name-hint')!.textContent).toContain('thekonnen / ai / …');
    type($('#rg-f-name') as HTMLInputElement, 'RAG');
    type($('#rg-f-desc') as HTMLInputElement, 'RAG');
    const rule = $('#rg-f-rule') as HTMLInputElement;
    type(rule, 'rag-*');
    rule.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(($('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement).disabled).toBe(false));
    ($('.rg-drawer-foot .rg-btn-primary') as HTMLElement).click();
    await vi.waitFor(() => expect(drawer()).toBeNull());
    expect((fc.log.find((r) => r.type === 'org:edit') as any).edit).toEqual({ kind: 'new', parent: ['ai'], name: 'rag', description: 'RAG', match: ['rag-*'] });
    // back on the root, ai is open now and shows its new subgroup
    window.history.pushState(null, '', '/orgs/thekonnen/repositories');
    window.dispatchEvent(new Event('popstate'));
    await vi.waitFor(() => expect(names()).toEqual(['infra', 'dagu', 'authentik', 'checkmate', 'ai', 'litellm', 'rag', 'omniroute', 'keep_supabase_alive']));
  });
  it('creates a top-level group from the root', async () => {
    const fc = await open('', { edit: okEdit((g) => g.push({ name: 'data', description: '', logo: null, teams: [], match: [], groups: [] })) });
    await vi.waitFor(() => expect(btn('New group')).toBeTruthy());
    btn('New group').click();
    await vi.waitFor(() => expect($('#rg-drawer-title')!.textContent).toBe('New group'));
    type($('#rg-f-name') as HTMLInputElement, 'data');
    await vi.waitFor(() => expect(($('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement).disabled).toBe(false));
    ($('.rg-drawer-foot .rg-btn-primary') as HTMLElement).click();
    await vi.waitFor(() => expect(drawer()).toBeNull());
    expect((fc.log.find((r) => r.type === 'org:edit') as any).edit).toMatchObject({ kind: 'new', parent: [], name: 'data' });
    await vi.waitFor(() => expect(names()).toContain('data'));
  });
  it('offers to create <org>/.github when it does not exist, then saves', async () => {
    let calls = 0;
    const fc = await open('', { edit: (req) => (++calls === 1 ? { status: 'needs-repo' } : okEdit((g) => g.push({ name: 'data', description: '', logo: null, teams: [], match: [], groups: [] }))(req)) });
    await vi.waitFor(() => expect(btn('New group')).toBeTruthy());
    btn('New group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    type($('#rg-f-name') as HTMLInputElement, 'data');
    await vi.waitFor(() => expect(($('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement).disabled).toBe(false));
    ($('.rg-drawer-foot .rg-btn-primary') as HTMLElement).click();
    await vi.waitFor(() => expect($('.rg-callout')!.textContent).toContain('does not exist yet'));
    expect(fc.log.some((r) => r.type === 'org:create-dotgithub')).toBe(false); // never created without a click
    btn(/Create thekonnen\/\.github and save/).click();
    await vi.waitFor(() => expect(drawer()).toBeNull());
    expect(fc.log.map((r: Request) => r.type).filter((t) => t === 'org:create-dotgithub' || t === 'org:edit')).toEqual(['org:edit', 'org:create-dotgithub', 'org:edit']);
  });
});

describe('who can edit', () => {
  it('hides the edit buttons for members without write access to .github', async () => {
    await open('#infra/dagu', { access: memberAccess });
    await vi.waitFor(() => expect($('.rg-g-actions a')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect($$('.rg-g-actions button')).toHaveLength(0);
    expect(btn('New repository')).toBeTruthy();
  });
  it('hides them until the access level is known', async () => {
    const fc = fakeCall();
    const slow = vi.fn(async (req: Request) => (req.type === 'org:access' ? new Promise(() => {}) : fc.call(req)));
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories#infra');
    mounted = (await mountOrgRepos('thekonnen', { call: slow as any }, document, 200))!;
    await vi.waitFor(() => expect($('.rg-g-actions a')).toBeTruthy());
    expect($$('.rg-g-actions button')).toHaveLength(0);
  });
});
