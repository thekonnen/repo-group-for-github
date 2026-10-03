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

export const matches = (rules: string[], name: string): boolean => rules.some((r) => globRe(r).test(name));

/** GitHub's own repository-name normalization: other characters become "-". */
export function normName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}
