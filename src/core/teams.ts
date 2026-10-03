import { pickIn, postOrder, findGroup } from './placement';
import { rankOf } from './permissions';
import type { Group, Permission, RepoInfo } from './types';

export interface EffectiveTeam {
  permission: Permission;
  from: string; // group key that defined it
}

/** Own + inherited teams along the path; the closest definition of a slug wins (§5.5). */
export function effectiveTeams(groups: Group[], path: string[]): Record<string, EffectiveTeam> {
  const map: Record<string, EffectiveTeam> = {};
  let list = groups;
  for (let i = 0; i < path.length; i++) {
    const g = list.find((c) => c.name === path[i]);
    if (!g) break;
    for (const t of g.teams) map[t.slug] = { permission: t.permission, from: path.slice(0, i + 1).join('/') };
    list = g.groups;
  }
  return map;
}

/** Every team slug mentioned anywhere in the tree. */
export function teamSlugs(groups: Group[]): string[] {
  const set = new Set<string>();
  const walk = (list: Group[]) => list.forEach((g) => (g.teams.forEach((t) => set.add(t.slug)), walk(g.groups)));
  walk(groups);
  return [...set].sort();
}

export interface SyncRow {
  repo: string;
  team: string;
  current: Permission; // 'none' when no access
  target: Permission;
  from: string;
}

export type TeamAccess = Record<string, Record<string, Permission>>; // slug -> repo -> permission

/**
 * Rows for the Sync access drawer: repos whose team access is lower than the target of their group.
 * Never yields removals or downgrades. Archived and ungrouped repos are skipped.
 */
export function syncPlan(
  groups: Group[],
  repos: Pick<RepoInfo, 'name' | 'archived'>[],
  access: TeamAccess,
  teamSlug?: string,
  customBase?: Record<string, string>,
): SyncRow[] {
  const order = postOrder(groups);
  const rows: SyncRow[] = [];
  for (const repo of repos) {
    if (repo.archived) continue;
    const node = pickIn(order, repo.name);
    if (!node) continue;
    const eff = effectiveTeams(groups, node.path);
    for (const [slug, target] of Object.entries(eff)) {
      if (teamSlug && slug !== teamSlug) continue;
      const current = access[slug]?.[repo.name] ?? 'none';
      const tr = rankOf(target.permission, customBase);
      const cr = rankOf(current, customBase);
      // Unknown custom-role rank: only propose when the team has no access at all.
      if (tr < 0 ? current === 'none' : cr < tr) rows.push({ repo: repo.name, team: slug, current, target: target.permission, from: target.from });
    }
  }
  return rows;
}

/** Repos a team can access that sit in groups not tagged for it (informational banner). */
export function untaggedAccess(
  groups: Group[],
  repos: Pick<RepoInfo, 'name'>[],
  access: TeamAccess,
  teamSlug: string,
): string[] {
  const order = postOrder(groups);
  const names = new Set(repos.map((r) => r.name));
  return Object.keys(access[teamSlug] ?? {}).filter((name) => {
    if (!names.has(name)) return false;
    const node = pickIn(order, name);
    return !node || !(teamSlug in effectiveTeams(groups, node.path));
  });
}

export { findGroup };
