// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandler } from '../src/background/handlers';
import { memoryKV } from '../src/background/kv';
import { encodeBase64Utf8 } from '../src/background/org-data';
import { memoryIndexStore } from '../src/background/repo-index';
import { failedTeamsText, filedMessage, teamPhrase } from '../src/core/newrepo';
import { mountNewRepo, mountRepoToast, type Disposable } from '../src/features/new-repo-field/mount';
import type { Request } from '../src/github/messages';
import { example, EXAMPLE } from './fixtures';
import { fakeFetch } from './fake-github';
import { memberAccess, ownerAccess, repos } from './page-helpers';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/new-repo.html'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
let mounted: Disposable | null = null;
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const nameInput = () => $('#repository-name-input') as HTMLInputElement;
const type = (v: string) => ((nameInput().value = v), nameInput().dispatchEvent(new Event('input', { bubbles: true })));
const teams = () => $$('#rg-nr-teams .rg-trow:not(.rg-muted)').map((r) => `${r.querySelector('.rg-tchip')!.textContent}:${(r.querySelector('select') as HTMLSelectElement).value}`);

function fake(opts: { access?: any } = {}) {
  const log: Request[] = [];
  const call = vi.fn(async (req: Request): Promise<any> => {
    log.push(req);
    switch (req.type) {
      case 'org:config': return { exists: true, sha: 's', config: example(), warnings: [] };
      case 'org:cached': return { repos, meta: {} };
      case 'org:access': return opts.access ?? ownerAccess;
      case 'org:teams': return { teams: ['ai-squad', 'extra', 'konnen_team'].map((slug) => ({ slug, name: slug })), customRoles: null };
      case 'newrepo:discard': return { discarded: true };
      case 'newrepo:pending': return { saved: true };
      default: throw new Error('unexpected ' + req.type);
    }
  });
  return { call: call as any, log };
}

async function open(opts: Parameters<typeof fake>[0] = {}, url = '/organizations/thekonnen/repositories/new') {
  window.history.replaceState(null, '', url);
  const f = fake(opts);
  mounted = await mountNewRepo('thekonnen', { call: f.call, location: window.location }, document, 200);
  await vi.waitFor(() => expect($('#rg-nr-teams')).toBeTruthy());
  return f;
}
const pickGroup = async (label: string) => {
  $('#rg-nr-picker')!.click();
  await vi.waitFor(() => expect(($('#rg-nr-pop') as HTMLElement).hidden).toBe(false));
  ($$('#rg-nr-pop [role="option"]').find((o) => o.textContent!.includes(label)) as HTMLElement).click();
  await vi.waitFor(() => expect($('#rg-nr-picker')!.textContent).toContain(label));
};
const pending = (f: ReturnType<typeof fake>) => {
  nameInput().closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return (f.log.filter((r) => r.type === 'newrepo:pending') as any[]).at(-1).entry;
};

beforeEach(() => (document.documentElement.innerHTML = html));
afterEach(() => {
  mounted?.dispose();
  mounted = null;
  document.documentElement.innerHTML = '';
});

