export type AccessLevel = 'owner' | 'editor' | 'member' | 'outside' | 'no-app';

export interface AccessProbe {
  /** `role` from GET /user/memberships/orgs/{org}; null when 404. */
  membershipRole: 'admin' | 'member' | null;
  /** `permissions.push` from GET /repos/{org}/.github; null when not readable. */
  pushOnDotGithub: boolean | null;
  /** The App is installed on the org (private org repos are returned). */
  appInstalled: boolean;
  /** `allow_forking` of <org>/.github when known. */
  allowForking?: boolean;
}

export interface Access {
  level: AccessLevel;
  /** Can commit to <org>/.github. */
  canWriteOrg: boolean;
  /** Org layer is shown at all (the file is readable). */
  hasOrgFile: boolean;
  /** Org-layer edits go through "Suggest change". */
  suggestMode: boolean;
  /** The editor flow (fork + Propose changes) can work; otherwise use the issue alternative. */
  canForkSuggest: boolean;
  /** Sync access rows are limited to repos where viewerIsAdmin. */
  syncNeedsRepoAdmin: boolean;
  publicOnly: boolean;
  /** The signed-in user's own account (not an organization): no teams. */
  personal?: boolean;
}

export function detectAccess(p: AccessProbe): Access {
  const readable = p.pushOnDotGithub !== null;
  let level: AccessLevel;
  if (!p.appInstalled) level = 'no-app';
  else if (p.membershipRole === 'admin') level = 'owner';
  else if (p.pushOnDotGithub === true) level = 'editor';
  else if (p.membershipRole === 'member') level = 'member';
  else level = 'outside';
  const canWriteOrg = level === 'owner' || level === 'editor';
  const hasOrgFile = readable && level !== 'outside';
  return {
    level,
    canWriteOrg,
    hasOrgFile,
    suggestMode: hasOrgFile && !canWriteOrg,
    canForkSuggest: p.allowForking !== false,
    syncNeedsRepoAdmin: level !== 'owner',
    publicOnly: level === 'no-app',
  };
}

/** Whether the user can apply a sync row. */
export const canApplyRow = (a: Access, viewerIsAdmin: boolean | undefined): boolean =>
  a.level === 'no-app' ? false : a.level === 'owner' || !!viewerIsAdmin;

/** Action-index entries are dropped until confirmed by the user's own API calls (F15 §5). */
export function confirmActionIndex<T extends { name: string }>(fromAction: T[], confirmedNames: Iterable<string>): T[] {
  const ok = new Set(confirmedNames);
  return fromAction.filter((r) => ok.has(r.name));
}

export const SUGGEST_ISSUE_LIMIT = 6000;

/** Prefilled new-issue URL, or null when the text does not fit. */
export function suggestIssueUrl(org: string, title: string, body: string): string | null {
  const url = `https://github.com/${org}/.github/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return body.length > SUGGEST_ISSUE_LIMIT ? null : url;
}

export const editorUrl = (org: string, branch: string): string => `https://github.com/${org}/.github/edit/${branch}/repo-groups.yml`;
