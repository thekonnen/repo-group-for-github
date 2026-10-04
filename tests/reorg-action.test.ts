import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { run } from '../src/action/reorg-run';
import { commitMessage, planReorg, prBody } from '../src/core/reorg';
import { placement } from '../src/core/placement';
import { readConfig } from '../src/core/yaml-read';
import { writeConfig } from '../src/core/yaml-write';
import type { Config, RepoInfo } from '../src/core/types';
// @ts-expect-error plain .mjs build script
import { buildAction } from '../scripts/build-action.mjs';

const YAML = `version: 1
groups:
  - name: infra
    description: "Cloud infrastructure, backups and S3 storage"
    keywords: ["s3", "backup", "terraform"]
    match: ["infra-*", "old-backup"]
  - name: ai
    description: "Machine learning and LLM tools"
    keywords: ["llm", "gpt", "embedding"]
    match: ["ai-*"]
`;
const cfg = (text = YAML): Config => readConfig(text, (t) => load(t)).config!;
const repo = (name: string, description = '', archived = false): RepoInfo => ({ name, description, archived });

const repos = [
  repo('infra-core'),
  repo('ai-chat'),
  repo('terraform-s3-backup', 'Terraform module for S3 backup buckets'),
  repo('zzz-lunch-menu', 'Weekly cafeteria menu'),
  repo('archived-thing', 'Terraform backup', true),
];

describe('planReorg', () => {
  const plan = planReorg(cfg(), repos);

  it('files a new repo only when the suggestion is confident', () => {
    expect(plan.additions.map((a) => [a.repo, a.group])).toEqual([['terraform-s3-backup', 'infra']]);
    expect(plan.undecided.map((u) => u.repo)).toEqual(['zzz-lunch-menu']);
  });

  it('ignores archived repositories', () => {
    expect(plan.additions.concat([]).some((a) => a.repo === 'archived-thing')).toBe(false);
    expect(plan.undecided.some((u) => u.repo === 'archived-thing')).toBe(false);
  });

  it('proposes removing exact names whose repository is gone, but keeps archived ones and patterns', () => {
    expect(plan.removals).toEqual([{ name: 'old-backup', group: 'infra' }]);
    const kept = planReorg(cfg(), [...repos, repo('old-backup', '', true)]);
    expect(kept.removals).toEqual([]);
    expect(plan.config.groups[0].match).toEqual(['infra-*', 'terraform-s3-backup']);
  });

  it('counts changes and keeps the original tree untouched', () => {
    const original = cfg();
    const p = planReorg(original, repos);
    expect(p.changes).toBe(2);
    expect(original.groups[0].match).toEqual(['infra-*', 'old-backup']);
    expect(commitMessage(p)).toBe('chore(repo-groups): propose reorganization (2 changes)');
  });

  it('is idempotent: planning on the result proposes nothing more', () => {
    const again = planReorg(plan.config, repos);
    expect(again.changes).toBe(0);
    expect(again.additions).toEqual([]);
    expect(again.removals).toEqual([]);
    // The undecided one stays undecided until a human acts.
    expect(again.undecided.map((u) => u.repo)).toEqual(['zzz-lunch-menu']);
    // And the written file round-trips to the same tree.
    const text = writeConfig(plan.config, 'o/.github/repo-groups.yml');
    expect(placement(cfg(text).groups, repos)['terraform-s3-backup']).toBe('infra');
  });

  it('proposes nothing for a tidy org', () => {
    const p = planReorg(cfg(), [repo('infra-core'), repo('ai-chat'), repo('old-backup')]);
    expect(p.changes).toBe(0);
    expect(p.undecided).toEqual([]);
  });
});

describe('prBody', () => {
  const body = prBody(planReorg(cfg(), repos), 'acme');

  it('lists + − ~ → lines and the human-decision section', () => {
    expect(body).toContain('## Changes (2)');
    expect(body).toContain('`+` `terraform-s3-backup` added to `infra`');
    expect(body).toContain('`−` `old-backup` removed from `infra`');
    expect(body).toContain('`~` Rules of infra');
    expect(body).toContain('`→` `terraform-s3-backup` ungrouped → infra');
    expect(body).toContain('## Needs a human decision (1)');
    expect(body).toContain('`zzz-lunch-menu`: Weekly cafeteria menu');
  });

  it('is stable for the same input', () => {
    expect(prBody(planReorg(cfg(), repos), 'acme')).toBe(body);
  });
});

