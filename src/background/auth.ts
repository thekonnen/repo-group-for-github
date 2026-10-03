import { explainTokenRejection, GitHubError, type FetchLike } from './api';
import type { KV } from './kv';

const TOKEN_KEY = 'rg:auth';

export interface Auth {
  token: string;
  kind: 'oauth' | 'pat';
  login?: string;
  avatarUrl?: string;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type PollResult =
  | { state: 'pending'; interval: number }
  | { state: 'done'; token: string }
  | { state: 'error'; reason: 'expired' | 'denied' | 'other'; message: string };

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const JSON_FORM = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };

/** Step 1: ask GitHub for a user code. Background worker only (no CORS for web pages). */
export async function startDeviceFlow(fetch: FetchLike, clientId: string): Promise<DeviceCode> {
  if (!clientId) throw new Error('The GitHub App client id is not set in src/config.ts.');
  const res = await fetch('https://github.com/login/device/code', { method: 'POST', headers: JSON_FORM, body: form({ client_id: clientId }) });
  const j = await res.json();
  if (!res.ok || j.error) {
    const hint = j.error === 'device_flow_disabled' ? ' Enable "Device Flow" in the GitHub App settings.' : '';
    throw new Error((j.error_description || j.error || `HTTP ${res.status}`) + hint);
  }
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_uri, expiresIn: j.expires_in, interval: j.interval ?? 5 };
}

/**
 * Step 2, one request per call. The popup calls this every `interval` seconds, so nothing depends on
 * the MV3 service worker staying alive between polls. Handles authorization_pending and slow_down.
 */
export async function pollDeviceFlow(fetch: FetchLike, clientId: string, deviceCode: string, interval: number): Promise<PollResult> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: JSON_FORM,
    body: form({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });
  const j = await res.json();
  if (j.access_token) return { state: 'done', token: j.access_token };
  switch (j.error) {
    case 'authorization_pending':
      return { state: 'pending', interval };
    case 'slow_down':
      return { state: 'pending', interval: typeof j.interval === 'number' ? j.interval : interval + 5 };
    case 'expired_token':
      return { state: 'error', reason: 'expired', message: 'The code expired. Start the sign-in again.' };
    case 'access_denied':
      return { state: 'error', reason: 'denied', message: 'Sign-in was cancelled on GitHub.' };
    default:
      return { state: 'error', reason: 'other', message: j.error_description || j.error || `HTTP ${res.status}` };
  }
}

export async function saveAuth(kv: KV, auth: Auth): Promise<void> {
  await kv.set(TOKEN_KEY, auth);
}
export const loadAuth = (kv: KV): Promise<Auth | undefined> => kv.get<Auth>(TOKEN_KEY);
export const signOut = (kv: KV): Promise<void> => kv.remove(TOKEN_KEY);

/** Fills login and avatar for a token (also validates a pasted personal access token). */
export async function describeToken(fetch: FetchLike, token: string): Promise<{ login: string; avatarUrl: string }> {
  const res = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  if (!res.ok) {
    // Org policy errors (SAML SSO, blocked token types) carry a message the UI turns into advice (F15).
    let msg = '';
    try {
      msg = String((await res.json())?.message ?? '');
    } catch {}
    if (explainTokenRejection(msg)) throw new GitHubError(res.status, res.status === 403 ? 'forbidden' : 'auth', msg);
    throw new Error(res.status === 401 ? 'GitHub rejected this token.' : `GitHub answered ${res.status}.`);
  }
  const u = await res.json();
  return { login: u.login, avatarUrl: u.avatar_url };
}

/** What the UI may show about the signed-in state; never includes the token. */
export const publicAuth = (a: Auth | undefined) => (a ? { signedIn: true, kind: a.kind, login: a.login, avatarUrl: a.avatarUrl } : { signedIn: false as const });
