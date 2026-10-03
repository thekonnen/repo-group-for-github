import type { RepoInfo } from './types';

export interface ActionIndexFile {
  /** Entries exactly as the Action wrote them. They may name repos this user cannot open: never show them unconfirmed. */
  repos: RepoInfo[];
  generatedAt: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Parses repo-index.json (the format written by design/actions/repo-index.yml):
 * `{ version: 1, org, generatedAt, total, repos: [{ name, description, language, private, archived, fork, pushedAt, stars, forks, openIssuesAndPrs }] }`.
 * `viewerIsAdmin` is never in the file. Returns null when the file is not usable (the caller falls back to the API index).
 */
export function parseActionIndex(data: unknown, org: string): ActionIndexFile | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || !Array.isArray(d.repos)) return null;
  if (typeof d.org === 'string' && d.org.toLowerCase() !== org.toLowerCase()) return null;
  const generatedAt = str(d.generatedAt);
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) return null;
  const seen = new Set<string>();
  const repos: RepoInfo[] = [];
  for (const raw of d.repos) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = str(r.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    repos.push({
      name,
      description: str(r.description) ?? '',
      language: str(r.language),
      languageColor: str(r.languageColor),
      private: !!r.private,
      archived: !!r.archived,
      fork: !!r.fork,
      pushedAt: str(r.pushedAt),
      stars: num(r.stars),
      forks: num(r.forks),
      openIssuesAndPrs: num(r.openIssuesAndPrs),
    });
  }
  return { repos, generatedAt };
}
