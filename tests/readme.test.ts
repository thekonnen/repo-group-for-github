// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/background/api';
import { commitEditWithLogo } from '../src/background/commit-logo';
import { memoryKV } from '../src/background/kv';
import { memoryLogoCache } from '../src/background/logos';
import { decodeBase64Utf8, encodeBase64Utf8 } from '../src/background/org-data';
import { createReadmeService } from '../src/background/readmes';
import { AI_PROMPT_TEMPLATE } from '../src/core/ai-prompt';
import { diffTrees } from '../src/core/diff';
import { applyEdit, commitMessage } from '../src/core/edit';
import { findGroup } from '../src/core/placement';
import { cleanReadme, isReadmePath, readmeFilePath, readReadme } from '../src/core/readme';
import { readConfig } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';
import { mountOrgRepos, type Mounted } from '../src/features/mount';
import { EXAMPLE, example, load } from './fixtures';
import { fakeFetch, type Route } from './fake-github';
import { fakeCall, memberAccess } from './page-helpers';

const read = (t: string, org = 'o') => readConfig(t, load, { org });
const withReadme = (text: string) => `groups:\n  - name: a\n    readme: ${text}\n`;

describe('readme in the YAML (reader, validator, writer)', () => {
  it('reads a block scalar, a path and nothing', () => {
    const r = read('groups:\n  - name: a\n    readme: |\n      # Hi\n\n      Text **bold**\n  - name: b\n    readme: readmes/b.md\n  - name: c\n');
    const [a, b, c] = r.config!.groups;
    expect(a.readme).toBe('# Hi\n\nText **bold**\n');
    expect(b.readme).toBe('readmes/b.md');
    expect(c.readme).toBeUndefined();
  });
  it('tells a path from inline text', () => {
    expect(isReadmePath('readmes/infra.md')).toBe(true);
    expect(isReadmePath('notes.markdown')).toBe(true);
    expect(isReadmePath('Read the docs.md now')).toBe(false);
    expect(isReadmePath('a.md\nb')).toBe(false);
    expect(readReadme('a', 'o', '   ')).toEqual({ none: true });
  });
  it('rejects a non-text readme, a path outside .github and a README over 64 KB', () => {
    expect(read('groups:\n  - name: a\n    readme: [1]\n').error).toBe('"a": readme must be text or a path to a .md file in o/.github.');
    expect(read(withReadme('../secrets.md')).error).toBe('"a": readme path "../secrets.md" must stay inside o/.github.');
    expect(read(withReadme('/etc/x.md')).error).toContain('must stay inside');
    expect(read(withReadme('a/../b.md')).error).toContain('must stay inside');
    const big = 'x'.repeat(64 * 1024 + 1);
    expect(read(`groups:\n  - name: a\n    readme: "${big}"\n`).error).toBe('"a": readme is larger than 64 KB.');
    const ok = 'x'.repeat(64 * 1024);
    expect(read(`groups:\n  - name: a\n    readme: "${ok}"\n`).error).toBeUndefined();
  });
  it('counts bytes, not characters', () => {
    const t = 'é'.repeat(33 * 1024); // 66 KB in UTF-8, 33K characters
    expect(read(`groups:\n  - name: a\n    readme: "${t}"\n`).error).toContain('larger than 64 KB');
  });
  it('writes in canonical order, with a block scalar for text and a quoted string for a path', () => {
    const cfg = example();
    const g = findGroup(cfg.groups, ['infra'])!;
    g.readme = 'readmes/infra.md';
    findGroup(cfg.groups, ['infra', 'dagsrv'])!.readme = '# Scheduler\n\nLine two\n\n  indented';
    const text = writeConfig(cfg, 'o/.github/repo-groups.yml');
    expect(text).toContain('    readme: "readmes/infra.md"\n');
    expect(text).toContain('        readme: |\n          # Scheduler\n\n          Line two\n\n            indented\n');
    const lines = text.split('\n');
    const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
    const i = at(/^ {4}readme: "readmes/);
    expect(at(/^ {4}logo:/)).toBeLessThan(i);
    expect(at(/^ {4}teams:/)).toBeGreaterThan(i);
  });
  it('round-trips awkward text', () => {
    const texts = ['One line', '# T\n\n```yaml\nkey: "v"\n```\n\n- a\n- b', 'Tab\there\nand "quotes" and \\ backslash', '  leading space\nsecond', '\nleading newline', 'ends with spaces   \nnext', 'ünïcode — ok ✓\n\n\n\nfour blank lines above', 'a: b\n- c\n# d\n---\n...'];
    for (const t of texts) {
      const cfg = example();
      findGroup(cfg.groups, ['infra'])!.readme = cleanReadme(t);
      const out = read(writeConfig(cfg, 'h'));
      expect(out.error, t).toBeUndefined();
      expect(findGroup(out.config!.groups, ['infra'])!.readme, t).toBe(cleanReadme(t));
    }
  });
  it('a code fence inside a README is not mistaken for a pasted chat answer', () => {
    const file = 'version: 1\ngroups:\n  - name: a\n    readme: |\n      ```sh\n      npm i\n      ```\n';
    const r = read(file);
    expect(r.stripped).toBe(false);
    expect(r.config!.groups[0].readme).toBe('```sh\nnpm i\n```\n');
    const chat = read('Here you go:\n```yaml\ngroups:\n  - name: z\n```\nDone');
    expect(chat.stripped).toBe(true);
    expect(chat.config!.groups[0].name).toBe('z');
  });
  it('is part of the file written by the personal layer too, and drops nothing else', () => {
    const cfg = example();
    findGroup(cfg.groups, ['infra'])!.readme = 'readmes/infra.md';
    expect(writeConfig(cfg, 'h', { personal: true })).toContain('readme: "readmes/infra.md"');
  });
});

describe('diff and AI prompt', () => {
  it('lists "README of x" as a change', () => {
    const a = example().groups;
    const b = structuredClone(a);
    findGroup(b, ['infra'])!.readme = 'readmes/infra.md';
    expect(diffTrees(a, b, []).items).toEqual([{ k: '~', cls: 'chg', text: 'README of infra', to: 'readmes/infra.md' }]);
    findGroup(b, ['infra'])!.readme = '# x\n';
    expect(diffTrees(a, b, []).items[0].to).toBe('text changed');
    expect(diffTrees(b, a, []).items[0].to).toBe('removed');
    expect(diffTrees(b, b, []).items).toEqual([]);
  });
  it('tells the AI to keep every readme untouched', () => {
    expect(AI_PROMPT_TEMPLATE).toContain('Keep every "readme" value exactly as it is');
    expect(AI_PROMPT_TEMPLATE).toContain('logo, readme, teams, match, shared, pinned, sort, groups');
  });
});

describe('applyEdit with a readme', () => {
  const base = () => example().groups;
  const edit = (readme: any) => ({ kind: 'edit' as const, path: ['infra'], name: 'infra', description: 'd', match: [], readme });
  it('inline, path, file and remove', () => {
    const r = (x: any) => findGroup((applyEdit(base(), edit(x)) as any).groups, ['infra'])!.readme;
    expect(r({ inline: '# Hi  \r\n' })).toBe('# Hi\n');
    expect(r({ path: ' readmes/x.md ' })).toBe('readmes/x.md');
    expect(r({ file: '# Body' })).toBe('readmes/infra.md');
    expect(r({ inline: '   ' })).toBeUndefined();
    expect(r({ remove: true })).toBeUndefined();
  });
  it('a file readme of a new subgroup lives at the final slug', () => {
    const r = applyEdit(base(), { kind: 'new', parent: ['infra'], name: 'Data Jobs', description: '', match: [], readme: { file: 'x' } }) as any;
    expect(findGroup(r.groups, ['infra', 'data-jobs'])!.readme).toBe('readmes/infra-data-jobs.md');
    expect(readmeFilePath(['infra', 'data-jobs'])).toBe('readmes/infra-data-jobs.md');
  });
  it('rejects a path outside the repository and keeps the readme when the edit has none', () => {
    expect(applyEdit(base(), edit({ path: '../x.md' }))).toEqual({ error: 'The README path must stay inside the .github repository.' });
    const g = base();
    findGroup(g, ['infra'])!.readme = 'keep.md';
    expect(findGroup((applyEdit(g, { kind: 'edit', path: ['infra'], name: 'infra', description: 'x', match: [] }) as any).groups, ['infra'])!.readme).toBe('keep.md');
  });
  it('commit messages', () => {
    expect(commitMessage({ ...edit({ file: 'x' }) })).toBe('chore(repo-groups): update README for infra');
    expect(commitMessage({ kind: 'new', parent: [], name: 'x', description: '', match: [], readme: { file: 'a' } })).toBe('chore(repo-groups): add group x with README');
  });
});

// ---- background: one commit with the file, and fetching by blob SHA ----------------------------------------------

const client = (f: ReturnType<typeof fakeFetch>) => createClient({ fetch: f.fetch, getToken: async () => 't' });

function world() {
  const blobs = new Map<string, { content: string; encoding: string }>();
  const trees: any[] = [];
  const commits: any[] = [];
  let n = 0;
  const routes: Route[] = [
    (u) => (u.pathname === '/repos/o/.github' ? { json: { default_branch: 'main', permissions: { push: true } } } : undefined),
    (u) => (u.pathname === '/repos/o/.github/git/ref/heads/main' ? { json: { object: { sha: 'c1' } } } : undefined),
    (u) => (u.pathname.startsWith('/repos/o/.github/git/commits/') ? { json: { tree: { sha: 'tree0' } } } : undefined),
    (u) => (u.pathname === '/repos/o/.github/contents/repo-groups.yml' ? { json: { content: encodeBase64Utf8(EXAMPLE), sha: 'old' } } : undefined),
    (u, c) => (u.pathname === '/repos/o/.github/git/blobs' && c.method === 'POST' ? (blobs.set(`b${++n}`, JSON.parse(c.body!)), { status: 201, json: { sha: `b${n}` } }) : undefined),
    (u, c) => (u.pathname === '/repos/o/.github/git/trees' ? (trees.push(JSON.parse(c.body!)), { status: 201, json: { sha: 't1' } }) : undefined),
    (u, c) => (u.pathname === '/repos/o/.github/git/commits' && c.method === 'POST' ? (commits.push(JSON.parse(c.body!)), { status: 201, json: { sha: 'c2' } }) : undefined),
    (u, c) => (u.pathname === '/repos/o/.github/git/refs/heads/main' && c.method === 'PATCH' ? { json: {} } : undefined),
  ];
  return { blobs, trees, commits, f: fakeFetch(...routes) };
}

describe('README saved as a file', () => {
  it('goes in the same commit as repo-groups.yml (Git Data API)', async () => {
    const w = world();
    const text = '# About infra\n\nHello\n';
    const r = await commitEditWithLogo(client(w.f), memoryKV(), 'o', { kind: 'edit', path: ['infra'], name: 'infra', description: 'd', match: ['x'], readme: { file: text } });
    expect(r).toMatchObject({ status: 'ok', readmeSha: 'b1', readmeFile: 'readmes/infra.md' });
    expect(w.commits).toHaveLength(1);
    expect(w.commits[0].message).toBe('chore(repo-groups): update README for infra');
    expect(w.trees[0].tree).toEqual([
      { path: 'repo-groups.yml', mode: '100644', type: 'blob', sha: 'b2' },
      { path: 'readmes/infra.md', mode: '100644', type: 'blob', sha: 'b1' },
    ]);
    expect(decodeBase64Utf8(w.blobs.get('b1')!.content)).toBe(text);
    const yml = readConfig(decodeBase64Utf8(w.blobs.get('b2')!.content), load, { org: 'o' }).config!;
    expect(findGroup(yml.groups, ['infra'])!.readme).toBe('readmes/infra.md');
  });
  it('logo and README together make one commit with both files', async () => {
    const w = world();
    const r = await commitEditWithLogo(client(w.f), memoryKV(), 'o', { kind: 'edit', path: ['infra'], name: 'infra', description: 'd', match: [], logo: { png: 'iVBORw0KGgo=' }, readme: { file: 'hi' } });
    expect(r.status).toBe('ok');
    expect(w.commits).toHaveLength(1);
    expect(w.trees[0].tree.map((t: any) => t.path)).toEqual(['repo-groups.yml', 'logos/infra.png', 'readmes/infra.md']);
  });
  it('a renamed group stores its file under the new slug', async () => {
    const w = world();
    await commitEditWithLogo(client(w.f), memoryKV(), 'o', { kind: 'edit', path: ['infra'], name: 'platform', description: 'd', match: [], readme: { file: 'hi' } });
    expect(w.trees[0].tree[1].path).toBe('readmes/platform.md');
  });
});

describe('readme fetching (background)', () => {
  function repo(sha = 's1') {
    let blobCalls = 0;
    const f = fakeFetch(
      (u) => (u.pathname === '/repos/o/.github/contents/readmes' ? { json: [{ type: 'file', name: 'infra.md', sha, size: 12 }, { type: 'file', name: 'big.md', sha: 'sb', size: 70000 }] } : undefined),
      (u) => (u.pathname === `/repos/o/.github/git/blobs/${sha}` ? (blobCalls++, { json: { content: encodeBase64Utf8('# Infra ✓') } }) : undefined),
    );
    return { f, calls: () => blobCalls };
  }
  it('reads text through the API and caches by blob SHA', async () => {
    const { f, calls } = repo();
    const cache = memoryLogoCache();
    const svc = createReadmeService({ client: client(f), cache });
    expect(await svc.load('o', ['readmes/infra.md'])).toEqual({ 'readmes/infra.md': '# Infra ✓' });
    expect(cache.data.get('readme:s1')).toBe('# Infra ✓');
    const again = createReadmeService({ client: client(f), cache });
    await again.load('o', ['readmes/infra.md']);
    expect(calls()).toBe(1);
  });
  it('missing, oversized and unsafe paths are null', async () => {
    const { f } = repo();
    const svc = createReadmeService({ client: client(f), cache: memoryLogoCache() });
    expect(await svc.load('o', ['readmes/nope.md', 'readmes/big.md', '../x.md'])).toEqual({ 'readmes/nope.md': null, 'readmes/big.md': null, '../x.md': null });
  });
});

// ---- the page: About tab and the drawer ---------------------------------------------------------------------------

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
const btn = (label: string | RegExp) => $$('button, a').find((b) => (typeof label === 'string' ? b.textContent!.trim() === label : label.test(b.textContent!.trim())))!;
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => ((el.value = v), el.dispatchEvent(new Event('input', { bubbles: true })));

function configWith(readme: string | undefined) {
  const cfg = example();
  if (readme !== undefined) findGroup(cfg.groups, ['infra'])!.readme = readme;
  return { exists: true, sha: 'sha1', config: cfg, warnings: [] };
}

async function open(hash: string, config: any, extra: { files?: Record<string, string | null>; edit?: (req: any) => any; access?: any } = {}) {
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories' + hash);
  const fc = fakeCall({ config, edit: extra.edit, access: extra.access });
  const call = vi.fn(async (req: any) => (req.type === 'readmes:get' ? Object.fromEntries(req.paths.map((p: string) => [p, extra.files?.[p] ?? null])) : fc.call(req)));
  mounted = (await mountOrgRepos('thekonnen', { call: call as any }, document, 200))!;
  await vi.waitFor(() => expect($('.rg-g-head')).toBeTruthy());
  return { ...fc, call };
}

describe('About tab on the group page', () => {
  it('opens first, renders inline Markdown safely', async () => {
    await open('#infra', configWith('# Platform\n\nWelcome **team** <script>alert(1)</script>\n\n[docs](https://docs.example.com) [bad](javascript:alert(1))\n'));
    await vi.waitFor(() => expect($('.rg-md')).toBeTruthy());
    const tabs = $$('.rg-tabs .rg-tab').map((t) => t.textContent!.trim());
    expect(tabs[0]).toBe('About');
    expect($('.rg-tabs .rg-tab')!.getAttribute('aria-selected')).toBe('true');
    expect($('.rg-md h2')!.textContent).toBe('Platform');
    expect($('.rg-md strong')!.textContent).toBe('team');
    expect($('.rg-md script')).toBeNull();
    expect($('.rg-md')!.textContent).toContain('<script>alert(1)</script>');
    expect($$('.rg-md a').map((a) => a.getAttribute('href'))).toEqual(['https://docs.example.com']);
    expect($('.rg-md a')!.getAttribute('rel')).toBe('noopener noreferrer');
    expect($('.rg-box .rg-row')).toBeNull(); // the list is on the other tab
    btn(/^Groups and repositories/).click();
    await vi.waitFor(() => expect($('.rg-box .rg-row')).toBeTruthy());
    expect($('.rg-md')).toBeNull();
  });
  it('loads a README file through the background', async () => {
    const { call } = await open('#infra', configWith('readmes/infra.md'), { files: { 'readmes/infra.md': '## From a file\n\n- one\n- two' } });
    await vi.waitFor(() => expect($('.rg-md h3')?.textContent).toBe('From a file'));
    expect($$('.rg-md li')).toHaveLength(2);
    expect(call.mock.calls.filter((c: any) => c[0].type === 'readmes:get')).toHaveLength(1);
    expect($('.rg-about')!.textContent).not.toContain('could not be loaded');
  });
  it('says so when the file cannot be loaded', async () => {
    await open('#infra', configWith('readmes/missing.md'));
    await vi.waitFor(() => expect($('.rg-about')!.textContent).toContain('This README could not be loaded'));
  });
  it('tabs can be reordered with Alt+Arrow and the order is saved per org, then reset', async () => {
    const { call } = await open('#infra', configWith('hello'));
    const names = () => $$('.rg-tabs .rg-tab').map((t) => t.textContent!.trim());
    expect(names()[0]).toBe('About');
    const about = $('.rg-tabs .rg-tab[data-tab="about"]') as HTMLElement;
    about.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(names()[1]).toBe('About'));
    expect(names()[0]).toContain('Groups and repositories');
    const saved = call.mock.calls.map((c: any) => c[0]).filter((m: any) => m.type === 'prefs:set' && m.prefs.tabOrder);
    expect(saved.at(-1).prefs.tabOrder.slice(0, 2)).toEqual(['items', 'about']);
    (Array.from(document.querySelectorAll('.rg-tabs-reset'))[0] as HTMLElement).click();
    await vi.waitFor(() => expect(names()[0]).toBe('About'));
    expect(document.querySelector('.rg-tabs-reset')).toBeNull();
  });
  it('groups without a README, and the root, open on the list as before', async () => {
    await open('#infra', configWith(undefined));
    expect($$('.rg-tabs .rg-tab').map((t) => t.textContent!.trim()).some((t) => t === 'About')).toBe(false);
    expect($('.rg-tabs .rg-tab')!.textContent).toContain('Groups and repositories');
  });
  it('browser navigation to another group resets to its default tab', async () => {
    await open('#infra', configWith('hello'));
    await vi.waitFor(() => expect($('.rg-md')).toBeTruthy());
    btn(/^Groups and repositories/).click();
    await vi.waitFor(() => expect($('.rg-md')).toBeNull());
    $$('.rg-crumbs a')[0].click();
    await vi.waitFor(() => expect($('.rg-g-head h1')!.textContent).not.toBe('infra'));
    expect($$('.rg-tabs .rg-tab').some((t) => t.textContent!.trim() === 'About')).toBe(false);
  });
});

