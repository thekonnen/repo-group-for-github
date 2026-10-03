import { describe, expect, it } from 'vitest';
import { applyEdit, commitMessage, finalName, slugName, validateDraft, type Edit } from '../src/core/edit';
import { example, load } from './fixtures';
import { findGroup } from '../src/core/placement';

describe('group names', () => {
  it('slugs: lowercase, non-slug characters become "-"', () => {
    expect(slugName('My Group!')).toBe('my-group-');
    expect(slugName('a_b.c-d')).toBe('a_b.c-d');
    expect(finalName('  --My  Group!! ')).toBe('my-group');
    expect(finalName('***')).toBe('');
  });
  it('validates required and duplicate names among siblings', () => {
    const g = example().groups;
    expect(validateDraft(g, { mode: 'new', path: [], name: '  ' })).toBe('Name is required.');
    expect(validateDraft(g, { mode: 'new', path: [], name: 'Infra' })).toBe('A group named "infra" already exists here.');
    expect(validateDraft(g, { mode: 'new', path: ['infra'], name: 'dagsrv' })).toBe('A group named "dagsrv" already exists here.');
    expect(validateDraft(g, { mode: 'new', path: ['ai'], name: 'dagsrv' })).toBeNull();
    expect(validateDraft(g, { mode: 'edit', path: ['infra', 'dagsrv'], name: 'dagsrv' })).toBeNull(); // itself
    expect(validateDraft(g, { mode: 'edit', path: ['infra', 'dagsrv'], name: 'authn' })).toBe('A group named "authn" already exists here.');
    expect(validateDraft(g, { mode: 'edit', path: ['infra', 'dagsrv'], name: 'ai' })).toBeNull(); // same name at another level is fine
  });
});

describe('applyEdit', () => {
  const base = example().groups;
  it('edits description and rules, keeping logo, teams and subgroups; never mutates the input', () => {
    const before = JSON.stringify(base);
    const r = applyEdit(base, { kind: 'edit', path: ['infra'], name: 'infra', description: ' New text ', match: ['a', ' b ', ''] }) as any;
    const infra = findGroup(r.groups, ['infra'])!;
    expect(infra.description).toBe('New text');
    expect(infra.match).toEqual(['a', 'b']);
    expect(infra.teams).toEqual([{ slug: 'core_team', permission: 'push' }]);
    expect(infra.groups.map((g) => g.name)).toEqual(['dagsrv', 'authn', 'cmonitor']);
    expect(findGroup(r.groups, ['infra', 'dagsrv'])!.logo).toBe('logos/infra-dagsrv.png');
    expect(JSON.stringify(base)).toBe(before);
  });
  it('renames a group; its subgroups come along', () => {
    const r = applyEdit(base, { kind: 'edit', path: ['infra'], name: 'Platform', description: '', match: [] }) as any;
    expect(r.groups.map((g: any) => g.name)).toEqual(['platform', 'ai']);
    expect(findGroup(r.groups, ['platform', 'dagsrv'])).toBeTruthy();
  });
  it('adds a group at the root or under a parent, at the end', () => {
    const a = applyEdit(base, { kind: 'new', parent: [], name: 'data', description: 'Data', match: ['etl-*'] }) as any;
    expect(a.groups.map((g: any) => g.name)).toEqual(['infra', 'ai', 'data']);
    expect(a.groups[2]).toEqual({ name: 'data', description: 'Data', logo: null, teams: [], match: ['etl-*'], groups: [] });
    const b = applyEdit(base, { kind: 'new', parent: ['ai'], name: 'rag', description: '', match: [] }) as any;
    expect(findGroup(b.groups, ['ai'])!.groups.map((g) => g.name)).toEqual(['llm-proxy', 'rag']);
  });
  it('reports a missing group, a duplicate and an empty name instead of throwing', () => {
    expect(applyEdit(base, { kind: 'edit', path: ['gone'], name: 'x', description: '', match: [] })).toEqual({ error: 'The group "gone" no longer exists. Reload the page and try again.' });
    expect(applyEdit(base, { kind: 'new', parent: ['gone'], name: 'x', description: '', match: [] })).toMatchObject({ error: expect.stringContaining('no longer exists') });
    expect(applyEdit(base, { kind: 'new', parent: [], name: 'infra', description: '', match: [] })).toEqual({ error: 'A group named "infra" already exists here.' });
    expect(applyEdit(base, { kind: 'edit', path: ['infra', 'dagsrv'], name: 'authn', description: '', match: [] })).toMatchObject({ error: expect.stringContaining('already exists') });
    expect(applyEdit(base, { kind: 'new', parent: [], name: '!!', description: '', match: [] })).toEqual({ error: 'Name is required.' });
  });
  it('re-applying the same edit to a changed tree works (conflict retry)', () => {
    const edit: Edit = { kind: 'edit', path: ['infra', 'dagsrv'], name: 'dagsrv', description: 'Mine', match: ['dagsrv'] };
    const theirs = applyEdit(base, { kind: 'new', parent: [], name: 'data', description: '', match: [] }) as any;
    const merged = applyEdit(theirs.groups, edit) as any;
    expect(merged.groups.map((g: any) => g.name)).toEqual(['infra', 'ai', 'data']);
    expect(findGroup(merged.groups, ['infra', 'dagsrv'])!.description).toBe('Mine');
  });
});

