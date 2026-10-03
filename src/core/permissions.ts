import type { Permission } from './types';

export const PERMISSIONS = ['pull', 'triage', 'push', 'maintain', 'admin'] as const;

export const PERMISSION_LABEL: Record<string, string> = {
  pull: 'Read',
  triage: 'Triage',
  push: 'Write',
  maintain: 'Maintain',
  admin: 'Admin',
  none: 'none',
};

export const RANK: Record<string, number> = { none: 0, pull: 1, triage: 2, push: 3, maintain: 4, admin: 5 };

const FROM_GRAPHQL: Record<string, Permission> = {
  READ: 'pull',
  TRIAGE: 'triage',
  WRITE: 'push',
  MAINTAIN: 'maintain',
  ADMIN: 'admin',
};

export const fromGraphql = (p: string): Permission => FROM_GRAPHQL[p] ?? 'pull';

export const labelOf = (p: string): string => PERMISSION_LABEL[p] ?? p;

/** Rank of a permission; custom roles rank by their base role when known, else unknown (-1). */
export function rankOf(p: string, customBase?: Record<string, string>): number {
  if (p in RANK) return RANK[p];
  const base = customBase?.[p];
  return base && base in RANK ? RANK[base] : -1;
}