describe('README field of the Edit group drawer', () => {
  const field = () => $('#rg-f-readme') as HTMLTextAreaElement;
  const save = () => btn('Save changes') as HTMLButtonElement;
  const openDrawer = async (cfg: any, extra: Parameters<typeof open>[2] = {}) => {
    const r = await open('#infra', cfg, extra);
    await vi.waitFor(() => expect(btn('Edit group')).toBeTruthy());
    btn('Edit group').click();
    await vi.waitFor(() => expect($('.rg-drawer')).toBeTruthy());
    return r;
  };
  const edited = (req: any) => ({ status: 'ok', sha: 'sha-2', config: configWith(undefined).config, warnings: [], req });

  it('has Write and Preview tabs; the text is saved as a file with the edit', async () => {
    const { log } = await openDrawer(configWith(undefined), { edit: edited });
    expect(field()).toBeTruthy();
    expect(save().disabled).toBe(true); // nothing changed yet
    type(field(), '# Hi\n\n**bold** <b>x</b>');
    await vi.waitFor(() => expect(save().disabled).toBe(false));
    $('#rg-readme-tab-preview')!.click();
    await vi.waitFor(() => expect($('.rg-md-preview .rg-md strong')!.textContent).toBe('bold'));
    expect($('.rg-md-preview b')).toBeNull();
    $('#rg-readme-tab-write')!.click();
    await vi.waitFor(() => expect(field().value).toContain('# Hi'));
    save().click();
    await vi.waitFor(() => expect(log.some((r: any) => r.type === 'org:edit')).toBe(true));
    const req: any = log.find((r: any) => r.type === 'org:edit');
    expect(req.edit).toMatchObject({ kind: 'edit', path: ['infra'], readme: { file: '# Hi\n\n**bold** <b>x</b>' } });
  });
  it('"Markdown file" mode sends the text as a file change', async () => {
    const { log } = await openDrawer(configWith(undefined), { edit: edited });
    const mode = $('#rg-f-readme-mode') as HTMLSelectElement;
    mode.value = 'file';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(field()).toBeTruthy());
    expect($('.rg-drawer')!.textContent).toContain('readmes/infra.md');
    type(field(), 'Body');
    await vi.waitFor(() => expect(save().disabled).toBe(false));
    save().click();
    await vi.waitFor(() => expect(log.some((r: any) => r.type === 'org:edit')).toBe(true));
    expect((log.find((r: any) => r.type === 'org:edit') as any).edit.readme).toEqual({ file: 'Body' });
  });
  it('path mode takes a path and rejects one outside the repository', async () => {
    const { log } = await openDrawer(configWith(undefined), { edit: edited });
    const mode = $('#rg-f-readme-mode') as HTMLSelectElement;
    mode.value = 'path';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect($('#rg-f-readme-path')).toBeTruthy());
    type($('#rg-f-readme-path') as HTMLInputElement, '../secret.md');
    await vi.waitFor(() => expect($('.rg-drawer')!.textContent).toContain('must stay inside'));
    expect(save().disabled).toBe(true);
    type($('#rg-f-readme-path') as HTMLInputElement, 'readmes/shared.md');
    await vi.waitFor(() => expect(save().disabled).toBe(false));
    save().click();
    await vi.waitFor(() => expect(log.some((r: any) => r.type === 'org:edit')).toBe(true));
    expect((log.find((r: any) => r.type === 'org:edit') as any).edit.readme).toEqual({ path: 'readmes/shared.md' });
  });
  it('blocks a README over 64 KB', async () => {
    await openDrawer(configWith(undefined), { edit: edited });
    type(field(), 'x'.repeat(64 * 1024 + 1));
    await vi.waitFor(() => expect($('.rg-drawer')!.textContent).toContain('larger than 64 KB'));
    expect(save().disabled).toBe(true);
  });
  it('shows the saved inline README, moves it to a file on load, and clearing it removes it', async () => {
    const { log } = await openDrawer(configWith('Old text\n'), { edit: edited });
    expect(field().value).toBe('Old text\n');
    type(field(), '');
    await vi.waitFor(() => expect(save().disabled).toBe(false));
    save().click();
    await vi.waitFor(() => expect(log.some((r: any) => r.type === 'org:edit' && r.edit.kind === 'edit')).toBe(true));
    expect((log.find((r: any) => r.type === 'org:edit' && r.edit.kind === 'edit') as any).edit.readme).toEqual({ remove: true });
    // the page itself already asked to move the inline README to a file (C4)
    expect(log.some((r: any) => r.type === 'org:edit' && r.edit.kind === 'migrate-readmes')).toBe(true);
  });
  it('fills in a saved file README when it arrives, without marking the form changed', async () => {
    await openDrawer(configWith('readmes/infra.md'), { files: { 'readmes/infra.md': 'From file' }, edit: edited });
    await vi.waitFor(() => expect(field().value).toBe('From file'));
    expect(save().disabled).toBe(true);
  });
  it('a member (org file read-only) gets no Edit group, so no README editor', async () => {
    await open('#infra', configWith('hi'), { access: memberAccess });
    expect($$('button').some((b) => b.textContent!.trim() === 'Edit group')).toBe(false);
    await vi.waitFor(() => expect($('.rg-md')).toBeTruthy()); // but they can read it
  });
});

