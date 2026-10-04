import { pickIn, postOrder } from './placement';
import type { Group, LabelTag, MilestoneTag, RepoInfo } from './types';

/** GitHub's own default label color (light grey). Used for the string shorthand `"urgent"`. */
export const DEFAULT_LABEL_COLOR = 'ededed';

/** "#D73A4A" -> "d73a4a"; null when it is not six hex digits. */
export function normColor(c: string): string | null {
  const v = c.trim().replace(/^#/, '').toLowerCase();
  return /^[0-9a-f]{6}$/.test(v) ? v : null;
}

/** `YYYY-MM-DD` or an ISO 8601 timestamp; returns the timestamp the milestones API wants, or null when invalid. */
export function dueOn(v: string): string | null {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Number.isNaN(Date.parse(t)) ? null : `${t}T00:00:00Z`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(t) && !Number.isNaN(Date.parse(t))) return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return null;
}

/** Names are case-insensitive on GitHub. */
export const labelKey = (name: string): string => name.trim().toLowerCase();

export interface EffectiveLabel {
  label: Required<Pick<LabelTag, 'name' | 'color'>> & Pick<LabelTag, 'description'>;
  from: string;
}
export interface EffectiveMilestone {
  milestone: MilestoneTag;
  from: string;
}

/** Walks the groups along `path` top-down; `f` receives each group and its key. */
function along(groups: Group[], path: string[], f: (g: Group, key: string) => void): void {
  let list = groups;
  for (let i = 0; i < path.length; i++) {
    const g = list.find((c) => c.name === path[i]);
    if (!g) break;
    f(g, path.slice(0, i + 1).join('/'));
    list = g.groups;
  }
}

/** Own + inherited default labels along the path, keyed by lowercase name; the closest definition wins (like effectiveTeams). */
export function effectiveLabels(groups: Group[], path: string[]): Record<string, EffectiveLabel> {
  const map: Record<string, EffectiveLabel> = {};
  along(groups, path, (g, from) => {
    for (const l of g.labels ?? []) map[labelKey(l.name)] = { label: { name: l.name, color: l.color ?? DEFAULT_LABEL_COLOR, ...(l.description ? { description: l.description } : {}) }, from };
  });
  return map;
}

/** Own + inherited default milestones along the path, keyed by lowercase title; the closest definition wins. */
export function effectiveMilestones(groups: Group[], path: string[]): Record<string, EffectiveMilestone> {
  const map: Record<string, EffectiveMilestone> = {};
  along(groups, path, (g, from) => {
    for (const m of g.milestones ?? []) map[labelKey(m.title)] = { milestone: m, from };
  });
  return map;
}

/** What a repository has today (lowercase name -> color, lowercase titles). Read by the background worker. */
export interface RepoLabelState {
  labels: Record<string, string>;
  milestones: string[];
}
export type ExistingMap = Record<string, RepoLabelState>; // repo -> state

export type LabelRow =
  | { kind: 'label'; repo: string; name: string; label: LabelTag & { color: string }; status: 'missing' | 'differs'; existingColor?: string; from: string }
  | { kind: 'milestone'; repo: string; name: string; milestone: MilestoneTag; status: 'missing'; from: string };

export const labelRowId = (r: Pick<LabelRow, 'kind' | 'repo' | 'name'>): string => `${r.kind}\u0000${r.repo}\u0000${labelKey(r.name)}`;

/** A row can be applied only when the item is missing. A label that exists with another color is shown and skipped. */
export const isApplicable = (r: LabelRow): boolean => r.status === 'missing';

/**
 * Rows for the Sync labels drawer: one per (repository, label or milestone) of the group the repo is placed in
 * (own + inherited) that the repository does not have. Add-only: existing labels and milestones are never part of
 * the plan, except a label with a different color, which is listed as "differs" and never applied.
 * Archived and ungrouped repos are skipped; so are repos whose current state is unknown.
 */
export function labelsPlan(groups: Group[], repos: Pick<RepoInfo, 'name' | 'archived'>[], existing: ExistingMap): LabelRow[] {
  const order = postOrder(groups);
  const rows: LabelRow[] = [];
  for (const repo of repos) {
    if (repo.archived) continue;
    const has = existing[repo.name];
    if (!has) continue;
    const node = pickIn(order, repo.name);
    if (!node) continue;
    for (const [k, e] of Object.entries(effectiveLabels(groups, node.path))) {
      const cur = has.labels[k];
      if (cur === undefined) rows.push({ kind: 'label', repo: repo.name, name: e.label.name, label: e.label, status: 'missing', from: e.from });
      else if (cur.toLowerCase() !== e.label.color) rows.push({ kind: 'label', repo: repo.name, name: e.label.name, label: e.label, status: 'differs', existingColor: cur, from: e.from });
    }
    const have = new Set(has.milestones.map(labelKey));
    for (const [k, e] of Object.entries(effectiveMilestones(groups, node.path))) {
      if (!have.has(k)) rows.push({ kind: 'milestone', repo: repo.name, name: e.milestone.title, milestone: e.milestone, status: 'missing', from: e.from });
    }
  }
  return rows;
}

/** Body of `POST /repos/{org}/{repo}/labels`. */
export const labelBody = (l: LabelTag): { name: string; color: string; description?: string } => ({
  name: l.name,
  color: l.color ?? DEFAULT_LABEL_COLOR,
  ...(l.description ? { description: l.description } : {}),
});

/** Body of `POST /repos/{org}/{repo}/milestones`. */
export function milestoneBody(m: MilestoneTag): { title: string; state: 'open'; description?: string; due_on?: string } {
  const due = m.due_on ? dueOn(m.due_on) : null;
  return { title: m.title, state: 'open', ...(m.description ? { description: m.description } : {}), ...(due ? { due_on: due } : {}) };
}

/** Plain text for "Copy list": repo, kind, name, one per line. */
export const labelsListText = (org: string, rows: LabelRow[]): string => rows.filter(isApplicable).map((r) => `${org}/${r.repo}\t${r.kind}\t${r.name}`).join('\n');

export const hasDefaults = (g: Group): boolean => !!(g.labels?.length || g.milestones?.length);
