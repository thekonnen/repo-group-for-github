// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountOrgRepos, type Mounted } from '../src/features/mount';
import { fakeCall } from './page-helpers';

const body = readFileSync(join(process.cwd(), 'tests/fixtures/org-repos.html'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
let mounted: Mounted | null = null;
const written = vi.fn();

beforeEach(() => {
  document.documentElement.innerHTML = body;
  written.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: written }, configurable: true });
});
afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.documentElement.innerHTML = '';
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const item = (label: string) => ([...document.querySelectorAll('.rg-ctx-item')] as HTMLElement[]).find((b) => b.textContent!.trim() === label)!;
const tick = () => new Promise((r) => setTimeout(r, 20));

async function open(hash = '#infra') {
  window.history.replaceState(null, '', '/orgs/thekonnen/repositories' + hash);
  const fc = fakeCall();
  mounted = (await mountOrgRepos('thekonnen', { call: fc.call }, document, 200))!;
  await vi.waitFor(() => expect($('.rg-ctx')).toBeTruthy());
  ($('.rg-ctx summary') as HTMLElement).click();
  await vi.waitFor(() => expect($('.rg-ctx-panel')).toBeTruthy());
  return fc;
}

describe('Context for agents menu (D4)', () => {
  it('copies the context pack of the current group, with no request to the background', async () => {
    const fc = await open();
    const before = fc.log.length;
    item('Copy context for agents').click();
    await vi.waitFor(() => expect(written).toHaveBeenCalledOnce());
    const text = written.mock.calls[0][0] as string;
    expect(text).toContain('# Context: thekonnen / infra');
    expect(text).toContain('https://github.com/thekonnen/dagsrv');
    await vi.waitFor(() => expect($('.rg-ctx-note')!.textContent).toContain('Copied'));
    expect(fc.log.length).toBe(before);
  });

  it('copies the AGENTS.md snippet', async () => {
    await open();
    item('Copy AGENTS.md snippet').click();
    await vi.waitFor(() => expect(written).toHaveBeenCalledOnce());
    expect(written.mock.calls[0][0]).toContain('This repository belongs to the group `thekonnen / infra`');
  });

  it('downloads a .md file named after the org and the group path', async () => {
    const urls: Blob[] = [];
    (URL as any).createObjectURL = (b: Blob) => (urls.push(b), 'blob:x');
    (URL as any).revokeObjectURL = () => {};
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    await open('#infra/dagsrv');
    item('Download .md').click();
    await tick();
    expect(names).toEqual(['thekonnen-infra-dagsrv-context.md']);
    expect(urls).toHaveLength(1);
    expect(await urls[0].text()).toContain('# Context: thekonnen / infra / ');
    click.mockRestore();
  });

  it('shows the text selected in a read-only box when the clipboard is refused', async () => {
    written.mockRejectedValue(new Error('denied'));
    await open();
    item('Copy context for agents').click();
    await vi.waitFor(() => expect($('.rg-ctx-fallback')).toBeTruthy());
    const ta = $('.rg-ctx-fallback') as HTMLTextAreaElement;
    expect(ta.readOnly).toBe(true);
    expect(ta.value).toContain('# Context: thekonnen / infra');
    expect($('.rg-ctx-note')!.textContent).toContain('Ctrl+C');
  });

  it('is available on the top level too', async () => {
    await open('');
    item('Copy context for agents').click();
    await vi.waitFor(() => expect(written).toHaveBeenCalledOnce());
    expect(written.mock.calls[0][0]).toContain('# Context: thekonnen / All groups');
  });
});