/** A tiny GitHub: the file, the org repos, branches and PRs held in memory. */
function fakeGitHub(opts: { file: string; repos: any[]; openPr?: { number: number; ref: string; body: string }; branchFile?: string }) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const f = (async (url: string, init: any = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = u.pathname;
    calls.push({ method, path, body });
    const ok = (json: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(json), { status, headers });
    if (path === '/repos/acme/.github' && method === 'GET') return ok({ default_branch: 'main' });
    if (path === '/repos/acme/.github/contents/repo-groups.yml') {
      if (u.searchParams.get('ref') === 'main') return ok({ content: b64(opts.file) });
      return opts.branchFile ? ok({ content: b64(opts.branchFile) }) : ok({ message: 'Not Found' }, 404);
    }
    if (path === '/orgs/acme/repos') return ok(opts.repos);
    if (path === '/repos/acme/.github/pulls' && method === 'GET')
      return ok(opts.openPr ? [{ number: opts.openPr.number, body: opts.openPr.body, head: { ref: opts.openPr.ref, repo: { full_name: 'acme/.github' } } }] : []);
    if (path === '/repos/acme/.github/git/ref/heads/main') return ok({ object: { sha: 'h1' } });
    if (path === '/repos/acme/.github/git/commits/h1') return ok({ tree: { sha: 't0' } });
    if (path.endsWith('/git/blobs')) return ok({ sha: 'b1' }, 201);
    if (path.endsWith('/git/trees')) return ok({ sha: 't1' }, 201);
    if (path.endsWith('/git/commits')) return ok({ sha: 'c1' }, 201);
    if (path.endsWith('/git/refs')) return ok({}, 201);
    if (path.includes('/git/refs/heads/')) return ok({});
    if (path === '/repos/acme/.github/pulls' && method === 'POST') return ok({ number: 7, html_url: 'https://github.com/acme/.github/pull/7' }, 201);
    if (path.startsWith('/repos/acme/.github/pulls/') && method === 'PATCH') return ok({});
    return ok({ message: 'Not Found' }, 404);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const rawRepos = repos.map((r) => ({ name: r.name, description: r.description, archived: r.archived }));
const base = { org: 'acme', token: 't', date: '2026-10-05', log: () => {} };
const writes = (calls: { method: string; path: string; body?: any }[]) => calls.filter((c) => c.method !== 'GET');

describe('run', () => {
  it('opens a PR from repo-groups/reorg-<date> and never touches the default branch', async () => {
    const gh = fakeGitHub({ file: YAML, repos: rawRepos });
    const r = await run({ ...base, fetch: gh.f });
    expect(r).toMatchObject({ action: 'created', branch: 'repo-groups/reorg-2026-10-05', pr: 7 });
    const w = writes(gh.calls);
    expect(w.some((c) => c.method === 'PATCH' && c.path.endsWith('/refs/heads/main'))).toBe(false);
    expect(w.some((c) => c.method === 'DELETE')).toBe(false);
    const ref = w.find((c) => c.path.endsWith('/git/refs'))!;
    expect(ref.body.ref).toBe('refs/heads/repo-groups/reorg-2026-10-05');
    expect(w.find((c) => c.path.endsWith('/git/commits'))!.body.message).toBe('chore(repo-groups): propose reorganization (2 changes)');
    expect(w.find((c) => c.path.endsWith('/pulls'))!.body.body).toContain('Needs a human decision');
  });

  it('does nothing when there are no changes', async () => {
    const gh = fakeGitHub({ file: YAML, repos: [repo('infra-core'), repo('ai-chat'), repo('old-backup')].map((r) => ({ name: r.name, description: '', archived: false })) });
    const r = await run({ ...base, fetch: gh.f });
    expect(r.action).toBe('none');
    expect(writes(gh.calls)).toEqual([]);
  });

  it('dry run writes nothing', async () => {
    const gh = fakeGitHub({ file: YAML, repos: rawRepos });
    const r = await run({ ...base, dryRun: true, fetch: gh.f });
    expect(r.action).toBe('dry-run');
    expect(r.yaml).toContain('terraform-s3-backup');
    expect(writes(gh.calls)).toEqual([]);
  });

  it('updates the open PR instead of opening another, and is idempotent', async () => {
    const first = await run({ ...base, dryRun: true, fetch: fakeGitHub({ file: YAML, repos: rawRepos }).f });
    const stale = fakeGitHub({ file: YAML, repos: rawRepos, openPr: { number: 3, ref: 'repo-groups/reorg-2026-09-28', body: 'old' }, branchFile: 'old' });
    const r = await run({ ...base, fetch: stale.f });
    expect(r).toMatchObject({ action: 'updated', pr: 3, branch: 'repo-groups/reorg-2026-09-28' });
    const w = writes(stale.calls);
    expect(w.find((c) => c.path.endsWith('/refs/heads/repo-groups/reorg-2026-09-28'))!.body.force).toBe(true);
    expect(w.some((c) => c.method === 'POST' && c.path.endsWith('/pulls'))).toBe(false);

    const same = fakeGitHub({ file: YAML, repos: rawRepos, openPr: { number: 3, ref: 'repo-groups/reorg-2026-09-28', body: first.body! }, branchFile: first.yaml });
    const again = await run({ ...base, fetch: same.f });
    expect(again.action).toBe('unchanged');
    expect(writes(same.calls)).toEqual([]);
  });

  it('aborts when the token sees no repositories', async () => {
    const gh = fakeGitHub({ file: YAML, repos: [] });
    await expect(run({ ...base, fetch: gh.f })).rejects.toThrow(/no repositories/);
    expect(writes(gh.calls)).toEqual([]);
  });
});

describe('design/actions/reorg.mjs', () => {
  it('is in sync with src (run `npm run build:action`)', async () => {
    expect(readFileSync(new URL('../design/actions/reorg.mjs', import.meta.url), 'utf8')).toBe(await buildAction());
  }, 60000);

  it('the workflow template calls the script and exposes dry_run', () => {
    const t = readFileSync(new URL('../design/actions/repo-groups-reorg.yml', import.meta.url), 'utf8');
    expect(t).toContain('REPO_GROUPS_TOKEN');
    expect(t).toContain('workflow_dispatch');
    expect(t).toContain('cron:');
    expect(t).toContain('.github/scripts/reorg.mjs');
  });
});
