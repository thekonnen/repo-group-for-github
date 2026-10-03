import type { FetchLike } from '../src/background/api';

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> };
export type Route = (url: URL, call: Call) => Reply | undefined;

/** Fake fetch with route handlers; records calls and the max number of requests in flight. */
export function fakeFetch(...routes: Route[]) {
  const calls: Call[] = [];
  let inflight = 0;
  const stats = { maxInflight: 0 };
  const fetch: FetchLike = async (input, init) => {
    const call: Call = { url: input, method: init?.method ?? 'GET', headers: (init?.headers as Record<string, string>) ?? {}, body: init?.body as string | undefined };
    calls.push(call);
    inflight++;
    stats.maxInflight = Math.max(stats.maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 1));
    inflight--;
    const url = new URL(input);
    for (const r of routes) {
      const rep = r(url, call);
      if (rep) {
        const status = rep.status ?? 200;
        return new Response(status === 204 || status === 304 ? null : JSON.stringify(rep.json ?? {}), { status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4000', ...rep.headers } });
      }
    }
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  };
  return { fetch, calls, stats };
}

export const rawRepo = (i: number, pushedAt: string, extra: Record<string, unknown> = {}) => ({
  name: `repo-${i}`,
  description: `desc ${i}`,
  language: 'TypeScript',
  private: i % 2 === 0,
  archived: false,
  fork: false,
  pushed_at: pushedAt,
  stargazers_count: i,
  forks_count: 0,
  open_issues_count: 1,
  permissions: { admin: i % 10 === 0 },
  ...extra,
});

/** An org with `n` repos, newest first (repo-0 is the newest), 100 per page, with a Link header. */
export function orgReposRoute(org: string, repos: () => any[]): Route {
  return (url) => {
    if (url.pathname !== `/orgs/${org}/repos`) return undefined;
    const page = Number(url.searchParams.get('page') ?? 1);
    const all = repos();
    const last = Math.max(1, Math.ceil(all.length / 100));
    const link = last > 1 ? `<https://api.github.com/orgs/${org}/repos?type=all&per_page=100&page=${last}>; rel="last"` : '';
    const headers: Record<string, string> = link ? { link } : {};
    return { json: all.slice((page - 1) * 100, page * 100), headers };
  };
}

/** `n` repos pushed 1 minute apart, newest first, ending at `newest`. */
export const makeRepos = (n: number, newest = Date.parse('2026-01-10T12:00:00Z')) =>
  Array.from({ length: n }, (_, i) => rawRepo(i, new Date(newest - i * 60000).toISOString()));
