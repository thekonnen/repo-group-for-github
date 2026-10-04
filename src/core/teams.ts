import { pickIn, postOrder, findGroup } from './placement';
import { fromGraphql, rankOf } from './permissions';
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
 * Uses the PRIMARY placement only (A3): a repo also listed in other groups through `shared` rules has one target,
 * the one of its primary group, so two groups with different team tags can never make the target ambiguous.
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

/** GraphQL `team.repositories.edges` -> repo name -> permission (READ -> pull ... ADMIN -> admin). */
export function edgesToAccess(edges: { permission: string; node: { name: string } | null }[]): Record<string, Permission> {
  const out: Record<string, Permission> = {};
  for (const e of edges) if (e?.node?.name) out[e.node.name] = fromGraphql(e.permission);
  return out;
}

export interface ChipTeam {
  slug: string;
  permission: Permission;
  /** Defined by an ancestor, not by this group itself. */
  inherited: boolean;
  from: string;
}

/** Teams to show as chips on a group: its own first, then the inherited ones (muted), in tree order. */
export function chipTeams(groups: Group[], path: string[]): ChipTeam[] {
  const eff = effectiveTeams(groups, path);
  const key = path.join('/');
  const all = Object.entries(eff).map(([slug, t]) => ({ slug, permission: t.permission, inherited: t.from !== key, from: t.from }));
  return [...all.filter((t) => !t.inherited), ...all.filter((t) => t.inherited)];
}

/** Raises (never lowers) a team's access in an access map, e.g. after a grant. Returns a new map. */
export function withGranted(access: TeamAccess, slug: string, repo: string, permission: Permission, customBase?: Record<string, string>): TeamAccess {
  const cur = access[slug]?.[repo];
  if (cur && rankOf(cur, customBase) >= rankOf(permission, customBase) && rankOf(permission, customBase) >= 0) return access;
  return { ...access, [slug]: { ...access[slug], [repo]: permission } };
}

/** Whether a repo placed at `placedKey` lives in `groupKey` or below it. */
export const inGroup = (placedKey: string, groupKey: string): boolean => placedKey === groupKey || placedKey.startsWith(groupKey + '/');

export { findGroup };
