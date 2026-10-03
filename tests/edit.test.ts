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
    expect(validateDraft(g, { mode: 'new', path: ['infra'], name: 'dagu' })).toBe('A group named "dagu" already exists here.');
    expect(validateDraft(g, { mode: 'new', path: ['ai'], name: 'dagu' })).toBeNull();
    expect(validateDraft(g, { mode: 'edit', path: ['infra', 'dagu'], name: 'dagu' })).toBeNull(); // itself
    expect(validateDraft(g, { mode: 'edit', path: ['infra', 'dagu'], name: 'authentik' })).toBe('A group named "authentik" already exists here.');
    expect(validateDraft(g, { mode: 'edit', path: ['infra', 'dagu'], name: 'ai' })).toBeNull(); // same name at another level is fine
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
    expect(infra.teams).toEqual([{ slug: 'konnen_team', permission: 'push' }]);
    expect(infra.groups.map((g) => g.name)).toEqual(['dagu', 'authentik', 'checkmate']);
    expect(findGroup(r.groups, ['infra', 'dagu'])!.logo).toBe('logos/infra-dagu.png');
    expect(JSON.stringify(base)).toBe(before);
  });
  it('renames a group; its subgroups come along', () => {
    const r = applyEdit(base, { kind: 'edit', path: ['infra'], name: 'Platform', description: '', match: [] }) as any;
    expect(r.groups.map((g: any) => g.name)).toEqual(['platform', 'ai']);
    expect(findGroup(r.groups, ['platform', 'dagu'])).toBeTruthy();
  });
  it('adds a group at the root or under a parent, at the end', () => {
    const a = applyEdit(base, { kind: 'new', parent: [], name: 'data', description: 'Data', match: ['etl-*'] }) as any;
    expect(a.groups.map((g: any) => g.name)).toEqual(['infra', 'ai', 'data']);
    expect(a.groups[2]).toEqual({ name: 'data', description: 'Data', logo: null, teams: [], match: ['etl-*'], groups: [] });
    const b = applyEdit(base, { kind: 'new', parent: ['ai'], name: 'rag', description: '', match: [] }) as any;
    expect(findGroup(b.groups, ['ai'])!.groups.map((g) => g.name)).toEqual(['litellm', 'rag']);
  });
  it('reports a missing group, a duplicate and an empty name instead of throwing', () => {
    expect(applyEdit(base, { kind: 'edit', path: ['gone'], name: 'x', description: '', match: [] })).toEqual({ error: 'The group "gone" no longer exists. Reload the page and try again.' });
    expect(applyEdit(base, { kind: 'new', parent: ['gone'], name: 'x', description: '', match: [] })).toMatchObject({ error: expect.stringContaining('no longer exists') });
    expect(applyEdit(base, { kind: 'new', parent: [], name: 'infra', description: '', match: [] })).toEqual({ error: 'A group named "infra" already exists here.' });
    expect(applyEdit(base, { kind: 'edit', path: ['infra', 'dagu'], name: 'authentik', description: '', match: [] })).toMatchObject({ error: expect.stringContaining('already exists') });
    expect(applyEdit(base, { kind: 'new', parent: [], name: '!!', description: '', match: [] })).toEqual({ error: 'Name is required.' });
  });
  it('re-applying the same edit to a changed tree works (conflict retry)', () => {
    const edit: Edit = { kind: 'edit', path: ['infra', 'dagu'], name: 'dagu', description: 'Mine', match: ['dagu'] };
    const theirs = applyEdit(base, { kind: 'new', parent: [], name: 'data', description: '', match: [] }) as any;
    const merged = applyEdit(theirs.groups, edit) as any;
    expect(merged.groups.map((g: any) => g.name)).toEqual(['infra', 'ai', 'data']);
    expect(findGroup(merged.groups, ['infra', 'dagu'])!.description).toBe('Mine');
  });
});

describe('commit messages (§7)', () => {
  it('describes the action', () => {
    expect(commitMessage({ kind: 'edit', path: ['infra', 'dagu'], name: 'dagu', description: '', match: [] })).toBe('chore(repo-groups): edit group infra/dagu');
    expect(commitMessage({ kind: 'edit', path: ['infra', 'dagu'], name: 'jobs', description: '', match: [] })).toBe('chore(repo-groups): rename group infra/dagu to infra/jobs');
    expect(commitMessage({ kind: 'new', parent: [], name: 'Data', description: '', match: [] })).toBe('chore(repo-groups): add group data');
    expect(commitMessage({ kind: 'new', parent: ['infra'], name: 'n8n', description: '', match: [] })).toBe('chore(repo-groups): add subgroup infra/n8n');
  });
});

describe('splitRules', () => {
  it('splits on commas, spaces, semicolons and newlines, trims and removes duplicates', async () => {
    const { splitRules } = await import('../src/core/edit');
    expect(splitRules('dag,dagu,dags')).toEqual(['dag', 'dagu', 'dags']);
    expect(splitRules(' dag , dagu;dags\nlitellm  dag ')).toEqual(['dag', 'dagu', 'dags', 'litellm']);
    expect(splitRules('dags-*')).toEqual(['dags-*']);
    expect(splitRules(' , ;')).toEqual([]);
  });
  it('the YAML reader splits a rule written with commas, so an old broken rule starts working', async () => {
    const { readConfig } = await import('../src/core/yaml-read');
    const r = readConfig('groups:\n  - name: a\n    match: ["dag,dagu,dags"]\n', (t) => load(t));
    expect(r.config!.groups[0].match).toEqual(['dag', 'dagu', 'dags']);
  });
});
