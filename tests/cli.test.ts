import { describe, expect, it } from 'vitest';
import { runCli, parseArgs, type CliDeps } from '../packages/cli/src/cli';
import { handleMessage, serveStdio, TOOLS, type McpDeps } from '../packages/cli/src/mcp';
import { decodeBase64Utf8, encodeBase64Utf8 } from '../src/background/org-data';
import { readConfig } from '../src/core/yaml-read';
import { EXAMPLE, REPOS, load } from './fixtures';
import { fakeFetch, orgReposRoute, rawRepo, type Route } from './fake-github';

const TOKEN = 'ghp_secret_token_value';

interface World {
  file: { text: string; sha: string } | null;
  putErrors: { status: number; message: string }[];
  /** Runs before a PUT is evaluated: simulates someone else committing in between. */
  beforePut?: (w: World) => void;
}

function world(w: Partial<World> = {}, repoNames: string[] = REPOS.map((r) => r.name)) {
  const s: World = { file: { text: EXAMPLE, sha: 'sha-1' }, putErrors: [], ...w };
  const raws = repoNames.map((n, i) => rawRepo(i, new Date(Date.parse('2026-01-10T12:00:00Z') - i * 60000).toISOString(), { name: n, description: `desc of ${n}` }));
  const file: Route = (u, call) => {
    if (u.pathname !== '/repos/o/.github/contents/repo-groups.yml') return undefined;
    if (call.method === 'PUT') {
      const body = JSON.parse(call.body!);
      s.beforePut?.(s);
      s.beforePut = undefined;
      const err = s.putErrors.shift();
      if (err) return { status: err.status, json: { message: err.message } };
      if (s.file && body.sha !== s.file.sha) return { status: 409, json: { message: 'does not match' } };
      s.file = { text: decodeBase64Utf8(body.content), sha: `sha-${Number(s.file?.sha.split('-')[1] ?? 0) + 1}` };
      return { json: { content: { sha: s.file.sha }, commit: { sha: 'abcdef1234' } } };
    }
    return s.file ? { json: { content: encodeBase64Utf8(s.file.text), sha: s.file.sha } } : { status: 404, json: { message: 'Not Found' } };
  };
  const f = fakeFetch(file, orgReposRoute('o', () => raws));
  return { s, f };
}

const puts = (f: ReturnType<typeof fakeFetch>) => f.calls.filter((c) => c.method === 'PUT');
const groupsOf = (text: string) => readConfig(text, load, { org: 'o' }).config!.groups;

function cli(f: ReturnType<typeof fakeFetch>, env: Record<string, string> = { GITHUB_TOKEN: TOKEN, RG_ORG: 'o' }, files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    env,
    fetch: f.fetch,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    readFile: async (p) => files[p] ?? Promise.reject(new Error(`ENOENT ${p}`)),
    readStdin: async () => files['-'] ?? '',
  };
  return { run: (...argv: string[]) => runCli(argv, deps), out, err };
}

