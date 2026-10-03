import { buildTree, type GroupNode, type TreeModel } from './tree';
import type { TeamAccess } from './teams';
import type { Group, Permission, RepoInfo } from './types';

/** Repositories (not archived) that `slug` can access, newest push first like everywhere else. */
export function teamRepos(repos: RepoInfo[], access: TeamAccess, slug: string): RepoInfo[] {
  const mine = access[slug] ?? {};
  return repos.filter((r) => !r.archived && r.name in mine);
}

/** Removes groups that hold no repositories. Mutates a model that was just built, never a shared one. */
export function pruneEmptyGroups(model: TreeModel): TreeModel {
  const walk = (n: GroupNode) => {
    n.children = n.children.filter((c) => c.total > 0);
    n.subgroups = 0;
    for (const c of n.children) {
      walk(c);
      n.subgroups += 1 + c.subgroups;
    }
  };
  walk(model.root);
  model.byKey.clear();
  const reg = (n: GroupNode) => (model.byKey.set(n.key, n), n.children.forEach(reg));
  reg(model.root);
  return model;
}

/** The team repositories page: the org's group tree over only the repositories the team can access. */
export function buildTeamTree(groups: Group[], repos: RepoInfo[], access: TeamAccess, slug: string): TreeModel {
  return pruneEmptyGroups(buildTree(groups, teamRepos(repos, access, slug)));
}

export const permissionOn = (access: TeamAccess, slug: string, repo: string): Permission | undefined => access[slug]?.[repo];
