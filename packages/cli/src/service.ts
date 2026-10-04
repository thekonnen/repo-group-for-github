import { load } from 'js-yaml';
import { GitHubError, type Client } from '../../../src/background/api';
import { decodeBase64Utf8, encodeBase64Utf8 } from '../../../src/background/org-data';
import { toRepoInfo } from '../../../src/background/repo-index';
import { diffTrees, type DiffResult } from '../../../src/core/diff';
import { applyEdit, finalName } from '../../../src/core/edit';
import { isExact } from '../../../src/core/glob';
import { findGroup, flatList } from '../../../src/core/placement';
import { suggest } from '../../../src/core/suggest';
import { allRepos, buildTree, nodeAt, type GroupNode } from '../../../src/core/tree';
import type { Config, Group, RepoInfo } from '../../../src/core/types';
import { readConfig } from '../../../src/core/yaml-read';
import { writeConfig } from '../../../src/core/yaml-write';

/** An error with text meant for the person (or agent) running the command. */
export class CliError extends Error {}

export interface Ctx {
  client: Client;
  org: string;
}

const FILE = 'repo-groups.yml';
const enc = encodeURIComponent;
const header = (org: string) => `${org}/.github/${FILE}`;
const EMPTY: Config = { version: 1, index: 'api', groups: [] };
const loader = (t: string) => load(t);

export const parsePath = (s: string): string[] => s.split('/').map((p) => p.trim()).filter(Boolean);

export interface Remote {
  text: string;
  sha: string | null;
  config: Config;
}

/** Wraps GitHub failures in plain language. Never includes the token. */
function friendly(e: unknown, org: string): never {
  if (e instanceof GitHubError) {
    if (e.kind === 'auth') throw new CliError('GitHub rejected the token (401). Check GITHUB_TOKEN.');
    if (/protected branch|branch protection|required status|review is required|changes must be made through a pull request/i.test(e.message))
      throw new CliError(`The default branch of ${org}/.github is protected, so a direct commit is not possible. Edit the file through a pull request.`);
    if (e.kind === 'forbidden' || e.kind === 'not-found')
      throw new CliError(`GitHub denied access to ${org}/.github (${e.status}: ${e.message}). The token needs Contents read/write on that repository.`);
    throw new CliError(`GitHub error ${e.status}: ${e.message}`);
  }
  throw e;
}

export async function fetchRemote(ctx: Ctx): Promise<Remote> {
  let res;
  try {
    res = await ctx.client.rest(`/repos/${enc(ctx.org)}/.github/contents/${FILE}`, { allow404: true });
  } catch (e) {
    return friendly(e, ctx.org);
  }
  if (res.status === 404) return { text: '', sha: null, config: structuredClone(EMPTY) };
  const text = decodeBase64Utf8(res.data.content ?? '');
  const r = readConfig(text, loader, { org: ctx.org });
  if (!r.config) throw new CliError(`${header(ctx.org)} has a problem: ${r.error}. Fix the file on GitHub first.`);
  return { text, sha: res.data.sha, config: r.config };
}

/** Every repository the token can see in the org (REST, 100 per page). */
export async function listAllRepos(ctx: Ctx): Promise<RepoInfo[]> {
  const out: RepoInfo[] = [];
  for (let page = 1; page <= 200; page++) {
    let res;
    try {
      res = await ctx.client.rest<any[]>(`/orgs/${enc(ctx.org)}/repos?type=all&sort=pushed&direction=desc&per_page=100&page=${page}`);
    } catch (e) {
      return friendly(e, ctx.org);
    }
    const rows = res.data ?? [];
    out.push(...rows.map(toRepoInfo));
    if (rows.length < 100) break;
  }
  return out;
}

// ---------- read-only operations ----------

export interface GroupRow {
  path: string;
  depth: number;
  repos: number;
  direct: number;
  subgroups: number;
  description: string;
  rules: string[];
}

export async function listGroups(ctx: Ctx) {
  const [remote, repos] = await Promise.all([fetchRemote(ctx), listAllRepos(ctx)]);
  const model = buildTree(remote.config.groups, repos);
  const groups: GroupRow[] = flatList(remote.config.groups).map((n) => {
    const node = nodeAt(model, n.path)!;
    return { path: n.key, depth: n.depth, repos: node.total, direct: node.repos.length, subgroups: node.subgroups, description: n.group.description, rules: n.group.match };
  });
  return { org: ctx.org, fileExists: remote.sha !== null, repositories: model.visible, ungrouped: model.root.repos.length, groups };
}

export interface RepoRow {
  name: string;
  group: string;
  private: boolean;
  language: string | null;
  pushedAt: string | null;
  description: string;
}

const row = (r: RepoInfo, group: string): RepoRow => ({
  name: r.name,
  group,
  private: !!r.private,
  language: r.language ?? null,
  pushedAt: r.pushedAt ?? null,
  description: r.description ?? '',
});

