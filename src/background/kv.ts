/** Tiny async key-value interface so background logic is testable without chrome.* */
export interface KV {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** All keys, when the backing store can list them (used by cache clearing). */
  keys?(): Promise<string[]>;
}

export function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(k: string) {
      return data.get(k) as T | undefined;
    },
    async set(k, v) {
      data.set(k, structuredClone(v));
    },
    async remove(k) {
      data.delete(k);
    },
    async keys() {
      return [...data.keys()];
    },
  };
}

/** Adapter over a chrome.storage area (local, session or sync). */
export function areaKV(area: { get(k: string | null): Promise<Record<string, any>>; set(o: Record<string, any>): Promise<void>; remove(k: string): Promise<void> }): KV {
  return {
    async get<T>(k: string) {
      return (await area.get(k))[k] as T | undefined;
    },
    set: (k, v) => area.set({ [k]: v }),
    remove: (k) => area.remove(k),
    keys: async () => Object.keys(await area.get(null)),
  };
}
