export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ErrorKind = 'auth' | 'rate-limit' | 'sso' | 'forbidden' | 'not-found' | 'validation' | 'network' | 'other';

export class GitHubError extends Error {
  constructor(
    public status: number,
    public kind: ErrorKind,
    message: string,
    public detail?: { acceptedPermissions?: string; ssoUrl?: string; resetAt?: number },
  ) {
    super(message);
  }
}

export interface RateState {
  remaining: number | null;
  resetAt: number | null; // epoch seconds
}

export interface RestResult<T = any> {
  status: number;
  data: T;
  headers: Headers;
  notModified: boolean;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  etag?: string;
  /** Accept 404 as a normal answer (returned with status 404, data null). */
  allow404?: boolean;
  /** Overrides the Accept header (e.g. the raw media type for files over 1 MB). */
  accept?: string;
}

const API = 'https://api.github.com';

/** Tells a member why the org rejected their token (F15). Returns null when the message is not a known policy error. */
export function explainTokenRejection(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes('saml')) return 'This organization requires SAML SSO. Authorize the token for SSO in your GitHub token settings, then try again.';
  if (m.includes('forbids access via a personal access token (classic)'))
    return 'This organization blocks classic personal access tokens. Use a fine-grained token with the organization as resource owner, or sign in with GitHub.';
  if (m.includes('forbids access via a fine-grained personal access tokens') || m.includes('fine-grained personal access token'))
    return 'This organization does not allow this fine-grained token yet. Ask an owner to approve it, or sign in with GitHub.';
  return null;
}

export function createClient(deps: { fetch: FetchLike; getToken: () => Promise<string | null>; version?: string }) {
  const rate: RateState = { remaining: null, resetAt: null };

  async function rest<T = any>(path: string, opts: RequestOptions = {}): Promise<RestResult<T>> {
    const token = await deps.getToken();
    const headers: Record<string, string> = {
      Accept: opts.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': deps.version ?? '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.etag) headers['If-None-Match'] = opts.etag;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await deps.fetch(path.startsWith('http') ? path : API + path, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new GitHubError(0, 'network', 'Could not reach GitHub. Check your connection.');
    }
    const rem = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (rem != null) rate.remaining = Number(rem);
    if (reset != null) rate.resetAt = Number(reset);

    if (res.status === 304) return { status: 304, data: null as T, headers: res.headers, notModified: true };
    if (res.ok) {
      const text = res.status === 204 ? '' : await res.text();
      return { status: res.status, data: (text ? JSON.parse(text) : null) as T, headers: res.headers, notModified: false };
    }
    if (res.status === 404 && opts.allow404) return { status: 404, data: null as T, headers: res.headers, notModified: false };

    let message = res.statusText || `HTTP ${res.status}`;
    try {
      message = (await res.json()).message ?? message;
    } catch {}
    const accepted = res.headers.get('x-accepted-github-permissions') ?? undefined;
    if (accepted) console.debug('[RG] expected permissions:', accepted, path);
    const sso = res.headers.get('x-github-sso');
    if (res.status === 401) throw new GitHubError(401, 'auth', 'Your GitHub sign-in expired. Sign in again.');
    if (res.status === 403 || res.status === 429) {
      if (rate.remaining === 0 || /rate limit/i.test(message)) throw new GitHubError(res.status, 'rate-limit', message, { resetAt: rate.resetAt ?? undefined });
      if (sso) throw new GitHubError(403, 'sso', message, { ssoUrl: /url=([^;\s]+)/.exec(sso)?.[1] });
      throw new GitHubError(403, 'forbidden', message, { acceptedPermissions: accepted });
    }
    if (res.status === 404) throw new GitHubError(404, 'not-found', message, { acceptedPermissions: accepted });
    if (res.status === 409 || res.status === 422) throw new GitHubError(res.status, 'validation', message);
    throw new GitHubError(res.status, 'other', message);
  }

  return { rest, rate };
}

export type Client = ReturnType<typeof createClient>;
