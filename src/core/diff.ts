import { flatList, placement } from './placement';
import { labelOf } from './permissions';
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
const teamsStr = (g: Group) => g.teams.map((t) => `${t.slug}:${t.permission}`).join(', ');

export function diffTrees(a: Group[], b: Group[], repos: Pick<RepoInfo, 'name'>[]): DiffResult {
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
    if (na.match.join('|') !== nb.match.join('|'))
      items.push({ k: '~', cls: 'chg', text: `Rules of ${k}`, to: nb.match.join(', ') || '(none)' });
    if (teamsStr(na) !== teamsStr(nb))
      items.push({
        k: '~',
        cls: 'chg',
        text: `Teams of ${k}`,
        to: nb.teams.map((t) => `${t.slug} · ${labelOf(t.permission)}`).join(', ') || '(none)',
      });
  }
  for (const r of repos) {
    if (pa[r.name] !== pb[r.name])
      items.push({ k: '→', cls: 'mov', text: r.name, to: `${pa[r.name] || 'ungrouped'} → ${pb[r.name] || 'ungrouped'}` });
  }
  const ungrouped = repos.filter((r) => !pb[r.name]).length;
  return { items, groups: gb.size, ungrouped };
}
