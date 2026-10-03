// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountOrgRepos, type Mounted } from '../src/features/mount';
import type { Request } from '../src/github/messages';
import { example } from './fixtures';
import { fakeCall } from './page-helpers';

// happy-dom has no canvas or image decoding: the cropper's drawing is replaced, the rest runs for real.
vi.mock('../src/features/logo-cropper/render', () => ({
  decodeImage: async () => ({ img: {}, w: 400, h: 200 }),
  drawCrop: () => {},
  renderPng: () => 'data:image/png;base64,UE5HREFUQQ==',
}));

const PNG = 'UE5HREFUQQ==';
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
const btn = (label: string | RegExp, within: ParentNode = document) =>
  ([...within.querySelectorAll('button, a')] as HTMLElement[]).find((b) => (typeof label === 'string' ? b.textContent!.trim() === label : label.test(b.textContent!.trim())))!;
const drawer = () => $('.rg-drawer');
const file = (type: string, size = 100, name = 'logo.png') => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const choose = (f: File) => {
  const input = $('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const DATA = 'data:image/png;base64,AAAA';
interface Opts {
  logos?: Record<string, string | null>;
  edit?: (req: any) => any;
  fetchLink?: (url: string) => Promise<{ dataUrl: string }>;
}

/** The page with the standard fake background plus the two logo messages. */
async function open(hash: string, o: Opts = {}) {
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories' + hash);
  const base = fakeCall({ edit: o.edit });
  const log: Request[] = [];
  const call = vi.fn(async (req: Request): Promise<any> => {
    log.push(req);
    if (req.type === 'logos:get') return Object.fromEntries(req.srcs.map((s) => [s, o.logos?.[s] ?? null]));
    if (req.type === 'logo:fetch-link') return (o.fetchLink ?? (async () => ({ dataUrl: DATA })))(req.url);
    return base.call(req);
  });
  mounted = (await mountOrgRepos('thekonnen', { call: call as any }, document, 200))!;
  await vi.waitFor(() => expect($('.rg-g-head')).toBeTruthy());
  return { log, call };
}

const withLogo = (path: string[], logo: string | null) => (req: any) => {
  void req;
  const cfg = structuredClone(example());
  let g: any = { groups: cfg.groups };
  for (const p of path) g = g.groups.find((x: any) => x.name === p);
  g.logo = logo;
  return { status: 'ok', sha: 'sha-2', config: cfg, warnings: [] };
};

describe('logo display (F7)', () => {
  it('shows the logo in the header, breadcrumb, group rows and the sidebar tree, loaded through the background', async () => {
    const { log } = await open('#infra', { logos: { 'logos/infra-dagu.png': DATA } });
    await vi.waitFor(() => expect(log.some((r) => r.type === 'logos:get')).toBe(true));
    expect((log.find((r) => r.type === 'logos:get') as any).srcs).toEqual(['logos/infra-dagu.png']);
    // sidebar tree (16px) for infra/dagu
    await vi.waitFor(() => expect($('.rg-tree-logo')).toBeTruthy());
    expect(($('.rg-tree-logo') as HTMLImageElement).src).toBe(DATA);
    // dagu is a subgroup of infra: its row has the logo, infra's own avatar is a letter
    await vi.waitFor(() => expect($$('.rg-root[data-rg="view"] .rg-row img.rg-av').length).toBe(1));
    expect($$('.rg-root[data-rg="view"] .rg-row .rg-av').filter((e) => e.tagName === 'SPAN').length).toBeGreaterThan(0);
    // open dagu: header (big) and breadcrumb (mini)
    ($$('.rg-root[data-rg="view"] .rg-grp').find((a) => a.textContent === 'dagu')!).click();
    await vi.waitFor(() => expect($('img.rg-big-av')).toBeTruthy());
    expect(($('img.rg-big-av') as HTMLImageElement).src).toBe(DATA);
    expect($('.rg-crumbs img.rg-mini-av')).toBeTruthy();
  });

  it('falls back to the letter when the logo cannot be loaded, or the image fails', async () => {
    await open('#infra/dagu', { logos: { 'logos/infra-dagu.png': null } });
    await vi.waitFor(() => expect($('.rg-g-title .rg-big-av')).toBeTruthy());
    expect($('.rg-g-title .rg-big-av')!.tagName).toBe('SPAN');
    expect($('.rg-g-title .rg-big-av')!.textContent).toBe('D');
    expect($('.rg-tree-logo')).toBeNull();
    mounted!.dispose();

    await open('#infra/dagu', { logos: { 'logos/infra-dagu.png': 'data:image/png;base64,broken' } });
    await vi.waitFor(() => expect($('img.rg-big-av')).toBeTruthy());
    $('img.rg-big-av')!.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect($('.rg-g-title .rg-big-av')!.tagName).toBe('SPAN'));
    $('.rg-tree-logo')?.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect($('.rg-tree-logo')).toBeNull());
  });
});

