import { describe, expect, it } from 'vitest';
import { createHandler } from '../src/background/handlers';
import { memoryKV } from '../src/background/kv';
import { encodeBase64Utf8 } from '../src/background/org-data';
import { memoryIndexStore } from '../src/background/repo-index';
import { applyEdit, commitMessage } from '../src/core/edit';
import { describeDestination, destinationSentence, filedMessage, pickerOptions } from '../src/core/newrepo';
import { findGroup } from '../src/core/placement';
import { buildTree } from '../src/core/tree';
import { example, EXAMPLE, REPOS } from './fixtures';
import { fakeFetch } from './fake-github';

const groups = () => example().groups;
const d = (name: string, picked = '') => describeDestination(groups(), name, picked);

describe('destination sentence (F9)', () => {
  it('automatic and a rule matched', () => {
    const x = d('dags-new');
    expect(x).toMatchObject({ kind: 'auto-hit', destKey: 'infra/dagu', rule: 'dags-*', needsCommit: false });
    expect(destinationSentence(x)).toBe('Lands here because it matches the rule dags-*. Pick another group to override.');
  });
  it('automatic and nothing matched', () => {
    const x = d('brand-new');
    expect(x).toMatchObject({ kind: 'auto-miss', destKey: '', needsCommit: false });
    expect(destinationSentence(x)).toBe('No rule matches this name yet, so it will show under Ungrouped. Pick a group to file it now.');
  });
  it('picked and already matching', () => {
    const x = d('konnen-authentik', 'infra/authentik');
    expect(x).toMatchObject({ kind: 'same', rule: '*authentik*', needsCommit: false });
    expect(destinationSentence(x)).toBe('Already matches the rule *authentik* of this group. repo-groups.yml stays the same.');
  });
  it('picked and different', () => {
    const x = d('konnen-authentik', 'infra/dagu');
    expect(x).toMatchObject({ kind: 'diff', destKey: 'infra/dagu', autoKey: 'infra/authentik', needsCommit: true });
    expect(destinationSentence(x)).toBe('Adds konnen-authentik to the match list of infra / dagu in repo-groups.yml (otherwise it would land in infra / authentik).');
    expect(destinationSentence(d('brand-new', 'ai'))).toContain('(otherwise it would land in Ungrouped)');
  });
  it('empty name and unknown picked group', () => {
    expect(d('').kind).toBe('empty');
    expect(d('dagu', 'nope/gone')).toMatchObject({ kind: 'auto-hit', destKey: 'infra/dagu', pickedKey: '' });
  });
  it('an exact name beats a pattern, like everywhere else (§5.3)', () => {
    expect(d('dagu')).toMatchObject({ autoKey: 'infra/dagu', rule: 'dagu' });
  });
});

describe('picker options', () => {
  it('lists every group with depth and recursive counts', () => {
    const opts = pickerOptions(groups(), buildTree(groups(), REPOS).placed);
    expect(opts.map((o) => `${o.depth}:${o.key}`)).toEqual(['0:infra', '1:infra/dagu', '1:infra/authentik', '1:infra/checkmate', '0:ai', '1:ai/litellm']);
    expect(opts.find((o) => o.key === 'infra')!.count).toBe(6);
    expect(opts.find((o) => o.key === 'infra/dagu')!.count).toBe(3);
  });
});

describe('file edit', () => {
  it('appends the exact name once and never mutates the input', () => {
    const g = groups();
    const r = applyEdit(g, { kind: 'file', path: ['infra', 'dagu'], repo: 'konnen-n8n' }) as { groups: typeof g };
    expect(findGroup(r.groups, ['infra', 'dagu'])!.match).toEqual(['dagu', 'dags-*', 'konnen-dagu', 'konnen-n8n']);
    expect(findGroup(g, ['infra', 'dagu'])!.match).not.toContain('konnen-n8n');
    const again = applyEdit(r.groups, { kind: 'file', path: ['infra', 'dagu'], repo: 'KONNEN-N8N' }) as { groups: typeof g };
    expect(findGroup(again.groups, ['infra', 'dagu'])!.match).toHaveLength(4);
    expect('error' in applyEdit(g, { kind: 'file', path: ['gone'], repo: 'x' })).toBe(true);
  });
  it('commit message', () => {
    expect(commitMessage({ kind: 'file', path: ['infra', 'dagu'], repo: 'konnen-n8n' })).toBe('chore(repo-groups): file konnen-n8n in infra/dagu');
  });
  it('toast text', () => {
    expect(filedMessage({ groupKey: 'infra/dagu', committed: true })).toBe('Filed in infra / dagu · repo-groups.yml updated');
    expect(filedMessage({ groupKey: 'infra/dagu', committed: false })).toBe('Filed in infra / dagu');
    expect(filedMessage({ groupKey: '', committed: false })).toBe('Created, not in any group yet');
  });
});

