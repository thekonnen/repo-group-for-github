// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { computeStats, groupStats, nodeRepos } from '../src/core/group-stats';
import { buildTree, nodeAt } from '../src/core/tree';
import { GroupSummary } from '../src/features/grouped-view/GroupSummary';
import type { Group, RepoInfo } from '../src/core/types';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const DAY = 86400000;
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const g = (name: string, match: string[], groups: Group[] = []): Group => ({ name, description: '', logo: null, teams: [], match, groups });

describe('computeStats', () => {
  it('handles an empty group', () => {
    const s = computeStats([], { now: NOW });
    expect(s).toMatchObject({ repos: 0, stars: 0, forks: 0, languages: [], noLanguage: 0, pushed30d: 0, lastPush: null });
    expect(s.weekly).toEqual(new Array(12).fill(0));
  });

  it('sums stars and forks and skips archived repos by default', () => {
    const repos: RepoInfo[] = [
      { name: 'a', stars: 3, forks: 1 },
      { name: 'b', stars: 4 },
      { name: 'old', stars: 100, forks: 50, archived: true },
    ];
    expect(computeStats(repos, { now: NOW })).toMatchObject({ repos: 2, stars: 7, forks: 1 });
    expect(computeStats(repos, { now: NOW, includeArchived: true })).toMatchObject({ repos: 3, stars: 107, forks: 51 });
  });

  it('breaks language ties by name, keeps top 5 and merges the rest into Other', () => {
    const langs = ['Go', 'Rust', 'C', 'Ruby', 'Lua', 'Nix', 'Dart'];
    const s = computeStats(langs.map((language, i) => ({ name: `r${i}`, language })), { now: NOW });
    expect(s.languages.map((l) => l.name)).toEqual(['C', 'Dart', 'Go', 'Lua', 'Nix', 'Other']);
    const other = s.languages.at(-1)!;
    expect(other).toMatchObject({ other: true, repos: 2 });
    expect(other.percent).toBeCloseTo(28.6, 1);
    expect(s.languages.reduce((n, l) => n + l.repos, 0)).toBe(7);
  });

  it('orders by count first and uses the index language color', () => {
    const s = computeStats(
      [
        { name: 'a', language: 'Zig', languageColor: '#ec915c' },
        { name: 'b', language: 'Zig' },
        { name: 'c', language: 'Ada' },
      ],
      { now: NOW },
    );
    expect(s.languages[0]).toMatchObject({ name: 'Zig', repos: 2, color: '#ec915c', percent: 66.7 });
    expect(s.languages[1].name).toBe('Ada');
  });

  it('counts null languages apart and bases percentages on repos that have one', () => {
    const s = computeStats([{ name: 'a', language: null }, { name: 'b' }, { name: 'c', language: 'Go' }], { now: NOW });
    expect(s.noLanguage).toBe(2);
    expect(s.languages).toHaveLength(1);
    expect(s.languages[0].percent).toBe(100);
    expect(computeStats([{ name: 'a', language: null }], { now: NOW }).languages).toEqual([]);
  });

  it('builds the 12-week pushed-per-week series, newest week last, and the 30-day count', () => {
    const s = computeStats(
      [
        { name: 'a', pushedAt: ago(0) },
        { name: 'b', pushedAt: ago(6) },
        { name: 'c', pushedAt: ago(8) },
        { name: 'd', pushedAt: ago(29) },
        { name: 'e', pushedAt: ago(31) },
        { name: 'f', pushedAt: ago(83) },
        { name: 'g', pushedAt: ago(84) },
        { name: 'h', pushedAt: null },
        { name: 'i', pushedAt: 'garbage' },
      ],
      { now: NOW },
    );
    expect(s.weekly[11]).toBe(2);
    expect(s.weekly[10]).toBe(1);
    expect(s.weekly[7]).toBe(2);
    expect(s.weekly[0]).toBe(1);
    expect(s.weekly.reduce((a, b) => a + b, 0)).toBe(6);
    expect(s.pushed30d).toBe(4);
    expect(s.lastPush).toBe(ago(0));
  });

  it('is fast on 5,000 repos', () => {
    const repos: RepoInfo[] = Array.from({ length: 5000 }, (_, i) => ({ name: `r${i}`, language: `L${i % 40}`, stars: i % 7, forks: i % 3, pushedAt: ago(i % 120) }));
    const t0 = performance.now();
    const s = computeStats(repos, { now: NOW });
    expect(performance.now() - t0).toBeLessThan(250);
    expect(s.repos).toBe(5000);
    expect(s.languages).toHaveLength(6);
  });
});

