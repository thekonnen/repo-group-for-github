import { diffTrees, type DiffItem } from './diff';
import { isExact } from './glob';
import { flatList, placement } from './placement';
import { suggest } from './suggest';
import type { Config, Group, RepoInfo } from './types';

/**
 * Pure planning for the scheduled reorganization Action (design/actions/repo-groups-reorg.yml). No network, no DOM.
 * Finds (a) new ungrouped repositories and (b) exact names that point to repositories that no longer exist, proposes
 * additions only when the lexical suggestion is confident, and lists everything else for a human.
 */

export interface Addition {
  repo: string;
  group: string;
  score: number;
}
export interface Removal {
  name: string;
  group: string;
}
export interface Undecided {
  repo: string;
  description: string;
  /** Best guess when there is one, still below the confidence threshold. */
  hint: string | null;
}

export interface ReorgPlan {
  config: Config;
  additions: Addition[];
  removals: Removal[];
  undecided: Undecided[];
  /** additions + removals: the N of the commit message. */
  changes: number;
  diff: DiffItem[];
}

const clone = (groups: Group[]): Group[] => groups.map((g) => ({ ...g, match: [...g.match], teams: [...g.teams], groups: clone(g.groups) }));

const at = (groups: Group[], key: string): Group | undefined => flatList(groups).find((n) => n.key === key)?.group;

export function planReorg(config: Config, repos: RepoInfo[]): ReorgPlan {
  const active = repos.filter((r) => !r.archived);
  // Archived repos still exist: their exact names are not dead.
  const existing = new Set(repos.map((r) => r.name.toLowerCase()));
  const groups = clone(config.groups);

  const removals: Removal[] = [];
  for (const { group, key } of flatList(groups)) {
    const keep: string[] = [];
    for (const rule of group.match) {
      if (isExact(rule) && !existing.has(rule.toLowerCase())) removals.push({ name: rule, group: key });
      else keep.push(rule);
    }
    group.match = keep;
  }

  const placed = placement(config.groups, active);
  const additions: Addition[] = [];
  const undecided: Undecided[] = [];
  for (const r of [...active].sort((a, b) => a.name.localeCompare(b.name))) {
    if (placed[r.name]) continue;
    const s = suggest(config.groups, r);
    if (s.source === 'lexical' && s.key) {
      additions.push({ repo: r.name, group: s.key, score: s.score });
      at(groups, s.key)!.match.push(r.name);
    } else {
      undecided.push({ repo: r.name, description: r.description ?? '', hint: s.ranking[0]?.key ?? null });
    }
  }

  const next: Config = { ...config, groups };
  const diff = diffTrees(config.groups, groups, active).items;
  return { config: next, additions, removals, undecided, changes: additions.length + removals.length, diff };
}

export const REORG_MARKER = '<!-- repo-groups-reorg -->';
export const commitMessage = (p: ReorgPlan): string => `chore(repo-groups): propose reorganization (${p.changes} changes)`;
const code = (s: string) => '`' + s + '`';

export function prBody(p: ReorgPlan, org: string): string {
  const out = [REORG_MARKER, `Proposed by the scheduled **Repository Group for Github** Action for \`${org}/.github/repo-groups.yml\`. Review the changes, edit the branch if needed, then merge. Nothing is applied until you do.`, ''];
  out.push(`## Changes (${p.changes})`, '');
  const lines: string[] = [];
  for (const a of p.additions) lines.push(`- \`+\` ${code(a.repo)} added to ${code(a.group)} (confidence ${a.score.toFixed(2)})`);
  for (const r of p.removals) lines.push(`- \`−\` ${code(r.name)} removed from ${code(r.group)}: the repository no longer exists`);
  for (const d of p.diff) if (d.k !== '→') lines.push(`- \`${d.k}\` ${d.text}: ${d.to}`);
  for (const d of p.diff) if (d.k === '→') lines.push(`- \`→\` ${code(d.text)} ${d.to}`);
  out.push(lines.length ? lines.join('\n') : '_No automatic changes._', '');
  if (p.undecided.length) {
    out.push(`## Needs a human decision (${p.undecided.length})`, '', 'These repositories match no rule and no group was a confident fit. Add a rule or an exact name for each one you want to file.', '');
    for (const u of p.undecided) out.push(`- ${code(u.repo)}${u.description ? `: ${u.description.replace(/\s+/g, ' ').trim()}` : ''}${u.hint ? ` (closest: ${code(u.hint)})` : ''}`);
    out.push('');
  }
  out.push('---', 'Dead names are only proposed for removal here; no repository is touched. The file is rewritten in canonical format, so unknown keys and comments are dropped.');
  return out.join('\n') + '\n';
}
