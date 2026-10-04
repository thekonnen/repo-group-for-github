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

/** Rule syntax `fork-of:<owner>` or `fork-of:<owner>/<repo>` (A5): forks by upstream. No `*` = exact-style. */
export const FORK_PREFIX = 'fork-of:';
export const isForkRule = (rule: string): boolean => rule.toLowerCase().startsWith(FORK_PREFIX);
export const forkTarget = (rule: string): string => rule.slice(FORK_PREFIX.length).trim();

/** What a rule is checked against: the repo name, plus fork status and upstream for `fork-of:` rules. */
export interface RuleTarget {
  name: string;
  fork?: boolean;
  parent?: string | null;
}

/** Does one rule catch this repo? A `fork-of:` rule needs a known parent. */
export function ruleHits(rule: string, repo: RuleTarget): boolean {
  if (!isForkRule(rule)) return globRe(rule).test(repo.name);
  const t = forkTarget(rule);
  if (!t || !repo.fork || !repo.parent) return false;
  return globRe(t).test(t.includes('/') ? repo.parent : repo.parent.split('/')[0]);
}

export const matchesRepo = (rules: string[], repo: RuleTarget): boolean => rules.some((r) => ruleHits(r, repo));

export const matches = (rules: string[], name: string): boolean => rules.some((r) => !isForkRule(r) && globRe(r).test(name));

/** GitHub's own repository-name normalization: other characters become "-". */
export function normName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}