describe('rg CLI', () => {
  it('parses flags and positionals', () => {
    const p = parseArgs(['move-repo', 'a', 'b/c', '--org=x', '--yes', '--description', 'hi there']);
    expect(p.command).toBe('move-repo');
    expect(p.positionals).toEqual(['a', 'b/c']);
    expect(p.flags).toEqual({ org: 'x', yes: true, description: 'hi there' });
  });

  it('needs a token and an org, and never prints the token', async () => {
    const { f } = world();
    const a = cli(f, { RG_ORG: 'o' });
    expect(await a.run('list-groups')).toBe(1);
    expect(a.err.join()).toMatch(/GITHUB_TOKEN/);
    const b = cli(f, { GITHUB_TOKEN: TOKEN });
    expect(await b.run('list-groups')).toBe(1);
    expect(b.err.join()).toMatch(/--org or RG_ORG/);
    expect(f.calls).toHaveLength(0);
  });

  it('sends the token only as a bearer header, and no output contains it', async () => {
    const { f } = world();
    const c = cli(f);
    await c.run('list-groups', '--json');
    await c.run('move-repo', 'nope', 'infra', '--yes');
    expect(f.calls.every((x) => x.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect([...c.out, ...c.err].join('\n')).not.toContain(TOKEN);
  });

  it('list-groups prints the tree with counts', async () => {
    const { f } = world();
    const c = cli(f);
    expect(await c.run('list-groups', '--json')).toBe(0);
    const data = JSON.parse(c.out[0]);
    expect(data.repositories).toBe(10);
    const byPath = Object.fromEntries(data.groups.map((g: any) => [g.path, g]));
    expect(byPath['infra/dagsrv'].repos).toBe(3);
    expect(byPath.infra.repos).toBeGreaterThanOrEqual(3);
    expect(data.ungrouped).toBe(1);
    const text = cli(f);
    await text.run('list-groups');
    expect(text.out[0]).toMatch(/infra {2}\d+ repos/);
  });

  it('list-repos filters by group (recursive) and ungrouped', async () => {
    const { f } = world();
    const g = cli(f);
    await g.run('list-repos', '--group', 'infra/dagsrv', '--json');
    expect(JSON.parse(g.out[0]).repos.map((r: any) => r.name).sort()).toEqual(['dags-repo', 'dagsrv', 'kite-dagsrv']);
    const u = cli(f);
    await u.run('list-repos', '--ungrouped', '--json');
    expect(JSON.parse(u.out[0]).repos.map((r: any) => r.name)).toEqual(['keep_alive_job']);
    const bad = cli(f);
    expect(await bad.run('list-repos', '--group', 'nope')).toBe(1);
  });

  it('list-repos pages through the REST list', async () => {
    const names = Array.from({ length: 230 }, (_, i) => `r-${i}`);
    const { f } = world({}, names);
    const c = cli(f);
    await c.run('list-repos', '--json', '--limit', '5');
    const d = JSON.parse(c.out[0]);
    expect(d.total).toBe(230);
    expect(d.repos).toHaveLength(5);
    expect(f.calls.filter((x) => x.url.includes('/orgs/o/repos'))).toHaveLength(3);
  });

  it('show-group reports rules and repositories', async () => {
    const { f } = world();
    const c = cli(f);
    expect(await c.run('show-group', 'infra/dagsrv', '--json')).toBe(0);
    const d = JSON.parse(c.out[0]);
    expect(d.rules).toEqual(['dagsrv', 'dags-*', 'kite-dagsrv']);
    expect(d.reposTotal).toBe(3);
    expect(await cli(f).run('show-group', 'infra/zzz')).toBe(1);
  });

  it('suggest lists ungrouped repositories with a group or "uncertain"', async () => {
    const { f } = world({}, ['keep_alive_job', 'dagsrv', 'zzzz']);
    const c = cli(f);
    await c.run('suggest', '--json');
    const d = JSON.parse(c.out[0]);
    expect(d.suggestions.map((s: any) => s.name).sort()).toEqual(['keep_alive_job', 'zzzz']);
    expect(d.suggestions.every((s: any) => ['lexical', 'uncertain'].includes(s.source))).toBe(true);
  });

  it('validate: a good file, a bad file (exit 1) and the remote file', async () => {
    const { f } = world();
    const ok = cli(f, undefined, { 'good.yml': EXAMPLE });
    expect(await ok.run('validate', 'good.yml')).toBe(0);
    expect(ok.out[0]).toMatch(/^Valid/);
    const bad = cli(f, undefined, { 'bad.yml': 'groups:\n  - name: Bad Name\n' });
    expect(await bad.run('validate', 'bad.yml')).toBe(1);
    expect(bad.out[0]).toMatch(/Invalid/);
    const remote = cli(f);
    expect(await remote.run('validate')).toBe(0);
  });

  it('diff shows the changes of a file without writing', async () => {
    const { f } = world();
    const edited = EXAMPLE.replace('match: ["oroute"]', 'match: ["oroute", "keep_alive_job"]');
    const c = cli(f, undefined, { 'new.yml': edited });
    expect(await c.run('diff', 'new.yml')).toBe(0);
    expect(c.out[0]).toMatch(/Rules of ai/);
    expect(c.out[0]).toMatch(/keep_alive_job: ungrouped → ai/);
    expect(puts(f)).toHaveLength(0);
  });

  describe('write commands are dry-run by default', () => {
    it('move-repo', async () => {
      const { s, f } = world();
      const c = cli(f);
      expect(await c.run('move-repo', 'keep_alive_job', 'infra/dagsrv')).toBe(0);
      expect(c.out[0]).toMatch(/Dry run/);
      expect(c.out[0]).toMatch(/keep_alive_job: ungrouped → infra\/dagsrv/);
      expect(c.out[0]).toMatch(/Re-run with --yes/);
      expect(puts(f)).toHaveLength(0);
      expect(s.file!.sha).toBe('sha-1');
    });

    it('move-repo --yes commits with a conventional message and the sha', async () => {
      const { s, f } = world();
      const c = cli(f);
      expect(await c.run('move-repo', 'keep_alive_job', 'infra/dagsrv', '--yes')).toBe(0);
      expect(puts(f)).toHaveLength(1);
      const body = JSON.parse(puts(f)[0].body!);
      expect(body.message).toBe('chore(repo-groups): file keep_alive_job in infra/dagsrv');
      expect(body.sha).toBe('sha-1');
      expect(c.out[0]).toMatch(/Committed to o\/.github\/repo-groups.yml/);
      expect(s.file!.text).toContain('"keep_alive_job"');
    });

    it('move-repo takes the exact name out of the group that listed it', async () => {
      const { s, f } = world();
      await cli(f).run('move-repo', 'oroute', 'infra', '--yes');
      const g = groupsOf(s.file!.text);
      expect(g.find((x) => x.name === 'ai')!.match).toEqual([]);
      expect(g.find((x) => x.name === 'infra')!.match).toEqual(['oroute']);
    });

    it('move-repo rejects unknown repos and groups', async () => {
      const { f } = world();
      const a = cli(f);
      expect(await a.run('move-repo', 'ghost', 'infra', '--yes')).toBe(1);
      expect(a.err[0]).toMatch(/cannot see a repository named "ghost"/);
      const b = cli(f);
      expect(await b.run('move-repo', 'oroute', 'nowhere', '--yes')).toBe(1);
      expect(b.err[0]).toMatch(/no group "nowhere"/);
      expect(puts(f)).toHaveLength(0);
    });

    it('add-rule', async () => {
      const { s, f } = world();
      const dry = cli(f);
      await dry.run('add-rule', 'infra/dagsrv', 'dagsrv-*');
      expect(puts(f)).toHaveLength(0);
      expect(dry.out[0]).toMatch(/Rules of infra\/dagsrv/);
      await cli(f).run('add-rule', 'infra/dagsrv', 'dagsrv-*', '--yes');
      expect(JSON.parse(puts(f)[0].body!).message).toBe('chore(repo-groups): add rule dagsrv-* to infra/dagsrv');
      expect(groupsOf(s.file!.text)[0].groups[0].match).toContain('dagsrv-*');
      const bad = cli(f);
      expect(await bad.run('add-rule', 'infra', 'two words', '--yes')).toBe(1);
    });

    it('add-rule on an existing rule is a no-op and commits nothing', async () => {
      const { f } = world();
      const c = cli(f);
      await c.run('add-rule', 'infra/dagsrv', 'dags-*', '--yes');
      expect(c.out[0]).toMatch(/No changes/);
      expect(puts(f)).toHaveLength(0);
    });

    it('create-group', async () => {
      const { s, f } = world();
      const dry = cli(f);
      await dry.run('create-group', 'infra/billing', '--description', 'Money things');
      expect(puts(f)).toHaveLength(0);
      expect(dry.out[0]).toMatch(/New group: infra\/billing/);
      await cli(f).run('create-group', 'infra/billing', '--description', 'Money things', '--yes');
      expect(JSON.parse(puts(f)[0].body!).message).toBe('chore(repo-groups): add subgroup infra/billing');
      const created = groupsOf(s.file!.text)[0].groups.find((g) => g.name === 'billing')!;
      expect(created.description).toBe('Money things');
      const noParent = cli(f);
      expect(await noParent.run('create-group', 'nope/child', '--yes')).toBe(1);
      expect(await cli(f).run('create-group', 'Bad Name', '--yes')).toBe(1);
      expect(await cli(f).run('create-group', 'infra/dagsrv', '--yes')).toBe(1); // duplicate
    });

    it('create-group creates the file when it does not exist yet (no sha)', async () => {
      const { s, f } = world({ file: null });
      await cli(f).run('create-group', 'infra', '--yes');
      expect(JSON.parse(puts(f)[0].body!).sha).toBeUndefined();
      expect(groupsOf(s.file!.text).map((g) => g.name)).toEqual(['infra']);
    });

    it('apply replaces the file only with --yes and uses a change-count message', async () => {
      const edited = EXAMPLE.replace('match: ["oroute"]', 'match: ["oroute", "keep_alive_job"]');
      const { s, f } = world();
      const dry = cli(f, undefined, { 'x.yml': edited });
      expect(await dry.run('apply', 'x.yml')).toBe(0);
      expect(puts(f)).toHaveLength(0);
      expect(dry.out[0]).toMatch(/Dry run/);
      const yes = cli(f, undefined, { 'x.yml': edited });
      expect(await yes.run('apply', 'x.yml', '--yes')).toBe(0);
      expect(JSON.parse(puts(f)[0].body!).message).toMatch(/^chore\(repo-groups\): apply YAML edit \(\d+ changes?\)$/);
      expect(groupsOf(s.file!.text).find((g) => g.name === 'ai')!.match).toContain('keep_alive_job');
    });

    it('apply refuses an invalid file and a fenced AI answer is accepted', async () => {
      const { f } = world();
      const bad = cli(f, undefined, { 'b.yml': 'nothing: here' });
      expect(await bad.run('apply', 'b.yml', '--yes')).toBe(1);
      expect(puts(f)).toHaveLength(0);
      const fenced = cli(f, undefined, { 'f.yml': 'Here you go:\n```yaml\n' + EXAMPLE.replace('"oroute"', '"oroute", "x"') + '```\n' });
      expect(await fenced.run('apply', 'f.yml')).toBe(0);
    });
  });

  describe('conflicts', () => {
    it('refetches and re-applies the same change once after a sha conflict', async () => {
      const { s, f } = world({
        // Someone else commits an unrelated change between our read and our PUT.
        beforePut: (w) => {
          w.file = { text: w.file!.text.replace('description: "Uptime monitoring"', 'description: "Monitoring"'), sha: 'sha-2' };
        },
      });
      const c = cli(f);
      expect(await c.run('move-repo', 'keep_alive_job', 'infra/dagsrv', '--yes')).toBe(0);
      const sent = puts(f);
      expect(sent).toHaveLength(2);
      expect(JSON.parse(sent[0].body!).sha).toBe('sha-1');
      expect(JSON.parse(sent[1].body!).sha).toBe('sha-2');
      // both the other person's change and ours survive
      expect(s.file!.text).toContain('"Monitoring"');
      expect(s.file!.text).toContain('"keep_alive_job"');
    });

    it('gives up after one retry', async () => {
      const { f } = world({ putErrors: [{ status: 409, message: 'x' }, { status: 409, message: 'x' }, { status: 409, message: 'x' }] });
      const c = cli(f);
      expect(await c.run('add-rule', 'infra', 'zzz', '--yes')).toBe(1);
      expect(puts(f)).toHaveLength(2);
      expect(c.err[0]).toMatch(/changed on GitHub/);
    });

    it('apply never overwrites a file that changed since it was read', async () => {
      const { s, f } = world({
        beforePut: (w) => {
          w.file = { text: w.file!.text + '# edited\n', sha: 'sha-2' };
        },
      });
      const c = cli(f, undefined, { 'x.yml': EXAMPLE.replace('"oroute"', '"oroute", "k"') });
      expect(await c.run('apply', 'x.yml', '--yes')).toBe(1);
      expect(c.err[0]).toMatch(/changed on GitHub since it was read/);
      expect(s.file!.sha).toBe('sha-2');
    });

    it('explains a protected branch and missing write access', async () => {
      const a = cli(world({ putErrors: [{ status: 403, message: 'Protected branch update failed' }] }).f);
      expect(await a.run('add-rule', 'infra', 'q', '--yes')).toBe(1);
      expect(a.err[0]).toMatch(/protected/);
      const b = cli(world({ putErrors: [{ status: 404, message: 'Not Found' }] }).f);
      expect(await b.run('add-rule', 'infra', 'q', '--yes')).toBe(1);
      expect(b.err[0]).toMatch(/Contents read\/write/);
    });
  });

  it('prints help and rejects unknown commands and flags', async () => {
    const { f } = world();
    const h = cli(f);
    expect(await h.run('--help')).toBe(0);
    expect(h.out[0]).toMatch(/dry-run by default/);
    expect(await cli(f).run('frobnicate')).toBe(1);
    expect(await cli(f).run('list-groups', '--nope')).toBe(1);
  });
});

describe('MCP server', () => {
  const deps = (f: ReturnType<typeof fakeFetch>, env: Record<string, string> = { GITHUB_TOKEN: TOKEN, RG_ORG: 'o' }): McpDeps => ({ env, fetch: f.fetch });
  const call = (f: ReturnType<typeof fakeFetch>, name: string, args: object = {}, env?: Record<string, string>) =>
    handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, deps(f, env)) as Promise<any>;
  const payload = (r: any) => JSON.parse(r.result.content[0].text);

  it('initialize negotiates the protocol version and advertises tools', async () => {
    const { f } = world();
    const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, deps(f));
    expect(r.result.protocolVersion).toBe('2024-11-05');
    expect(r.result.capabilities).toEqual({ tools: {} });
    const other: any = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999' } }, deps(f));
    expect(other.result.protocolVersion).toBe('2025-06-18');
  });

  it('does not answer notifications, and rejects unknown methods', async () => {
    const { f } = world();
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps(f))).toBeUndefined();
    const r: any = await handleMessage({ jsonrpc: '2.0', id: 5, method: 'nope' }, deps(f));
    expect(r.error.code).toBe(-32601);
  });

  it('tools/list exposes every command with a schema; write tools take apply', async () => {
    const { f } = world();
    const r: any = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, deps(f));
    const names = r.result.tools.map((t: any) => t.name);
    expect(names).toEqual(['list_groups', 'list_repos', 'show_group', 'suggest', 'move_repo', 'add_rule', 'create_group', 'validate', 'diff', 'apply']);
    for (const t of TOOLS) expect(t.inputSchema.type).toBe('object');
    for (const n of ['move_repo', 'add_rule', 'create_group', 'apply']) expect(r.result.tools.find((t: any) => t.name === n).inputSchema.properties.apply.type).toBe('boolean');
  });

  it('read tools return JSON text', async () => {
    const { f } = world();
    expect(payload(await call(f, 'list_groups')).repositories).toBe(10);
    expect(payload(await call(f, 'list_repos', { ungrouped: true })).repos.map((x: any) => x.name)).toEqual(['keep_alive_job']);
    expect(payload(await call(f, 'show_group', { path: 'infra/dagsrv' })).reposTotal).toBe(3);
    expect(payload(await call(f, 'suggest')).ungrouped).toBe(1);
    expect(payload(await call(f, 'validate', { yaml: EXAMPLE })).valid).toBe(true);
    expect(payload(await call(f, 'validate', { yaml: 'x: 1' })).valid).toBe(false);
    expect(payload(await call(f, 'diff', { yaml: EXAMPLE })).noChange).toBe(true);
  });

  it('write tools are dry-run unless apply is exactly true', async () => {
    const { s, f } = world();
    for (const apply of [undefined, false, 'true', 1]) {
      const r = await call(f, 'move_repo', { repo: 'keep_alive_job', group: 'infra/dagsrv', ...(apply === undefined ? {} : { apply }) });
      expect(payload(r).dryRun).toBe(true);
      expect(payload(r).applied).toBe(false);
    }
    expect(puts(f)).toHaveLength(0);
    const r = await call(f, 'move_repo', { repo: 'keep_alive_job', group: 'infra/dagsrv', apply: true });
    expect(payload(r).applied).toBe(true);
    expect(payload(r).commit).toBe('abcdef1234');
    expect(puts(f)).toHaveLength(1);
    expect(s.file!.text).toContain('"keep_alive_job"');
    expect(payload(r).yaml).toBeUndefined();
    const withYaml = await call(f, 'add_rule', { group: 'infra', rule: 'zz-*', include_yaml: true });
    expect(payload(withYaml).yaml).toContain('zz-*');
  });

  it('create_group, add_rule and apply commit with apply: true', async () => {
    const { s, f } = world();
    await call(f, 'create_group', { path: 'infra/billing', apply: true });
    await call(f, 'add_rule', { group: 'infra/billing', rule: 'billing-*', apply: true });
    expect(puts(f).map((p) => JSON.parse(p.body!).message)).toEqual(['chore(repo-groups): add subgroup infra/billing', 'chore(repo-groups): add rule billing-* to infra/billing']);
    const r = await call(f, 'apply', { yaml: s.file!.text.replace('billing-*', 'bill-*'), apply: true });
    expect(payload(r).applied).toBe(true);
  });

  it('retries once on a sha conflict', async () => {
    const { f } = world({ beforePut: (w) => void (w.file = { text: w.file!.text, sha: 'sha-2' }) });
    const r = await call(f, 'add_rule', { group: 'infra', rule: 'q', apply: true });
    expect(payload(r).applied).toBe(true);
    expect(puts(f)).toHaveLength(2);
  });

  it('reports fixable problems as tool errors, not protocol errors', async () => {
    const { f } = world();
    const noToken = await call(f, 'list_groups', {}, { RG_ORG: 'o' });
    expect(noToken.result.isError).toBe(true);
    expect(noToken.result.content[0].text).toMatch(/GITHUB_TOKEN/);
    const missing = await call(f, 'move_repo', { repo: 'x' });
    expect(missing.result.isError).toBe(true);
    const unknown = await call(f, 'nope');
    expect(unknown.error.code).toBe(-32602);
    expect(JSON.stringify([noToken, missing])).not.toContain(TOKEN);
  });

  it('the org argument overrides RG_ORG', async () => {
    const { f } = world();
    await call(f, 'list_groups', { org: 'o' }, { GITHUB_TOKEN: TOKEN });
    expect(f.calls.length).toBeGreaterThan(0);
  });

  it('serveStdio speaks newline-delimited JSON-RPC', async () => {
    const { f } = world();
    const lines: string[] = [];
    const input = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n',
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
      'not json\n',
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_groups', arguments: {} } }),
    ];
    await serveStdio((async function* () { yield* input; })(), (l) => lines.push(l), deps(f));
    const msgs = lines.map((l) => JSON.parse(l));
    expect(msgs).toHaveLength(3);
    expect(msgs.find((m) => m.id === 1).result.serverInfo.name).toBe('repo-groups');
    expect(msgs.find((m) => m.id === null).error.code).toBe(-32700);
    expect(JSON.parse(msgs.find((m) => m.id === 2).result.content[0].text).repositories).toBe(10);
  });
});
