import { describe, expect, it } from 'vitest';
import { createClient } from '../src/background/api';
import { commitEdit, createDotGithub } from '../src/background/commit';
import { createHandler } from '../src/background/handlers';
import { memoryKV } from '../src/background/kv';
import { decodeBase64Utf8, encodeBase64Utf8 } from '../src/background/org-data';
import { memoryIndexStore } from '../src/background/repo-index';
import { findGroup } from '../src/core/placement';
import { readConfig } from '../src/core/yaml-read';
import { EXAMPLE, load } from './fixtures';
import { fakeFetch, type Route } from './fake-github';

const b64 = encodeBase64Utf8;
const client = (f: ReturnType<typeof fakeFetch>) => createClient({ fetch: f.fetch, getToken: async () => 't' });

interface World {
  file: { text: string; sha: string } | null;
  repo: boolean;
  putErrors: { status: number; message: string }[]; // consumed one per PUT
  onPut?: (body: any) => void;
}
const world = (w: Partial<World> = {}) => {
  const s: World = { file: { text: EXAMPLE, sha: 'sha-1' }, repo: true, putErrors: [], ...w };
  const routes: Route[] = [
    (u, call) => {
      if (u.pathname !== '/repos/o/.github/contents/repo-groups.yml') return undefined;
      if (call.method === 'PUT') {
        const body = JSON.parse(call.body!);
        s.onPut?.(body);
        const err = s.putErrors.shift();
        if (err) return { status: err.status, json: { message: err.message } };
        if (s.file && body.sha !== s.file.sha) return { status: 409, json: { message: 'does not match' } };
        if (!s.file && body.sha) return { status: 422, json: { message: 'sha was not supplied' } };
        s.file = { text: decodeBase64Utf8(body.content), sha: 'sha-' + (Number(s.file?.sha.split('-')[1] ?? 0) + 1) };
        return { status: s.file.sha === 'sha-1' ? 201 : 200, json: { content: { sha: s.file.sha }, commit: { sha: 'c' } } };
      }
      return s.file ? { json: { content: b64(s.file.text), sha: s.file.sha } } : { status: 404, json: { message: 'Not Found' } };
    },
    (u) => (u.pathname === '/repos/o/.github' ? (s.repo ? { json: { default_branch: 'main', permissions: { push: true } } } : { status: 404, json: {} }) : undefined),
  ];
  return { s, f: fakeFetch(...routes) };
};
const puts = (f: ReturnType<typeof fakeFetch>) => f.calls.filter((c) => c.method === 'PUT');
const parsed = (text: string) => readConfig(text, load, { org: 'o' }).config!;

