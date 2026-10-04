const SPECIAL = /[.+?^${}()|[\]\\]/g;

const cache = new Map<string, RegExp>();

/** `*` is a wildcard, everything else is literal, case-insensitive. Compiled once per pattern. */
export function globRe(pattern: string): RegExp {
  let re = cache.get(pattern);
  if (!re) {
    re = new RegExp('^' + pattern.replace(SPECIAL, '\\$&').replace(/\*/g, '.*') + '$', 'i');
    cache.set(pattern, re);
  }
  return re;
}

export const isExact = (rule: string): boolean => !rule.includes('*');

/** Custom property values of a repository: property name -> value (or list of values). */
export type RepoProps = Record<string, string | string[]>;

export const PROP_PREFIX = 'prop:';

/** `prop:client=Acme` is a rule on an org custom property instead of the repository name. */
export const isPropRule = (rule: string): boolean => rule.slice(0, PROP_PREFIX.length).toLowerCase() === PROP_PREFIX;

/** Splits `prop:name=value`. Null when the name or the value is missing. */
export function parsePropRule(rule: string): { name: string; value: string } | null {
  if (!isPropRule(rule)) return null;
  const body = rule.slice(PROP_PREFIX.length);
  const eq = body.indexOf('=');
  const name = eq < 0 ? '' : body.slice(0, eq).trim();
  const value = eq < 0 ? '' : body.slice(eq + 1).trim();
  return name && value ? { name, value } : null;
}

/** Whether a property rule hits these values. Property names compare case-insensitively; the value takes `*` and ignores case. */
export function propHit(rule: string, props: RepoProps | undefined): boolean {
  const p = parsePropRule(rule);
  if (!p || !props) return false;
  const re = globRe(p.value);
  const lower = p.name.toLowerCase();
  for (const [k, v] of Object.entries(props)) {
    if (k.toLowerCase() !== lower) continue;
    if (Array.isArray(v) ? v.some((x) => re.test(x)) : typeof v === 'string' && re.test(v)) return true;
  }
  return false;
}

/** One rule against a repository: a name glob, or a custom property rule. */
export const ruleHit = (rule: string, name: string, props?: RepoProps): boolean => (isPropRule(rule) ? propHit(rule, props) : globRe(rule).test(name));

export const matches = (rules: string[], name: string, props?: RepoProps): boolean => rules.some((r) => ruleHit(r, name, props));

/** Chip text: `prop:client=Acme` reads "client: Acme"; other rules are shown as written. */
export function ruleLabel(rule: string): string {
  const p = parsePropRule(rule);
  return p ? `${p.name}: ${p.value}` : rule;
}

/** GitHub's own repository-name normalization: other characters become "-". */
export function normName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}
