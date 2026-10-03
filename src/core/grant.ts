/** Why a team could not be given access to a repository (F12, §6). Pure: the background maps HTTP errors with this. */
export type GrantErrorKind = 'admin' | 'validation' | 'permissions' | 'rate-limit' | 'other';

export interface GrantFailure {
  ok: false;
  kind: GrantErrorKind;
  message: string;
  /** Extra text for the row, e.g. the permissions GitHub expected. */
  detail?: string;
}

export type GrantResult = { ok: true } | GrantFailure;

export const installationsUrl = (org: string): string => `https://github.com/organizations/${org}/settings/installations`;

export const ADMIN_MESSAGE = 'You need admin access to this repository — ask an org owner';
export const permissionsMessage = (org: string): string =>
  `Repository Group for Github needs new permissions in ${org}. An org owner must accept the update in Settings → GitHub Apps.`;

/**
 * 403/404 are normally "you are not an admin of this repository". "Resource not accessible by integration" is what GitHub
 * answers when the installation still has the old permissions (an org owner has not accepted the update yet).
 * 422 carries GitHub's own explanation.
 */
export function classifyGrantError(e: { status: number; kind: string; message: string; acceptedPermissions?: string }, org: string): GrantFailure {
  const detail = e.acceptedPermissions ? `GitHub expected: ${e.acceptedPermissions}` : undefined;
  if ((e.status === 403 || e.status === 404) && /not accessible by integration/i.test(e.message)) return { ok: false, kind: 'permissions', message: permissionsMessage(org), detail };
  if (e.kind === 'rate-limit') return { ok: false, kind: 'rate-limit', message: e.message, detail };
  if (e.status === 403 || e.status === 404) return { ok: false, kind: 'admin', message: ADMIN_MESSAGE, detail };
  if (e.status === 422 || e.status === 409) return { ok: false, kind: 'validation', message: e.message, detail };
  return { ok: false, kind: 'other', message: e.message, detail };
}
