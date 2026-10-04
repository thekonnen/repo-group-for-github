import type { IndexMeta } from '../core/index-sync';
import type { IndexStore } from './repo-index';
import type { KV } from './kv';

/** User settings kept in storage.local and edited from the options page. */
export interface Settings {
  refreshMinutes: number;
}

export const DEFAULT_REFRESH_MINUTES = 5;
const SETTINGS_KEY = 'rg:settings';

export const normalizeMinutes = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(v, 24 * 60) : DEFAULT_REFRESH_MINUTES;
};

export async function loadSettings(kv: KV): Promise<Settings> {
  const s = await kv.get<Partial<Settings>>(SETTINGS_KEY);
  return { refreshMinutes: normalizeMinutes(s?.refreshMinutes ?? DEFAULT_REFRESH_MINUTES) };
}

export async function saveSettings(kv: KV, patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings(kv);
  const next: Settings = { refreshMinutes: patch.refreshMinutes !== undefined ? normalizeMinutes(patch.refreshMinutes) : current.refreshMinutes };
  await kv.set(SETTINGS_KEY, next);
  return next;
}

/** True when the index was refreshed less than `minutes` ago, so a visit needs no request. */
export function withinInterval(meta: Pick<IndexMeta, 'lastIncrementalSync'> | null | undefined, minutes: number, now: number): boolean {
  const t = meta?.lastIncrementalSync ? Date.parse(meta.lastIncrementalSync) : NaN;
  return Number.isFinite(t) && now - t >= 0 && now - t < minutes * 60_000;
}

/** Cache keys in storage.local. Auth (rg:auth), prefs (rg:prefs:*), settings and the pending flow are never listed. */
const CACHE_PREFIXES = ['rg:file:', 'rg:props:', 'rg:teams:', 'rg:config:', 'rg:orgs', 'rg:details:', 'rg:parents:'];

/** Removes the repo indexes and every org file / teams / org-list cache. Never touches the token, prefs or settings. */
export async function clearCache(kv: KV, index: IndexStore, logos?: { clear?(): Promise<void> }): Promise<{ removed: number }> {
  const keys = ((await kv.keys?.()) ?? []).filter((k) => CACHE_PREFIXES.some((p) => k.startsWith(p)));
  for (const k of keys) await kv.remove(k);
  await index.clear();
  await logos?.clear?.();
  return { removed: keys.length };
}
