import { applyEdit, commitMessage, type Edit } from '../core/edit';
import type { Config } from '../core/types';
import { loadYamlParser, readConfig } from '../core/yaml-read';
import { writeConfig } from '../core/yaml-write';
import { GitHubError, type Client } from './api';
import type { KV } from './kv';
import { encodeBase64Utf8, readDotGithub, type OrgFile } from './org-data';

/** An error with text meant for the person using the page. */
export class EditError extends Error {}

export type EditResult =
  | { status: 'ok'; sha: string | null; config: Config; warnings: string[] }
  | { status: 'needs-repo' };

const FILE = 'repo-groups.yml';
const enc = encodeURIComponent;

interface Fresh {
  text: string;
  sha: string | null;
}

/** Latest file straight from GitHub (no ETag cache): null sha means the file does not exist yet. */
async function fetchFresh(client: Client, org: string): Promise<Fresh | 'no-repo'> {
  const res = await client.rest(`/repos/${enc(org)}/.github/contents/${FILE}`, { allow404: true });
  if (res.status !== 404) return { text: decodeUtf8(res.data.content ?? ''), sha: res.data.sha };
  const repo = await readDotGithub(client, org);
  return repo.readable ? { text: '', sha: null } : 'no-repo';
}

const decodeUtf8 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

export function friendly(e: unknown, org: string): never {
  if (e instanceof GitHubError) {
    if (/protected branch|branch protection|required status|review is required|changes must be made through a pull request/i.test(e.message))
      throw new EditError(`The default branch of ${org}/.github is protected, so the extension cannot commit to it. Ask an owner to allow it, or edit the file on GitHub.`);
    if (e.kind === 'forbidden' || e.kind === 'not-found')
      throw new EditError(`You cannot write to ${org}/.github. Ask an org owner for access, or organize in My groups.`);
  }
  throw e;
}

/**
 * Applies one edit to the latest repo-groups.yml and commits it. On a sha conflict (409/422) the file is fetched
 * again and the same edit is re-applied, once (§7).
 */
export async function commitEdit(client: Client, kv: KV, org: string, edit: Edit): Promise<EditResult> {
  const load = await loadYamlParser();
  for (let attempt = 0; ; attempt++) {
    const fresh = await fetchFresh(client, org);
    if (fresh === 'no-repo') return { status: 'needs-repo' };

    let base: Config = { version: 1, index: 'api', groups: [] };
    if (fresh.text.trim()) {
      const r = readConfig(fresh.text, load, { org });
      if (!r.config) throw new EditError(`repo-groups.yml has a problem, so nothing was changed: ${r.error}. Fix the file on GitHub first.`);
      base = r.config;
    }
    const applied = applyEdit(base.groups, edit);
    if ('error' in applied) throw new EditError(applied.error);
    const next: Config = { ...base, groups: applied.groups };
    const text = writeConfig(next, `${org}/.github/repo-groups.yml`);

    try {
      const res = await client.rest(`/repos/${enc(org)}/.github/contents/${FILE}`, {
        method: 'PUT',
        body: { message: commitMessage(edit), content: encodeBase64Utf8(text), ...(fresh.sha ? { sha: fresh.sha } : {}) },
      });
      const sha: string | null = res.data?.content?.sha ?? null;
      await kv.set(`rg:file:${org}`, { exists: true, text, sha, etag: null } satisfies OrgFile);
      return { status: 'ok', sha, config: next, warnings: [] };
    } catch (e) {
      if (e instanceof GitHubError && e.kind === 'validation' && attempt === 0) continue; // changed under us: refetch, re-apply
      if (e instanceof GitHubError && e.kind === 'validation') throw new EditError('The file changed on GitHub while saving. Reload the page and try again.');
      friendly(e, org);
    }
  }
}

/** Creates the private <org>/.github repository (with a first commit, so files can be added). */
export async function createDotGithub(client: Client, org: string): Promise<void> {
  try {
    await client.rest(`/orgs/${enc(org)}/repos`, {
      method: 'POST',
      body: { name: '.github', private: true, auto_init: true, description: 'Organization-wide settings, including Repository Group' },
    });
  } catch (e) {
    if (e instanceof GitHubError && e.kind === 'validation' && /already exists/i.test(e.message)) return;
    if (e instanceof GitHubError && (e.kind === 'forbidden' || e.kind === 'not-found'))
      throw new EditError(`You cannot create ${org}/.github. Ask an org owner to create it.`);
    throw e;
  }
}
