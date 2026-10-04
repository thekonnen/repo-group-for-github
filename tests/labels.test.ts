import { describe, expect, it } from 'vitest';
import { createClient } from '../src/background/api';
import { memoryKV } from '../src/background/kv';
import { createHandler } from '../src/background/handlers';
import { memoryIndexStore } from '../src/background/repo-index';
import { addLabel, addMilestone, readLabelStates } from '../src/background/labels-data';
import { applyEdit } from '../src/core/edit';
import { diffTrees } from '../src/core/diff';
import { dueOn, effectiveLabels, effectiveMilestones, labelBody, labelsPlan, milestoneBody, normColor, type ExistingMap } from '../src/core/labels';
import { readConfig } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';
import { fakeFetch, type Route } from './fake-github';
import { load } from './fixtures';

const YAML = `groups:
  - name: infra
    labels:
      - urgent
      - { name: bug, color: "#D73A4A", description: "Something is broken" }
    milestones:
      - { title: "v1", due_on: 2026-12-31, description: "First release" }
    match: ["dags-*"]
    groups:
      - name: dagsrv
        labels: [{ name: BUG, color: "0e8a16" }, { name: infra-only }]
        milestones: [{ title: "v2" }]
        match: ["dagsrv", "kite-*"]
`;
const read = (t: string) => readConfig(t, load, { org: 'o' });
const cfg = () => read(YAML).config!;

describe('reading labels and milestones', () => {
  it('reads both forms, normalizes colors and dates, ignores unknown keys', () => {
    const g = cfg().groups[0];
    expect(g.labels).toEqual([{ name: 'urgent' }, { name: 'bug', color: 'd73a4a', description: 'Something is broken' }]);
    expect(g.milestones).toEqual([{ title: 'v1', due_on: '2026-12-31', description: 'First release' }]);
    expect(read('groups:\n  - name: a\n    whatever: 1\n    labels: [x]\n').config!.groups[0].labels).toEqual([{ name: 'x' }]);
  });
  it('one label per name, case-insensitive, the last wins', () => {
    expect(read('groups:\n  - name: a\n    labels: [{ name: Bug, color: "111111" }, { name: bug, color: "222222" }]\n').config!.groups[0].labels).toEqual([{ name: 'bug', color: '222222' }]);
  });
  it('validation messages', () => {
    expect(read('groups:\n  - name: a\n    labels: bug\n').error).toBe('"a": labels must be a list of label names or { name, color, description }.');
    expect(read('groups:\n  - name: a\n    labels: [{ color: "ffffff" }]\n').error).toBe('"a": labels must be a list of label names or { name, color, description }.');
    expect(read('groups:\n  - name: a\n    labels: [{ name: bug, color: red }]\n').error).toBe('"a": label "bug" color must be six hex digits, like d73a4a.');
    expect(read('groups:\n  - name: a\n    milestones: v1\n').error).toBe('"a": milestones must be a list of { title, due_on, description }.');
    expect(read('groups:\n  - name: a\n    milestones: [{ title: v1, due_on: "soon" }]\n').error).toBe('"a": milestone "v1" due_on must be a date like 2026-12-31.');
  });
  it('normColor and dueOn', () => {
    expect([normColor('#ABCDEF'), normColor('abc'), normColor('zzzzzz')]).toEqual(['abcdef', null, null]);
    expect([dueOn('2026-12-31'), dueOn('2026-12-31T10:00:00.000Z'), dueOn('tomorrow'), dueOn('2026-13-45')]).toEqual(['2026-12-31T00:00:00Z', '2026-12-31T10:00:00Z', null, null]);
  });
});

describe('writing', () => {
  it('emits labels and milestones after teams and before match, string shorthand for plain names', () => {
    const text = writeConfig(cfg(), 'o/.github/repo-groups.yml');
    expect(text).toContain('    labels: ["urgent", { name: "bug", color: "d73a4a", description: "Something is broken" }]\n    milestones: [{ title: "v1", due_on: "2026-12-31", description: "First release" }]\n    match: ["dags-*"]');
    expect(read(text).config!.groups).toEqual(cfg().groups); // round trip
  });
  it('personal layer drops them like teams', () => {
    expect(writeConfig(cfg(), 'x', { personal: true })).not.toContain('labels');
  });
});

