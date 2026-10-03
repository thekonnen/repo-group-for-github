import { globRe, isExact, matches } from './glob';
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

/** Exact names win; otherwise the first pattern hit in post-order (deepest wins). */
export function pickIn(order: Node[], name: string): Node | null {
  const n = name.toLowerCase();
  return (
    order.find((x) => x.group.match.some((r) => isExact(r) && r.toLowerCase() === n)) ??
    order.find((x) => matches(x.group.match, name)) ??
    null
  );
}

/** The rule of `group` that catches `name` (exact first). */
export function ruleFor(group: Group, name: string): string | undefined {
  const n = name.toLowerCase();
  return (
    group.match.find((r) => isExact(r) && r.toLowerCase() === n) ?? group.match.find((r) => globRe(r).test(name))
  );
}

/** repo name -> group key ('' = ungrouped). */
export function placement(groups: Group[], repos: Pick<RepoInfo, 'name'>[]): Record<string, string> {
  const order = postOrder(groups);
  const out: Record<string, string> = {};
  for (const r of repos) out[r.name] = pickIn(order, r.name)?.key ?? '';
  return out;
}
