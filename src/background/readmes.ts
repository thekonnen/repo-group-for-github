import { isSafeReadmePath, MAX_README_BYTES } from '../core/readme';
import { GitHubError, type Client } from './api';
import type { LogoCache } from './logos';
import { decodeBase64Utf8 } from './org-data';

const enc = encodeURIComponent;
const DIR_TTL = 60_000;

interface Entry {
  sha: string;
  size: number;
}

/**
 * README files of groups (C4). <org>/.github may be private, so the background reads them with the user's token and
 * hands the page plain text, cached by blob SHA (same cache and idea as logos).
 */
export function createReadmeService(deps: { client: Client; cache: LogoCache }) {
  const dirs = new Map<string, { at: number; entries: Map<string, Entry> }>();

  async function listDir(org: string, dir: string): Promise<Map<string, Entry>> {
    const key = `${org}:${dir}`;
    const hit = dirs.get(key);
    if (hit && Date.now() - hit.at < DIR_TTL) return hit.entries;
    const res = await deps.client.rest(`/repos/${enc(org)}/.github/contents/${dir.split('/').filter(Boolean).map(enc).join('/')}`, { allow404: true });
    const entries = new Map<string, Entry>();
    if (Array.isArray(res.data)) for (const f of res.data) if (f.type === 'file') entries.set(f.name, { sha: f.sha, size: f.size ?? 0 });
    dirs.set(key, { at: Date.now(), entries });
    return entries;
  }

  async function one(org: string, path: string): Promise<string | null> {
    if (!isSafeReadmePath(path)) return null;
    const i = path.lastIndexOf('/');
    const entry = (await listDir(org, i < 0 ? '' : path.slice(0, i))).get(path.slice(i + 1));
    if (!entry || entry.size > MAX_README_BYTES) return null;
    const key = `readme:${entry.sha}`;
    const cached = await deps.cache.get(key);
    if (typeof cached === 'string') return cached;
    const blob = await deps.client.rest(`/repos/${enc(org)}/.github/git/blobs/${entry.sha}`);
    const text = decodeBase64Utf8(String(blob.data?.content ?? '').replace(/\s/g, ''));
    await deps.cache.set(key, text);
    return text;
  }

  return {
    /** Text (or null: missing, too large or unreadable) for each README path of the org file. */
    async load(org: string, paths: string[]): Promise<Record<string, string | null>> {
      const out: Record<string, string | null> = {};
      await Promise.all(
        [...new Set(paths)].map(async (p) => {
          try {
            out[p] = await one(org, p);
          } catch (e) {
            if (e instanceof GitHubError && (e.kind === 'auth' || e.kind === 'rate-limit')) throw e;
            out[p] = null;
          }
        }),
      );
      return out;
    },

    /** After a commit: the text is known, so cache it by blob SHA and forget the folder listing. */
    async prime(org: string, sha: string, text: string) {
      await deps.cache.set(`readme:${sha}`, text);
      for (const k of [...dirs.keys()]) if (k.startsWith(`${org}:`)) dirs.delete(k);
    },
  };
}