describe('commitEdit (F5/F6, §7)', () => {
  it('edits a group, commits canonical YAML with the sha and a conventional message', async () => {
    const { s, f } = world();
    const kv = memoryKV();
    const r = await commitEdit(client(f), kv, 'o', { kind: 'edit', path: ['infra', 'dagu'], name: 'dagu', description: 'Jobs', match: ['dagu', 'dags-*'] });
    expect(r).toMatchObject({ status: 'ok', sha: 'sha-2' });
    const body = JSON.parse(puts(f)[0].body!);
    expect(body.message).toBe('chore(repo-groups): edit group infra/dagu');
    expect(body.sha).toBe('sha-1');
    expect(s.file!.text.startsWith('# o/.github/repo-groups.yml\nversion: 1\ngroups:\n')).toBe(true);
    const cfg = parsed(s.file!.text);
    expect(findGroup(cfg.groups, ['infra', 'dagu'])).toMatchObject({ description: 'Jobs', match: ['dagu', 'dags-*'], logo: 'logos/infra-dagu.png' });
    expect(findGroup(cfg.groups, ['infra'])!.teams).toEqual([{ slug: 'konnen_team', permission: 'push' }]); // untouched
    expect(findGroup(cfg.groups, ['ai', 'litellm'])).toBeTruthy();
    expect((await kv.get<any>('rg:file:o'))).toMatchObject({ exists: true, sha: 'sha-2' });
  });
  it('creates a group, and creates the file when it does not exist yet (no sha sent)', async () => {
    const { s, f } = world({ file: null });
    const r = await commitEdit(client(f), memoryKV(), 'o', { kind: 'new', parent: [], name: 'Data', description: 'Pipelines', match: ['etl-*'] });
    expect(r.status).toBe('ok');
    expect(JSON.parse(puts(f)[0].body!)).toMatchObject({ message: 'chore(repo-groups): add group data' });
    expect('sha' in JSON.parse(puts(f)[0].body!)).toBe(false);
    expect(parsed(s.file!.text).groups.map((g) => g.name)).toEqual(['data']);
  });
  it('keeps index: action and the version', async () => {
    const { s, f } = world({ file: { text: 'version: 1\nindex: action\ngroups:\n  - name: a\n', sha: 'sha-1' } });
    await commitEdit(client(f), memoryKV(), 'o', { kind: 'new', parent: ['a'], name: 'b', description: '', match: [] });
    expect(s.file!.text).toContain('index: action');
  });
  it('on a conflict, refetches the file and re-applies the same change once', async () => {
    const { s, f } = world();
    // Someone else commits between our GET and PUT: first PUT conflicts, and the file now has another group.
    let first = true;
    s.onPut = () => {
      if (first) {
        first = false;
        s.file = { text: EXAMPLE.replace('groups:\n', 'groups:\n  - name: theirs\n'), sha: 'sha-9' };
      }
    };
    const r = await commitEdit(client(f), memoryKV(), 'o', { kind: 'new', parent: [], name: 'mine', description: '', match: [] });
    expect(r.status).toBe('ok');
    expect(puts(f)).toHaveLength(2);
    expect(JSON.parse(puts(f)[1].body!).sha).toBe('sha-9');
    expect(parsed(s.file!.text).groups.map((g) => g.name)).toEqual(['theirs', 'infra', 'ai', 'mine']);
  });
  it('gives up after a second conflict with a plain message', async () => {
    const { f } = world({ putErrors: [{ status: 409, message: 'x' }, { status: 409, message: 'x' }] });
    await expect(commitEdit(client(f), memoryKV(), 'o', { kind: 'new', parent: [], name: 'x', description: '', match: [] })).rejects.toThrow('The file changed on GitHub while saving. Reload the page and try again.');
    expect(puts(f)).toHaveLength(2);
  });
  it('explains a protected default branch and missing write access', async () => {
    const a = world({ putErrors: [{ status: 403, message: 'Protected branch update failed for refs/heads/main.' }] });
    await expect(commitEdit(client(a.f), memoryKV(), 'o', { kind: 'new', parent: [], name: 'x', description: '', match: [] })).rejects.toThrow(/default branch of o\/\.github is protected/);
    const b = world({ putErrors: [{ status: 403, message: 'Resource not accessible by integration' }] });
    await expect(commitEdit(client(b.f), memoryKV(), 'o', { kind: 'new', parent: [], name: 'x', description: '', match: [] })).rejects.toThrow('You cannot write to o/.github. Ask an org owner for access, or organize in My groups.');
    const c = world({ putErrors: [{ status: 404, message: 'Not Found' }] });
    await expect(commitEdit(client(c.f), memoryKV(), 'o', { kind: 'new', parent: [], name: 'x', description: '', match: [] })).rejects.toThrow(/cannot write/);
  });
  it('does not touch a file with invalid YAML, and reports edit errors without committing', async () => {
    const a = world({ file: { text: 'groups: [x', sha: 'sha-1' } });
    await expect(commitEdit(client(a.f), memoryKV(), 'o', { kind: 'new', parent: [], name: 'x', description: '', match: [] })).rejects.toThrow(/repo-groups.yml has a problem, so nothing was changed/);
    expect(puts(a.f)).toHaveLength(0);
    const b = world();
    await expect(commitEdit(client(b.f), memoryKV(), 'o', { kind: 'edit', path: ['gone'], name: 'x', description: '', match: [] })).rejects.toThrow(/no longer exists/);
    await expect(commitEdit(client(b.f), memoryKV(), 'o', { kind: 'new', parent: [], name: 'infra', description: '', match: [] })).rejects.toThrow('A group named "infra" already exists here.');
    expect(puts(b.f)).toHaveLength(0);
  });
  it('asks to create <org>/.github when the repository does not exist', async () => {
    const { f } = world({ file: null, repo: false });
    expect(await commitEdit(client(f), memoryKV(), 'o', { kind: 'new', parent: [], name: 'x', description: '', match: [] })).toEqual({ status: 'needs-repo' });
    expect(puts(f)).toHaveLength(0);
  });
});

describe('createDotGithub and the message handler', () => {
  it('creates a private repo with a first commit; tolerates "already exists"; explains permission errors', async () => {
    const posts: any[] = [];
    const ok = fakeFetch((u, c) => (u.pathname === '/orgs/o/repos' && c.method === 'POST' ? (posts.push(JSON.parse(c.body!)), { status: 201, json: {} }) : undefined));
    await createDotGithub(client(ok), 'o');
    expect(posts[0]).toMatchObject({ name: '.github', private: true, auto_init: true });
    const dup = fakeFetch(() => ({ status: 422, json: { message: 'name already exists on this account' } }));
    await expect(createDotGithub(client(dup), 'o')).resolves.toBeUndefined();
    const no = fakeFetch(() => ({ status: 403, json: { message: 'nope' } }));
    await expect(createDotGithub(client(no), 'o')).rejects.toThrow('You cannot create o/.github. Ask an org owner to create it.');
  });
  it('org:edit returns the result; failures come back as edit errors for the UI', async () => {
    const { f } = world();
    const h = createHandler({ fetch: f.fetch, kv: memoryKV(), index: memoryIndexStore(), clientId: 'c' });
    const ok: any = await h({ type: 'org:edit', org: 'o', edit: { kind: 'new', parent: [], name: 'data', description: '', match: [] } });
    expect(ok).toMatchObject({ ok: true, data: { status: 'ok' } });
    const dup: any = await h({ type: 'org:edit', org: 'o', edit: { kind: 'new', parent: [], name: 'data', description: '', match: [] } });
    expect(dup).toEqual({ ok: false, error: { kind: 'edit', message: 'A group named "data" already exists here.' } });
  });
  it('base64 helpers round-trip UTF-8 and large text', () => {
    const t = 'ação ✓\n' + 'x'.repeat(200000);
    expect(decodeBase64Utf8(encodeBase64Utf8(t))).toBe(t);
  });
});
