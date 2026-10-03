// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountOrgRepos, type Mounted } from '../src/features/mount';
import { writeConfig } from '../src/core/yaml-write';
import { SCOPE_LINE } from '../src/core/ai-prompt';
import { example, EXAMPLE } from './fixtures';
import { fakeCall, memberAccess } from './page-helpers';
import type { Request } from '../src/github/messages';

const body = readFileSync(join(process.cwd(), 'tests/fixtures/org-repos.html'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
let mounted: Mounted | null = null;
const written = vi.fn();

beforeEach(() => {
  document.documentElement.innerHTML = body;
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories');
  written.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: written }, configurable: true });
});
afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.documentElement.innerHTML = '';
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const btn = (label: string | RegExp, within: ParentNode = document) =>
  ([...within.querySelectorAll('button, a')] as HTMLElement[]).find((b) => (typeof label === 'string' ? b.textContent!.trim() === label : label.test(b.textContent!.trim())))!;
const area = () => $('#rg-y-text') as HTMLTextAreaElement;
const type = (v: string) => ((area().value = v), area().dispatchEvent(new Event('input', { bubbles: true })));
const status = () => $('.rg-y-status:not(.rg-warn)')?.textContent ?? '';
const apply = () => $('#rg-y-apply') as HTMLButtonElement;
const tick = () => new Promise((r) => setTimeout(r, 20)); // let Preact re-render between an input and the next click

async function open(opts: Parameters<typeof fakeCall>[0] = {}, hash = '') {
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories' + hash);
  const fc = fakeCall(opts);
  mounted = (await mountOrgRepos('thekonnen', { call: fc.call }, document, 200))!;
  await vi.waitFor(() => expect(btn('Edit YAML')).toBeTruthy());
  btn('Edit YAML').click();
  await vi.waitFor(() => expect(area()).toBeTruthy());
  await vi.waitFor(() => expect(status()).not.toBe('Checking…'));
  return fc;
}

/** What an AI would answer: fenced, with the repositories list echoed back, and a new group plus a moved repo. */
const answer = () => {
  const y = EXAMPLE.replace('groups:\n', 'groups:\n  - name: data\n    description: "Pipelines"\n    match: ["oroute", "etl-*"]\n');
  return `Here you go!\n\`\`\`yaml\n${y}repositories:\n  - name: x\n\`\`\`\nLet me know.`;
};

