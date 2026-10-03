/** Pre-filled "Register a GitHub App" link (CLAUDE.md §6). Works for a personal account or an organization. */

export const APP_PERMISSIONS = {
  metadata: 'read', // mandatory on every App: listing
  contents: 'write', // only used on <org>/.github
  issues: 'read', // open counts
  pull_requests: 'read', // open counts
  administration: 'write', // F12: add teams to repositories (the sensitive one)
  members: 'read', // organization permission: list teams and their repositories
} as const;

export interface AppLinkOptions {
  /** Organization login; omit to register on the personal account. */
  org?: string;
  /** Must be unique across GitHub. */
  name?: string;
  homepage?: string;
}

export function appRegistrationUrl(opts: AppLinkOptions = {}): string {
  const base = opts.org
    ? `https://github.com/organizations/${encodeURIComponent(opts.org)}/settings/apps/new`
    : 'https://github.com/settings/apps/new';
  const p = new URLSearchParams({
    name: opts.name ?? 'Repository Group for Github',
    description: 'Organizes the repositories of a GitHub organization into groups and subgroups. No server: data stays in GitHub and in your browser.',
    url: opts.homepage ?? 'https://github.com/thekonnen/repo-group-for-github',
    public: 'true', // lets other accounts and orgs install it
    webhook_active: 'false',
    ...APP_PERMISSIONS,
  });
  return `${base}?${p.toString()}`;
}

/** Install page, once the App exists (members can request an install from here). */
export const appInstallUrl = (slug: string): string => `https://github.com/apps/${slug}/installations/new`;