export async function listRepos(ctx: Ctx, opts: { ungrouped?: boolean; group?: string; limit?: number } = {}) {
  const [remote, repos] = await Promise.all([fetchRemote(ctx), listAllRepos(ctx)]);
  const model = buildTree(remote.config.groups, repos);
  let rows: RepoRow[];
  if (opts.group) {
    const node = nodeAt(model, parsePath(opts.group));
    if (!node || !node.key) throw new CliError(`There is no group "${opts.group}" in ${header(ctx.org)}.`);
    rows = allRepos(node).map((r) => row(r, model.placed.get(r.name) ?? ''));
  } else if (opts.ungrouped) {
    rows = model.root.repos.map((r) => row(r, ''));
  } else {
    rows = repos.filter((r) => !r.archived).map((r) => row(r, model.placed.get(r.name) ?? ''));
  }
  const total = rows.length;
  if (opts.limit && opts.limit > 0) rows = rows.slice(0, opts.limit);
  return { org: ctx.org, total, repos: rows };
}

export async function showGroup(ctx: Ctx, path: string) {
  const [remote, repos] = await Promise.all([fetchRemote(ctx), listAllRepos(ctx)]);
  const model = buildTree(remote.config.groups, repos);
  const node: GroupNode | null = nodeAt(model, parsePath(path));
  if (!node || !node.key) throw new CliError(`There is no group "${path}" in ${header(ctx.org)}.`);
  const g = node.group;
  return {
    path: node.key,
    title: g.title ?? null,
    description: g.description,
    keywords: g.keywords ?? [],
    logo: g.logo,
    teams: g.teams,
    rules: g.match,
    subgroups: g.groups.map((c) => c.name),
    reposDirect: node.repos.map((r) => r.name),
    reposTotal: node.total,
  };
}

export async function suggestRepos(ctx: Ctx, opts: { limit?: number } = {}) {
  const [remote, repos] = await Promise.all([fetchRemote(ctx), listAllRepos(ctx)]);
  const model = buildTree(remote.config.groups, repos);
  const all = model.root.repos.map((r) => {
    const s = suggest(remote.config.groups, r);
    return {
      name: r.name,
      description: r.description ?? '',
      suggested: s.key,
      source: s.source,
      score: Number(s.score.toFixed(3)),
      alternatives: s.ranking.slice(0, 3).map((c) => c.key),
    };
  });
  return { org: ctx.org, ungrouped: all.length, suggestions: opts.limit && opts.limit > 0 ? all.slice(0, opts.limit) : all };
}

export interface ValidateResult {
  valid: boolean;
  source: 'file' | 'remote';
  error?: string;
  line?: number | null;
  warnings: string[];
  groups?: number;
  fencesRemoved?: boolean;
}

/** Validates the given YAML text, or the file on GitHub when none is given. */
export async function validate(ctx: Ctx, yaml?: string): Promise<ValidateResult> {
  let text = yaml;
  if (text === undefined) {
    let res;
    try {
      res = await ctx.client.rest(`/repos/${enc(ctx.org)}/.github/contents/${FILE}`, { allow404: true });
    } catch (e) {
      return friendly(e, ctx.org);
    }
    if (res.status === 404) throw new CliError(`${header(ctx.org)} does not exist yet.`);
    text = decodeBase64Utf8(res.data.content ?? '');
  }
  const source = yaml === undefined ? 'remote' : 'file';
  const r = readConfig(text, loader, { org: ctx.org });
  if (!r.config) return { valid: false, source, error: r.error, line: r.line ?? null, warnings: r.warnings };
  return { valid: true, source, warnings: r.warnings, groups: flatList(r.config.groups).length, fencesRemoved: !!r.stripped };
}

// ---------- changes (dry-run unless apply) ----------

export type Change =
  | { kind: 'move-repo'; repo: string; group: string }
  | { kind: 'add-rule'; group: string; rule: string }
  | { kind: 'create-group'; path: string; description?: string }
  | { kind: 'apply-file'; yaml: string };

const mustExist = (groups: Group[], path: string[], what: string, org: string): Group => {
  const g = path.length ? findGroup(groups, path) : null;
  if (!g) throw new CliError(`There is no group "${what}" in ${header(org)}. Create it first (create-group).`);
  return g;
};

const eachGroup = (groups: Group[], fn: (g: Group) => void) => groups.forEach((g) => (fn(g), eachGroup(g.groups, fn)));

interface Planned {
  config: Config;
  message: string | ((changes: number) => string);
  warnings: string[];
}

