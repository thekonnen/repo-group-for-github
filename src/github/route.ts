export type PageRoute = { kind: 'org-repos'; org: string };

/** Pages the extension takes over. Everything else is left alone (CLAUDE.md §9). */
export function routeOf(loc: { pathname: string }): PageRoute | null {
  const m = loc.pathname.match(/^\/orgs\/([A-Za-z0-9][A-Za-z0-9-_]*)\/repositories\/?$/);
  return m ? { kind: 'org-repos', org: m[1] } : null;
}

/** GitHub filter params: the user asked GitHub for a filter, so its list is shown first (F4). */
export function hasGithubFilter(search: string): boolean {
  const p = new URLSearchParams(search);
  return ['type', 'language', 'q'].some((k) => p.has(k));
}