describe('Teams field on Create a new repository (F12)', () => {
  it('sits directly below the Group block with the same purple tag and the hint', async () => {
    await open();
    expect($('#rg-nr-group')!.nextElementSibling).toBe($('#rg-nr-teams'));
    expect($('#rg-nr-teams-label')!.textContent).toBe('Teams');
    expect($('#rg-nr-teams .rg-ext-tag')!.textContent).toBe('Repository Group');
    expect($('#rg-nr-teams-hint')!.textContent).toContain('These teams get access right after the repository is created.');
    expect($('#rg-nr-teams-hint')!.textContent).not.toContain('You need admin access');
  });

  it('is pre-filled with the effective teams of the destination (own + inherited), each with its permission', async () => {
    await open();
    type('my-litellm');
    await vi.waitFor(() => expect(teams()).toEqual(['ai-squad:maintain', 'konnen_team:pull'])); // ai/litellm: own konnen_team (Read) + inherited ai-squad
    await pickGroup('dagu');
    await vi.waitFor(() => expect(teams()).toEqual(['konnen_team:push'])); // infra/dagu inherits infra's
    type('unmatched-name');
    await pickGroup('Automatic');
    await vi.waitFor(() => expect(teams()).toEqual([])); // ungrouped: no target
    expect($('#rg-nr-teams')!.textContent).toContain('No teams');
  });

  it('re-fills while untouched; after a manual edit the teams stay as the user set them', async () => {
    const f = await open();
    await pickGroup('infra');
    await vi.waitFor(() => expect(teams()).toEqual(['konnen_team:push']));
    const sel = $('#rg-nr-teams select') as HTMLSelectElement;
    sel.value = 'admin';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(teams()).toEqual(['konnen_team:admin']));
    await pickGroup('litellm');
    type('x-repo');
    await new Promise((r) => setTimeout(r, 20));
    expect(teams()).toEqual(['konnen_team:admin']); // sticky
    // remove, then add from the picker
    ($('[aria-label="Remove team konnen_team"]') as HTMLElement).click();
    await vi.waitFor(() => expect(teams()).toEqual([]));
    $$('#rg-nr-teams button').find((b) => b.textContent!.trim() === 'Add team')!.click();
    await vi.waitFor(() => expect($$('#rg-nr-teams [role="option"]').map((o) => o.textContent!.trim())).toEqual(['ai-squad', 'extra', 'konnen_team']));
    ($$('#rg-nr-teams [role="option"]').find((o) => o.textContent!.includes('extra')) as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(teams()).toEqual(['extra:push']));
    // the pending entry carries the final list
    expect(pending(f)).toMatchObject({ org: 'thekonnen', repo: 'x-repo', teams: [{ slug: 'extra', permission: 'push' }] });
  });

  it('the pending entry carries the pre-filled teams of the chosen group', async () => {
    const f = await open();
    type('konnen-n8n');
    await pickGroup('dagu');
    await vi.waitFor(() => expect(teams()).toEqual(['konnen_team:push']));
    expect(pending(f)).toEqual({ org: 'thekonnen', repo: 'konnen-n8n', groupPath: 'infra/dagu', explicit: true, teams: [{ slug: 'konnen_team', permission: 'push' }] });
  });

  it('members get the note about admin access on the new repository; owners do not', async () => {
    await open({ access: memberAccess });
    expect($('#rg-nr-teams-hint')!.textContent).toContain('You need admin access to the new repository to give teams access. As its creator you usually have it.');
  });
});

describe('toast text (F12)', () => {
  it('names the teams that got access, and the ones that did not', () => {
    expect(filedMessage({ groupKey: 'infra/dagu', committed: true, granted: [{ team: 'konnen_team', permission: 'push' }] })).toBe('Filed in infra / dagu · konnen_team can write · repo-groups.yml updated');
    expect(filedMessage({ groupKey: 'infra/dagu', committed: true })).toBe('Filed in infra / dagu · repo-groups.yml updated');
    expect(filedMessage({ groupKey: '', committed: false, granted: [{ team: 't', permission: 'pull' }] })).toBe('Created, not in any group yet · t can read');
    expect(teamPhrase('t', 'admin')).toBe('t has admin access');
    expect(teamPhrase('t', 'reviewer')).toBe('t has the reviewer role');
    expect(failedTeamsText([{ team: 'a', message: 'x' }, { team: 'b', message: 'y' }])).toBe('a was not added: x. b was not added: y.');
  });
});

