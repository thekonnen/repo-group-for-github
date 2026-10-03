import { APP_SLUG, GITHUB_CLIENT_ID } from '../config';
import type { ErrorInfo, OrgSnapshot, Request, Response } from '../github/messages';
import { createClient, explainTokenRejection, GitHubError, type FetchLike } from './api';
import { describeToken, loadAuth, pollDeviceFlow, publicAuth, saveAuth, signOut, startDeviceFlow } from './auth';
import type { KV } from './kv';
import { probeAccess, readOrgFile } from './org-data';
import { refreshIndex, type IndexStore } from './repo-index';

export interface Deps {
  fetch: FetchLike;
  kv: KV; // storage.local, background only
  index: IndexStore;
  clientId?: string;
}

export function toErrorInfo(e: unknown): ErrorInfo {
  if (e instanceof GitHubError) {
    return { kind: e.kind, message: e.message, hint: explainTokenRejection(e.message) ?? undefined, resetAt: e.detail?.resetAt };
  }
  return { kind: 'other', message: e instanceof Error ? e.message : String(e) };
}

/** Pure request router so it can be tested with a fake fetch and in-memory storage. */
export function createHandler(deps: Deps) {
  const clientId = deps.clientId ?? GITHUB_CLIENT_ID;
  const client = createClient({ fetch: deps.fetch, getToken: async () => (await loadAuth(deps.kv))?.token ?? null });
  const tokenKind = async () => (await loadAuth(deps.kv))?.kind ?? 'oauth';

  async function handle(req: Request): Promise<unknown> {
    switch (req.type) {
      case 'auth:status':
        return { ...publicAuth(await loadAuth(deps.kv)), appSlug: APP_SLUG };
      case 'auth:start': {
        const d = await startDeviceFlow(deps.fetch, clientId);
        return { deviceCode: d.deviceCode, userCode: d.userCode, verificationUri: d.verificationUri, expiresIn: d.expiresIn, interval: d.interval };
      }
      case 'auth:poll': {
        const r = await pollDeviceFlow(deps.fetch, clientId, req.deviceCode, req.interval);
        if (r.state !== 'done') return r;
        const who = await describeToken(deps.fetch, r.token);
        await saveAuth(deps.kv, { token: r.token, kind: 'oauth', ...who });
        return { state: 'done', ...publicAuth(await loadAuth(deps.kv)) };
      }
      case 'auth:pat': {
        const token = req.token.trim();
        const who = await describeToken(deps.fetch, token);
        await saveAuth(deps.kv, { token, kind: 'pat', ...who });
        return publicAuth(await loadAuth(deps.kv));
      }
      case 'auth:signout':
        await signOut(deps.kv);
        return publicAuth(undefined);
      case 'org:cached':
        return (await deps.index.load(req.org)) satisfies OrgSnapshot | null;
      case 'org:refresh': {
        const publicOnly = !(await loadAuth(deps.kv));
        return refreshIndex(client, req.org, deps.index, { force: req.force, concurrency: publicOnly ? 2 : 6 });
      }
      case 'org:file':
        return readOrgFile(client, deps.kv, req.org);
      case 'org:access':
        return probeAccess(client, req.org, (await tokenKind()) as 'oauth' | 'pat');
    }
  }

  return async (req: Request): Promise<Response> => {
    try {
      return { ok: true, data: await handle(req) };
    } catch (e) {
      return { ok: false, error: toErrorInfo(e) };
    }
  };
}