describe('effective labels and milestones', () => {
  const g = () => cfg().groups;
  it('inherit; the closest definition of a name wins, case-insensitively', () => {
    const e = effectiveLabels(g(), ['infra', 'dagsrv']);
    expect(Object.keys(e).sort()).toEqual(['bug', 'infra-only', 'urgent']);
    expect(e.bug).toMatchObject({ label: { name: 'BUG', color: '0e8a16' }, from: 'infra/dagsrv' });
    expect(e.urgent).toMatchObject({ label: { color: 'ededed' }, from: 'infra' });
    expect(Object.keys(effectiveMilestones(g(), ['infra', 'dagsrv'])).sort()).toEqual(['v1', 'v2']);
    expect(Object.keys(effectiveMilestones(g(), ['infra']))).toEqual(['v1']);
  });
});

describe('labels plan', () => {
  const repos = [{ name: 'dags-a' }, { name: 'kite-x' }, { name: 'free' }, { name: 'dags-old', archived: true }, { name: 'unreadable' }];
  const existing: ExistingMap = {
    'dags-a': { labels: { bug: 'd73a4a', urgent: 'ededed' }, milestones: ['v1'] }, // has everything
    'kite-x': { labels: { bug: 'ff0000' }, milestones: ['V1'] }, // bug has another color
    free: { labels: {}, milestones: [] }, // ungrouped
    'dags-old': { labels: {}, milestones: [] },
  };
  it('lists only what is missing, flags a different color, skips archived, ungrouped and unknown state', () => {
    const rows = labelsPlan(cfg().groups, repos, existing);
    expect(rows.filter((r) => r.repo === 'dags-a')).toEqual([]);
    expect(rows.map((r) => [r.repo, r.kind, r.name, r.status]).sort()).toEqual([
      ['kite-x', 'label', 'BUG', 'differs'],
      ['kite-x', 'label', 'infra-only', 'missing'],
      ['kite-x', 'label', 'urgent', 'missing'],
      ['kite-x', 'milestone', 'v2', 'missing'],
    ]);
  });
  it('request bodies', () => {
    expect(labelBody({ name: 'x' })).toEqual({ name: 'x', color: 'ededed' });
    expect(milestoneBody({ title: 'v1', due_on: '2026-12-31', description: 'd' })).toEqual({ title: 'v1', state: 'open', description: 'd', due_on: '2026-12-31T00:00:00Z' });
  });
});

describe('edit and diff', () => {
  it('Edit group sets and clears labels and milestones; keeps them when not given', () => {
    const g = cfg().groups;
    const base = { kind: 'edit' as const, path: ['infra'], name: 'infra', description: '', match: ['dags-*'] };
    const kept = applyEdit(g, base);
    expect('groups' in kept && kept.groups[0].labels).toHaveLength(2);
    const set = applyEdit(g, { ...base, labels: [{ name: ' a ', color: '#ABCDEF' }], milestones: [] }) as { groups: typeof g };
    expect(set.groups[0].labels).toEqual([{ name: 'a', color: 'abcdef' }]);
    expect(set.groups[0].milestones).toBeUndefined();
    expect(diffTrees(g, set.groups, []).items.map((i) => i.text)).toEqual(['Default labels of infra', 'Default milestones of infra']);
  });
  it('New group carries them', () => {
    const r = applyEdit([], { kind: 'new', parent: [], name: 'a', description: '', match: [], labels: [{ name: 'x' }] }) as { groups: ReturnType<typeof cfg>['groups'] };
    expect(r.groups[0].labels).toEqual([{ name: 'x' }]);
  });
});

