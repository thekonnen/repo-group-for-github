/** storage.sync allows ~8 KB per item (key included) and ~100 KB total. */
export const SYNC_ITEM_LIMIT = 8000;
export const SYNC_TOTAL_LIMIT = 100000;

const utf8 = (s: string) => new TextEncoder().encode(s).length;

export interface Chunked {
  items: Record<string, string>;
  tooLarge: boolean;
}

/** Splits text across `<key>:0..n` items plus a `<key>:n` count, never cutting a UTF-8 character. */
export function splitChunks(key: string, text: string, itemLimit = SYNC_ITEM_LIMIT, totalLimit = SYNC_TOTAL_LIMIT): Chunked {
  const budget = itemLimit - utf8(`${key}:999`) - 16;
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of text) {
    const b = utf8(ch);
    if (curBytes + b > budget) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  if (cur || !parts.length) parts.push(cur);
  const items: Record<string, string> = { [`${key}:n`]: String(parts.length) };
  parts.forEach((p, i) => (items[`${key}:${i}`] = p));
  const total = Object.entries(items).reduce((n, [k, v]) => n + utf8(k) + utf8(v), 0);
  return { items, tooLarge: total > totalLimit };
}

export function joinChunks(key: string, items: Record<string, unknown>): string | null {
  const n = Number(items[`${key}:n`]);
  if (!Number.isInteger(n) || n < 1) return null;
  let out = '';
  for (let i = 0; i < n; i++) {
    const p = items[`${key}:${i}`];
    if (typeof p !== 'string') return null;
    out += p;
  }
  return out;
}

export const chunkKeys = (key: string, count: number): string[] => [`${key}:n`, ...Array.from({ length: count }, (_, i) => `${key}:${i}`)];
