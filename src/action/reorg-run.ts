import { loadYamlParser, readConfig } from '../core/yaml-read';
import { writeConfig } from '../core/yaml-write';
import { commitMessage, planReorg, prBody, type ReorgPlan } from '../core/reorg';
import type { RepoInfo } from '../core/types';

/** Runtime of the scheduled reorganization Action. Everything is injected so tests can run it without a network. */

export interface RunOptions {
  org: string;
  token: string;
  /** Repository that holds repo-groups.yml. */
  repo?: string;
  dryRun?: boolean;
  /** Overrides today's date (YYYY-MM-DD) in the branch name. */
  date?: string;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
}

export interface RunResult {
  action: 'none' | 'dry-run' | 'created' | 'updated' | 'unchanged';
  plan: ReorgPlan;
  branch?: string;
  pr?: number;
  body?: string;
  yaml?: string;
}

export const BRANCH_PREFIX = 'repo-groups/reorg-';
const FILE = 'repo-groups.yml';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

export async function run(o: RunOptions): Promise<RunResult> {
  const f = o.fetch ?? fetch;
  const log = o.log ?? ((m: string) => console.log(m));
  const repo = o.repo ?? '.github';
  const api = 'https://api.github.com';

  async function call(method: string, path: string, body?: unknown, ok: number[] = []): Promise<{ status: number; json: any; link: string }> {
    const res = await f(path.startsWith('http') ? path : api + path, {
      method,
      headers: { authorization: `Bearer ${o.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'repo-groups-reorg', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok && !ok.includes(res.status)) throw new Error(`${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    return { status: res.status, json: text ? JSON.parse(text) : null, link: res.headers.get('link') ?? '' };
  }

  // 1. The current file and the default branch.
  const meta = (await call('GET', `/repos/${o.org}/${repo}`)).json;
  const base: string = meta.default_branch;
  const file = (await call('GET', `/repos/${o.org}/${repo}/contents/${FILE}?ref=${encodeURIComponent(base)}`)).json;
  const parsed = readConfig(unb64(file.content), await loadYamlParser(), { org: o.org });
  if (!parsed.config) throw new Error(`${FILE} is not valid: ${parsed.error}`);

  // 2. Every repository of the org. A partial list would propose wrong removals, so any failure aborts the run.
  const raw: any[] = [];
  let next: string | null = `/orgs/${o.org}/repos?type=all&per_page=100`;
  while (next) {
    const r = await call('GET', next);
    raw.push(...r.json);
    next = /<([^>]+)>;\s*rel="next"/.exec(r.link)?.[1] ?? null;
  }
  if (!raw.length) throw new Error('The token sees no repositories. Check REPO_GROUPS_TOKEN (Metadata read on all repositories); refusing to continue.');
  const repos: RepoInfo[] = raw.map((r) => ({ name: r.name, description: r.description ?? '', archived: !!r.archived }));

  // 3. Plan.
  const plan = planReorg(parsed.config, repos);
  const yaml = writeConfig(plan.config, `${o.org}/.github/repo-groups.yml`);
  const body = prBody(plan, o.org);
  log(`${repos.length} repositories, ${plan.additions.length} additions, ${plan.removals.length} dead names, ${plan.undecided.length} need a human.`);
  if (!plan.changes) {
    // Undecided repos alone give nothing to commit, so no PR. They are listed whenever a PR is opened.
    log(plan.undecided.length ? 'No automatic changes, so no pull request. Undecided: ' + plan.undecided.map((u) => u.repo).join(', ') : 'Nothing to propose.');
    return { action: 'none', plan };
  }
  if (o.dryRun) {
    log(`Dry run: would open or update a pull request.\n\n${body}\n${yaml}`);
    return { action: 'dry-run', plan, body, yaml };
  }

  // 4. Reuse the open reorg PR when there is one.
  const open: any[] = (await call('GET', `/repos/${o.org}/${repo}/pulls?state=open&base=${encodeURIComponent(base)}&per_page=100`)).json;
  const existing = open.find((p) => String(p.head?.ref).startsWith(BRANCH_PREFIX) && p.head.repo?.full_name === `${o.org}/${repo}`);
  const branch: string = existing ? existing.head.ref : `${BRANCH_PREFIX}${o.date ?? new Date().toISOString().slice(0, 10)}`;
  if (branch === base) throw new Error('Refusing to write to the default branch.');

  if (existing) {
    const cur = await call('GET', `/repos/${o.org}/${repo}/contents/${FILE}?ref=${encodeURIComponent(branch)}`, undefined, [404]);
    if (cur.status === 200 && unb64(cur.json.content) === yaml && (existing.body ?? '') === body) {
      log(`PR #${existing.number} is already up to date.`);
      return { action: 'unchanged', plan, branch, pr: existing.number, body, yaml };
    }
  }

  // 5. One commit on top of the default branch, written to the bot branch only.
  const headSha = (await call('GET', `/repos/${o.org}/${repo}/git/ref/heads/${base}`)).json.object.sha;
  const baseCommit = (await call('GET', `/repos/${o.org}/${repo}/git/commits/${headSha}`)).json;
  const blob = (await call('POST', `/repos/${o.org}/${repo}/git/blobs`, { content: b64(yaml), encoding: 'base64' })).json;
  const tree = (await call('POST', `/repos/${o.org}/${repo}/git/trees`, { base_tree: baseCommit.tree.sha, tree: [{ path: FILE, mode: '100644', type: 'blob', sha: blob.sha }] })).json;
  const commit = (await call('POST', `/repos/${o.org}/${repo}/git/commits`, { message: commitMessage(plan), tree: tree.sha, parents: [headSha] })).json;
  const refs = `/repos/${o.org}/${repo}/git/refs`;
  const upd = existing ? await call('PATCH', `${refs}/heads/${branch}`, { sha: commit.sha, force: true }) : { status: 404 };
  if (upd.status !== 200) await call('POST', refs, { ref: `refs/heads/${branch}`, sha: commit.sha });

  if (existing) {
    await call('PATCH', `/repos/${o.org}/${repo}/pulls/${existing.number}`, { title: commitMessage(plan), body });
    log(`Updated PR #${existing.number}.`);
    return { action: 'updated', plan, branch, pr: existing.number, body, yaml };
  }
  const pr = (await call('POST', `/repos/${o.org}/${repo}/pulls`, { title: commitMessage(plan), head: branch, base, body })).json;
  log(`Opened PR #${pr.number}: ${pr.html_url}`);
  return { action: 'created', plan, branch, pr: pr.number, body, yaml };
}
