import { describe, expect, it } from 'vitest';
import { buildAgentsSnippet, buildGroupContext, codeSpan, contextFilename, mdText } from '../src/core/agent-context';
import { buildTree, nodeAt } from '../src/core/tree';
import type { Group, RepoInfo } from '../src/core/types';

const g = (name: string, o: Partial<Group> = {}): Group => ({ name, description: '', logo: null, teams: [], match: [], groups: [], ...o });
const repo = (name: string, o: Partial<RepoInfo> = {}): RepoInfo => ({ name, pushedAt: '2026-01-10T12:00:00Z', private: false, language: 'Go', ...o });

const groups = [
  g('infra', { description: 'Platform "infra"', match: ['infra-*'], teams: [{ slug: 'core_team', permission: 'push' }], groups: [
    g('dagsrv', { description: 'DAG server', match: ['dagsrv', 'dags-*'] }),
    g('empty'),
  ] }),
  g('ai', { match: ['llm-*'] }),
];
const repos = [
  repo('infra-base', { description: 'Base images', pushedAt: '2026-01-01T00:00:00Z' }),
  repo('dagsrv', { description: 'Server', language: 'Python', private: true, pushedAt: '2026-01-09T00:00:00Z' }),
  repo('dags-repo', { pushedAt: '2026-01-08T00:00:00Z' }),
  repo('llm-proxy'),
  repo('loose'),
];
const model = buildTree(groups, repos);
const at = (p: string[]) => nodeAt(model, p)!;

describe('buildGroupContext', () => {
  it('describes a nested group with its subgroups, rules, teams and repos', () => {
    const r = buildGroupContext({ org: 'acme', node: at(['infra']), teams: ['core_team'] });
    expect(r.total).toBe(3);
    expect(r.omitted).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.text).toContain('# Context: acme / infra');
    expect(r.text).toContain('- Path: `infra`');
    expect(r.text).toContain('- Match rules: `infra-*`');
    expect(r.text).toContain('- Teams: `core_team`');
    expect(r.text).toContain('- Subgroups: `infra/dagsrv`, `infra/empty`');
    expect(r.text).toContain('[dagsrv](https://github.com/acme/dagsrv)');
    expect(r.text).toContain('clone `https://github.com/acme/dagsrv.git`');
    expect(r.text).toContain('Python · pushed 2026-01-09 · private');
    expect(r.text).not.toContain('llm-proxy'); // another group
    expect(r.text).not.toContain('loose');
  });

  it('is deterministic and orders groups parent first, repos newest push first', () => {
    const a = buildGroupContext({ org: 'acme', node: at(['infra']) });
    expect(buildGroupContext({ org: 'acme', node: at(['infra']) }).text).toBe(a.text);
    const i = (s: string) => a.text.indexOf(`[${s}]`);
    expect(i('infra-base')).toBeGreaterThan(-1);
    expect(i('infra-base')).toBeLessThan(i('dagsrv'));
    expect(i('dagsrv')).toBeLessThan(i('dags-repo'));
    expect(a.text.indexOf('### infra\n')).toBeLessThan(a.text.indexOf('### infra/dagsrv'));
  });

  it('handles an empty group and marks relations unknown', () => {
    const r = buildGroupContext({ org: 'acme', node: at(['infra', 'empty']) });
    expect(r.total).toBe(0);
    expect(r.text).toContain('No repositories in this group yet.');
    expect(r.text).toContain('Relationships: **unknown**');
    expect(r.text).toContain('- Teams: _none tagged_');
  });

  it('builds the relation section only from data: unknown topics and dependencies are marked, shared topics are counted', () => {
    const none = buildGroupContext({ org: 'acme', node: at(['infra']) }).text;
    expect(none).toContain('Topics: **unknown**');
    expect(none).toContain('Dependencies, shared APIs and deploy order: **unknown**');
    expect(none).toContain('Languages (primary, from the index): Go 2, Python 1');
    expect(none).toContain('Group `infra/dagsrv`: DAG server');
    const some = buildGroupContext({ org: 'acme', node: at(['infra']), topics: { dagsrv: ['dag', 'etl'], 'dags-repo': ['dag'] } }).text;
    expect(some).toContain('Topics shared by two or more repositories: dag (2)');
  });

  it('includes the readme when the group has one, quoted and capped', () => {
    const r = buildGroupContext({ org: 'acme', node: at(['ai']), readme: 'Line one\n# not a heading\n' + 'x'.repeat(3000) });
    expect(r.text).toContain('### README of the group');
    expect(r.text).toContain('> Line one');
    expect(r.text).toContain('> # not a heading');
    expect(r.text.length).toBeLessThan(8000);
    expect(buildGroupContext({ org: 'acme', node: at(['ai']) }).text).not.toContain('README');
  });

  it('truncates a huge group under the cap with a note and an omitted count', () => {
    const many = Array.from({ length: 400 }, (_, i) => repo(`svc-${String(i).padStart(3, '0')}`, { description: 'A service that does a number of useful things' }));
    const m = buildTree([g('big', { match: ['svc-*'] })], many);
    const r = buildGroupContext({ org: 'acme', node: nodeAt(m, ['big'])! });
    expect(r.text.length).toBeLessThanOrEqual(8000);
    expect(r.total).toBe(400);
    expect(r.omitted).toBeGreaterThan(0);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain(`Truncated: ${r.omitted} of 400 repositories omitted`);
    const listed = (r.text.match(/^- \[svc-/gm) ?? []).length;
    expect(listed + r.omitted).toBe(400);
    const small = buildGroupContext({ org: 'acme', node: nodeAt(m, ['big'])!, maxChars: 200000 });
    expect(small.omitted).toBe(0);
    expect(small.text).not.toContain('Truncated');
  });

  it('never exceeds the cap even when the notes alone are huge', () => {
    const rules = Array.from({ length: 500 }, (_, i) => 'r' + i);
    const m = buildTree([g('x', { description: 'd'.repeat(20000), match: rules })], [repo('r1')]);
    const r = buildGroupContext({ org: 'acme', node: nodeAt(m, ['x'])!, maxChars: 1000 });
    expect(r.text.length).toBeLessThanOrEqual(1000);
    expect(r.truncated).toBe(true);
  });

  it('escapes Markdown specials in descriptions, names and rules', () => {
    const m = buildTree([g('x', { description: 'a *bold* [link](http://x) <b> | _u_', match: ['we`ird*', 'x-1'] })], [repo('x-1', { description: '# h1 `code` & <script>\nsecond line' })]);
    const r = buildGroupContext({ org: 'acme', node: nodeAt(m, ['x'])! }).text;
    expect(r).toContain('a \\*bold\\* \\[link\\](http://x) \\<b\\> \\| \\_u\\_');
    expect(r).toContain('# h1 \\`code\\` \\& \\<script\\> second line');
    expect(r).toContain('``we`ird*``');
    expect(r).not.toContain('<script>');
  });

  it('describes the top level and labels the personal layer', () => {
    const r = buildGroupContext({ org: 'acme', node: model.root, layer: 'my' });
    expect(r.text).toContain('# Context: acme / All groups');
    expect(r.text).toContain('personal layer (My groups)');
    expect(r.total).toBe(5);
    expect(r.text).toContain('### (top level)');
    expect(r.text).toContain('[loose]');
  });

  it('uses the title for the group itself', () => {
    const m = buildTree([g('grupo-x', { title: 'Grupo: X' })], []);
    expect(buildGroupContext({ org: 'acme', node: nodeAt(m, ['grupo-x'])! }).text).toContain('# Context: acme / Grupo: X');
  });

  it('marks missing data per repository', () => {
    const m = buildTree([g('x', { match: ['*'] })], [{ name: 'bare' }]);
    const t = buildGroupContext({ org: 'acme', node: nodeAt(m, ['x'])! }).text;
    expect(t).toContain('_no description_');
    expect(t).toContain('language unknown · pushed unknown · visibility unknown');
  });
});

