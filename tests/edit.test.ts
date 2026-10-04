import { describe, expect, it } from 'vitest';
import { applyEdit, commitMessage, deleteImpact, editPath, finalName, slugName, validateDraft, type Edit } from '../src/core/edit';
import { readConfig } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';
import { example, load } from './fixtures';
import { findGroup, placement } from '../src/core/placement';

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

describe('delete group', () => {
  const TREE = [
    'groups:',
    '  - name: infra',
    '    match: ["keep_alive_job"]',
    '    groups:',
    '      - name: jobs',
    '        teams: ["core_team"]',
    '        logo: "logos/infra-jobs.png"',
    '        match: ["dagsrv", "dags-*", "Cron-*"]',
    '        groups:',
    '          - name: nightly',
    '            match: ["nightly-*", "dags-*"]',
    '      - name: auth',
    '        match: ["authn"]',
    '  - name: ai',
    '    match: ["llm-*"]',
    '  - name: apps',
    '    match: ["app-*"]',
  ].join('\n');
  const groups = () => readConfig(TREE, load, { org: 'o' }).config!.groups;
  const repos = ['keep_alive_job', 'dagsrv', 'dags-one', 'cron-x', 'nightly-1', 'authn', 'llm-1', 'app-1', 'stray'].map((name) => ({ name }));
  const where = (g: ReturnType<typeof groups>) => placement(g, repos);
  const del = (path: string[], g = groups()) => {
    const r = applyEdit(g, { kind: 'delete', path });
    if ('error' in r) throw new Error(r.error);
    return r.groups;
  };

  it('a top-level group goes with its subgroups and its repositories become Ungrouped', () => {
    const before = where(groups());
    expect(before['dagsrv']).toBe('infra/jobs');
    expect(before['nightly-1']).toBe('infra/jobs/nightly');
    const after = del(['infra']);
    expect(after.map((g) => g.name)).toEqual(['ai', 'apps']);
    const now = where(after);
    for (const r of ['keep_alive_job', 'dagsrv', 'dags-one', 'cron-x', 'nightly-1', 'authn']) expect(now[r]).toBe('');
    expect(now['llm-1']).toBe('ai'); // other groups are untouched
    expect(now['app-1']).toBe('apps');
  });

  it('a subgroup is removed and its repositories stay in the group above', () => {
    const after = del(['infra', 'auth']);
    expect(findGroup(after, ['infra', 'auth'])).toBeNull();
    expect(findGroup(after, ['infra'])!.match).toEqual(['keep_alive_job', 'authn']);
    expect(where(after)['authn']).toBe('infra'); // was infra/auth
    expect(where(after)['dagsrv']).toBe('infra/jobs'); // siblings keep theirs
  });

  it('a subgroup with subgroups of its own: all their rules move up and nothing is left behind', () => {
    const after = del(['infra', 'jobs']);
    expect(findGroup(after, ['infra', 'jobs'])).toBeNull();
    expect(findGroup(after, ['infra', 'jobs', 'nightly'])).toBeNull();
    // own rules first, then the sub-subgroup's; "dags-*" is not repeated
    expect(findGroup(after, ['infra'])!.match).toEqual(['keep_alive_job', 'dagsrv', 'dags-*', 'Cron-*', 'nightly-*']);
    const now = where(after);
    for (const r of ['dagsrv', 'dags-one', 'cron-x', 'nightly-1', 'keep_alive_job']) expect(now[r]).toBe('infra');
    expect(now['authn']).toBe('infra/auth');
  });

  it('deleting a middle level moves the deeper rules to the grandparent, not to a group that no longer exists', () => {
    const after = del(['infra', 'jobs', 'nightly']);
    expect(findGroup(after, ['infra', 'jobs'])!.match).toEqual(['dagsrv', 'dags-*', 'Cron-*', 'nightly-*']);
    expect(where(after)['nightly-1']).toBe('infra/jobs');
  });

  it('does not repeat a rule the parent already has, whatever its case', () => {
    const g = groups();
    findGroup(g, ['infra'])!.match.push('DAGSRV');
    expect(findGroup(del(['infra', 'jobs'], g), ['infra'])!.match.filter((m) => m.toLowerCase() === 'dagsrv')).toEqual(['DAGSRV']);
  });

  it('never mutates its input and reports a group that is gone', () => {
    const g = groups();
    const copy = structuredClone(g);
    del(['infra', 'jobs'], g);
    expect(g).toEqual(copy);
    expect(applyEdit(g, { kind: 'delete', path: ['infra', 'nope'] })).toEqual({ error: 'The group "infra/nope" no longer exists. Reload the page and try again.' });
    expect('error' in applyEdit(g, { kind: 'delete', path: ['gone'] })).toBe(true);
  });

  it('deleting the only group leaves an empty file that still reads back', () => {
    const one = readConfig('groups:\n  - name: a\n', load, { org: 'o' }).config!;
    const text = writeConfig({ ...one, groups: del(['a'], one.groups) }, 'o/.github/repo-groups.yml');
    expect(text).toContain('groups: []');
    expect(readConfig(text, load, { org: 'o' }).config!.groups).toEqual([]);
  });

  it('commit message and path name what was deleted', () => {
    expect(commitMessage({ kind: 'delete', path: ['infra'] })).toBe('chore(repo-groups): delete group infra');
    expect(commitMessage({ kind: 'delete', path: ['infra', 'jobs'] })).toBe('chore(repo-groups): delete subgroup infra/jobs (rules moved to the parent group)');
    expect(editPath({ kind: 'delete', path: ['infra', 'jobs'] })).toBe('infra/jobs');
  });

  describe('impact shown before confirming', () => {
    it('a subgroup: counts, the rules that move, and where the repositories stay', () => {
      const i = deleteImpact(groups(), ['infra', 'jobs'], repos)!;
      expect(i).toMatchObject({ subgroups: 1, rules: 5, movedRules: 5, parentKey: 'infra', hasTeams: true, hasLogo: true });
      expect(i.repos).toBe(4); // dagsrv, dags-one, cron-x, nightly-1
      expect(i.landing).toEqual([{ key: 'infra', count: 4 }]);
    });
    it('a top-level group: nothing moves up and the repositories become Ungrouped', () => {
      const i = deleteImpact(groups(), ['infra'], repos)!;
      expect(i).toMatchObject({ subgroups: 3, movedRules: 0, parentKey: '', hasTeams: true });
      expect(i.repos).toBe(6);
      expect(i.landing).toEqual([{ key: '', count: 6 }]);
    });
    it('a group with no repositories, no teams and no logo', () => {
      expect(deleteImpact(groups(), ['apps'], [])).toMatchObject({ repos: 0, landing: [], hasTeams: false, hasLogo: false });
    });
    it('reports honestly when a repository would land somewhere else', () => {
      const g = groups();
      // another group, listed earlier, has a glob that also matches dagsrv: after the delete it can win
      g.unshift({ name: 'early', description: '', logo: null, teams: [], match: ['dags*'], groups: [] });
      const i = deleteImpact(g, ['infra', 'jobs'], repos)!;
      expect(i.landing.map((l) => l.key)).toContain('infra');
      expect(i.landing.reduce((n, l) => n + l.count, 0)).toBe(i.repos);
    });
    it('is null for a group that does not exist', () => {
      expect(deleteImpact(groups(), ['nope'], repos)).toBeNull();
    });
  });
});
