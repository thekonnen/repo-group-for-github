import { displayName } from './edit';
import { findGroup, keyOf, pickIn, postOrder, ruleFor } from './placement';
import type { Group } from './types';

/** What the Group field on "Create a new repository" tells the person (F9). Pure, so it is tested without a page. */
export type DestKind = 'empty' | 'auto-hit' | 'auto-miss' | 'same' | 'diff';

export interface Destination {
  kind: DestKind;
  name: string;
  /** Group the repo ends up in ('' = Ungrouped). */
  destKey: string;
  /** Group the match rules would choose ('' = none). */
  autoKey: string;
  /** Explicitly picked group ('' = Automatic). */
  pickedKey: string;
  /** The rule that catches the name (auto-hit and same). */
  rule?: string;
  /** True when the pick differs from the automatic placement, so repo-groups.yml has to change. */
  needsCommit: boolean;
}

/** "infra/dagu" -> "infra / dagu", or with display names ("Infraestrutura / Jobs") when the groups are given. */
export function pathLabel(key: string, groups?: Group[]): string {
  const parts = key.split('/').filter(Boolean);
  return parts
    .map((slug, i) => {
      const g = groups ? findGroup(groups, parts.slice(0, i + 1)) : null;
      return g ? displayName(g) : slug;
    })
    .join(' / ');
}

export function describeDestination(groups: Group[], name: string, pickedKey: string): Destination {
  const auto = name ? pickIn(postOrder(groups), name) : null;
  const picked = pickedKey ? findGroup(groups, pickedKey.split('/')) : null;
  const pickedOk = picked ? pickedKey : '';
  const autoKey = auto?.key ?? '';
  const base = { name, autoKey, pickedKey: pickedOk };
  if (!name) return { ...base, kind: 'empty', destKey: pickedOk || autoKey, needsCommit: false };
  if (picked && auto && auto.key === pickedKey) return { ...base, kind: 'same', destKey: pickedKey, rule: ruleFor(picked, name), needsCommit: false };
  if (picked) return { ...base, kind: 'diff', destKey: pickedKey, needsCommit: true };
  if (auto) return { ...base, kind: 'auto-hit', destKey: auto.key, rule: ruleFor(auto.group, name), needsCommit: false };
  return { ...base, kind: 'auto-miss', destKey: '', needsCommit: false };
}

/** Plain-text version of the one sentence under the destination path (the UI renders the same text with code and bold). */
export function destinationSentence(d: Destination, groups?: Group[]): string {
  switch (d.kind) {
    case 'empty':
      return 'Type a name to see which group it lands in.';
    case 'auto-hit':
      return `Lands here because it matches the rule ${d.rule}. Pick another group to override.`;
    case 'auto-miss':
      return 'No rule matches this name yet, so it will show under Ungrouped. Pick a group to file it now.';
    case 'same':
      return `Already matches the rule ${d.rule} of this group. repo-groups.yml stays the same.`;
    case 'diff':
      return `Adds ${d.name} to the match list of ${pathLabel(d.pickedKey, groups)} in repo-groups.yml (otherwise it would land in ${d.autoKey ? pathLabel(d.autoKey, groups) : 'Ungrouped'}).`;
  }
}

/** Options of the picker: every group and subgroup, in file order, with depth and recursive count. */
export function pickerOptions(groups: Group[], placed: ReadonlyMap<string, string>): { key: string; name: string; label: string; depth: number; count: number }[] {
  const out: { key: string; name: string; label: string; depth: number; count: number }[] = [];
  const walk = (list: Group[], parent: string[]) => {
    for (const g of list) {
      const path = [...parent, g.name];
      const key = keyOf(path);
      let count = 0;
      for (const k of placed.values()) if (k === key || k.startsWith(key + '/')) count++;
      out.push({ key, name: g.name, label: displayName(g), depth: path.length - 1, count });
      walk(g.groups, path);
    }
  };
  walk(groups, []);
  return out;
}

/** Entry kept in storage.session between the form submit and the repo page (F9). */
export interface PendingRepo {
  org: string;
  repo: string;
  groupPath: string; // '' = Automatic
  explicit: boolean;
  teams: { slug: string; permission: string }[]; // filled by the Teams field (F12)
  createdAt: number;
}

export const PENDING_TTL_MS = 10 * 60 * 1000;

/** Text of the toast shown on the repo page after filing. */
export function filedMessage(p: { groupKey: string; committed: boolean; groupLabel?: string }): string {
  // SEAM (F12): the Teams agent appends " · <team> can write" parts here.
  const where = p.groupKey ? `Filed in ${p.groupLabel ?? pathLabel(p.groupKey)}` : 'Created, not in any group yet';
  return where + (p.committed ? ' · repo-groups.yml updated' : '');
}
