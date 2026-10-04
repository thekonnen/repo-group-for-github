import { exactRuleHit, matchesRepo, ruleHits, type RepoProps, type RuleTarget } from './glob';
import type { Group, RepoInfo } from './types';

/** A group plus its path, e.g. ['infra', 'dagsrv']. */
export interface Node {
  group: Group;
  path: string[];
  key: string;
}

export const keyOf = (path: string[]): string => path.join('/');

export function findGroup(groups: Group[], path: string[]): Group | null {
  let list = groups;
  let g: Group | null = null;
  for (const id of path) {
    g = list.find((c) => c.name === id) ?? null;
    if (!g) return null;
    list = g.groups;
  }
  return g;
}

/** Children before parents, in file order (§5.3 step 1). */
export function postOrder(groups: Group[], parent: string[] = [], out: Node[] = []): Node[] {
  for (const g of groups) {
    const path = [...parent, g.name];
    postOrder(g.groups, path, out);
    out.push({ group: g, path, key: keyOf(path) });
  }
  return out;
}

/** Pre-order list with depth, for pickers and sidebar trees. */
export function flatList(groups: Group[], depth = 0, parent: string[] = [], out: (Node & { depth: number })[] = []) {
  for (const g of groups) {
    const path = [...parent, g.name];
    out.push({ group: g, path, key: keyOf(path), depth });
    flatList(g.groups, depth + 1, path, out);
  }
  return out;
}

/** A repo name (with optional topics / props) or the repo itself: `{ ...repo }` carries fork, parent, topics and props. */
const target = (t: string | RuleTarget, topics?: readonly string[], props?: RepoProps): RuleTarget =>
  typeof t === 'string' ? { name: t, topics, props } : { ...t, topics: t.topics ?? topics, props: t.props ?? props };

/** Exact names win (and exact `topic:`, `prop:`, `fork-of:` rules); otherwise the first pattern hit in post-order (deepest wins). */
export function pickIn(order: Node[], repo: string | RuleTarget, topics?: readonly string[], props?: RepoProps): Node | null {
  const t = target(repo, topics, props);
  return order.find((x) => x.group.match.some((r) => exactRuleHit(r, t))) ?? order.find((x) => matchesRepo(x.group.match, t)) ?? null;
}

/** The rule of `group` that catches the repo (exact first). */
export function ruleFor(group: Group, repo: string | RuleTarget, topics?: readonly string[], props?: RepoProps): string | undefined {
  const t = target(repo, topics, props);
  return group.match.find((r) => exactRuleHit(r, t)) ?? group.match.find((r) => ruleHits(r, t));
}

/** repo name -> group key ('' = ungrouped). */
export function placement(groups: Group[], repos: Pick<RepoInfo, 'name' | 'fork' | 'parent' | 'topics' | 'props'>[]): Record<string, string> {
  const order = postOrder(groups);
  const out: Record<string, string> = {};
  for (const r of repos) out[r.name] = pickIn(order, r)?.key ?? '';
  return out;
}
