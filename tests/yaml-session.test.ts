import { describe, expect, it } from 'vitest';
import { buildTree, nodeAt } from '../src/core/tree';
import { scopeOptions, scopeWarning, statusSummary, yamlCommitMessage, changesText } from '../src/core/yaml-session';
import { example } from './fixtures';

const names = ['konnen-litellm', 'litellm', 'konnen-authentik', 'authentik', 'dagu', 'dags-repo', 'keep_supabase_alive', 'omniroute'];
const model = buildTree(example().groups, names.map((name) => ({ name })).concat([{ name: 'old', archived: true } as any]));

describe('scope options (F8/F14)', () => {
  it('offers all, ungrouped, and "this group" only on a group page, with counts (archived excluded)', () => {
    const root = scopeOptions(model, model.root);
    expect(root.map((o) => o.label)).toEqual(['All repositories (8)', 'Ungrouped only (1)']);
    const g = scopeOptions(model, nodeAt(model, ['infra'])!);
    expect(g.map((o) => o.label)).toEqual(['All repositories (8)', 'Ungrouped only (1)', 'This group (4)']);
    expect(g[2].repos.map((r) => r.name).sort()).toEqual(['authentik', 'dags-repo', 'dagu', 'konnen-authentik']);
    expect(scopeOptions(model, null)).toHaveLength(2);
  });
  it('warns above 500 repositories and suggests a smaller scope', () => {
    expect(scopeWarning(500)).toBeNull();
    expect(scopeWarning(501)).toContain('501 repositories');
    expect(scopeWarning(2000)).toContain('Ungrouped only');
  });
});

describe('status text', () => {
  it('summarizes groups, grouped repos and fences', () => {
    expect(statusSummary({ items: [], groups: 7, ungrouped: 1 }, 10, true)).toBe('7 groups · 9 of 10 repositories grouped · 1 ungrouped · code fences removed');
    expect(statusSummary({ items: [], groups: 1, ungrouped: 0 }, 3, false)).toBe('1 group · 3 of 3 repositories grouped');
  });
  it('commit message counts changes (§7)', () => {
    expect(yamlCommitMessage(19)).toBe('chore(repo-groups): apply YAML edit (19 changes)');
    expect(yamlCommitMessage(1)).toBe('chore(repo-groups): apply YAML edit (1 change)');
    expect(changesText(0)).toBe('0 changes');
  });
});
