import { classifyGrantError, type GrantResult } from '../core/grant';
import { rateLimitPause } from '../core/index-sync';
import { labelBody, labelKey, milestoneBody, type ExistingMap, type RepoLabelState } from '../core/labels';
import { runPool } from '../core/pool';
import type { LabelTag, MilestoneTag } from '../core/types';
import { GitHubError, type Client } from './api';

const CONCURRENCY = 3;
const MAX_PAGES = 20;

export interface LabelStateResult {
  state: ExistingMap;
  /** Repositories whose labels or milestones could not be read, with the reason. They are left out of the plan. */
  failed: { repo: string; message: string }[];
  /** Reading stopped because the rate limit is nearly used up. */
  paused?: { resumeAt?: string; message: string };
}

const hhmm = (d?: Date) => (d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : 'later');
export const pausedMessage = (resumeAt?: Date): string => `Paused to respect GitHub's rate limit — resumes at ${hhmm(resumeAt)}`;

/** Every page of a list endpoint (100 per page). */
async function listAll(client: Client, path: string): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client.rest(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const items: any[] = Array.isArray(res.data) ? res.data : [];
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

/** `GET /repos/{org}/{repo}/labels` and `…/milestones?state=all` of one repository. Read only. */
export async function readRepoLabelState(client: Client, org: string, repo: string): Promise<RepoLabelState> {
  const base = `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
  const labels = await listAll(client, `${base}/labels`);
  const milestones = await listAll(client, `${base}/milestones?state=all`);
  const l: Record<string, string> = {};
  for (const x of labels) if (x?.name) l[labelKey(x.name)] = String(x.color ?? '').toLowerCase();
  return { labels: l, milestones: milestones.filter((m) => m?.title).map((m) => labelKey(m.title)) };
}

/** Reads the state of many repositories, 3 at a time, stopping early when the rate limit is nearly gone. */
export async function readLabelStates(client: Client, org: string, repos: string[]): Promise<LabelStateResult> {
  const state: ExistingMap = {};
  const failed: LabelStateResult['failed'] = [];
  let paused: LabelStateResult['paused'];
  await runPool([...new Set(repos)], CONCURRENCY, async (repo) => {
    const p = rateLimitPause(client.rate.remaining, client.rate.resetAt);
    if (p.paused || paused) {
      paused ??= { resumeAt: p.resumeAt?.toISOString(), message: pausedMessage(p.resumeAt) };
      return;
    }
    try {
      state[repo] = await readRepoLabelState(client, org, repo);
    } catch (e) {
      failed.push({ repo, message: e instanceof GitHubError ? (e.kind === 'forbidden' || e.kind === 'not-found' ? 'Could not read this repository’s labels (no access).' : e.message) : String(e) });
    }
  });
  return { state, failed, ...(paused ? { paused } : {}) };
}

async function post(client: Client, org: string, repo: string, path: 'labels' | 'milestones', body: unknown): Promise<GrantResult> {
  const p = rateLimitPause(client.rate.remaining, client.rate.resetAt);
  if (p.paused) return { ok: false, kind: 'rate-limit', message: pausedMessage(p.resumeAt) };
  try {
    await client.rest(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/${path}`, { method: 'POST', body });
  } catch (e) {
    if (e instanceof GitHubError) {
      const accepted = e.detail?.acceptedPermissions;
      if (accepted) console.debug('[RG] add failed; GitHub expected permissions:', accepted, `${path} -> ${repo}`);
      return classifyGrantError({ status: e.status, kind: e.kind, message: e.message, acceptedPermissions: accepted }, org);
    }
    throw e;
  }
  return { ok: true };
}

/** `POST /repos/{org}/{repo}/labels`. Creates only; an existing label is never updated (GitHub answers 422). */
export const addLabel = (client: Client, org: string, repo: string, label: LabelTag): Promise<GrantResult> => post(client, org, repo, 'labels', labelBody(label));

/** `POST /repos/{org}/{repo}/milestones`. Creates only. */
export const addMilestone = (client: Client, org: string, repo: string, m: MilestoneTag): Promise<GrantResult> => post(client, org, repo, 'milestones', milestoneBody(m));