describe('post-create grants (background + toast)', () => {
  function setup(opts: { deny?: Record<string, number>; putFile?: number } = {}) {
    let file = { text: EXAMPLE, sha: 'sha-1' };
    const f = fakeFetch((u, call) => {
      if (u.pathname === '/repos/o/.github/contents/repo-groups.yml') {
        if (call.method === 'PUT') {
          if (opts.putFile) return { status: opts.putFile, json: { message: 'Resource not accessible by integration' } };
          const body = JSON.parse(call.body!);
          file = { text: new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0))), sha: 'sha-2' };
          return { json: { content: { sha: 'sha-2' } } };
        }
        return { json: { content: encodeBase64Utf8(file.text), sha: file.sha } };
      }
      const m = u.pathname.match(/^\/orgs\/o\/teams\/([^/]+)\/repos\/o\/([^/]+)$/);
      if (m && call.method === 'PUT') {
        const status = opts.deny?.[m[1]];
        if (status) return { status, json: { message: status === 422 ? 'Validation Failed: team cannot be added' : 'Must have admin rights to Repository.' } };
        return { status: 204 };
      }
      return undefined;
    });
    const h = createHandler({ fetch: f.fetch, kv: memoryKV(), session: memoryKV(), index: memoryIndexStore(), clientId: 'c' });
    const entry = (over: object = {}) => ({ org: 'o', repo: 'konnen-n8n', groupPath: 'infra/dagu', explicit: true, teams: [{ slug: 'konnen_team', permission: 'push' }, { slug: 'ai-squad', permission: 'maintain' }], ...over });
    const teamPuts = () => f.calls.filter((c) => c.url.includes('/teams/'));
    const land = async (e = entry()) => {
      await h({ type: 'newrepo:pending', entry: e });
      return ((await h({ type: 'newrepo:landed', org: 'o', repo: e.repo })) as any).data;
    };
    return { h, f, land, entry, teamPuts, file: () => file };
  }

  it('grants each selected team its permission with PUT only, and files the repo', async () => {
    const t = setup();
    const r = await t.land();
    expect(r.committed).toBe(true);
    expect(r.grants).toEqual([
      { team: 'konnen_team', permission: 'push', ok: true },
      { team: 'ai-squad', permission: 'maintain', ok: true },
    ]);
    expect(t.teamPuts().map((c) => [c.method, c.url, JSON.parse(c.body!)])).toEqual([
      ['PUT', 'https://api.github.com/orgs/o/teams/konnen_team/repos/o/konnen-n8n', { permission: 'push' }],
      ['PUT', 'https://api.github.com/orgs/o/teams/ai-squad/repos/o/konnen-n8n', { permission: 'maintain' }],
    ]);
    expect(t.f.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('a failed grant names the team and the reason, and the other teams still go through', async () => {
    const t = setup({ deny: { 'ai-squad': 403 } });
    const r = await t.land();
    expect(r.grants[0]).toMatchObject({ team: 'konnen_team', ok: true });
    expect(r.grants[1]).toEqual({ team: 'ai-squad', permission: 'maintain', ok: false, message: 'You need admin access to this repository — ask an org owner' });
    expect(r.committed).toBe(true);
  });

  it('a failed commit does not stop the grants, and failed grants do not stop the commit', async () => {
    const a = setup({ putFile: 403 });
    const ra = await a.land();
    expect(ra.committed).toBe(false);
    expect(ra.error).toBeTruthy();
    expect(ra.grants.every((g: any) => g.ok)).toBe(true);
    const b = setup({ deny: { konnen_team: 422, 'ai-squad': 404 } });
    const rb = await b.land();
    expect(rb.committed).toBe(true);
    expect(rb.grants.map((g: any) => g.ok)).toEqual([false, false]);
    expect(rb.grants[0].message).toBe('Validation Failed: team cannot be added');
  });

  it('no teams selected: no team requests and the toast text is the old one', async () => {
    const t = setup();
    const r = await t.land(t.entry({ teams: [] }));
    expect(r.grants).toEqual([]);
    expect(t.teamPuts()).toEqual([]);
  });

  describe('toast on the repo page', () => {
    afterEach(() => (document.body.innerHTML = ''));
    const landed = (data: unknown) => vi.fn(async (req: Request): Promise<any> => (req.type === 'newrepo:landed' ? data : null));
    it('"Filed in infra / dagu · konnen_team can write · repo-groups.yml updated"', async () => {
      mounted = await mountRepoToast('o', 'konnen-n8n', { call: landed({ groupKey: 'infra/dagu', committed: true, teams: [], grants: [{ team: 'konnen_team', permission: 'push', ok: true }] }) as any });
      expect($('.rg-toast')!.textContent).toBe('Filed in infra / dagu · konnen_team can write · repo-groups.yml updated');
      expect($('.rg-toast a')).toBeNull();
    });
    it('a failed grant says which team and why, with a link to Settings → Collaborators and teams', async () => {
      const grants = [
        { team: 'konnen_team', permission: 'push', ok: true },
        { team: 'ai-squad', permission: 'maintain', ok: false, message: 'You need admin access to this repository — ask an org owner' },
      ];
      mounted = await mountRepoToast('o', 'konnen-n8n', { call: landed({ groupKey: 'infra/dagu', committed: true, teams: [], grants }) as any });
      const t = $('.rg-toast.rg-err')!;
      expect(t.textContent).toContain('Filed in infra / dagu · konnen_team can write · repo-groups.yml updated');
      expect(t.textContent).toContain('ai-squad was not added: You need admin access to this repository — ask an org owner.');
      expect(t.querySelector('a')!.getAttribute('href')).toBe('https://github.com/o/konnen-n8n/settings/access');
      expect(t.querySelector('a')!.textContent).toBe('Settings → Collaborators and teams');
    });
    it('keeps the commit-failed text and still lists the teams that were added', async () => {
      mounted = await mountRepoToast('o', 'r', { call: landed({ groupKey: 'infra/dagu', committed: false, error: 'You cannot write to o/.github.', teams: [], grants: [{ team: 't', permission: 'push', ok: true }] }) as any });
      expect($('.rg-toast.rg-err')!.textContent).toContain('repo-groups.yml was not updated. You cannot write to o/.github. · t can write');
    });
  });
});