describe('commit messages (§7)', () => {
  it('describes the action', () => {
    expect(commitMessage({ kind: 'edit', path: ['infra', 'dagsrv'], name: 'dagsrv', description: '', match: [] })).toBe('chore(repo-groups): edit group infra/dagsrv');
    expect(commitMessage({ kind: 'edit', path: ['infra', 'dagsrv'], name: 'jobs', description: '', match: [] })).toBe('chore(repo-groups): rename group infra/dagsrv to infra/jobs');
    expect(commitMessage({ kind: 'new', parent: [], name: 'Data', description: '', match: [] })).toBe('chore(repo-groups): add group data');
    expect(commitMessage({ kind: 'new', parent: ['infra'], name: 'nflow', description: '', match: [] })).toBe('chore(repo-groups): add subgroup infra/nflow');
  });
});

describe('splitRules', () => {
  it('splits on commas, spaces, semicolons and newlines, trims and removes duplicates', async () => {
    const { splitRules } = await import('../src/core/edit');
    expect(splitRules('dag,dagsrv,dags')).toEqual(['dag', 'dagsrv', 'dags']);
    expect(splitRules(' dag , dagsrv;dags\nllm-proxy  dag ')).toEqual(['dag', 'dagsrv', 'dags', 'llm-proxy']);
    expect(splitRules('dags-*')).toEqual(['dags-*']);
    expect(splitRules(' , ;')).toEqual([]);
  });
  it('the YAML reader splits a rule written with commas, so an old broken rule starts working', async () => {
    const { readConfig } = await import('../src/core/yaml-read');
    const r = readConfig('groups:\n  - name: a\n    match: ["dag,dagsrv,dags"]\n', (t) => load(t));
    expect(r.config!.groups[0].match).toEqual(['dag', 'dagsrv', 'dags']);
  });
});