function plan(change: Change, base: Config, repos: RepoInfo[], org: string): Planned {
  const next: Config = structuredClone(base);
  switch (change.kind) {
    case 'move-repo': {
      const repo = repos.find((r) => r.name.toLowerCase() === change.repo.toLowerCase());
      if (!repo) throw new CliError(`The token cannot see a repository named "${change.repo}" in ${org}.`);
      const path = parsePath(change.group);
      const target = mustExist(next.groups, path, change.group, org);
      const lower = repo.name.toLowerCase();
      // An exact name always wins (5.3): take it out of every other group, then list it in the target.
      eachGroup(next.groups, (g) => {
        if (g !== target) g.match = g.match.filter((m) => !(isExact(m) && m.toLowerCase() === lower));
      });
      if (!target.match.some((m) => isExact(m) && m.toLowerCase() === lower)) target.match.push(repo.name);
      return { config: next, message: `chore(repo-groups): file ${repo.name} in ${path.join('/')}`, warnings: [] };
    }
    case 'add-rule': {
      const rule = change.rule.trim();
      if (!rule || /[\s,;]/.test(rule)) throw new CliError('A rule is one repository name or a pattern with *, without spaces or commas.');
      const path = parsePath(change.group);
      const target = mustExist(next.groups, path, change.group, org);
      if (!target.match.some((m) => m.toLowerCase() === rule.toLowerCase())) target.match.push(rule);
      return { config: next, message: `chore(repo-groups): add rule ${rule} to ${path.join('/')}`, warnings: [] };
    }
    case 'create-group': {
      const path = parsePath(change.path);
      if (!path.length) throw new CliError('Give the group path, for example infra/dagsrv.');
      const name = path[path.length - 1];
      if (!name || finalName(name) !== name) throw new CliError(`"${name}" is not a valid group name. Use lowercase letters, numbers, - _ or .`);
      const parent = path.slice(0, -1);
      if (parent.length) mustExist(next.groups, parent, parent.join('/'), org);
      const r = applyEdit(next.groups, { kind: 'new', parent, name, description: change.description ?? '', match: [] });
      if ('error' in r) throw new CliError(r.error);
      return { config: { ...next, groups: r.groups }, message: `chore(repo-groups): add ${parent.length ? 'subgroup' : 'group'} ${path.join('/')}`, warnings: [] };
    }
    case 'apply-file': {
      const r = readConfig(change.yaml, loader, { org });
      if (!r.config) throw new CliError(`The YAML has a problem: ${r.error}`);
      return { config: r.config, message: (n) => `chore(repo-groups): apply YAML edit (${n} change${n === 1 ? '' : 's'})`, warnings: r.warnings };
    }
  }
}

export interface ChangeResult {
  org: string;
  /** true only when a commit was made. */
  applied: boolean;
  dryRun: boolean;
  /** The resulting file is identical to the current one. */
  noChange: boolean;
  message: string;
  diff: DiffResult;
  warnings: string[];
  yaml: string;
  commit?: string | null;
}

export async function runChange(ctx: Ctx, change: Change, opts: { apply?: boolean } = {}): Promise<ChangeResult> {
  const repos = await listAllRepos(ctx);
  let firstText: string | null = null;
  for (let attempt = 0; ; attempt++) {
    const remote = await fetchRemote(ctx);
    firstText ??= remote.text;
    // A whole-file replacement was reviewed against one version: never overwrite someone else's newer edit.
    if (change.kind === 'apply-file' && remote.text !== firstText) throw new CliError('The file changed on GitHub since it was read. Review the diff again and re-run.');
    const p = plan(change, remote.config, repos, ctx.org);
    const diff = diffTrees(remote.config.groups, p.config.groups, repos);
    const yaml = writeConfig(p.config, header(ctx.org));
    const message = typeof p.message === 'function' ? p.message(diff.items.length) : p.message;
    const noChange = remote.sha !== null && yaml === writeConfig(remote.config, header(ctx.org));
    const base: ChangeResult = { org: ctx.org, applied: false, dryRun: !opts.apply, noChange, message, diff, warnings: p.warnings, yaml };
    if (!opts.apply || noChange) return base;
    try {
      const res = await ctx.client.rest(`/repos/${enc(ctx.org)}/.github/contents/${FILE}`, {
        method: 'PUT',
        body: { message, content: encodeBase64Utf8(yaml), ...(remote.sha ? { sha: remote.sha } : {}) },
      });
      return { ...base, applied: true, dryRun: false, commit: res.data?.commit?.sha ?? null };
    } catch (e) {
      if (e instanceof GitHubError && e.kind === 'validation') {
        if (attempt > 0) throw new CliError('The file changed on GitHub while saving. Run the command again.');
        continue; // refetch the file and re-apply the same change, once (7)
      }
      return friendly(e, ctx.org);
    }
  }
}

/** Diff of a YAML text against the file on GitHub. Never writes. */
export async function diffYaml(ctx: Ctx, yaml: string) {
  const r = await runChange(ctx, { kind: 'apply-file', yaml }, { apply: false });
  return { org: ctx.org, noChange: r.noChange, diff: r.diff, warnings: r.warnings };
}