describe('big avatar button (F3)', () => {
  it('is a button with a pencil on non-root groups; it opens Edit group focused on the logo', async () => {
    await open('#infra/dagu');
    await vi.waitFor(() => expect($('.rg-big-av-btn')).toBeTruthy());
    expect($('.rg-big-av-btn .rg-pen')).toBeTruthy();
    $('.rg-big-av-btn')!.click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    expect($('#rg-drawer-title')!.textContent).toBe('Edit group infra / dagu');
    expect(document.activeElement).toBe($('#rg-logo-upload'));
  });
  it('is not a button on the org root', async () => {
    await open('');
    await vi.waitFor(() => expect($('.rg-g-title .rg-big-av')).toBeTruthy());
    expect($('.rg-big-av-btn')).toBeNull();
  });
  it('Edit group still focuses the name field', async () => {
    await open('#infra/dagu');
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    expect(document.activeElement).toBe($('#rg-f-name'));
  });
});

describe('logo field and cropper (F7)', () => {
  async function openDrawer(o: Opts = {}) {
    const ctx = await open('#ai/litellm', o);
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    return ctx;
  }
  const saveBtn = () => $('.rg-drawer-foot .rg-btn-primary') as HTMLButtonElement;

  it('has the Logo field first, with upload (accept image/*), link and the limits hint', async () => {
    await openDrawer();
    const labels = $$('.rg-drawer .rg-field > label').map((l) => l.textContent);
    expect(labels[0]).toBe('Logo');
    expect(($('input[type=file]') as HTMLInputElement).accept).toBe('image/*');
    expect($('.rg-logo-field')!.textContent).toContain('PNG, JPG, SVG or WebP up to 5 MB. You can also drop a file here or paste an image.');
    expect(btn('Use the letter instead')).toBeUndefined(); // no logo yet
  });

  it('upload -> crop -> Use this crop -> Save sends the PNG with the edit', async () => {
    const { log } = await openDrawer({ edit: withLogo(['ai', 'litellm'], 'logos/ai-litellm.png') });
    expect(saveBtn().disabled).toBe(true);
    choose(file('image/png'));
    await vi.waitFor(() => expect($('.rg-cropper canvas')).toBeTruthy());
    expect($('.rg-cropper canvas')!.getAttribute('width')).toBe('280');
    expect(document.activeElement).toBe($('.rg-cropper canvas'));
    btn('Use this crop').click();
    await vi.waitFor(() => expect($('.rg-cropper')).toBeNull());
    expect(($('.rg-logo-field img') as HTMLImageElement).src).toBe(`data:image/png;base64,${PNG}`);
    expect(saveBtn().disabled).toBe(false);
    expect(btn('Use the letter instead')).toBeTruthy();
    saveBtn().click();
    await vi.waitFor(() => expect(drawer()).toBeNull());
    const sent = log.find((r) => r.type === 'org:edit') as any;
    expect(sent.edit.logo).toEqual({ png: PNG });
    expect(sent.edit).toMatchObject({ kind: 'edit', path: ['ai', 'litellm'], name: 'litellm' });
    // the new logo shows right away, without waiting for the file
    await vi.waitFor(() => expect($('img.rg-big-av')).toBeTruthy());
    expect(($('img.rg-big-av') as HTMLImageElement).src).toBe(`data:image/png;base64,${PNG}`);
  });

  it('Cancel and Esc close the cropper but keep the drawer', async () => {
    await openDrawer();
    choose(file('image/png'));
    await vi.waitFor(() => expect($('.rg-cropper')).toBeTruthy());
    btn('Cancel', $('.rg-cropper')!).click();
    await vi.waitFor(() => expect($('.rg-cropper')).toBeNull());
    expect(drawer()).toBeTruthy();
    expect(saveBtn().disabled).toBe(true); // nothing changed
    choose(file('image/png'));
    await vi.waitFor(() => expect($('.rg-cropper canvas')).toBeTruthy());
    $('.rg-cropper canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect($('.rg-cropper')).toBeNull());
    expect(drawer()).toBeTruthy();
  });

  it('keyboard: plus and minus zoom, the slider and wheel zoom, within 1x–5x', async () => {
    await openDrawer();
    choose(file('image/png'));
    await vi.waitFor(() => expect($('.rg-cropper canvas')).toBeTruthy());
    const cv = $('.rg-cropper canvas')!;
    const out = () => $('.rg-zoom-row output')!.textContent;
    expect(out()).toBe('1.0×');
    cv.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(out()).toBe('1.1×'));
    cv.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }));
    cv.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(out()).toBe('1.0×')); // never below 1
    const slider = $('.rg-zoom-row input') as HTMLInputElement;
    slider.value = '9';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(out()).toBe('5.0×')); // never above 5
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(Number(out()!.replace('×', ''))).toBeLessThan(5));
  });

  it('rejects files that are not images, too large, or an unsupported type, in plain language', async () => {
    await openDrawer();
    choose(file('application/pdf'));
    await vi.waitFor(() => expect($('.rg-logo-field ~ .rg-error')!.textContent).toBe('That file is not an image. Choose a PNG, JPG, SVG or WebP.'));
    choose(file('image/png', 6 * 1024 * 1024));
    await vi.waitFor(() => expect($('.rg-logo-field ~ .rg-error')!.textContent).toBe('That image is larger than 5 MB. Choose a smaller file.'));
    choose(file('image/gif'));
    await vi.waitFor(() => expect($('.rg-logo-field ~ .rg-error')!.textContent).toMatch(/not supported/));
    expect($('.rg-cropper')).toBeNull();
  });

  it('accepts a dropped file and a pasted image (but not pasted text)', async () => {
    await openDrawer();
    const zone = $('.rg-logo-field')!;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file('image/webp', 10, 'a.webp')] } });
    zone.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(zone.classList.contains('rg-drop-on')).toBe(true));
    zone.dispatchEvent(drop);
    await vi.waitFor(() => expect($('.rg-cropper')).toBeTruthy());
    expect(zone.classList.contains('rg-drop-on')).toBe(false);
    btn('Cancel', $('.rg-cropper')!).click();
    await vi.waitFor(() => expect($('.rg-cropper')).toBeNull());

    const paste = (files: File[]) => {
      const ev = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: { files } });
      document.dispatchEvent(ev);
      return ev;
    };
    expect(paste([]).defaultPrevented).toBe(false);
    expect(paste([file('image/png')]).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect($('.rg-cropper')).toBeTruthy());
  });

  it('Paste a link: loads the image in the background, then crops it', async () => {
    const { log } = await openDrawer();
    btn('Paste a link').click();
    await vi.waitFor(() => expect($('#rg-logo-url')).toBeTruthy());
    const input = $('#rg-logo-url') as HTMLInputElement;
    input.value = 'https://img.example.org/logo.png';
    btn('Load').click();
    await vi.waitFor(() => expect($('.rg-cropper')).toBeTruthy());
    expect(log.find((r) => r.type === 'logo:fetch-link')).toEqual({ type: 'logo:fetch-link', url: 'https://img.example.org/logo.png' });
    expect($('#rg-logo-url')).toBeNull();
  });

  it('Paste a link: shows the permission message when the person declines, and rejects non-https links', async () => {
    const msg = 'Allow access to img.example.org to load this image, or download it and upload the file.';
    const { log } = await openDrawer({ fetchLink: async () => { throw new Error(msg); } });
    btn('Paste a link').click();
    await vi.waitFor(() => expect($('#rg-logo-url')).toBeTruthy());
    const input = $('#rg-logo-url') as HTMLInputElement;
    input.value = 'http://img.example.org/logo.png';
    btn('Load').click();
    await vi.waitFor(() => expect($('.rg-logo-field ~ .rg-add-rule ~ .rg-error, .rg-logo-field ~ .rg-error')!.textContent).toBe('Enter a direct link that starts with https://.'));
    expect(log.some((r) => r.type === 'logo:fetch-link')).toBe(false);
    input.value = 'https://img.example.org/logo.png';
    btn('Load').click();
    await vi.waitFor(() => expect($('.rg-error[role=alert]')!.textContent).toBe(msg));
    expect($('.rg-cropper')).toBeNull();
  });

  it('Use the letter instead removes the logo of a group that has one', async () => {
    const { log } = await open('#infra/dagu', { logos: { 'logos/infra-dagu.png': DATA }, edit: withLogo(['infra', 'dagu'], null) });
    await vi.waitFor(() => btn('Edit group'));
    btn('Edit group').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    await vi.waitFor(() => expect(($('.rg-logo-field img') as HTMLImageElement)?.src).toBe(DATA));
    btn('Use the letter instead').click();
    await vi.waitFor(() => expect($('.rg-logo-field span.rg-big-av')).toBeTruthy());
    expect($('.rg-logo-field img')).toBeNull();
    saveBtn().click();
    await vi.waitFor(() => expect(drawer()).toBeNull());
    expect((log.find((r) => r.type === 'org:edit') as any).edit.logo).toEqual({ remove: true });
    await vi.waitFor(() => expect($('.rg-g-title span.rg-big-av')).toBeTruthy());
  });

  it('works when creating a new group, with the path taken from the final name', async () => {
    const { log } = await open('#ai', { edit: withLogo([], null) });
    await vi.waitFor(() => btn('New subgroup'));
    btn('New subgroup').click();
    await vi.waitFor(() => expect(drawer()).toBeTruthy());
    const name = $('#rg-f-name') as HTMLInputElement;
    name.value = 'Vision';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    choose(file('image/jpeg'));
    await vi.waitFor(() => expect($('.rg-cropper')).toBeTruthy());
    btn('Use this crop').click();
    await vi.waitFor(() => expect(saveBtn().disabled).toBe(false));
    saveBtn().click();
    await vi.waitFor(() => expect(drawer()).toBeNull());
    expect((log.find((r) => r.type === 'org:edit') as any).edit).toMatchObject({ kind: 'new', parent: ['ai'], name: 'vision', logo: { png: PNG } });
  });
});
