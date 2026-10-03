import { describe, expect, it } from 'vitest';
import { example, EXAMPLE, load, REPOS } from './fixtures';
import { globRe, matches, normName } from '../src/core/glob';
import { findGroup, placement, pickIn, postOrder, ruleFor } from '../src/core/placement';
import { readConfig, stripFences } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';
import { diffTrees } from '../src/core/diff';
import { lineTokens, highlightHtml } from '../src/core/highlight';
import { aiPrompt, aiText, SCOPE_LINE } from '../src/core/ai-prompt';
import { ago } from '../src/core/time';
import { buildHash, parseHash } from '../src/core/layers';

const read = (t: string, o = {}) => readConfig(t, load, { org: 'thekonnen', ...o });

describe('glob', () => {
  it('matches case-insensitively and escapes regex chars', () => {
    expect(globRe('dags-*').test('DAGS-repo')).toBe(true);
    expect(globRe('a.b').test('axb')).toBe(false);
    expect(matches(['*authentik*'], 'konnen-authentik')).toBe(true);
  });
  it('normalizes repository names like GitHub', () => {
    expect(normName('  my repo!! name ')).toBe('my-repo-name');
    expect(normName('ok_name.v1')).toBe('ok_name.v1');
  });
});

describe('placement', () => {
  const cfg = example();
  const p = placement(cfg.groups, REPOS);
  it('matches the F1 done-when', () => {
    expect(p['keep_supabase_alive']).toBe('');
    expect(Object.values(p).filter((k) => k === 'infra/dagu')).toHaveLength(3);
    expect(p['dagu'] && p['dags-repo'] && p['konnen-dagu']).toBe('infra/dagu');
    expect(p['omniroute']).toBe('ai');
    expect(p['konnen-litellm']).toBe('ai/litellm');
  });
  it('exact names beat patterns, even in a shallower group', () => {
    const c = read('groups:\n  - name: a\n    match: ["x-tool"]\n  - name: b\n    match: ["x-*"]\n').config!;
    expect(placement(c.groups, [{ name: 'x-tool' }, { name: 'x-other' }])).toEqual({ 'x-tool': 'a', 'x-other': 'b' });
  });
  it('deepest pattern wins', () => {
    const c = read('groups:\n  - name: p\n    match: ["*-svc"]\n    groups:\n      - name: c\n        match: ["a-*"]\n').config!;
    expect(placement(c.groups, [{ name: 'a-svc' }])['a-svc']).toBe('p/c');
  });
  it('post-order puts children before parents', () => {
    expect(postOrder(cfg.groups).map((n) => n.key)).toEqual(['infra/dagu', 'infra/authentik', 'infra/checkmate', 'infra', 'ai/litellm', 'ai']);
  });
  it('ruleFor and pickIn', () => {
    const g = findGroup(cfg.groups, ['infra', 'dagu'])!;
    expect(ruleFor(g, 'dags-x')).toBe('dags-*');
    expect(ruleFor(g, 'dagu')).toBe('dagu');
    expect(pickIn(postOrder(cfg.groups), 'nothing')).toBeNull();
  });
});

describe('yaml read + validate', () => {
  it('reads the example with both teams forms', () => {
    const c = example();
    expect(c.groups[0].teams).toEqual([{ slug: 'konnen_team', permission: 'push' }]);
    expect(c.groups[1].teams).toEqual([{ slug: 'ai-squad', permission: 'maintain' }]);
    expect(c.version).toBe(1);
    expect(c.index).toBe('api');
  });
  it('strips fences from a chat answer and ignores repositories/unknown keys', () => {
    const r = read('Sure!\n```yaml\nversion: 1\nfoo: 1\ngroups:\n  - name: a\n    match: z\nrepositories:\n  - name: q\n```\nbye');
    expect(r.stripped).toBe(true);
    expect(r.config!.groups[0].match).toEqual(['z']);
    expect(stripFences('plain').stripped).toBe(false);
  });
  it.each([
    ['version: 1', 'The file needs a top-level "groups:" list.'],
    ['groups:\n  - name: Bad Name', 'groups → item 1: name "Bad Name" must use lowercase letters, numbers, - _ or .'],
    ['groups:\n  - name: a\n  - name: a', 'Two groups are named "a" in groups.'],
    ['groups:\n  - name: a\n    match: 3', '"a": match must be a list of names or patterns.'],
    ['groups:\n  - name: a\n    groups: x', '"a": groups must be a list.'],
    ['groups:\n  - name: a\n    teams: x', '"a": teams must be a list of team slugs or { slug, permission }.'],
    ['groups:\n  - name: a\n    teams: [3]', '"a": teams must be a list of team slugs or { slug, permission }.'],
  ])('error for %j', (text, msg) => expect(read(text).error).toBe(msg));
  it('reports YAML syntax errors with a line', () => {
    const r = read('groups:\n  - name: [a\n');
    expect(r.error).toMatch(/\(line \d+\)$/);
    expect(r.line).toBeGreaterThan(0);
  });
  it('validates permissions against custom roles', () => {
    const t = 'groups:\n  - name: a\n    teams: [{ slug: t, permission: wizard }]\n';
    expect(read(t, { customRoles: ['dev'] }).error).toContain('permission "wizard" must be one of pull, triage, push, maintain, admin, or a custom repository role of thekonnen.');
    expect(read(t, { customRoles: ['wizard'] }).error).toBeUndefined();
    const open = read(t);
    expect(open.error).toBeUndefined();
    expect(open.warnings).toHaveLength(1);
  });
  it('warns, not errors, on unknown team slugs', () => {
    const r = read(EXAMPLE, { knownTeams: ['konnen_team'] });
    expect(r.error).toBeUndefined();
    expect(r.warnings).toContain('"ai": team "ai-squad" was not found in thekonnen.');
  });
});

