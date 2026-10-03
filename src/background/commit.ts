import { applyEdit, commitMessage, type Edit } from '../core/edit';
import { yamlCommitMessage } from '../core/yaml-session';
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
  | { status: 'needs-repo' }
  /** Edit YAML only: the file on GitHub is not the one the editor was opened on. `config` is the fresh file (null if none or invalid). */
  | { status: 'conflict'; sha: string | null; config: Config | null };

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
export async function createDotGithub(client: Client, org: string, personal = false): Promise<void> {
  try {
    await client.rest(personal ? '/user/repos' : `/orgs/${enc(org)}/repos`, {
      method: 'POST',
      body: { name: '.github', private: true, auto_init: true, description: personal ? 'Profile and settings, including Repository Group' : 'Organization-wide settings, including Repository Group' },
    });
  } catch (e) {
    if (e instanceof GitHubError && e.kind === 'validation' && /already exists/i.test(e.message)) return;
    if (e instanceof GitHubError && (e.kind === 'forbidden' || e.kind === 'not-found'))
      throw new EditError(`You cannot create ${org}/.github. Ask an org owner to create it.`);
    throw e;
  }
}

export interface YamlCheck {
  config?: Config;
  error?: string;
  line?: number | null;
  warnings: string[];
  stripped: boolean;
}

/** Validates editor text (fences stripped, `repositories:` and unknown keys ignored). The page diffs the returned tree. */
export async function checkYaml(org: string, text: string, knownTeams?: string[]): Promise<YamlCheck> {
  const r = readConfig(text, await loadYamlParser(), { org, knownTeams });
  return { config: r.config, error: r.error, line: r.line, warnings: r.warnings, stripped: !!r.stripped };
}

/**
 * Commits the YAML editor's text. Unlike the single-edit flow there is no automatic retry: if the file on GitHub is not
 * the one the editor was opened on, the person decides ("The file changed on GitHub since you opened it").
 */
export async function commitYaml(client: Client, kv: KV, org: string, text: string, baseSha: string | null, changes: number): Promise<EditResult> {
  const load = await loadYamlParser();
  const draft = readConfig(text, load, { org });
  if (!draft.config) throw new EditError(`The YAML has a problem: ${draft.error}`);

  const conflict = async (): Promise<EditResult> => {
    const f = await fetchFresh(client, org);
    if (f === 'no-repo') return { status: 'needs-repo' };
    const r = f.text.trim() ? readConfig(f.text, load, { org }) : null;
    return { status: 'conflict', sha: f.sha, config: r?.config ?? null };
  };

  const fresh = await fetchFresh(client, org);
  if (fresh === 'no-repo') return { status: 'needs-repo' };
  if ((fresh.sha ?? null) !== baseSha) return conflict();

  const out = writeConfig(draft.config, `${org}/.github/repo-groups.yml`);
  try {
    const res = await client.rest(`/repos/${enc(org)}/.github/contents/${FILE}`, {
      method: 'PUT',
      body: { message: yamlCommitMessage(changes), content: encodeBase64Utf8(out), ...(fresh.sha ? { sha: fresh.sha } : {}) },
    });
    const sha: string | null = res.data?.content?.sha ?? null;
    await kv.set(`rg:file:${org}`, { exists: true, text: out, sha, etag: null } satisfies OrgFile);
    return { status: 'ok', sha, config: draft.config, warnings: draft.warnings };
  } catch (e) {
    if (e instanceof GitHubError && e.kind === 'validation') return conflict();
    friendly(e, org);
  }
}