describe('Edit YAML drawer (F8)', () => {
  it('opens as a wide modal dialog with the saved file, a line gutter and highlighting; nothing to apply yet', async () => {
    await open();
    expect($('.rg-drawer')!.classList.contains('rg-wide')).toBe(true);
    expect($('.rg-drawer')!.getAttribute('aria-modal')).toBe('true');
    expect($('#rg-y-title')!.textContent).toBe('.github/repo-groups.yml');
    expect(area().value.startsWith('# thekonnen/.github/repo-groups.yml\nversion: 1\ngroups:\n')).toBe(true);
    expect($('.rg-y-gutter')!.textContent!.trim().split(/\s+/).length).toBe(area().value.split('\n').length);
    expect($('.rg-y-hl .rg-t-key')).toBeTruthy();
    expect(status()).toMatch(/^Valid\. No changes yet\. 6 groups · 9 of 10 repositories grouped · 1 ungrouped$/);
    expect(apply().disabled).toBe(true);
    expect($$('ol.rg-y-steps li')).toHaveLength(3);
    expect($('.rg-drawer-foot')!.textContent).toContain('Commits to thekonnen/.github on the default branch.');
    expect(document.activeElement).toBe(area());
  });
  it('shows an error with the line, highlights it in the gutter, and keeps Apply disabled', async () => {
    await open();
    type('groups:\n  - name: [a\n');
    await vi.waitFor(() => expect($('.rg-y-status.rg-err')).toBeTruthy());
    expect($('.rg-y-status.rg-err')!.textContent).toMatch(/\(line \d+\)$/);
    expect($('.rg-y-gutter .rg-bad')).toBeTruthy();
    expect(apply().disabled).toBe(true);
    type('version: 1');
    await vi.waitFor(() => expect($('.rg-y-status.rg-err')!.textContent).toBe('The file needs a top-level "groups:" list.'));
    type('groups:\n  - name: Bad Name\n');
    await vi.waitFor(() => expect($('.rg-y-status.rg-err')!.textContent).toContain('must use lowercase letters, numbers'));
  });
  it('takes a whole chat answer: fences removed, repositories ignored, diff listed, Apply enabled', async () => {
    await open();
    type(answer());
    await vi.waitFor(() => expect(apply().disabled).toBe(false));
    expect(status()).toContain('code fences removed');
    expect(status()).toMatch(/^Valid\. 2 changes · 7 groups · /);
    const items = $$('.rg-y-diff li').map((l) => l.textContent!.replace(/\s+/g, ' ').trim());
    expect(items).toEqual(['+New groupdata', '→orouteai → data']);
    expect($('.rg-y-diff .rg-add')).toBeTruthy();
    expect($('.rg-y-diff .rg-mov')).toBeTruthy();
  });
  it('commits with the typed text and the change count, then closes with the toast', async () => {
    const apply$ = vi.fn((req: any) => ({ status: 'ok', sha: 'sha-2', config: (fc.cfg = { version: 1, index: 'api', groups: example().groups }), warnings: [] }));
    const fc: any = await open({ apply: apply$ });
    type(answer());
    await vi.waitFor(() => expect(apply().disabled).toBe(false));
    apply().click();
    await vi.waitFor(() => expect($('.rg-drawer')).toBeNull());
    const sent = fc.log.find((r: Request) => r.type === 'org:apply-yaml') as any;
    expect(sent).toMatchObject({ org: 'thekonnen', baseSha: 'sha1', changes: 2 });
    expect(sent.text).toContain('```yaml'); // the background strips fences; the page sends what the person pasted
    expect($('.rg-toast')!.textContent).toBe('Committed to thekonnen/.github/repo-groups.yml');
  });
  it('Reset to saved file brings the file back', async () => {
    await open();
    const saved = area().value;
    type('groups: []');
    await vi.waitFor(() => expect(apply().disabled).toBe(false));
    btn('Reset to saved file').click();
    await vi.waitFor(() => expect(area().value).toBe(saved));
    await vi.waitFor(() => expect(apply().disabled).toBe(true));
  });
  it('Tab inserts two spaces instead of leaving the field', async () => {
    await open();
    type('abc');
    area().selectionStart = area().selectionEnd = 1;
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    area().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(area().value).toBe('a  bc');
    const shift = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    area().dispatchEvent(shift);
    expect(shift.defaultPrevented).toBe(false);
  });
  it('closes with Esc, Cancel and the backdrop', async () => {
    await open();
    $('.rg-drawer')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect($('.rg-drawer')).toBeNull());
    btn('Edit YAML').click();
    await vi.waitFor(() => expect($('.rg-drawer')).toBeTruthy());
    btn('Cancel', $('.rg-drawer')!).click();
    await vi.waitFor(() => expect($('.rg-drawer')).toBeNull());
  });
});

