import { declinedMessage, ERR_LINK, isExternalLogo, MAX_BYTES, mimeOf, parseLogoUrl } from '../core/logo';
import { GitHubError, type Client, type FetchLike } from './api';
import { EditError } from './commit';

/** Small async cache for logo data URLs. In the browser it is IndexedDB; tests use memory. */
export interface LogoCache {
  get(key: string): Promise<any>;
  set(key: string, value: unknown): Promise<void>;
}

export function memoryLogoCache(): LogoCache & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) };
}

/** Optional host permission for an image link's origin (needs a user gesture). */
export interface Origins {
  has(origin: string): Promise<boolean>;
  request(origin: string): Promise<boolean>;
}

const enc = encodeURIComponent;
const DIR_TTL = 60_000;
const EXTERNAL_TTL = 24 * 3600_000;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

interface Entry {
  name: string;
  sha: string;
  size: number;
}

/**
 * Logos for the page. <org>/.github may be private, so the page cannot use an <img> pointing at GitHub: the background
 * fetches the bytes with the user's token and hands back data URLs, cached by blob SHA (F7).
 */
export function createLogoService(deps: { client: Client; fetch: FetchLike; cache: LogoCache; origins?: Origins }) {
  const dirs = new Map<string, { at: number; entries: Map<string, Entry> }>();

  async function listDir(org: string, dir: string): Promise<Map<string, Entry>> {
    const key = `${org}:${dir}`;
    const hit = dirs.get(key);
    if (hit && Date.now() - hit.at < DIR_TTL) return hit.entries;
    const res = await deps.client.rest(`/repos/${enc(org)}/.github/contents/${dir.split('/').map(enc).join('/')}`, { allow404: true });
    const entries = new Map<string, Entry>();
    if (Array.isArray(res.data)) for (const f of res.data) if (f.type === 'file') entries.set(f.name, { name: f.name, sha: f.sha, size: f.size ?? 0 });
    dirs.set(key, { at: Date.now(), entries });
    return entries;
  }

  async function fromRepo(org: string, path: string): Promise<string | null> {
    const i = path.lastIndexOf('/');
    const entry = (await listDir(org, i < 0 ? '' : path.slice(0, i))).get(path.slice(i + 1));
    const mime = mimeOf(path);
    if (!entry || !mime || entry.size > MAX_BYTES) return null;
    const key = `logo:${entry.sha}`;
    const cached = await deps.cache.get(key);
    if (typeof cached === 'string') return cached;
    const blob = await deps.client.rest(`/repos/${enc(org)}/.github/git/blobs/${entry.sha}`);
    const url = `data:${mime};base64,${String(blob.data?.content ?? '').replace(/\s/g, '')}`;
    await deps.cache.set(key, url);
    return url;
  }

  /** Reads an image from another site. No token goes along. */
  async function download(url: string): Promise<string> {
    const res = await deps.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) throw new Error('not an image');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new EditError('That image is larger than 5 MB. Choose a smaller file.');
    return `data:${type};base64,${toBase64(bytes)}`;
  }

  async function fromLink(url: string): Promise<string | null> {
    const key = `logo-url:${url}`;
    const cached = await deps.cache.get(key);
    if (cached && Date.now() - cached.at < EXTERNAL_TTL) return cached.dataUrl;
    try {
      const dataUrl = await download(url);
      await deps.cache.set(key, { dataUrl, at: Date.now() });
      return dataUrl;
    } catch {
      return null; // no permission, blocked or not an image: the page shows the letter
    }
  }

  return {
    /** Data URL (or null: show the letter) for each logo reference of the org file. */
    async load(org: string, srcs: string[]): Promise<Record<string, string | null>> {
      const out: Record<string, string | null> = {};
      await Promise.all(
        [...new Set(srcs)].map(async (src) => {
          try {
            out[src] = isExternalLogo(src) ? await fromLink(src) : await fromRepo(org, src);
          } catch (e) {
            if (e instanceof GitHubError && (e.kind === 'auth' || e.kind === 'rate-limit')) throw e;
            out[src] = null;
          }
        }),
      );
      return out;
    },

    /** The image behind a link typed in the logo field, as a data URL for the cropper. */
    async fetchLink(raw: string): Promise<{ dataUrl: string }> {
      const p = parseLogoUrl(raw);
      if ('error' in p) throw new EditError(p.error);
      const origin = `${p.url.origin}/*`;
      if (deps.origins && !(await deps.origins.has(origin)) && !(await deps.origins.request(origin).catch(() => false))) {
        throw new EditError(declinedMessage(p.url.host));
      }
      try {
        return { dataUrl: await download(p.url.href) };
      } catch (e) {
        if (e instanceof EditError) throw e;
        throw new EditError(ERR_LINK);
      }
    },

    /** After a logo commit: the new PNG is known, so cache it by its blob SHA and forget the folder listing. */
    async prime(org: string, sha: string, dataUrl: string) {
      await deps.cache.set(`logo:${sha}`, dataUrl);
      for (const k of [...dirs.keys()]) if (k.startsWith(`${org}:`)) dirs.delete(k);
    },
  };
}
