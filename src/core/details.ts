import type { RepoInfo } from './types';

/** Groups with more repositories than this keep the combined "Open issues & PRs" number (F14). */
export const DETAILS_MAX_REPOS = 200;
export const DETAILS_TTL_MS = 5 * 60 * 1000;

export interface RepoDetail {
  issues: number;
  prs: number;
}
export type DetailsMap = Record<string, RepoDetail>;

/** Split totals when details exist for ALL repos and the group is small enough; otherwise null. */
export function detailTotals(repos: Pick<RepoInfo, 'name'>[], details: DetailsMap): RepoDetail | null {
  if (!repos.length || repos.length > DETAILS_MAX_REPOS) return null;
  let issues = 0;
  let prs = 0;
  for (const r of repos) {
    const d = details[r.name];
    if (!d) return null;
    issues += d.issues;
    prs += d.prs;
  }
  return { issues, prs };
}
