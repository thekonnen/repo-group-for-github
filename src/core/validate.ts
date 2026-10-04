import { splitRules } from './edit';
import { forkTarget, isForkRule, isPropRule, isTopicRule, parsePropRule, topicOf } from './glob';
import { PERMISSIONS } from './permissions';
import type { Config, Group, TeamTag } from './types';

export interface ValidationResult {
  config?: Config;
  error?: string;
  line?: number | null;
  warnings: string[];
}

export interface ValidateOptions {
  org?: string;
  /** Team slugs that exist in the org; when given, unknown slugs produce warnings. */
  knownTeams?: string[];
  /** Custom repository role names; when undefined, any non-empty name is accepted with a warning. */
  customRoles?: string[];
}

const NAME_RE = /^[a-z0-9._-]+$/;
const FORK_TARGET_RE = /^[A-Za-z0-9._*-]+(\/[A-Za-z0-9._*-]+)?$/;

/** Turns parsed YAML (any shape) into a Config, or returns the first problem found. */
export function configFromObject(obj: unknown, opts: ValidateOptions = {}): ValidationResult {
  const warnings: string[] = [];
  const o = obj as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.groups)) {
    return { error: 'The file needs a top-level "groups:" list.', warnings };
  }
  const org = opts.org ?? 'the organization';
  let err: string | null = null;

  const parseTeams = (name: string, raw: unknown): TeamTag[] | null => {
    if (raw == null) return [];
    const bad = () => {
      err = `"${name}": teams must be a list of team slugs or { slug, permission }.`;
      return null;
    };
    if (!Array.isArray(raw)) return bad();
    const out: TeamTag[] = [];
    for (const t of raw) {
      let slug: unknown;
      let permission: unknown = 'push';
      if (typeof t === 'string') slug = t;
      else if (t && typeof t === 'object') {
        slug = (t as any).slug;
        if ((t as any).permission != null) permission = (t as any).permission;
      } else return bad();
      if (typeof slug !== 'string' || !slug.trim()) return bad();
      if (typeof permission !== 'string' || !permission.trim()) return bad();
      slug = slug.trim();
      permission = permission.trim();
      const p = permission as string;
      if (!(PERMISSIONS as readonly string[]).includes(p)) {
        if (opts.customRoles) {
          if (!opts.customRoles.includes(p)) {
            err = `"${name}": permission "${p}" must be one of pull, triage, push, maintain, admin, or a custom repository role of ${org}.`;
            return null;
          }
        } else warnings.push(`"${name}": permission "${p}" is not a built-in role; it will be checked when the file is applied.`);
      }
      if (opts.knownTeams && !opts.knownTeams.includes(slug as string)) {
        warnings.push(`"${name}": team "${slug}" was not found in ${org}.`);
      }
      out.push({ slug: slug as string, permission: p });
    }
    return out;
  };

  const build = (list: unknown[], where: string): Group[] => {
    const seen = new Set<string>();
    const out: Group[] = [];
    list.forEach((it, i) => {
      if (err) return;
      const at = `${where} → item ${i + 1}`;
      if (!it || typeof it !== 'object') {
        err = `${at} must be a group with a name.`;
        return;
      }
      const raw = it as Record<string, unknown>;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!NAME_RE.test(name)) {
        err = `${at}: name "${raw.name == null ? '' : raw.name}" must use lowercase letters, numbers, - _ or .`;
        return;
      }
      if (seen.has(name)) {
        err = `Two groups are named "${name}" in ${where}.`;
        return;
      }
      seen.add(name);
      let match: unknown = raw.match == null ? [] : raw.match;
      if (typeof match === 'string') match = [match];
      if (!Array.isArray(match) || match.some((m) => typeof m !== 'string')) {
        err = `"${name}": match must be a list of names or patterns.`;
        return;
      }
      const badFork = (match as string[]).flatMap(splitRules).find((r) => isForkRule(r) && !FORK_TARGET_RE.test(forkTarget(r)));
      if (badFork) {
        err = `"${name}": rule "${badFork}" needs an owner, like fork-of:macfuse or fork-of:macfuse/macfuse.`;
        return;
      }
      const badProp = (match as string[]).flatMap(splitRules).find((r) => isPropRule(r) && !parsePropRule(r));
      if (badProp) {
        err = `"${name}": rule "${badProp}" needs a property and a value, like prop:client=Acme.`;
        return;
      }
      const emptyTopic = (match as string[]).flatMap(splitRules).find((r) => isTopicRule(r) && !topicOf(r));
      if (emptyTopic) {
        err = `"${name}": the rule "${emptyTopic}" needs a topic name, like topic:kubernetes.`;
        return;
      }
      let keywords: unknown = raw.keywords == null ? [] : raw.keywords;
      if (typeof keywords === 'string') keywords = [keywords];
      if (!Array.isArray(keywords) || keywords.some((k) => typeof k !== 'string')) {
        err = `"${name}": keywords must be a list of words.`;
        return;
      }
      const words = (keywords as string[]).map((k) => k.trim()).filter(Boolean);
      const teams = parseTeams(name, raw.teams);
      if (!teams) return;
      let groups: Group[] = [];
      if (raw.groups != null) {
        if (!Array.isArray(raw.groups)) {
          err = `"${name}": groups must be a list.`;
          return;
        }
        groups = build(raw.groups, name);
        if (err) return;
      }
      out.push({
        name,
        ...(typeof raw.title === 'string' && raw.title.trim() ? { title: raw.title.trim() } : {}),
        description: typeof raw.description === 'string' ? raw.description : '',
        ...(words.length ? { keywords: words } : {}),
        logo: typeof raw.logo === 'string' && raw.logo.trim() ? raw.logo.trim() : null,
        teams,
        match: (match as string[]).flatMap(splitRules),
        groups,
      });
    });
    return out;
  };

  const groups = build(o.groups, 'groups');
  if (err) return { error: err, warnings };
  const version = typeof o.version === 'number' && Number.isInteger(o.version) ? o.version : 1;
  const index = o.index === 'action' ? 'action' : 'api';
  return { config: { version, index, groups }, warnings };
}
