import { describe, expect, it } from 'vitest';
import { createClient } from '../src/background/api';
import { commitEditWithLogo } from '../src/background/commit-logo';
import { createHandler } from '../src/background/handlers';
import { memoryKV } from '../src/background/kv';
import { createLogoService, memoryLogoCache } from '../src/background/logos';
import { decodeBase64Utf8, encodeBase64Utf8 } from '../src/background/org-data';
import { memoryIndexStore } from '../src/background/repo-index';
import { findGroup } from '../src/core/placement';
import { readConfig } from '../src/core/yaml-read';
import { EXAMPLE, load } from './fixtures';
import { fakeFetch, type Route } from './fake-github';

const PNG = 'iVBORw0KGgo='; // base64 of the PNG signature, enough for a blob
const client = (f: ReturnType<typeof fakeFetch>) => createClient({ fetch: f.fetch, getToken: async () => 't' });
const parsed = (text: string) => readConfig(text, load, { org: 'o' }).config!;

interface World {
  yaml: string;
  head: string;
  blobs: Map<string, { content: string; encoding: string }>;
  commits: { message: string; tree: string; parents: string[] }[];
  trees: any[];
  patchErrors: { status: number; message: string }[];
  onPatch?: () => void;
  files: Record<string, string>; // path -> base64 of what is committed
}

/** A tiny Git Data API: refs, commits, blobs and trees of <org>/.github. */
function world(w: Partial<World> = {}) {
  const s: World = { yaml: EXAMPLE, head: 'c1', blobs: new Map(), commits: [], trees: [], patchErrors: [], files: {}, ...w };
  let n = 0;
  const routes: Route[] = [
    (u) => (u.pathname === '/repos/o/.github' ? { json: { default_branch: 'main', permissions: { push: true } } } : undefined),
    (u) => (u.pathname === '/repos/o/.github/git/ref/heads/main' ? { json: { object: { sha: s.head } } } : undefined),
    (u) => (u.pathname.startsWith('/repos/o/.github/git/commits/') ? { json: { tree: { sha: 'tree-of-' + s.head } } } : undefined),
    (u) => (u.pathname === '/repos/o/.github/contents/repo-groups.yml' ? { json: { content: encodeBase64Utf8(s.yaml), sha: 'yml-old' } } : undefined),
    (u, call) => {
      if (u.pathname !== '/repos/o/.github/git/blobs' || call.method !== 'POST') return undefined;
      const body = JSON.parse(call.body!);
      const sha = `blob-${++n}`;
      s.blobs.set(sha, body);
      return { status: 201, json: { sha } };
    },
    (u, call) => {
      if (u.pathname !== '/repos/o/.github/git/trees') return undefined;
      const body = JSON.parse(call.body!);
      s.trees.push(body);
      return { status: 201, json: { sha: 'tree-new' } };
    },
    (u, call) => {
      if (u.pathname !== '/repos/o/.github/git/commits' || call.method !== 'POST') return undefined;
      s.commits.push(JSON.parse(call.body!));
      return { status: 201, json: { sha: `commit-${s.commits.length}` } };
    },
    (u, call) => {
      if (u.pathname !== '/repos/o/.github/git/refs/heads/main' || call.method !== 'PATCH') return undefined;
      s.onPatch?.();
      const err = s.patchErrors.shift();
      if (err) return { status: err.status, json: { message: err.message } };
      s.head = JSON.parse(call.body!).sha;
      return { json: {} };
    },
  ];
  return { s, f: fakeFetch(...routes) };
}

const editLogo = (extra: object = {}) => ({ kind: 'edit' as const, path: ['infra', 'dagu'], name: 'dagu', description: 'Jobs', match: ['dagu'], logo: { png: PNG }, ...extra });

