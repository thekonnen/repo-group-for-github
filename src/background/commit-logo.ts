import { applyEdit, commitMessage, editLogoPath, finalName, inlineReadmes, pngOf, readmeFileOf, type Edit } from '../core/edit';
import { findGroup } from '../core/placement';
import { readmeFilePath } from '../core/readme';
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

export type LogoEditResult = EditResult & { logoSha?: string; readmeSha?: string; readmeFile?: string; /** `migrate-readmes`: every file written, to prime the cache. */ migrated?: { file: string; sha: string; text: string }[] };

/**
 * An edit that stores a new logo and/or a README file (C4): the files and repo-groups.yml go in ONE commit through the Git Data API
 * (ref, blobs, tree with base_tree, commit, ref update). On a conflict the file is read again and the same
 * edit is re-applied, once (§7).
 */
export async function commitEditWithLogo(client: Client, kv: KV, org: string, edit: Edit): Promise<LogoEditResult> {
  const png = pngOf(edit);
  const logoFile = editLogoPath(edit);
  const readmeText = readmeFileOf(edit);
  const migrate = edit.kind === 'migrate-readmes';
  if (!(png && logoFile) && readmeText === null && !migrate) throw new EditError('There is no new logo or README to save.');
  const load = await loadYamlParser();
  const repo = await readDotGithub(client, org);
  if (!repo.readable) return { status: 'needs-repo' };
  const git = `/repos/${enc(org)}/.github/git`;
  let pngSha: string | null = null;
  let readmeSha: string | null = null;
  let readmeFile: string | null = null;

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
      const moving = migrate ? inlineReadmes(config.groups) : [];
      if (migrate && !moving.length) throw new EditError('No README is stored inside repo-groups.yml, so there is nothing to move.');
      const applied = applyEdit(config.groups, edit);
      if ('error' in applied) throw new EditError(applied.error);
      const next: Config = { ...config, groups: applied.groups };
      const text = writeConfig(next, `${org}/.github/repo-groups.yml`);

      step = 'write';
      const files: { path: string; mode: string; type: string; sha: string }[] = [];
      if (png && logoFile) {
        pngSha ??= (await client.rest(`${git}/blobs`, { method: 'POST', body: { content: png, encoding: 'base64' } })).data.sha as string;
        files.push({ path: logoFile, mode: '100644', type: 'blob', sha: pngSha });
      }
      if (readmeText !== null) {
        // The file lives at the path the new group tree gives it (a rename in the same edit moves it).
        const at = readmeLocation(edit, applied.groups);
        if (at) {
          readmeSha ??= (await client.rest(`${git}/blobs`, { method: 'POST', body: { content: encodeBase64Utf8(readmeText), encoding: 'base64' } })).data.sha as string;
          readmeFile = at;
          files.push({ path: at, mode: '100644', type: 'blob', sha: readmeSha });
        }
      }
      const migrated: { file: string; sha: string; text: string }[] = [];
      for (const m of moving) {
        const sha = (await client.rest(`${git}/blobs`, { method: 'POST', body: { content: encodeBase64Utf8(m.text), encoding: 'base64' } })).data.sha as string;
        files.push({ path: m.file, mode: '100644', type: 'blob', sha });
        migrated.push({ file: m.file, sha, text: m.text });
      }
      const ymlSha: string = (await client.rest(`${git}/blobs`, { method: 'POST', body: { content: encodeBase64Utf8(text), encoding: 'base64' } })).data.sha;
      const tree = await client.rest(`${git}/trees`, {
        method: 'POST',
        body: {
          base_tree: base,
          tree: [
            { path: FILE, mode: '100644', type: 'blob', sha: ymlSha },
            ...files,
          ],
        },
      });
      const commit = await client.rest(`${git}/commits`, { method: 'POST', body: { message: commitMessage(edit), tree: tree.data.sha, parents: [head] } });

      step = 'ref';
      await client.rest(`${git}/refs/heads/${refPath(repo.defaultBranch)}`, { method: 'PATCH', body: { sha: commit.data.sha } });
      await kv.set(`rg:file:${org}`, { exists: true, text, sha: ymlSha, etag: null } satisfies OrgFile);
      return { status: 'ok', sha: ymlSha, config: next, warnings: [], ...(pngSha && png ? { logoSha: pngSha } : {}), ...(readmeSha && readmeFile ? { readmeSha, readmeFile } : {}), ...(migrated.length ? { migrated } : {}) };
    } catch (e) {
      const conflict = e instanceof GitHubError && e.kind === 'validation' && step === 'ref' && !PROTECTED.test(e.message);
      if (conflict && attempt === 0) continue; // the branch moved under us: read again, re-apply
      if (conflict) throw new EditError('The file changed on GitHub while saving. Reload the page and try again.');
      if (e instanceof GitHubError && e.kind === 'not-found' && step === 'read' && !(await readDotGithub(client, org)).readable) return { status: 'needs-repo' };
      friendly(e, org);
    }
  }
}

/** Where the README file of an edit ends up: the `readme` the applied tree gives the group. */
function readmeLocation(edit: Edit, groups: Parameters<typeof findGroup>[0]): string | null {
  if (edit.kind !== 'new' && edit.kind !== 'edit') return null;
  const parent = edit.kind === 'new' ? edit.parent : edit.path.slice(0, -1);
  const g = findGroup(groups, [...parent, finalName(edit.name)]);
  return g?.readme && g.readme === readmeFilePath([...parent, g.name]) ? g.readme : null;
}
