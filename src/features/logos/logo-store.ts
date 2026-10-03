import type { Call } from '../../github/client';
import { createStore, useStore, type Store } from '../store';

export interface LogoState {
  /** logo reference (path in <org>/.github or https URL) -> data URL; null = could not load, show the letter. */
  logos: Record<string, string | null>;
}

export interface LogoStore {
  store: Store<LogoState>;
  /** Starts loading references not asked for yet. */
  want(srcs: string[]): void;
  /** A logo we already have (just cropped, for example). */
  put(src: string, dataUrl: string): void;
}

/**
 * Logos come through the background worker (the .github repo may be private, so no <img> can point at it).
 * One request per batch of new references; results are data URLs.
 */
export function createLogoStore(call: Call, org: string): LogoStore {
  const store = createStore<LogoState>({ logos: {} });
  const asked = new Set<string>();
  return {
    store,
    want(srcs) {
      const fresh = [...new Set(srcs)].filter((s) => s && !asked.has(s));
      if (!fresh.length) return;
      fresh.forEach((s) => asked.add(s));
      call<Record<string, string | null>>({ type: 'logos:get', org, srcs: fresh }).then(
        (r) => store.set({ logos: { ...store.get().logos, ...Object.fromEntries(fresh.map((s) => [s, r?.[s] ?? null])) } }),
        () => store.set({ logos: { ...store.get().logos, ...Object.fromEntries(fresh.map((s) => [s, store.get().logos[s] ?? null])) } }),
      );
    },
    put(src, dataUrl) {
      asked.add(src);
      store.set({ logos: { ...store.get().logos, [src]: dataUrl } });
    },
  };
}

/** The data URL of a group's logo, or null (no logo, still loading or failed: the letter avatar shows). */
export function useLogoSrc(logos: LogoStore, logo: string | null | undefined): string | null {
  const s = useStore(logos.store);
  return logo ? s.logos[logo] ?? null : null;
}
