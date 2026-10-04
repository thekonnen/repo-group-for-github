import { labelOf, rankOf } from './permissions';
import { effectiveTeams } from './teams';
import type { Group, Permission } from './types';

/** A person in a team, from GraphQL `team.members.nodes`. */
export interface TeamMember {
  login: string;
  name?: string | null;
  avatarUrl?: string;
}

/** Members per team slug. A slug that is missing was not loaded (or could not be read). */
export type MembersByTeam = Record<string, TeamMember[]>;

/** One team that gives a person access to a group. */
export interface Via {
  team: string;
  permission: Permission;
  /** Group key that tagged the team. */
  from: string;
  /** Tagged by an ancestor, not by the group itself. */
  inherited: boolean;
}

export interface Person extends TeamMember {
  /** Highest permission over all teams. */
  best: Permission;
  /** Every team that reaches this person, highest permission first. */
  via: Via[];
}

export interface TeamGroup extends Via {
  people: TeamMember[];
}

/** Effective teams of a group (own + inherited, closest wins per slug) as a list, own first. */
export function viaTeams(groups: Group[], path: string[]): Via[] {
  const key = path.join('/');
  const all = Object.entries(effectiveTeams(groups, path)).map(([team, t]) => ({ team, permission: t.permission, from: t.from, inherited: t.from !== key }));
  return [...all.filter((t) => !t.inherited), ...all.filter((t) => t.inherited)];
}

const byRankDesc = (customBase?: Record<string, string>) => (a: Via, b: Via) =>
  rankOf(b.permission, customBase) - rankOf(a.permission, customBase) || a.team.localeCompare(b.team);

const byLogin = (a: { login: string }, b: { login: string }) => a.login.localeCompare(b.login, undefined, { sensitivity: 'base' });

/** People x teams x permission for a group. Teams that are not loaded contribute nobody. Sorted by login. */
export function aggregateMembers(groups: Group[], path: string[], members: MembersByTeam, customBase?: Record<string, string>): Person[] {
  const people = new Map<string, Person>();
  for (const v of viaTeams(groups, path)) {
    for (const m of members[v.team] ?? []) {
      const key = m.login.toLowerCase();
      const p = people.get(key);
      if (!p) people.set(key, { ...m, best: v.permission, via: [v] });
      else {
        p.via.push(v);
        p.name ??= m.name;
        p.avatarUrl ??= m.avatarUrl;
      }
    }
  }
  const order = byRankDesc(customBase);
  const out = [...people.values()];
  for (const p of out) {
    p.via.sort(order);
    p.best = p.via[0].permission;
  }
  return out.sort(byLogin);
}

/** The same data grouped by team: highest permission first, then slug. People sorted by login. */
export function membersByTeam(groups: Group[], path: string[], members: MembersByTeam, customBase?: Record<string, string>): TeamGroup[] {
  return viaTeams(groups, path)
    .sort(byRankDesc(customBase))
    .map((v) => ({ ...v, people: [...(members[v.team] ?? [])].sort(byLogin) }));
}

const matches = (q: string, ...fields: (string | null | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(q));

/** Search over login, display name and team slugs. */
export function filterPeople(people: Person[], query: string): Person[] {
  const q = query.trim().toLowerCase();
  return q ? people.filter((p) => matches(q, p.login, p.name, ...p.via.map((v) => v.team))) : people;
}

/** Search over team slugs (keeps the whole team) and people (login, name). */
export function filterTeamGroups(teams: TeamGroup[], query: string): TeamGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return teams;
  return teams
    .map((t) => (matches(q, t.team) ? t : { ...t, people: t.people.filter((p) => matches(q, p.login, p.name)) }))
    .filter((t) => t.people.length || matches(q, t.team));
}

/** "via core_team · Write · inherited from infra" (own teams: "via core_team · Write"). */
export function viaText(v: Via): string {
  return `via ${v.team} · ${labelOf(v.permission)}${v.inherited ? ` · inherited from ${v.from}` : ''}`;
}