describe('yaml write', () => {
  it('round-trips write → read → same tree', () => {
    const c = example();
    const text = writeConfig(c, 'thekonnen/.github/repo-groups.yml');
    expect(text.startsWith('# thekonnen/.github/repo-groups.yml\nversion: 1\ngroups:\n')).toBe(true);
    expect(read(text).config).toEqual(c);
  });
  it('emits canonical format', () => {
    const t = writeConfig(example(), 'x');
    expect(t).toContain('    teams: ["konnen_team"]\n');
    expect(t).toContain('    teams: [{ slug: "ai-squad", permission: "maintain" }]\n');
    expect(t).toContain('        match: ["dagu", "dags-*", "konnen-dagu"]\n');
  });
  it('escapes quotes and supports empty files, index and personal layer', () => {
    const c = read('index: action\ngroups:\n  - name: a\n    description: say "hi"\n    teams: [t]\n').config!;
    expect(read(writeConfig(c, 'h')).config).toEqual(c);
    expect(writeConfig(c, 'h')).toContain('index: action');
    const personal = writeConfig(c, 'h', { personal: true });
    expect(personal).not.toContain('teams');
    expect(personal).not.toContain('index');
    expect(writeConfig({ version: 1, index: 'api', groups: [] }, 'h')).toContain('groups: []');
  });
});

describe('diff', () => {
  it('lists added/removed groups, edits and moves', () => {
    const a = example().groups;
    const b = read(
      'groups:\n  - name: infra\n    description: "changed"\n    match: ["omniroute"]\n  - name: new\n',
    ).config!.groups;
    const d = diffTrees(a, b, REPOS);
    const kinds = d.items.map((i) => i.k + ' ' + i.text);
    expect(kinds).toContain('+ New group');
    expect(kinds).toContain('− Removed group');
    expect(kinds).toContain('~ Description of infra');
    expect(kinds).toContain('~ Rules of infra');
    expect(d.items.find((i) => i.text === 'omniroute')!.to).toBe('ai → infra');
    expect(d.groups).toBe(2);
  });
  it('reports team changes and no changes', () => {
    const a = example().groups;
    expect(diffTrees(a, a, REPOS).items).toEqual([]);
    const b = read(writeConfig({ version: 1, index: 'api', groups: a }, 'x').replace('["konnen_team"]', '[{ slug: "konnen_team", permission: "pull" }]')).config!.groups;
    expect(diffTrees(a, b, REPOS).items[0]).toMatchObject({ k: '~', text: 'Teams of infra', to: 'konnen_team · Read' });
  });
});

describe('highlight', () => {
  it('tokenizes keys, dashes, strings, constants and comments', () => {
    expect(lineTokens('  - name: "a" # hi')).toEqual([
      { cls: 'plain', text: '  ' }, { cls: 'dash', text: '- ' }, { cls: 'key', text: 'name' }, { cls: 'punc', text: ':' },
      { cls: 'plain', text: ' ' }, { cls: 'str', text: '"a"' }, { cls: 'plain', text: ' ' }, { cls: 'com', text: '# hi' },
    ]);
    const m = lineTokens('match: ["a", 2, true]').map((t) => t.cls);
    expect(m).toContain('punc');
    expect(m).toContain('const');
  });
  it('does not treat # inside strings as a comment and escapes HTML', () => {
    expect(lineTokens('d: "a # b"').some((t) => t.cls === 'com')).toBe(false);
    expect(highlightHtml('k: "<b>"')).toContain('&lt;b&gt;');
  });
});

describe('ai prompt', () => {
  it('fills the org and drops doc comments', () => {
    const p = aiPrompt('thekonnen');
    expect(p).toContain('the "thekonnen" organization');
    expect(p.startsWith('You are a software architect')).toBe(true);
    expect(p).not.toContain('{{org}}');
    expect(p).not.toContain(SCOPE_LINE);
  });
  it('adds the scope line before Output rules and assembles the full text', () => {
    const t = aiText('o', 'version: 1\ngroups: []\n', [{ name: 'a', description: 'd "x"', language: 'Go' }, { name: 'b' }], true);
    expect(t.indexOf(SCOPE_LINE)).toBeLessThan(t.indexOf('Output rules:'));
    expect(t).toContain('Current file and repositories:\n\n```yaml\nversion: 1\ngroups: []\n\nrepositories:');
    expect(t).toContain('  - name: a\n    description: "d \\"x\\""\n    language: Go\n  - name: b\n```');
  });
});

describe('time + layers', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  it('formats relative time', () => {
    expect(ago('2026-01-10T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-01-10T11:30:00Z', now)).toBe('30 minutes ago');
    expect(ago('2026-01-09T12:00:00Z', now)).toBe('yesterday');
    expect(ago(null)).toBe('No pushes');
  });
  it('parses and builds hashes for both layers', () => {
    expect(parseHash('#infra/dagu')).toEqual({ layer: 'org', path: ['infra', 'dagu'] });
    expect(parseHash('#~my/a/b')).toEqual({ layer: 'my', path: ['a', 'b'] });
    expect(parseHash('')).toEqual({ layer: 'org', path: [] });
    expect(buildHash({ layer: 'my', path: ['a'] })).toBe('#~my/a');
    expect(buildHash({ layer: 'org', path: [] })).toBe('');
  });
});
