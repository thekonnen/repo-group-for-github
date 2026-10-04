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

/** `topic:foo` / `topic:foo-*` rules match GitHub topics instead of the repository name. */
export const TOPIC_PREFIX = 'topic:';
export const isTopicRule = (rule: string): boolean => rule.slice(0, TOPIC_PREFIX.length).toLowerCase() === TOPIC_PREFIX;
/** The topic part of a `topic:` rule, trimmed (may be empty: invalid). */
export const topicOf = (rule: string): string => rule.slice(TOPIC_PREFIX.length).trim();

/** UI label of a rule: `topic:foo` is shown as `topic: foo`, `prop:client=Acme` as `client: Acme`. */
export function ruleLabel(rule: string): string {
  if (isTopicRule(rule)) return `topic: ${topicOf(rule)}`;
  const p = parsePropRule(rule);
  return p ? `${p.name}: ${p.value}` : rule;
}

/** Does one rule catch a repo? Name rules test the name, topic rules any topic (`*` allowed), property rules the custom properties. */
export function ruleMatches(rule: string, name: string, topics?: readonly string[], props?: RepoProps): boolean {
  if (isPropRule(rule)) return propHit(rule, props);
  if (!isTopicRule(rule)) return globRe(rule).test(name);
  const t = topicOf(rule);
  return !!t && !!topics?.some((x) => globRe(t).test(x));
}

/** Exact-style hit: a rule without `*` that equals the name, one of the topics (topic rule), or hits the properties (prop rule). */
export function exactHit(rule: string, name: string, topics?: readonly string[], props?: RepoProps): boolean {
  if (!isExact(rule)) return false;
  if (isPropRule(rule)) return propHit(rule, props);
  if (!isTopicRule(rule)) return rule.toLowerCase() === name.toLowerCase();
  const t = topicOf(rule).toLowerCase();
  return !!t && !!topics?.some((x) => x.toLowerCase() === t);
}

export const matches = (rules: string[], name: string, topics?: readonly string[], props?: RepoProps): boolean => rules.some((r) => ruleMatches(r, name, topics, props));

/** GitHub's own repository-name normalization: other characters become "-". */
export function normName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}