describe('README drawer draft (files first)', () => {
  it('opens inline text from an older file as a file draft that migrates on save', async () => {
    const { initialReadme, isInlineReadme, readmeChange } = await import('../src/features/readme/ReadmeField');
    const d = initialReadme('# Old\n', ['infra'], undefined);
    expect(d.mode).toBe('file');
    expect(isInlineReadme('# Old\n')).toBe(true);
    expect(isInlineReadme('readmes/infra.md')).toBe(false);
    expect(readmeChange(d, '# Old\n', ['infra'], undefined)).toEqual({ file: '# Old\n' });
    expect(initialReadme(undefined, ['infra'], undefined).mode).toBe('file');
  });
});

describe('migrate-readmes', () => {
  it('moves every inline README to its file path and leaves paths alone', async () => {
    const { inlineReadmes, migrateReadmes } = await import('../src/core/edit');
    const g = example().groups;
    findGroup(g, ['infra'])!.readme = '# Infra  \r\n';
    findGroup(g, ['infra', 'dagsrv'])!.readme = 'Scheduler';
    const ai = g.find((x) => x.name === 'ai');
    if (ai) ai.readme = 'readmes/ai.md';
    expect(inlineReadmes(g)).toEqual([
      { path: ['infra'], file: 'readmes/infra.md', text: '# Infra\n' },
      { path: ['infra', 'dagsrv'], file: 'readmes/infra-dagsrv.md', text: 'Scheduler\n' },
    ]);
    const out = migrateReadmes(g);
    expect(findGroup(out, ['infra'])!.readme).toBe('readmes/infra.md');
    expect(findGroup(out, ['infra', 'dagsrv'])!.readme).toBe('readmes/infra-dagsrv.md');
    expect(inlineReadmes(out)).toEqual([]);
    expect(findGroup(g, ['infra'])!.readme).toBe('# Infra  \r\n'); // input untouched
  });
});
