import type { Config, Group, TeamTag } from './types';
import { isReadmePath } from './readme';

/** Double-quoted YAML string. */
export const q = (s: string): string => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** `readme:` lines: a path is one quoted string; inline Markdown is a `|` block scalar (a quoted string when a block cannot hold it). */
export function readmeLines(text: string, ind: string): string[] {
  const t = text.replace(/\r\n?/g, '\n');
  // eslint-disable-next-line no-control-regex
  const odd = /[\u0000-\u0008\u000b-\u001f\u007f\u0085\u2028\u2029\ufeff]/.test(t) || /^[ \t\n]/.test(t);
  if (!t.includes('\n') || isReadmePath(t) || odd) {
    // eslint-disable-next-line no-control-regex
    const esc = t.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029\ufeff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    return [`${ind}readme: "${esc}"`];
  }
  const body = t.replace(/\s+$/, '').split('\n');
  return [`${ind}readme: |`, ...body.map((l) => (l.trim() ? `${ind}  ${l.replace(/\s+$/, '')}` : ''))];
}

export const teamToYaml = (t: TeamTag): string =>
  t.permission === 'push' ? q(t.slug) : `{ slug: ${q(t.slug)}, permission: ${q(t.permission)} }`;

/**
 * Canonical writer: order name, title, description, keywords, logo, readme, teams, match, groups; 2-space indent;
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
    if (g.keywords?.length) lines.push(`${ind}  keywords: [${g.keywords.map(q).join(', ')}]`);
    if (g.logo) lines.push(`${ind}  logo: ${q(g.logo)}`);
    if (g.readme) lines.push(...readmeLines(g.readme, ind + '  '));
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
