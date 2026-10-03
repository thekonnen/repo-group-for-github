import { applyEdit, commitMessage, editLogoPath, pngOf, type Edit } from '../core/edit';
import type { Config } from '../core/types';
import { loadYamlParser, readConfig } from '../core/yaml-read';
import { writeConfig } from '../core/yaml-write';
import { GitHubError, type Client } from './api';
import { EditError, friendly, type EditResult } from './commit';
import type { KV } from './kv';
import { decodeBase64Utf8, encodeBase64Utf8, readDotGithub, type OrgFile } from './org-data';

const FILE = 'repo-groups.yml';
const enc = encodeURIComponent;
const PROTECTED = /protected branch|branch protection|required status|review is required|changes must be made through a pull request/i;
const refPath = (branch: string) => branch.split('/').map(enc).join('/');

export type LogoEditResult = EditResult & { logoSha?: string };

/**
 * An edit that stores a new logo: the PNG and repo-groups.yml go in ONE commit through the Git Data API
 * (ref, blobs, tree with base_tree, commit, ref update). On a conflict the file is read again and the same
 * edit is re-applied, once (§7).
 */
export async function commitEditWithLogo(client: Client, kv: KV, org: string, edit: Edit): Promise<LogoEditResult> {
  const png = pngOf(edit);
  const logoFile = editLogoPath(edit);
  if (!png || !logoFile) throw new EditError('There is no new logo to save.');
  const load = await loadYamlParser();
  const repo = await readDotGithub(client, org);
  if (!repo.readable) return { status: 'needs-repo' };
  const git = `/repos/${enc(org)}/.github/git`;
  let pngSha: string | null = null;

  for (let attempt = 0; ; attempt++) {
    let step: 'read' | 'write' | 'ref' = 'read';
    try {
      const ref = await client.rest(`${git}/ref/heads/${refPath(repo.defaultBranch)}`);
      const head: string = ref.data.object.sha;
      const base: string = (await client.rest(`${git}/commits/${head}`)).data.tree.sha;
      const file = await client.rest(`/repos/${enc(org)}/.github/contents/${FILE}?ref=${head}`, { allow404: true });

      let config: Config = { version: 1, index: 'api', groups: [] };
      if (file.status !== 404 && file.data?.content) {
        const text = decodeBase64Utf8(file.data.content);
        if (text.trim()) {
          const r = readConfig(text, load, { org });
          if (!r.config) throw new EditError(`repo-groups.yml has a problem, so nothing was changed: ${r.error}. Fix the file on GitHub first.`);
          config = r.config;
        }
      }
      const applied = applyEdit(config.groups, edit);
      if ('error' in applied) throw new EditError(applied.error);
      const next: Config = { ...config, groups: applied.groups };
      const text = writeConfig(next, `${org}/.github/repo-groups.yml`);

      step = 'write';
      pngSha ??= (await client.rest(`${git}/blobs`, { method: 'POST', body: { content: png, encoding: 'base64' } })).data.sha as string;
      const ymlSha: string = (await client.rest(`${git}/blobs`, { method: 'POST', body: { content: encodeBase64Utf8(text), encoding: 'base64' } })).data.sha;
      const tree = await client.rest(`${git}/trees`, {
        method: 'POST',
        body: {
          base_tree: base,
          tree: [
            { path: FILE, mode: '100644', type: 'blob', sha: ymlSha },
            { path: logoFile, mode: '100644', type: 'blob', sha: pngSha },
          ],
        },
      });
      const commit = await client.rest(`${git}/commits`, { method: 'POST', body: { message: commitMessage(edit), tree: tree.data.sha, parents: [head] } });

      step = 'ref';
      await client.rest(`${git}/refs/heads/${refPath(repo.defaultBranch)}`, { method: 'PATCH', body: { sha: commit.data.sha } });
      await kv.set(`rg:file:${org}`, { exists: true, text, sha: ymlSha, etag: null } satisfies OrgFile);
      return { status: 'ok', sha: ymlSha, config: next, warnings: [], logoSha: pngSha };
    } catch (e) {
      const conflict = e instanceof GitHubError && e.kind === 'validation' && step === 'ref' && !PROTECTED.test(e.message);
      if (conflict && attempt === 0) continue; // the branch moved under us: read again, re-apply
      if (conflict) throw new EditError('The file changed on GitHub while saving. Reload the page and try again.');
      if (e instanceof GitHubError && e.kind === 'not-found' && step === 'read' && !(await readDotGithub(client, org)).readable) return { status: 'needs-repo' };
      friendly(e, org);
    }
  }
}