describe('commitEditWithLogo (F7, §7)', () => {
  it('commits the PNG and the YAML in ONE commit through the Git Data API', async () => {
    const { s, f } = world();
    const kv = memoryKV();
    const r = await commitEditWithLogo(client(f), kv, 'o', editLogo());
    expect(r).toMatchObject({ status: 'ok', logoSha: 'blob-1', sha: 'blob-2' });

    // order: ref, commit, file, blobs, tree, commit, ref update
    const calls = f.calls.filter((c) => c.url.includes('/git/') || c.url.includes('contents')).map((c) => `${c.method} ${new URL(c.url).pathname.replace('/repos/o/.github', '')}`);
    expect(calls).toEqual([
      'GET /git/ref/heads/main',
      'GET /git/commits/c1',
      'GET /contents/repo-groups.yml',
      'POST /git/blobs',
      'POST /git/blobs',
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/main',
    ]);
    expect(s.commits).toHaveLength(1);
    expect(s.commits[0]).toMatchObject({ message: 'chore(repo-groups): add logo for infra/dagu', tree: 'tree-new', parents: ['c1'] });
    expect(s.blobs.get('blob-1')).toEqual({ content: PNG, encoding: 'base64' });
    const yml = decodeBase64Utf8(s.blobs.get('blob-2')!.content);
    expect(yml.startsWith('# o/.github/repo-groups.yml\nversion: 1\n')).toBe(true);
    expect(findGroup(parsed(yml).groups, ['infra', 'dagu'])).toMatchObject({ logo: 'logos/infra-dagu.png', description: 'Jobs', match: ['dagu'] });
    expect(findGroup(parsed(yml).groups, ['infra'])!.teams).toEqual([{ slug: 'konnen_team', permission: 'push' }]);
    expect(s.trees[0]).toEqual({
      base_tree: 'tree-of-c1',
      tree: [
        { path: 'repo-groups.yml', mode: '100644', type: 'blob', sha: 'blob-2' },
        { path: 'logos/infra-dagu.png', mode: '100644', type: 'blob', sha: 'blob-1' },
      ],
    });
    expect(s.head).toBe('commit-1');
    expect(await kv.get<any>('rg:file:o')).toMatchObject({ exists: true, sha: 'blob-2' });
  });

  it('creates a group with a logo (path from the final slug)', async () => {
    const { s, f } = world();
    const r = await commitEditWithLogo(client(f), memoryKV(), 'o', { kind: 'new', parent: ['infra'], name: 'Data Jobs', description: '', match: [], logo: { png: PNG } });
    expect(r.status).toBe('ok');
    expect(s.trees[0].tree[1].path).toBe('logos/infra-data-jobs.png');
    expect(s.commits[0].message).toBe('chore(repo-groups): add subgroup infra/data-jobs with logo');
    expect(findGroup(parsed(decodeBase64Utf8(s.blobs.get('blob-2')!.content)).groups, ['infra', 'data-jobs'])!.logo).toBe('logos/infra-data-jobs.png');
  });

  it('on a conflict re-reads the branch and re-applies the same edit once', async () => {
    const { s, f } = world();
    let first = true;
    s.onPatch = () => {
      if (first) {
        first = false;
        s.head = 'c-other';
        s.yaml = EXAMPLE.replace('groups:\n', 'groups:\n  - name: theirs\n');
      }
    };
    s.patchErrors.push({ status: 422, message: 'Update is not a fast forward' });
    const r = await commitEditWithLogo(client(f), memoryKV(), 'o', editLogo());
    expect(r.status).toBe('ok');
    expect(s.commits).toHaveLength(2);
    expect(s.commits[1].parents).toEqual(['c-other']);
    expect(f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/git/blobs'))).toHaveLength(3); // the PNG blob is reused
    const yml = decodeBase64Utf8(s.blobs.get('blob-3')!.content);
    expect(parsed(yml).groups.map((g) => g.name)).toContain('theirs');
    expect(findGroup(parsed(yml).groups, ['infra', 'dagu'])!.logo).toBe('logos/infra-dagu.png');
  });

  it('gives up after a second conflict with a plain message', async () => {
    const { f } = world({ patchErrors: [{ status: 422, message: 'Update is not a fast forward' }, { status: 422, message: 'Update is not a fast forward' }] });
    await expect(commitEditWithLogo(client(f), memoryKV(), 'o', editLogo())).rejects.toThrow('The file changed on GitHub while saving. Reload the page and try again.');
  });

  it('explains a protected branch (also when GitHub answers 422) and missing write access', async () => {
    const a = world({ patchErrors: [{ status: 422, message: 'Changes must be made through a pull request.' }] });
    await expect(commitEditWithLogo(client(a.f), memoryKV(), 'o', editLogo())).rejects.toThrow(/default branch of o\/\.github is protected/);
    expect(a.s.commits).toHaveLength(1); // no retry for a protected branch
    const b = world({ patchErrors: [{ status: 403, message: 'Resource not accessible by integration' }] });
    await expect(commitEditWithLogo(client(b.f), memoryKV(), 'o', editLogo())).rejects.toThrow('You cannot write to o/.github. Ask an org owner for access, or organize in My groups.');
  });

  it('commits nothing when the edit is invalid or the file is broken', async () => {
    const a = world();
    await expect(commitEditWithLogo(client(a.f), memoryKV(), 'o', editLogo({ path: ['gone'] }))).rejects.toThrow(/no longer exists/);
    const b = world({ yaml: 'groups: [x' });
    await expect(commitEditWithLogo(client(b.f), memoryKV(), 'o', editLogo())).rejects.toThrow(/nothing was changed/);
    expect(a.s.commits.length + b.s.commits.length).toBe(0);
  });

  it('asks to create <org>/.github when it does not exist', async () => {
    const f = fakeFetch();
    expect(await commitEditWithLogo(client(f), memoryKV(), 'o', editLogo())).toEqual({ status: 'needs-repo' });
  });

  it('org:edit routes a logo edit to the Git Data commit and primes the logo cache with the new blob', async () => {
    const { s, f } = world();
    const logos = memoryLogoCache();
    const h = createHandler({ fetch: f.fetch, kv: memoryKV(), index: memoryIndexStore(), clientId: 'c', logos });
    const r: any = await h({ type: 'org:edit', org: 'o', edit: editLogo() });
    expect(r).toMatchObject({ ok: true, data: { status: 'ok' } });
    expect(s.commits).toHaveLength(1);
    expect(logos.data.get('logo:blob-1')).toBe(`data:image/png;base64,${PNG}`);
    // an edit without a new logo keeps the single-file path (Contents API PUT, no git data calls)
    const g = fakeFetch((u, c) => (u.pathname.endsWith('/contents/repo-groups.yml') ? (c.method === 'PUT' ? { json: { content: { sha: 's2' } } } : { json: { content: encodeBase64Utf8(EXAMPLE), sha: 's1' } }) : undefined));
    const h2 = createHandler({ fetch: g.fetch, kv: memoryKV(), index: memoryIndexStore(), clientId: 'c' });
    await h2({ type: 'org:edit', org: 'o', edit: { ...editLogo(), logo: { remove: true } } });
    expect(g.calls.some((c) => c.url.includes('/git/'))).toBe(false);
    const put = JSON.parse(g.calls.find((c) => c.method === 'PUT')!.body!);
    expect(findGroup(parsed(decodeBase64Utf8(put.content)).groups, ['infra', 'dagu'])!.logo).toBeNull();
  });
});

describe('logo display service (F7)', () => {
  const dataUrl = 'data:image/png;base64,AAAA';
  const logoWorld = () => {
    const blobReads: string[] = [];
    const f = fakeFetch(
      (u) => (u.pathname === '/repos/o/.github/contents/logos' ? { json: [{ type: 'file', name: 'infra.png', sha: 'sha-a', size: 10 }, { type: 'file', name: 'huge.png', sha: 'sha-h', size: 9e6 }] } : undefined),
      (u) => (u.pathname.startsWith('/repos/o/.github/git/blobs/') ? (blobReads.push(u.pathname.split('/').pop()!), { json: { content: 'AAAA\n', encoding: 'base64' } }) : undefined),
    );
    return { f, blobReads };
  };

  it('reads logos through the API, caches them by blob SHA, and falls back to null', async () => {
    const { f, blobReads } = logoWorld();
    const cache = memoryLogoCache();
    const svc = createLogoService({ client: client(f), fetch: f.fetch, cache });
    expect(await svc.load('o', ['logos/infra.png', 'logos/missing.png', 'logos/huge.png'])).toEqual({ 'logos/infra.png': dataUrl, 'logos/missing.png': null, 'logos/huge.png': null });
    expect(cache.data.get('logo:sha-a')).toBe(dataUrl);
    // a fresh service (new worker) with the same cache: the blob is not downloaded again
    const again = createLogoService({ client: client(f), fetch: f.fetch, cache });
    await again.load('o', ['logos/infra.png']);
    expect(blobReads).toEqual(['sha-a']);
  });

  it('shows nothing from a missing folder', async () => {
    const f = fakeFetch();
    const svc = createLogoService({ client: client(f), fetch: f.fetch, cache: memoryLogoCache() });
    expect(await svc.load('o', ['logos/x.png'])).toEqual({ 'logos/x.png': null });
  });

  it('prime() makes a new logo available without downloading it and forgets the folder listing', async () => {
    const { f, blobReads } = logoWorld();
    const svc = createLogoService({ client: client(f), fetch: f.fetch, cache: memoryLogoCache() });
    await svc.load('o', ['logos/infra.png']);
    await svc.prime('o', 'sha-a', 'data:image/png;base64,NEW');
    expect(await svc.load('o', ['logos/infra.png'])).toEqual({ 'logos/infra.png': 'data:image/png;base64,NEW' });
    expect(blobReads).toEqual(['sha-a']); // only the first load downloaded
  });

  it('loads https logos in the background without sending the token, and returns null on failure', async () => {
    const seen: any[] = [];
    const ext = (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      if (url.includes('bad')) return Promise.resolve(new Response('nope', { status: 404 }));
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/svg+xml; charset=utf-8' } }));
    };
    const f = fakeFetch();
    const svc = createLogoService({ client: client(f), fetch: ext as any, cache: memoryLogoCache() });
    const r = await svc.load('o', ['https://cdn.example.com/a.svg', 'https://cdn.example.com/bad.png']);
    expect(r['https://cdn.example.com/a.svg']).toBe('data:image/svg+xml;base64,AQID');
    expect(r['https://cdn.example.com/bad.png']).toBeNull();
    expect(JSON.stringify(seen)).not.toMatch(/authorization/i);
    expect(f.calls).toHaveLength(0);
  });
});

describe('logo from a link (F7)', () => {
  const okFetch = () => Promise.resolve(new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'image/png' } }));
  const svcWith = (origins?: { has: boolean; grant: boolean }, fetchImpl: any = okFetch) => {
    const asked: string[] = [];
    const svc = createLogoService({
      client: client(fakeFetch()),
      fetch: fetchImpl,
      cache: memoryLogoCache(),
      origins: origins && { has: async () => origins.has, request: async (o) => (asked.push(o), origins.grant) },
    });
    return { svc, asked };
  };

  it('asks for the optional host permission, then fetches the image', async () => {
    const { svc, asked } = svcWith({ has: false, grant: true });
    expect(await svc.fetchLink('https://img.example.org/logo.png')).toEqual({ dataUrl: 'data:image/png;base64,CQ==' });
    expect(asked).toEqual(['https://img.example.org/*']);
  });
  it('does not ask again when the origin is already allowed', async () => {
    const { svc, asked } = svcWith({ has: true, grant: false });
    await svc.fetchLink('https://img.example.org/logo.png');
    expect(asked).toEqual([]);
  });
  it('explains what to do when the person declines', async () => {
    const { svc } = svcWith({ has: false, grant: false });
    await expect(svc.fetchLink('https://img.example.org/logo.png')).rejects.toThrow('Allow access to img.example.org to load this image, or download it and upload the file.');
  });
  it('rejects links that are not https, and pages that are not images', async () => {
    const { svc } = svcWith({ has: true, grant: true });
    await expect(svc.fetchLink('http://x.org/a.png')).rejects.toThrow('Enter a direct link that starts with https://.');
    await expect(svc.fetchLink('not a url')).rejects.toThrow(/starts with https/);
    const html = svcWith({ has: true, grant: true }, () => Promise.resolve(new Response('<html>', { headers: { 'content-type': 'text/html' } }))).svc;
    await expect(html.fetchLink('https://x.org/page')).rejects.toThrow('That link did not load as an image. Use a direct link to the file (ending in .png, .jpg, .svg or .webp).');
    const big = svcWith({ has: true, grant: true }, () => Promise.resolve(new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } }))).svc;
    await expect(big.fetchLink('https://x.org/big.png')).rejects.toThrow('That image is larger than 5 MB. Choose a smaller file.');
  });
});