describe('groupStats (recursive and memoized)', () => {
  const repos: RepoInfo[] = [
    { name: 'dagsrv', language: 'Go', stars: 5, pushedAt: ago(1) },
    { name: 'dags-a', language: 'Go', stars: 1, pushedAt: ago(40) },
    { name: 'infra-x', language: 'Python', forks: 2, pushedAt: ago(2) },
    { name: 'old-dags', language: 'Go', stars: 99, archived: true, pushedAt: ago(1) },
    { name: 'loose', language: 'Rust', stars: 8, pushedAt: ago(3) },
  ];
  const model = buildTree([g('infra', ['infra-*'], [g('dagsrv', ['dag*', 'old-dags'])]), g('ai', [])], repos);

  it('includes subgroups and excludes archived repos', () => {
    const infra = nodeAt(model, ['infra'])!;
    expect(nodeRepos(infra).map((r) => r.name).sort()).toEqual(['dags-a', 'dagsrv', 'infra-x']);
    expect(groupStats(infra, NOW)).toMatchObject({ repos: 3, stars: 6, forks: 2 });
    expect(groupStats(nodeAt(model, ['infra', 'dagsrv'])!, NOW).repos).toBe(2);
    expect(groupStats(nodeAt(model, ['ai'])!, NOW).repos).toBe(0);
    expect(groupStats(model.root, NOW).repos).toBe(4);
  });

  it('returns the same object for the same node within the hour and recomputes later', () => {
    const infra = nodeAt(model, ['infra'])!;
    expect(groupStats(infra, NOW)).toBe(groupStats(infra, NOW + 60000));
    expect(groupStats(infra, NOW + 2 * 3600000)).not.toBe(groupStats(infra, NOW));
  });
});

describe('GroupSummary', () => {
  const repos: RepoInfo[] = [
    { name: 'a', language: 'Go', languageColor: '#00add8', stars: 3, forks: 1, pushedAt: new Date().toISOString() },
    { name: 'b', language: 'Rust', stars: 2, pushedAt: new Date().toISOString() },
    { name: 'c' },
  ];
  it('renders numbers, a labelled language bar, the honest sparkline label and a text alternative', () => {
    const el = document.createElement('div');
    render(h(GroupSummary, { node: buildTree([], repos).root }), el);
    const alt = el.querySelector('.rg-sr-only')!.textContent!;
    expect(alt).toContain('3 repositories, 5 stars, 1 forks');
    expect(alt).toContain('Go 50%, Rust 50%');
    expect(el.querySelectorAll('.rg-lang-bar span')).toHaveLength(2);
    expect((el.querySelector('.rg-lang-bar span') as HTMLElement).getAttribute('style')).toContain('#00add8');
    expect(el.querySelector('.rg-spark-label')!.textContent).toBe('Repos last pushed per week');
    expect(el.querySelector('.rg-spark title')!.textContent).toContain('Not commit activity');
    expect(el.querySelectorAll('.rg-spark rect[fill="transparent"]')).toHaveLength(12);
    expect(el.querySelector('.rg-spark mask polyline')!.getAttribute('points')!.split(' ')).toHaveLength(12);
    expect(el.querySelector('.rg-lang-note')!.textContent).toContain('1 without a language');
  });
  it('renders nothing for an empty group', () => {
    const el = document.createElement('div');
    render(h(GroupSummary, { node: buildTree([], []).root }), el);
    expect(el.querySelector('.rg-summary')).toBeNull();
  });
});
