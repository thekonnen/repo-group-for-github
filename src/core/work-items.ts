import { DETAILS_MAX_REPOS } from './details';

/** C1: open issues and pull requests aggregated over the repos of a group. Pure: chunking, merging, sorting, filtering. */

/** Groups with more repositories than this ask for a narrower group (same limit as the split counts). */
export const WORK_MAX_REPOS = DETAILS_MAX_REPOS;
/** Repositories per GraphQL query. */
export const WORK_BATCH = 50;
/** Items fetched per repository and kind on the first load, and the step "Load more" deepens by. */
export const WORK_DEPTH_STEP = 20;
/** GitHub answers at most 100 nodes per connection. */
export const WORK_DEPTH_MAX = 100;
/** Rows shown at first and added by each "Load more". */
export const WORK_PAGE = 25;
export const WORK_TTL_MS = 5 * 60 * 1000;

export interface WorkLabel {
  name: string;
  color: string;
}

export interface WorkItem {
  repo: string;
  kind: 'issue' | 'pr';
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  author: string | null;
  labels: WorkLabel[];
  draft?: boolean;
}

/** What the background returns for one repository: the newest `depth` items of each kind and whether more exist. */
export interface RepoWork {
  issues: WorkItem[];
  prs: WorkItem[];
  moreIssues: boolean;
  morePrs: boolean;
}
export type WorkMap = Record<string, RepoWork>;
export type WorkKind = 'all' | 'issue' | 'pr';

const ms = (s: string) => Date.parse(s) || 0;
export const byUpdated = (a: WorkItem, b: WorkItem): number => ms(b.updatedAt) - ms(a.updatedAt) || a.repo.localeCompare(b.repo) || b.number - a.number;

/** Repository names in chunks of `size`, without duplicates. */
export function chunkRepos(names: string[], size = WORK_BATCH): string[][] {
  const uniq = [...new Set(names)];
  const out: string[][] = [];
  for (let i = 0; i < uniq.length; i += size) out.push(uniq.slice(i, i + size));
  return out;
}

/** Repositories whose answer was cut at the current depth: the ones "Load more" has to fetch deeper. */
export function reposWithMore(map: WorkMap): string[] {
  return Object.keys(map).filter((n) => map[n].moreIssues || map[n].morePrs);
}

/**
 * Merges the per-repo answers into one list, newest update first.
 * A repository that was cut only knows items back to its oldest fetched one, so anything older than the
 * newest of those cut-off points could be missing items from that repository. Those rows are held back
 * (`hidden`) until a deeper fetch; this keeps the order exact.
 */
export function mergeWork(map: WorkMap): { items: WorkItem[]; hidden: number; incomplete: boolean } {
  const all: WorkItem[] = [];
  let cutoff = -1;
  for (const r of Object.values(map)) {
    all.push(...r.issues, ...r.prs);
    if (r.moreIssues && r.issues.length) cutoff = Math.max(cutoff, ms(r.issues[r.issues.length - 1].updatedAt));
    if (r.morePrs && r.prs.length) cutoff = Math.max(cutoff, ms(r.prs[r.prs.length - 1].updatedAt));
  }
  all.sort(byUpdated);
  if (cutoff < 0) return { items: all, hidden: 0, incomplete: false };
  const items = all.filter((i) => ms(i.updatedAt) >= cutoff);
  return { items, hidden: all.length - items.length, incomplete: true };
}

/** The "All / Issues / Pull requests" filter and the search over repo, title, number, author and labels. */
export function filterWork(items: WorkItem[], kind: WorkKind, query: string): WorkItem[] {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  return items.filter((i) => {
    if (kind === 'issue' && i.kind !== 'issue') return false;
    if (kind === 'pr' && i.kind !== 'pr') return false;
    if (!q) return true;
    return (
      i.title.toLowerCase().includes(q) ||
      i.repo.toLowerCase().includes(q) ||
      String(i.number) === q ||
      (i.author ?? '').toLowerCase().includes(q) ||
      i.labels.some((l) => l.name.toLowerCase().includes(q))
    );
  });
}

export const workCounts = (items: WorkItem[]): { issues: number; prs: number } => ({
  issues: items.filter((i) => i.kind === 'issue').length,
  prs: items.filter((i) => i.kind === 'pr').length,
});

/** Next depth for a deeper fetch, or null at the GitHub limit. */
export const nextDepth = (depth: number): number | null => (depth >= WORK_DEPTH_MAX ? null : Math.min(WORK_DEPTH_MAX, depth + WORK_DEPTH_STEP));

/** Black or white text for a label color given as hex without "#". */
export function labelText(color: string): string {
  if (!/^[0-9a-f]{6}$/i.test(color)) return '#1f2328';
  const n = parseInt(color, 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#1f2328' : '#ffffff';
}