describe('buildAgentsSnippet', () => {
  it('names the group and lists siblings without the repo itself', () => {
    const s = buildAgentsSnippet({ org: 'acme', node: at(['infra']), repo: 'dagsrv' });
    expect(s).toContain('`dagsrv` belongs to the group `acme / infra`');
    expect(s).toContain('[dags-repo](https://github.com/acme/dags-repo)');
    expect(s).not.toContain('[dagsrv]');
    expect(s).toContain('not recorded');
  });
  it('works without a repo, caps siblings, and handles a group alone', () => {
    const many = Array.from({ length: 30 }, (_, i) => repo(`s${i}`));
    const m = buildTree([g('big', { match: ['s*'] })], many);
    const s = buildAgentsSnippet({ org: 'acme', node: nodeAt(m, ['big'])!, layer: 'my' });
    expect(s).toContain('This repository belongs to the group `acme / big` (a personal grouping');
    expect(s).toContain('and 10 more');
    expect(buildAgentsSnippet({ org: 'acme', node: at(['infra', 'empty']) })).toContain('Sibling repositories: none known.');
  });
});

describe('helpers', () => {
  it('builds the file name from the org and the group path', () => {
    expect(contextFilename('acme', ['infra', 'dagsrv'])).toBe('acme-infra-dagsrv-context.md');
    expect(contextFilename('acme', [])).toBe('acme-all-context.md');
    expect(contextFilename('a cme', ['x/y'])).toBe('a-cme-x-y-context.md');
  });
  it('escapes text and code spans', () => {
    expect(mdText('  a\n b_*  ')).toBe('a b\\_\\*');
    expect(codeSpan('a`b')).toBe('``a`b``');
    expect(codeSpan('`a')).toBe('`` `a ``');
  });
});