describe('copy buttons and scope (F8/F14)', () => {
  it('Copy prompt for AI + YML: prompt, then the current editor text, then the repositories list', async () => {
    await open();
    type('version: 1\ngroups:\n  - name: mine\n');
    await vi.waitFor(() => expect(status()).toMatch(/^Valid/));
    btn(/Copy prompt for AI \+ YML/).click();
    await vi.waitFor(() => expect(written).toHaveBeenCalledTimes(1));
    const t = written.mock.calls[0][0] as string;
    expect(t).toContain('the "thekonnen" organization');
    expect(t).toContain('Current file and repositories:\n\n```yaml\nversion: 1\ngroups:\n  - name: mine\n');
    expect(t).toContain('repositories:  # read-only context, ignored when pasted back');
    expect(t).toContain('  - name: kite-llm-proxy\n    description: "AI Gateway for Acme"');
    expect(t).not.toContain(SCOPE_LINE); // scope is "all"
    await vi.waitFor(() => expect(btn(/^Copied$/)).toBeTruthy());
  });
  it('has only two copy buttons: prompt + YML, and YML alone', async () => {
    await open();
    expect($$('[data-copy]').map((b) => b.textContent!.trim())).toEqual(['Copy prompt for AI + YML', 'Copy YML']);
    btn('Copy YML').click();
    await vi.waitFor(() => expect(written).toHaveBeenCalledTimes(1));
    expect(written.mock.calls[0][0]).toBe(area().value);
  });
  it('the scope select offers All, Ungrouped, and This group on a group page; it narrows the list and adds the scope line', async () => {
    await open({}, '#infra');
    const opts = $$('.rg-y-scope option').map((o) => o.textContent);
    expect(opts).toEqual(['All repositories (10)', 'Ungrouped only (1)', 'This group (6)']);
    const sel = $('.rg-y-scope') as HTMLSelectElement;
    sel.value = 'ungrouped';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    btn(/Copy prompt for AI \+ YML/).click();
    await vi.waitFor(() => expect(written).toHaveBeenCalledTimes(1));
    const t = written.mock.calls[0][0] as string;
    expect(t.indexOf(SCOPE_LINE)).toBeGreaterThan(-1);
    expect(t.indexOf(SCOPE_LINE)).toBeLessThan(t.indexOf('Output rules:'));
    const listed = t.split('repositories:  # read-only')[1].match(/- name: /g)!.length;
    expect(listed).toBe(1); // only keep_alive_job
  });
  it('warns above 500 repositories in scope and suggests a smaller one', async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ name: `r${i}`, pushedAt: new Date().toISOString() }));
    await open({ repos: many });
    expect($('.rg-y-scopewarn')!.textContent).toContain('501 repositories');
    expect($('.rg-y-scopewarn')!.textContent).toContain('Ungrouped only');
  });
  it('when the clipboard API is refused, shows the text selected with a hint', async () => {
    written.mockRejectedValue(new Error('denied'));
    await open();
    btn('Copy YML').click();
    await vi.waitFor(() => expect($('.rg-ai-fallback textarea')).toBeTruthy());
    expect(($('.rg-ai-fallback textarea') as HTMLTextAreaElement).value).toBe(area().value);
    expect($('.rg-ai-fallback .rg-hint')!.textContent).toContain('press Ctrl+C or ⌘C');
  });
});

