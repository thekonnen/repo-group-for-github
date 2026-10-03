import type { Config, Group, TeamTag } from './types';

/** Double-quoted YAML string. */
export const q = (s: string): string => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

export const teamToYaml = (t: TeamTag): string =>
  t.permission === 'push' ? q(t.slug) : `{ slug: ${q(t.slug)}, permission: ${q(t.permission)} }`;

/**
 * Canonical writer: order name, title, description, logo, teams, match, groups; 2-space indent;
 * flow-style lists; leading comment. `personal` omits index and teams (My groups).
 */
export function writeConfig(cfg: Config, header: string, opts: { personal?: boolean } = {}): string {
  const lines = [`# ${header}`, `version: ${cfg.version || 1}`];
  if (!opts.personal && cfg.index === 'action') lines.push('index: action');
  lines.push('groups:');
  if (!cfg.groups.length) lines[lines.length - 1] = 'groups: []';
  const emit = (g: Group, ind: string) => {
    lines.push(`${ind}- name: ${g.name}`);
    if (g.title) lines.push(`${ind}  title: ${q(g.title)}`);
    if (g.description) lines.push(`${ind}  description: ${q(g.description)}`);
    if (g.logo) lines.push(`${ind}  logo: ${q(g.logo)}`);
    if (!opts.personal && g.teams.length) lines.push(`${ind}  teams: [${g.teams.map(teamToYaml).join(', ')}]`);
    if (g.match.length) lines.push(`${ind}  match: [${g.match.map(q).join(', ')}]`);
    if (g.groups.length) {
      lines.push(`${ind}  groups:`);
      g.groups.forEach((c) => emit(c, ind + '    '));
    }
  };
  cfg.groups.forEach((g) => emit(g, '  '));
  return lines.join('\n') + '\n';
}
