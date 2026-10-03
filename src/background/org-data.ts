import { detectAccess, type Access, type AccessProbe } from '../core/access';
import { GitHubError, type Client } from './api';
import type { KV } from './kv';

export interface OrgFile {
  exists: boolean;
  text: string;
  sha: string | null;
  etag: string | null;
}

export const decodeBase64Utf8 = (b64: string): string => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

/** Reads <org>/.github/repo-groups.yml with an ETag cache, so a 304 costs no rate limit. */
export async function readOrgFile(client: Client, kv: KV, org: string): Promise<OrgFile> {
  const key = `rg:file:${org}`;
  const cached = await kv.get<OrgFile>(key);
  const res = await client.rest(`/repos/${encodeURIComponent(org)}/.github/contents/repo-groups.yml`, { etag: cached?.exists ? cached.etag ?? undefined : undefined, allow404: true });
  if (res.notModified && cached) return cached;
  if (res.status === 404) {
    const none: OrgFile = { exists: false, text: '', sha: null, etag: null };
    await kv.set(key, none);
    return none;
  }
  const file: OrgFile = { exists: true, text: decodeBase64Utf8(res.data.content ?? ''), sha: res.data.sha, etag: res.headers.get('etag') };
  await kv.set(key, file);
  return file;
}

export interface DotGithub {
  readable: boolean;
  defaultBranch: string;
  push: boolean | null;
  allowForking?: boolean;
}

export async function readDotGithub(client: Client, org: string): Promise<DotGithub> {
  const res = await client.rest(`/repos/${encodeURIComponent(org)}/.github`, { allow404: true });
  if (res.status === 404) return { readable: false, defaultBranch: 'main', push: null };
  return { readable: true, defaultBranch: res.data.default_branch ?? 'main', push: !!res.data.permissions?.push, allowForking: res.data.allow_forking };
}

/** Detects the user's access level (F15). Personal access tokens skip the installation check. */
export async function probeAccess(client: Client, org: string, tokenKind: 'oauth' | 'pat'): Promise<{ access: Access; dotGithub: DotGithub }> {
  let membershipRole: AccessProbe['membershipRole'] = null;
  try {
    const m = await client.rest(`/user/memberships/orgs/${encodeURIComponent(org)}`, { allow404: true });
    if (m.status !== 404 && m.data?.state !== 'pending') membershipRole = m.data?.role === 'admin' ? 'admin' : 'member';
  } catch (e) {
    if (!(e instanceof GitHubError) || e.kind === 'auth' || e.kind === 'network' || e.kind === 'rate-limit') throw e;
  }
  const dotGithub = await readDotGithub(client, org);
  let appInstalled = true;
  if (tokenKind === 'oauth') {
    const inst = await client.rest('/user/installations?per_page=100', { allow404: true });
    appInstalled = !!inst.data?.installations?.some((i: any) => i.account?.login?.toLowerCase() === org.toLowerCase());
  }
  return {
    dotGithub,
    access: detectAccess({ membershipRole, pushOnDotGithub: dotGithub.readable ? dotGithub.push : null, appInstalled, allowForking: dotGithub.allowForking }),
  };
}
