import { FORK_PREFIX, isForkRule, forkTarget } from './glob';
import { slugName } from './edit';
import { placement, postOrder } from './placement';
import type { Group, RepoInfo } from './types';

export interface ForkProposal {
  /** Parent owner as GitHub spells it, e.g. "macfuse". */
  owner: string;
  group: Group;
  /** Names of the ungrouped forks the rule will catch. */
  repos: string[];
}

export const MIN_FORKS = 2;

export const parentOwner = (parent: string | null | undefined): string => (parent ? parent.split('/')[0] : '');

/** Owners already covered by a `fork-of:` rule somewhere in the tree (lowercase). */
function coveredOwners(groups: Group[]): Set<string> {
  const out = new Set<string>();
  for (const n of postOrder(groups)) for (const r of n.group.match) if (isForkRule(r)) out.add(forkTarget(r).split('/')[0].toLowerCase());
  return out;
}

/**
 * Proposes one top-level group per parent owner that has at least MIN_FORKS ungrouped forks (A5).
 * Group name = owner slug, rule `fork-of:<owner>`. Pure: nothing is committed; the caller shows it for review.
 * Owners that already have a `fork-of:` rule are skipped. A name that clashes with a sibling gets "-forks".
 */
export function proposeForkGroups(groups: Group[], repos: Pick<RepoInfo, 'name' | 'fork' | 'parent' | 'archived'>[]): ForkProposal[] {
  const live = repos.filter((r) => !r.archived);
  const placed = placement(groups, live);
  const covered = coveredOwners(groups);
  const byOwner = new Map<string, { owner: string; repos: string[] }>();
  for (const r of live) {
    if (!r.fork || !r.parent || placed[r.name]) continue;
    const owner = parentOwner(r.parent);
    const k = owner.toLowerCase();
    if (!owner || covered.has(k)) continue;
    const e = byOwner.get(k) ?? { owner, repos: [] };
    e.repos.push(r.name);
    byOwner.set(k, e);
  }
  const taken = new Set(groups.map((g) => g.name));
  const out: ForkProposal[] = [];
  const ranked = [...byOwner.values()].filter((x) => x.repos.length >= MIN_FORKS).sort((a, b) => b.repos.length - a.repos.length || a.owner.localeCompare(b.owner));
  for (const e of ranked) {
    let name = slugName(e.owner).replace(/^-+|-+$/g, '') || 'forks';
    if (taken.has(name)) name += '-forks';
    if (taken.has(name)) continue;
    taken.add(name);
    out.push({
      owner: e.owner,
      repos: e.repos.sort(),
      group: { name, description: `Forks of ${e.owner} projects`, logo: null, teams: [], match: [`${FORK_PREFIX}${e.owner}`], groups: [] },
    });
  }
  return out;
}

/** The current groups plus the proposed ones, appended at the top level (for the YAML editor draft). */
export const withForkGroups = (groups: Group[], proposals: ForkProposal[]): Group[] => [...groups, ...proposals.map((p) => p.group)];
