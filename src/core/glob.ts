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

/** `topic:foo` / `topic:foo-*` rules match GitHub topics instead of the repository name. */
export const TOPIC_PREFIX = 'topic:';
export const isTopicRule = (rule: string): boolean => rule.slice(0, TOPIC_PREFIX.length).toLowerCase() === TOPIC_PREFIX;
/** The topic part of a `topic:` rule, trimmed (may be empty: invalid). */
export const topicOf = (rule: string): string => rule.slice(TOPIC_PREFIX.length).trim();

/** UI label of a rule: `topic:foo` is shown as `topic: foo`. */
export const ruleLabel = (rule: string): string => (isTopicRule(rule) ? `topic: ${topicOf(rule)}` : rule);

/** Does one rule catch a repo? Name rules test the name, topic rules test any topic (case-insensitive, `*` allowed). */
export function ruleMatches(rule: string, name: string, topics?: readonly string[]): boolean {
  if (!isTopicRule(rule)) return globRe(rule).test(name);
  const t = topicOf(rule);
  return !!t && !!topics?.some((x) => globRe(t).test(x));
}

/** Exact-style hit: a rule without `*` that equals the name, or (topic rule) equals one of the topics. */
export function exactHit(rule: string, name: string, topics?: readonly string[]): boolean {
  if (!isExact(rule)) return false;
  if (!isTopicRule(rule)) return rule.toLowerCase() === name.toLowerCase();
  const t = topicOf(rule).toLowerCase();
  return !!t && !!topics?.some((x) => x.toLowerCase() === t);
}

export const matches = (rules: string[], name: string, topics?: readonly string[]): boolean => rules.some((r) => ruleMatches(r, name, topics));

/** GitHub's own repository-name normalization: other characters become "-". */
export function normName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}