describe('conflicts, missing repo, entry points', () => {
  it('a conflict keeps the text, blocks Apply, and "Reload and keep my text" diffs against the fresh file', async () => {
    const theirs = structuredClone(example());
    theirs.groups.push({ name: 'theirs', description: '', logo: null, teams: [], match: [], groups: [] });
    const fc: any = await open({ apply: () => ({ status: 'conflict', sha: 'sha-9', config: theirs }) });
    type(answer());
    await vi.waitFor(() => expect(apply().disabled).toBe(false));
    apply().click();
    await vi.waitFor(() => expect($('.rg-callout')!.textContent).toContain('The file changed on GitHub since you opened it'));
    expect(apply().disabled).toBe(true);
    expect(area().value).toContain('name: data'); // my text is kept
    btn('Reload and keep my text').click();
    await vi.waitFor(() => expect($('.rg-callout')).toBeNull());
    // now the diff is against the fresh file: "theirs" shows as removed by my text
    await vi.waitFor(() => expect($$('.rg-y-diff li').map((l) => l.textContent!).join('|')).toContain('Removed group'));
    // and the next apply uses the fresh sha
    fc.call.mockImplementation(async (req: Request) => (req.type === 'org:apply-yaml' ? { status: 'ok', sha: 'sha-10', config: example(), warnings: [] } : null));
  });
  it('when <org>/.github is missing, one click creates it and commits', async () => {
    let n = 0;
    const fc = await open({ apply: () => (++n === 1 ? { status: 'needs-repo' } : { status: 'ok', sha: 's', config: example(), warnings: [] }) });
    type(answer());
    await vi.waitFor(() => expect(apply().disabled).toBe(false));
    expect($('.rg-drawer-foot')!.textContent).toContain('created as private');
    apply().click();
    await vi.waitFor(() => expect($('.rg-drawer')).toBeNull());
    expect($('.rg-callout')).toBeNull();
    expect(fc.log.map((r) => r.type).filter((t) => t === 'org:create-dotgithub' || t === 'org:apply-yaml')).toEqual(['org:apply-yaml', 'org:create-dotgithub', 'org:apply-yaml']);
  });
  it('gives up with a message if the repository is still missing after creating it', async () => {
    await open({ apply: () => ({ status: 'needs-repo' }) });
    type(answer());
    await vi.waitFor(() => expect(apply().disabled).toBe(false));
    apply().click();
    await vi.waitFor(() => expect($('.rg-drawer p.rg-error')!.textContent).toContain('Could not create thekonnen/.github'));
  });
  it('shows the failure from the commit and stays open', async () => {
    await open({ apply: () => { throw new Error('You cannot write to thekonnen/.github.'); } });
    type(answer());
    await vi.waitFor(() => expect(apply().disabled).toBe(false));
    apply().click();
    await vi.waitFor(() => expect($('.rg-drawer p.rg-error')!.textContent).toBe('You cannot write to thekonnen/.github.'));
    expect($('.rg-drawer')).toBeTruthy();
  });
  it('an org without repo-groups.yml: Start with AI opens an empty groups list with the full repository list', async () => {
    const fc = fakeCall({ config: { exists: false } });
    mounted = (await mountOrgRepos('thekonnen', { call: fc.call }, document, 200))!;
    await vi.waitFor(() => expect(btn('Start with AI')).toBeTruthy());
    btn('Start with AI').click();
    await vi.waitFor(() => expect(area()).toBeTruthy());
    expect(area().value).toBe('# thekonnen/.github/repo-groups.yml\nversion: 1\ngroups: []\n');
    btn(/Copy prompt for AI \+ YML/).click();
    await vi.waitFor(() => expect(written).toHaveBeenCalled());
    expect((written.mock.calls[0][0] as string).split('repositories:  # read-only')[1].match(/- name: /g)!.length).toBe(10);
  });
  it('an org without repo-groups.yml: Create groups opens New group', async () => {
    const fc = fakeCall({ config: { exists: false } });
    mounted = (await mountOrgRepos('thekonnen', { call: fc.call }, document, 200))!;
    await vi.waitFor(() => expect(btn('Create groups')).toBeTruthy());
    btn('Create groups').click();
    await vi.waitFor(() => expect($('#rg-drawer-title')!.textContent).toBe('New group'));
  });
  it('Edit group has a link that opens the YAML editor with the draft already applied', async () => {
    window.history.replaceState(null, '', '/orgs/thekonnen/repositories#infra/dagsrv');
    const fc = fakeCall();
    mounted = (await mountOrgRepos('thekonnen', { call: fc.call }, document, 200))!;
    await vi.waitFor(() => expect(btn('Edit group')).toBeTruthy());
    btn('Edit group').click();
    await vi.waitFor(() => expect($('#rg-f-desc')).toBeTruthy());
    const d = $('#rg-f-desc') as HTMLInputElement;
    d.value = 'My new description';
    d.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    btn('Edit .github/repo-groups.yml').click();
    await vi.waitFor(() => expect(area()).toBeTruthy());
    expect($('#rg-drawer-title')).toBeNull();
    expect(area().value).toContain('description: "My new description"');
    await vi.waitFor(() => expect(status()).toContain('1 change'));
    expect($$('.rg-y-diff li')[0].textContent).toContain('Description of infra/dagsrv');
    expect(apply().disabled).toBe(false);
  });
  it('is not offered to members without write access', async () => {
    const fc = fakeCall({ access: memberAccess });
    mounted = (await mountOrgRepos('thekonnen', { call: fc.call }, document, 200))!;
    await vi.waitFor(() => expect($('.rg-g-actions a')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect($$('.rg-g-actions button')).toHaveLength(0);
  });
});

void writeConfig;