describe('display names and slugs (like GitLab)', () => {
  it('slugify builds the path from any text: "Grupo: Competição" -> "grupo-competicao"', async () => {
    const { slugify } = await import('../src/core/edit');
    const cases: [string, string][] = [
      ['Grupo: Competição', 'grupo-competicao'],
      ['Ação & Reação', 'acao-reacao'],
      ['Ünïcödé Straße', 'unicode-strasse'],
      ['  Équipe   de   Données  ', 'equipe-de-donnees'],
      ['Ørsted Œuvre Łódź', 'orsted-oeuvre-lodz'],
      ['infra_v2.0', 'infra_v2.0'],
      ['---Edge---', 'edge'],
      ['Já existe?!', 'ja-existe'],
      ['日本語', ''],
      ['', ''],
    ];
    for (const [input, out] of cases) expect(slugify(input), input).toBe(out);
  });
  it('cleanTitle drops empty titles and titles that only repeat the slug', async () => {
    const { cleanTitle, displayName } = await import('../src/core/edit');
    expect(cleanTitle('  Grupo   Competição ', 'grupo-competicao')).toBe('Grupo Competição');
    expect(cleanTitle('infra', 'infra')).toBeUndefined();
    expect(cleanTitle('   ', 'infra')).toBeUndefined();
    expect(cleanTitle(undefined, 'infra')).toBeUndefined();
    expect(displayName({ name: 'infra' })).toBe('infra');
    expect(displayName({ name: 'grupo-competicao', title: 'Grupo: Competição' })).toBe('Grupo: Competição');
  });
  it('a new group stores the title next to the slug; editing the title does not move the slug', () => {
    const a = applyEdit(example().groups, { kind: 'new', parent: [], name: 'grupo-competicao', title: 'Grupo: Competição', description: '', match: [] }) as any;
    expect(a.groups[2]).toMatchObject({ name: 'grupo-competicao', title: 'Grupo: Competição' });
    const b = applyEdit(a.groups, { kind: 'edit', path: ['grupo-competicao'], name: 'grupo-competicao', title: 'Competição 2025', description: '', match: [] }) as any;
    expect(b.groups[2]).toMatchObject({ name: 'grupo-competicao', title: 'Competição 2025' });
    const c = applyEdit(b.groups, { kind: 'edit', path: ['grupo-competicao'], name: 'grupo-competicao', title: 'grupo-competicao', description: '', match: [] }) as any;
    expect('title' in c.groups[2]).toBe(false); // a title that repeats the slug is not stored
    const d = applyEdit(b.groups, { kind: 'edit', path: ['grupo-competicao'], name: 'grupo-competicao', description: '', match: [] }) as any;
    expect(d.groups[2].title).toBe('Competição 2025'); // no title given: untouched
  });
  it('validation asks for a slug when the name has no usable letters', () => {
    const g = example().groups;
    expect(validateDraft(g, { mode: 'new', path: [], name: '', title: '日本語' })).toBe('Could not make a slug from this name. Type one in the Slug field.');
    expect(validateDraft(g, { mode: 'new', path: [], name: '', title: '' })).toBe('Name is required.');
    expect(validateDraft(g, { mode: 'new', path: [], name: 'grupo-competicao', title: 'Grupo: Competição' })).toBeNull();
  });
  it('the file keeps name as the slug and title as the display name; both round-trip', async () => {
    const { readConfig } = await import('../src/core/yaml-read');
    const { writeConfig } = await import('../src/core/yaml-write');
    const { load } = await import('./fixtures');
    const text = 'groups:\n  - name: grupo-competicao\n    title: "Grupo: Competição"\n    match: ["copa-*"]\n    groups:\n      - name: sub\n        title: "Sub Ação"\n';
    const cfg = readConfig(text, (t) => load(t)).config!;
    expect(cfg.groups[0].title).toBe('Grupo: Competição');
    expect(cfg.groups[0].groups[0].title).toBe('Sub Ação');
    const out = writeConfig(cfg, 'o/.github/repo-groups.yml');
    expect(out).toContain('  - name: grupo-competicao\n    title: "Grupo: Competição"\n    match: ["copa-*"]');
    expect(readConfig(out, (t) => load(t)).config).toEqual(cfg);
    // a group without a title writes none
    expect(writeConfig(readConfig('groups:\n  - name: a\n', (t) => load(t)).config!, 'h')).not.toContain('title');
  });
  it('the diff reports a changed display name', async () => {
    const { diffTrees } = await import('../src/core/diff');
    const a = example().groups;
    const b = structuredClone(a);
    b[0].title = 'Infraestrutura';
    expect(diffTrees(a, b, []).items).toEqual([{ k: '~', cls: 'chg', text: 'Name of infra', to: '“Infraestrutura”' }]);
  });
});
