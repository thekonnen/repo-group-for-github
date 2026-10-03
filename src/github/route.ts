export type PageRoute = { kind: 'org-repos'; org: string } | { kind: 'team-repos'; org: string; team: string };

/** Pages the extension takes over. Everything else is left alone (CLAUDE.md §9). */
export function routeOf(loc: { pathname: string }): PageRoute | null {
  const m = loc.pathname.match(/^\/orgs\/([A-Za-z0-9][A-Za-z0-9-_]*)\/repositories\/?$/);
  if (m) return { kind: 'org-repos', org: m[1] };
  // F12: a team's repositories page.
  const t = loc.pathname.match(/^\/orgs\/([A-Za-z0-9][A-Za-z0-9-_]*)\/teams\/([A-Za-z0-9][A-Za-z0-9-_]*)\/repositories\/?$/);
  return t ? { kind: 'team-repos', org: t[1], team: t[2] } : null;
}

/** GitHub filter params: the user asked GitHub for a filter, so its list is shown first (F4). */
export function hasGithubFilter(search: string): boolean {
  const p = new URLSearchParams(search);
  return ['type', 'language', 'q'].some((k) => p.has(k));
}