describe('background: read and add (only GET and POST)', () => {
  const client = (f: ReturnType<typeof fakeFetch>) => createClient({ fetch: f.fetch, getToken: async () => 't' });
  const read200: Route = (u, c) => {
    if (c.method !== 'GET') return undefined;
    const m = /^\/repos\/o\/([^/]+)\/(labels|milestones)$/.exec(u.pathname);
    if (!m) return undefined;
    if (m[1] === 'secret') return { status: 404, json: { message: 'Not Found' } };
    if (m[2] === 'labels') return { json: [{ name: 'Bug', color: 'D73A4A' }] };
    return { json: [{ title: 'V1' }] };
  };

  it('reads labels and milestones (state=all) 3 at a time, lowercased, and reports unreadable repos', async () => {
    const f = fakeFetch(read200);
    const r = await readLabelStates(client(f), 'o', ['a', 'b', 'c', 'd', 'secret']);
    expect(r.state.a).toEqual({ labels: { bug: 'd73a4a' }, milestones: ['v1'] });
    expect(Object.keys(r.state).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(r.failed.map((x) => x.repo)).toEqual(['secret']);
    expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(f.calls.some((c) => c.url.includes('/milestones?state=all&per_page=100'))).toBe(true);
    expect(f.calls.some((c) => c.url.includes('/labels?per_page=100'))).toBe(true);
    expect(f.stats.maxInflight).toBeLessThanOrEqual(3);
  });
  it('stops reading when the rate limit is nearly used up', async () => {
    const f = fakeFetch((u, c) => (read200(u, c) ? { ...read200(u, c)!, headers: { 'x-ratelimit-remaining': '10', 'x-ratelimit-reset': '1900000000' } } : undefined));
    const r = await readLabelStates(client(f), 'o', ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(r.paused?.message).toMatch(/^Paused to respect GitHub's rate limit — resumes at /);
    expect(Object.keys(r.state).length).toBeLessThan(6);
  });
  it('adds with POST, never updates', async () => {
    const f = fakeFetch((u, c) => (c.method === 'POST' && /^\/repos\/o\/r\/(labels|milestones)$/.test(u.pathname) ? { status: 201, json: {} } : undefined));
    expect(await addLabel(client(f), 'o', 'r', { name: 'bug', color: 'd73a4a', description: 'x' })).toEqual({ ok: true });
    expect(await addMilestone(client(f), 'o', 'r', { title: 'v1', due_on: '2026-12-31' })).toEqual({ ok: true });
    expect(f.calls.map((c) => [c.method, c.url])).toEqual([['POST', 'https://api.github.com/repos/o/r/labels'], ['POST', 'https://api.github.com/repos/o/r/milestones']]);
    expect(JSON.parse(f.calls[0].body!)).toEqual({ name: 'bug', color: 'd73a4a', description: 'x' });
    expect(JSON.parse(f.calls[1].body!)).toEqual({ title: 'v1', state: 'open', due_on: '2026-12-31T00:00:00Z' });
  });
  it('maps 403/404 to the owner message, accepted-permissions update to the settings message, 422 to GitHub’s text', async () => {
    const post = (reply: any) => fakeFetch((u, c) => (c.method === 'POST' ? reply : undefined));
    expect(await addLabel(client(post({ status: 403, json: { message: 'Must have admin rights' } })), 'o', 'r', { name: 'x' })).toMatchObject({ ok: false, kind: 'admin', message: 'You need admin access to this repository — ask an org owner' });
    expect(await addLabel(client(post({ status: 404, json: { message: 'Not Found' } })), 'o', 'r', { name: 'x' })).toMatchObject({ kind: 'admin' });
    expect(await addMilestone(client(post({ status: 403, json: { message: 'Resource not accessible by integration' } })), 'o', 'r', { title: 'x' })).toMatchObject({ kind: 'permissions', message: 'Repository Group for Github needs new permissions in o. An org owner must accept the update in Settings → GitHub Apps.' });
    expect(await addLabel(client(post({ status: 422, json: { message: 'Validation Failed: already_exists' } })), 'o', 'r', { name: 'x' })).toMatchObject({ kind: 'validation', message: 'Validation Failed: already_exists' });
  });
  it('handler messages route to GET and POST only', async () => {
    const f = fakeFetch(read200, (u, c) => (c.method === 'POST' ? { status: 201, json: {} } : undefined));
    const h = createHandler({ fetch: f.fetch, kv: memoryKV(), index: memoryIndexStore(), clientId: 'cid' });
    expect(await h({ type: 'labels:read', org: 'o', repos: ['a'] })).toMatchObject({ ok: true });
    expect(await h({ type: 'labels:add', org: 'o', repo: 'a', label: { name: 'x' } })).toEqual({ ok: true, data: { ok: true } });
    expect(await h({ type: 'milestone:add', org: 'o', repo: 'a', milestone: { title: 'x' } })).toEqual({ ok: true, data: { ok: true } });
    expect(new Set(f.calls.map((c) => c.method))).toEqual(new Set(['GET', 'POST']));
  });
});
