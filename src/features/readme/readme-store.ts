import type { Call } from '../../github/client';
import { createStore, useStore, type Store } from '../store';

export interface ReadmeState {
  /** README path in <org>/.github -> Markdown text; null = could not load; missing = still loading. */
  texts: Record<string, string | null>;
}

export interface ReadmeStore {
  store: Store<ReadmeState>;
  /** Starts loading paths not asked for yet. */
  want(paths: string[]): void;
  /** A text we already have (just saved, for example). */
  put(path: string, text: string): void;
}

/** READMEs stored as files come through the background worker (the .github repo may be private). One request per batch. */
export function createReadmeStore(call: Call, org: string): ReadmeStore {
  const store = createStore<ReadmeState>({ texts: {} });
  const asked = new Set<string>();
  return {
    store,
    want(paths) {
      const fresh = [...new Set(paths)].filter((p) => p && !asked.has(p));
      if (!fresh.length) return;
      fresh.forEach((p) => asked.add(p));
      call<Record<string, string | null>>({ type: 'readmes:get', org, paths: fresh }).then(
        (r) => store.set({ texts: { ...store.get().texts, ...Object.fromEntries(fresh.map((p) => [p, r?.[p] ?? null])) } }),
        () => store.set({ texts: { ...store.get().texts, ...Object.fromEntries(fresh.map((p) => [p, null])) } }),
      );
    },
    put(path, text) {
      asked.add(path);
      store.set({ texts: { ...store.get().texts, [path]: text } });
    },
  };
}

/** The text behind a path: undefined while loading, null when it failed. */
export function useReadmeText(readmes: ReadmeStore, path: string): string | null | undefined {
  return useStore(readmes.store).texts[path];
}
