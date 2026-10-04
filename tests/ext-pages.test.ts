// @vitest-environment happy-dom
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  send: vi.fn(),
  query: vi.fn(),
  create: vi.fn(async () => ({})),
  openOptionsPage: vi.fn(),
  permRequest: vi.fn(async () => true),
}));
vi.mock('wxt/browser', () => ({
  browser: { permissions: { request: mock.permRequest }, runtime: { sendMessage: mock.send, openOptionsPage: mock.openOptionsPage }, tabs: { query: mock.query, create: mock.create }, i18n: { getMessage: () => '' } },
}));

import { App as Popup } from '../src/entrypoints/popup/App';
import { App as Options } from '../src/entrypoints/options/App';

const root = () => document.getElementById('root')!;
const text = () => root().textContent ?? '';
const settle = () => vi.waitFor(() => expect(true).toBe(true), { timeout: 50 }).then(() => new Promise((r) => setTimeout(r, 10)));
const ok = (data: unknown) => ({ ok: true, data });
const bad = (message: string, hint?: string) => ({ ok: false, error: { kind: 'auth', message, hint } });

const ORGS = [
  { login: 'thekonnen', avatarUrl: 'https://a/t.png', hasFile: true },
  { login: 'acme', avatarUrl: 'https://a/a.png', hasFile: false },
];

let log: any[];
function backend(over: Record<string, (req: any) => unknown> = {}) {
  const prefs: Record<string, any> = {};
  mock.send.mockImplementation(async (req: any) => {
    log.push(req);
    if (over[req.type]) return over[req.type](req);
    switch (req.type) {
      case 'auth:status': return ok({ signedIn: true, login: 'ana', avatarUrl: 'https://a/ana.png', kind: 'oauth' });
      case 'orgs:list': return ok({ orgs: ORGS, fetchedAt: 1 });
      case 'prefs:get': return ok(prefs[req.org] ?? {});
      case 'prefs:set': return ok((prefs[req.org] = { ...prefs[req.org], ...req.prefs }));
      case 'settings:get': return ok({ refreshMinutes: 5 });
      case 'settings:set': return ok({ refreshMinutes: req.settings.refreshMinutes });
      case 'cache:clear': return ok({ removed: 2 });
      case 'auth:signout': return ok({ signedIn: false });
    }
    return ok({});
  });
}

beforeEach(() => {
  log = [];
  document.body.innerHTML = '<div id="root"></div>';
  mock.query.mockResolvedValue([{ url: 'https://github.com/orgs/thekonnen/people' }]);
  mock.create.mockClear();
});
afterEach(() => render(null, root()));

describe('popup', () => {
  it('shows the account, only orgs with a repo-groups.yml, and links to the grouped view', async () => {
    backend();
    render(h(Popup, {}), root());
    await vi.waitFor(() => expect(root().querySelectorAll('.orgs a')).toHaveLength(1));
    expect(text()).toContain('ana');
    const a = root().querySelector('.orgs a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://github.com/orgs/thekonnen/repositories');
    expect(text()).not.toContain('acme');
  });
  it('has no separate "Open grouped view" button: the org row already links there', async () => {
    backend();
    render(h(Popup, {}), root());
    await vi.waitFor(() => expect(root().querySelectorAll('.orgs a')).toHaveLength(1));
    expect([...root().querySelectorAll('button')].some((b) => b.textContent?.startsWith('Open grouped'))).toBe(false);
  });
  it('still renders when the tab url cannot be read', async () => {
    backend();
    mock.query.mockRejectedValue(new Error('no'));
    render(h(Popup, {}), root());
    await vi.waitFor(() => expect(root().querySelectorAll('.orgs a')).toHaveLength(1));
  });
  it('starts the device flow when signed out and shows the code', async () => {
    backend({
      'auth:status': () => ok({ signedIn: false }),
      'auth:start': () => ok({ deviceCode: 'dc', userCode: 'AB-12', verificationUri: 'https://github.com/login/device', interval: 3600 }),
    });
    render(h(Popup, {}), root());
    const btn = await vi.waitFor(() => {
      const b = [...root().querySelectorAll('button')].find((x) => x.textContent === 'Sign in with GitHub');
      expect(b).toBeTruthy();
      return b!;
    });
    expect(log.some((r) => r.type === 'orgs:list')).toBe(false);
    btn.click();
    await vi.waitFor(() => expect(text()).toContain('AB-12'));
  });
});

