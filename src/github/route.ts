export type PageRoute =
  | { kind: 'org-repos'; org: string }
  /** A user profile's Repositories tab, /<login>?tab=repositories. Taken over only on the signed-in user's own profile. */
  | { kind: 'user-repos'; owner: string }
  /** Create a new repository. `org` is null on /new, where the Owner dropdown decides. */
  | { kind: 'new-repo'; org: string | null }
  /** A repository's home page: where the pending new-repo entry is filed (F9). */
  | { kind: 'repo'; org: string; repo: string }
  /** F12: a team's repositories page. */
  | { kind: 'team-repos'; org: string; team: string };

const RESERVED = new Set(['orgs', 'organizations', 'new', 'settings', 'login', 'logout', 'join', 'signup', 'notifications', 'explore', 'topics', 'search', 'pulls', 'issues', 'marketplace', 'sponsors', 'features', 'apps', 'collections', 'codespaces', 'enterprises', 'users', 'about', 'pricing', 'dashboard', 'copilot', 'trending', 'orgs', 'account', 'sessions', 'password_reset']);

/** Pages the extension takes over. Everything else is left alone (CLAUDE.md §9). */
export function routeOf(loc: { pathname: string; search?: string }): PageRoute | null {
  const p = loc.pathname;
  const m = p.match(/^\/orgs\/([A-Za-z0-9][A-Za-z0-9-_]*)\/repositories\/?$/);
  if (m) return { kind: 'org-repos', org: m[1] };
  const n = p.match(/^\/organizations\/([A-Za-z0-9][A-Za-z0-9-_]*)\/repositories\/new\/?$/);
  if (n) return { kind: 'new-repo', org: n[1] };
  if (/^\/new\/?$/.test(p)) return { kind: 'new-repo', org: null };
  const t = p.match(/^\/orgs\/([A-Za-z0-9][A-Za-z0-9-_]*)\/teams\/([A-Za-z0-9][A-Za-z0-9-_]*)\/repositories\/?$/);
  if (t) return { kind: 'team-repos', org: t[1], team: t[2] };
  const u = p.match(/^\/([A-Za-z0-9][A-Za-z0-9-_]*)\/?$/);
  if (u && !RESERVED.has(u[1].toLowerCase()) && new URLSearchParams(loc.search ?? '').get('tab') === 'repositories') return { kind: 'user-repos', owner: u[1] };
  const r = p.match(/^\/([A-Za-z0-9][A-Za-z0-9-_]*)\/([A-Za-z0-9._-]+)\/?$/);
  if (r && !RESERVED.has(r[1].toLowerCase())) return { kind: 'repo', org: r[1], repo: r[2] };
  return null;
}

/** GitHub filter params: the user asked GitHub for a filter, so its list is shown first (F4). */
export function hasGithubFilter(search: string): boolean {
  const p = new URLSearchParams(search);
  return ['type', 'language', 'q'].some((k) => p.has(k));
}