describe('pending entry and post-create filing (F9)', () => {
  function setup(opts: { putStatus?: number } = {}) {
    let file = { text: EXAMPLE, sha: 'sha-1' };
    const f = fakeFetch((u, call) => {
      if (u.pathname !== '/repos/o/.github/contents/repo-groups.yml') return undefined;
      if (call.method === 'PUT') {
        if (opts.putStatus) return { status: opts.putStatus, json: { message: 'Resource not accessible by integration' } };
        const body = JSON.parse(call.body!);
        file = { text: new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0))), sha: 'sha-2' };
        return { json: { content: { sha: 'sha-2' } } };
      }
      return { json: { content: encodeBase64Utf8(file.text), sha: file.sha } };
    });
    const kv = memoryKV();
    const session = memoryKV();
    const h = createHandler({ fetch: f.fetch, kv, session, index: memoryIndexStore(), clientId: 'c' });
    const entry = (over: object = {}) => ({ org: 'o', repo: 'konnen-n8n', groupPath: 'infra/dagu', explicit: true, teams: [], ...over });
    const puts = () => f.calls.filter((c) => c.method === 'PUT');
    return { h, f, kv, session, entry, puts, file: () => file };
  }

  it('keeps the entry in session storage, not local', async () => {
    const t = setup();
    await t.h({ type: 'newrepo:pending', entry: t.entry() });
    expect(t.session.data.has('rg:pending-repo')).toBe(true);
    expect(t.kv.data.has('rg:pending-repo')).toBe(false);
    expect((t.session.data.get('rg:pending-repo') as any).createdAt).toBeTypeOf('number');
  });

  it('commits the exact name when the pick differs from the automatic placement', async () => {
    const t = setup();
    await t.h({ type: 'newrepo:pending', entry: t.entry() });
    const r: any = await t.h({ type: 'newrepo:landed', org: 'o', repo: 'konnen-n8n' });
    expect(r.data).toMatchObject({ groupKey: 'infra/dagu', committed: true });
    expect(t.puts()).toHaveLength(1);
    const body = JSON.parse(t.puts()[0].body!);
    expect(body.message).toBe('chore(repo-groups): file konnen-n8n in infra/dagu');
    expect(body.sha).toBe('sha-1');
    expect(t.file().text).toContain('"konnen-n8n"');
    // consumed: a reload of the repo page does nothing
    expect(((await t.h({ type: 'newrepo:landed', org: 'o', repo: 'konnen-n8n' })) as any).data).toBeNull();
    expect(t.puts()).toHaveLength(1);
  });

  it('commits nothing when the choice equals the automatic placement', async () => {
    const t = setup();
    await t.h({ type: 'newrepo:pending', entry: t.entry({ repo: 'konnen-authentik', groupPath: 'infra/authentik' }) });
    const r: any = await t.h({ type: 'newrepo:landed', org: 'o', repo: 'konnen-authentik' });
    expect(r.data).toMatchObject({ groupKey: 'infra/authentik', committed: false });
    expect(t.puts()).toHaveLength(0);
  });

  it('commits nothing for Automatic, but still reports where it landed (from the cached file)', async () => {
    const t = setup();
    await t.h({ type: 'org:config', org: 'o' }); // fills the cache
    await t.h({ type: 'newrepo:pending', entry: t.entry({ repo: 'dags-new', groupPath: '', explicit: false }) });
    const r: any = await t.h({ type: 'newrepo:landed', org: 'o', repo: 'dags-new' });
    expect(r.data).toMatchObject({ groupKey: 'infra/dagu', committed: false });
    expect(t.puts()).toHaveLength(0);
  });

  it('waits for the right repo, and ignores stale entries', async () => {
    const t = setup();
    await t.h({ type: 'newrepo:pending', entry: t.entry() });
    expect(((await t.h({ type: 'newrepo:landed', org: 'o', repo: 'other' })) as any).data).toBeNull();
    expect(t.session.data.has('rg:pending-repo')).toBe(true);
    (t.session.data.get('rg:pending-repo') as any).createdAt = Date.now() - 11 * 60 * 1000;
    expect(((await t.h({ type: 'newrepo:landed', org: 'o', repo: 'konnen-n8n' })) as any).data).toBeNull();
    expect(t.session.data.has('rg:pending-repo')).toBe(false);
    expect(t.puts()).toHaveLength(0);
  });

  it('discards the entry when creation failed', async () => {
    const t = setup();
    await t.h({ type: 'newrepo:pending', entry: t.entry() });
    await t.h({ type: 'newrepo:discard' });
    expect(((await t.h({ type: 'newrepo:landed', org: 'o', repo: 'konnen-n8n' })) as any).data).toBeNull();
    expect(t.puts()).toHaveLength(0);
  });

  it('reports a failed commit in plain language and still consumes the entry', async () => {
    const t = setup({ putStatus: 403 });
    await t.h({ type: 'newrepo:pending', entry: t.entry() });
    const r: any = await t.h({ type: 'newrepo:landed', org: 'o', repo: 'konnen-n8n' });
    expect(r.data.committed).toBe(false);
    expect(r.data.error).toMatch(/cannot write to o\/\.github/);
    expect(t.session.data.has('rg:pending-repo')).toBe(false);
  });
});
