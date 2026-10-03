import { useEffect, useRef, useState } from 'preact/hooks';

/** Minimal observable store shared by the page view and the sidebar tree. */
export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      subs.forEach((f) => f());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  const [, tick] = useState(0);
  const seen = useRef(store.get());
  seen.current = store.get();
  useEffect(() => {
    // The store may have changed between the render and this subscription: catch up.
    if (store.get() !== seen.current) tick((n) => n + 1);
    return store.subscribe(() => tick((n) => n + 1));
  }, [store]);
  return store.get();
}
