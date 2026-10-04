import type { RuleTarget } from './glob';
import { flatList, placement, sharedPlacement } from './placement';
import { labelOf } from './permissions';
import { SORT_LABEL } from './sort';
import { isReadmePath } from './readme';
import type { Group, RepoInfo } from './types';

export interface DiffItem {
  k: '+' | '−' | '~' | '→';
  cls: 'add' | 'del' | 'chg' | 'mov';
  text: string;
  to: string;
}

export interface DiffResult {
  items: DiffItem[];
  groups: number;
  ungrouped: number;
}

const byKey = (groups: Group[]) => new Map(flatList(groups).map((n) => [n.key, n.group]));
const labelsStr = (g: Group) => (g.labels ?? []).map((l) => `${l.name}:${l.color ?? ''}:${l.description ?? ''}`).join('|');
const milestonesStr = (g: Group) => (g.milestones ?? []).map((m) => `${m.title}:${m.due_on ?? ''}:${m.description ?? ''}`).join('|');
const teamsStr = (g: Group) => g.teams.map((t) => `${t.slug}:${t.permission}`).join(', ');

export function diffTrees(a: Group[], b: Group[], repos: RuleTarget[]): DiffResult {
  const ga = byKey(a);
  const gb = byKey(b);
  const pa = placement(a, repos);
  const pb = placement(b, repos);
  const items: DiffItem[] = [];
  for (const k of gb.keys()) if (!ga.has(k)) items.push({ k: '+', cls: 'add', text: 'New group', to: k });
  for (const k of ga.keys()) if (!gb.has(k)) items.push({ k: '−', cls: 'del', text: 'Removed group', to: k });
  for (const [k, nb] of gb) {
    const na = ga.get(k);
    if (!na) continue;
    if ((na.title || '') !== (nb.title || ''))
      items.push({ k: '~', cls: 'chg', text: `Name of ${k}`, to: `“${nb.title || nb.name}”` });
    if (na.description !== nb.description)
      items.push({ k: '~', cls: 'chg', text: `Description of ${k}`, to: `“${nb.description || '(empty)'}”` });
    if ((na.logo || '') !== (nb.logo || ''))
      items.push({ k: '~', cls: 'chg', text: `Logo of ${k}`, to: nb.logo || 'letter' });
    if ((na.readme || '') !== (nb.readme || ''))
      items.push({ k: '~', cls: 'chg', text: `README of ${k}`, to: !nb.readme ? 'removed' : isReadmePath(nb.readme) ? nb.readme.trim() : 'text changed' });
    if (na.match.join('|') !== nb.match.join('|'))
      items.push({ k: '~', cls: 'chg', text: `Rules of ${k}`, to: nb.match.join(', ') || '(none)' });
    if ((na.pinned ?? []).join('|') !== (nb.pinned ?? []).join('|'))
      items.push({ k: '~', cls: 'chg', text: `Pinned of ${k}`, to: (nb.pinned ?? []).join(', ') || '(none)' });
    if ((na.sort ?? '') !== (nb.sort ?? ''))
      items.push({ k: '~', cls: 'chg', text: `Sort of ${k}`, to: nb.sort ? SORT_LABEL[nb.sort] : 'default (Last pushed)' });
    if ((na.shared ?? []).join('|') !== (nb.shared ?? []).join('|'))
      items.push({ k: '~', cls: 'chg', text: `Shared rules of ${k}`, to: (nb.shared ?? []).join(', ') || '(none)' });
    if (teamsStr(na) !== teamsStr(nb))
      items.push({
        k: '~',
        cls: 'chg',
        text: `Teams of ${k}`,
        to: nb.teams.map((t) => `${t.slug} · ${labelOf(t.permission)}`).join(', ') || '(none)',
      });
    if (labelsStr(na) !== labelsStr(nb))
      items.push({ k: '~', cls: 'chg', text: `Default labels of ${k}`, to: (nb.labels ?? []).map((l) => l.name).join(', ') || '(none)' });
    if (milestonesStr(na) !== milestonesStr(nb))
      items.push({ k: '~', cls: 'chg', text: `Default milestones of ${k}`, to: (nb.milestones ?? []).map((m) => m.title).join(', ') || '(none)' });
  }
  for (const r of repos) {
    if (pa[r.name] !== pb[r.name])
      items.push({ k: '→', cls: 'mov', text: r.name, to: `${pa[r.name] || 'ungrouped'} → ${pb[r.name] || 'ungrouped'}` });
  }
  // A3: repositories whose extra memberships changed (only computed when either file uses `shared`).
  if ([...ga.values(), ...gb.values()].some((g) => g.shared?.length)) {
    const sa = sharedPlacement(a, repos).secondary;
    const sb = sharedPlacement(b, repos).secondary;
    for (const r of repos) {
      const x = (sa.get(r.name) ?? []).join(', ');
      const y = (sb.get(r.name) ?? []).join(', ');
      if (x !== y) items.push({ k: '~', cls: 'chg', text: `${r.name} also in`, to: y || '(none)' });
    }
  }
  const ungrouped = repos.filter((r) => !pb[r.name]).length;
  return { items, groups: gb.size, ungrouped };
}
