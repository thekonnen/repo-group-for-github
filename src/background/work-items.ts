import { rateLimitPause } from '../core/index-sync';
import { chunkRepos, WORK_TTL_MS, type RepoWork, type WorkItem, type WorkMap } from '../core/work-items';
import type { Client } from './api';
import { aliasQuery, graphql } from './graphql';

export interface WorkResult {
  repos: WorkMap;
  /** Background work stopped at the rate limit floor: what is returned is cached data only. */
  paused?: { resumeAt: number | null };
}

export type WorkCache = Map<string, { at: number; work: RepoWork }>;
export const newWorkCache = (): WorkCache => new Map();

const list = (field: string, kind: 'issues' | 'pullRequests', depth: number) =>
  `${field}: ${kind}(states: OPEN, first: ${depth}, orderBy: {field: UPDATED_AT, direction: DESC}) { pageInfo { hasNextPage } nodes { number title url updatedAt ${kind === 'pullRequests' ? 'isDraft ' : ''}author { login } labels(first: 5) { nodes { name color } } } }`;
const fields = (depth: number) => `${list('i', 'issues', depth)} ${list('p', 'pullRequests', depth)}`;

const toItem = (repo: string, kind: 'issue' | 'pr', n: any): WorkItem => ({
  repo,
  kind,
  number: n.number,
  title: n.title,
  url: n.url,
  updatedAt: n.updatedAt,
  author: n.author?.login ?? null,
  labels: (n.labels?.nodes ?? []).map((l: any) => ({ name: l.name, color: l.color })),
  ...(kind === 'pr' && n.isDraft ? { draft: true } : {}),
});

/**
 * Open issues and pull requests of these repos (C1). GraphQL aliases, 50 repos per query, never one request per
 * repository. The Search API is not used: it allows 30 requests a minute and a few operators per query, so a
 * `repo:a repo:b …` filter cannot cover a group. Each repo answers with its newest `depth` items of each kind.
 * Cached in memory for 5 minutes per (org, repo, depth). At the rate limit floor nothing is requested.
 * Repos the user cannot open come back as null and are left out.
 */
export async function loadWorkItems(client: Client, cache: WorkCache, org: string, repos: string[], depth: number, opts: { now?: () => number } = {}): Promise<WorkResult> {
  const now = (opts.now ?? Date.now)();
  const out: WorkMap = {};
  const key = (n: string) => `${org}\n${n}\n${depth}`;
  const stale: string[] = [];
  for (const n of new Set(repos)) {
    const hit = cache.get(key(n));
    if (hit && now - hit.at < WORK_TTL_MS) out[n] = hit.work;
    else stale.push(n);
  }
  let paused: WorkResult['paused'];
  for (const group of chunkRepos(stale)) {
    const p = rateLimitPause(client.rate.remaining, client.rate.resetAt);
    if (p.paused) {
      paused = { resumeAt: p.resumeAt ? p.resumeAt.getTime() : null };
      break;
    }
    const { query, variables } = aliasQuery(group, fields(depth));
    const data = await graphql<Record<string, any>>(client, query, { o: org, ...variables });
    group.forEach((n, i) => {
      const r = data[`r${i}`];
      if (!r) return;
      const work: RepoWork = {
        issues: (r.i?.nodes ?? []).map((x: any) => toItem(n, 'issue', x)),
        prs: (r.p?.nodes ?? []).map((x: any) => toItem(n, 'pr', x)),
        moreIssues: !!r.i?.pageInfo?.hasNextPage,
        morePrs: !!r.p?.pageInfo?.hasNextPage,
      };
      cache.set(key(n), { at: now, work });
      out[n] = work;
    });
  }
  return paused ? { repos: out, paused } : { repos: out };
}