describe('options page', () => {
  const find = (sel: string) => root().querySelector(sel) as HTMLElement;
  const input = (el: HTMLElement, value: string) => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('lists orgs with the "grouped by default" toggle on by default and saves it', async () => {
    backend();
    render(h(Options, {}), root());
    const box = (await vi.waitFor(() => {
      const el = find('#rg-org-acme');
      expect(el).toBeTruthy();
      return el;
    })) as HTMLInputElement;
    await vi.waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(true);
    expect(text()).toContain('no repo-groups.yml yet');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(log).toContainEqual({ type: 'prefs:set', org: 'acme', prefs: { groupedByDefault: false } }));
  });
  it('saves a token read from the field and shows the policy hint when it is rejected', async () => {
    backend({ 'auth:pat': (r) => (r.token === 'good' ? ok({ signedIn: true, login: 'ana', kind: 'pat' }) : bad('Resource protected by organization SAML enforcement', 'Authorize the token for SSO.')) });
    render(h(Options, {}), root());
    const field = (await vi.waitFor(() => {
      const el = find('#rg-token');
      expect(el).toBeTruthy();
      return el;
    })) as HTMLInputElement;
    expect(field.type).toBe('password');
    field.value = 'nope';
    find('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(find('[role=alert]').textContent).toContain('Authorize the token for SSO.'));
    field.value = ' good ';
    find('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(log).toContainEqual({ type: 'auth:pat', token: 'good' }));
    await vi.waitFor(() => expect(text()).toContain('Token saved. You are signed in as ana.'));
    expect(field.value).toBe('');
  });
  it('explains token kinds and org policy (F15) and the Action index privacy warning (F14)', async () => {
    backend();
    render(h(Options, {}), root());
    await settle();
    expect(text()).toContain('repo and read:org');
    expect(text()).toContain('resource owner is the organization');
    expect(text()).toContain('authorize the token for SSO');
    expect(text()).toContain('index: action');
    expect(text()).toContain('including private ones they cannot open');
  });
  it('clears the cache and saves the refresh interval', async () => {
    backend();
    render(h(Options, {}), root());
    const interval = (await vi.waitFor(() => {
      const el = find('#rg-interval') as HTMLInputElement;
      expect(el.value).toBe('5');
      return el;
    })) as HTMLInputElement;
    input(interval, '20');
    await vi.waitFor(() => expect(log).toContainEqual({ type: 'settings:set', settings: { refreshMinutes: 20 } }));
    const clear = [...root().querySelectorAll('button')].find((b) => b.textContent === 'Clear cache')!;
    clear.click();
    await vi.waitFor(() => expect(log.some((r) => r.type === 'cache:clear')).toBe(true));
    await vi.waitFor(() => expect(text()).toContain('Cache cleared.'));
  });
  it('shows the sign-in button and no org call when signed out', async () => {
    backend({ 'auth:status': () => ok({ signedIn: false }) });
    render(h(Options, {}), root());
    await vi.waitFor(() => expect(text()).toContain('Sign in to list your organizations.'));
    expect(log.some((r) => r.type === 'orgs:list')).toBe(false);
    expect([...root().querySelectorAll('button')].some((b) => b.textContent === 'Sign in with GitHub')).toBe(true);
  });
  it('shows an org load error with its hint', async () => {
    backend({ 'orgs:list': () => bad('Resource protected by organization SAML enforcement', 'Authorize the token for SSO.') });
    render(h(Options, {}), root());
    await vi.waitFor(() => expect(text()).toContain('Could not load organizations: Resource protected'));
    expect(text()).toContain('Authorize the token for SSO.');
  });
});

describe('options page: AI providers', () => {
  const find = (sel: string) => root().querySelector(sel) as HTMLElement;
  const radio = (i: number) => root().querySelectorAll('input[name="mode"]')[i] as HTMLInputElement;
  const STATUS = { configured: true, mode: 'gemini', gemini: { configured: true }, custom: { configured: true, baseUrl: 'https://llm.example.com/v1', model: 'my-model' }, fallback: true, auto: true, keysUrl: 'https://aistudio.google.com/api-keys' };
  const open = async (status: any = STATUS, extra: Record<string, (req: any) => unknown> = {}) => {
    backend({ 'llm:status': () => ok(status), ...extra });
    render(h(Options, {}), root());
    await vi.waitFor(() => expect(find('#rg-ai-order')).toBeTruthy()); // the status has arrived
  };
  const pickRadio = (i: number) => {
    radio(i).checked = true;
    radio(i).dispatchEvent(new Event('change', { bubbles: true }));
  };
  const toggle = (el: HTMLInputElement) => {
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const aiForm = () => find('#rg-ai-key').closest('form')!;

  it('keeps the saved endpoint and model when switching to Gemini and back', async () => {
    await open();
    pickRadio(2);
    await vi.waitFor(() => expect((find('#rg-ai-endpoint') as HTMLInputElement).value).toBe('https://llm.example.com/v1'));
    expect((find('#rg-ai-model') as HTMLInputElement).value).toBe('my-model');
    pickRadio(0);
    await vi.waitFor(() => expect(find('#rg-ai-endpoint')).toBeNull());
    pickRadio(2);
    await vi.waitFor(() => expect((find('#rg-ai-endpoint') as HTMLInputElement).value).toBe('https://llm.example.com/v1'));
  });

  it('saving Gemini sends only Gemini: nothing of the custom endpoint', async () => {
    await open(STATUS, { 'llm:save': () => ok({ ...STATUS, mode: 'gemini' }) });
    (aiForm().querySelector('button[type="submit"]') as HTMLElement).click();
    await vi.waitFor(() => expect(log.some((r) => r.type === 'llm:save')).toBe(true));
    const save = log.find((r) => r.type === 'llm:save');
    expect(save.config.mode).toBe('gemini');
    expect(save.config.apiKey).toBe('');
  });

  it('shows which provider is saved and which is tried first', async () => {
    await open();
    expect(text()).toContain('Google Gemini (AI Studio) · saved, tried first');
    expect(text()).toContain('Another provider (OpenAI-compatible endpoint) · saved');
    expect(find('#rg-ai-order').textContent).toContain('Order: Google Gemini (AI Studio), then Another provider');
  });

  it('enables the fallback only when both providers are saved, on by default, and saves the choice', async () => {
    await open(STATUS, { 'llm:fallback': (r) => ok({ ...STATUS, fallback: r.fallback }) });
    const box = find('#rg-ai-fallback') as HTMLInputElement;
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(true);
    toggle(box);
    await vi.waitFor(() => expect(log.find((r) => r.type === 'llm:fallback')).toMatchObject({ fallback: false }));
  });

  it('keeps the fallback off and explains why when only one provider is saved', async () => {
    await open({ ...STATUS, custom: { configured: false } });
    expect((find('#rg-ai-fallback') as HTMLInputElement).disabled).toBe(true);
    expect(text()).toContain('Save both providers to enable the fallback.');
    expect(find('#rg-ai-order').textContent).toContain('Only Google Gemini');
  });

  it('tests and removes only the selected provider', async () => {
    await open(STATUS, { 'llm:test': () => ok({ model: 'm1', provider: 'gemini' }), 'llm:clear': () => ok({ ...STATUS, custom: { configured: false } }) });
    const [save, test, remove] = [...aiForm().querySelectorAll('.inline button')] as HTMLButtonElement[];
    test.click();
    await vi.waitFor(() => expect(log.find((r) => r.type === 'llm:test')).toMatchObject({ mode: 'gemini' }));
    await vi.waitFor(() => expect(text()).toContain('works. Model: m1.'));
    remove.click();
    await vi.waitFor(() => expect(log.find((r) => r.type === 'llm:clear')).toMatchObject({ mode: 'gemini' }));
    expect(save).toBeTruthy();
  });
});
