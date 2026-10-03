import { APP_SLUG, GITHUB_CLIENT_ID } from '../config';
import { loadYamlParser, readConfig } from '../core/yaml-read';
import type { ConfigResult, ErrorInfo, OrgPrefs, OrgSnapshot, Progress, Request, Response } from '../github/messages';
import { createClient, explainTokenRejection, GitHubError, type FetchLike } from './api';
import { describeToken, loadAuth, pollDeviceFlow, publicAuth, saveAuth, signOut, startDeviceFlow } from './auth';
import type { KV } from './kv';
import { checkYaml, commitEdit, commitYaml, createDotGithub, EditError } from './commit';
import { discardPending, filePending, setPending } from './new-repo';
import { probeAccess, readOrgFile, type OrgFile } from './org-data';
import { refreshIndex, type IndexStore } from './repo-index';
import { refreshActionIndex } from './action-index';
import { loadDetails } from './details';

export interface Deps {
  fetch: FetchLike;
  kv: KV; // storage.local, background only
  index: IndexStore;
  session?: KV; // storage.session, background only (pending new repository)
  clientId?: string;
}

export function toErrorInfo(e: unknown): ErrorInfo {
  if (e instanceof GitHubError) {
    return { kind: e.kind, message: e.message, hint: explainTokenRejection(e.message) ?? undefined, resetAt: e.detail?.resetAt };
  }
  return { kind: e instanceof EditError ? 'edit' : 'other', message: e instanceof Error ? e.message : String(e) };
}

/** Pure request router so it can be tested with a fake fetch and in-memory storage. */
export function createHandler(deps: Deps) {
  const clientId = deps.clientId ?? GITHUB_CLIENT_ID;
  const client = createClient({ fetch: deps.fetch, getToken: async () => (await loadAuth(deps.kv))?.token ?? null });
  const FLOW_KEY = 'rg:device-flow';
  // The popup closes as soon as the user opens github.com/login/device, so the pending code lives here
  // and the popup resumes polling with it when it is opened again.
  const pendingFlow = async () => {
    const f = await deps.kv.get<{ deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresAt: number }>(FLOW_KEY);
    if (f && f.expiresAt > Date.now()) return f;
    if (f) await deps.kv.remove(FLOW_KEY);
    return undefined;
  };
  // The pending new-repo entry lives in storage.session (falls back to local storage in tests). filePending also
  // reads the org file cache, which is in local storage, so it gets a KV that routes by key.
  const session: KV = deps.session
    ? {
        get: (k) => (k.startsWith('rg:pending') ? deps.session! : deps.kv).get(k),
        set: (k, v) => (k.startsWith('rg:pending') ? deps.session! : deps.kv).set(k, v),
        remove: (k) => (k.startsWith('rg:pending') ? deps.session! : deps.kv).remove(k),
      }
    : deps.kv;
  const progress = new Map<string, Progress>();
  /** `index: action` in repo-groups.yml (read from the ETag cache when there is one). */
  const wantsActionIndex = async (org: string): Promise<boolean> => {
    try {
      const file = (await deps.kv.get<OrgFile>(`rg:file:${org}`)) ?? (await readOrgFile(client, deps.kv, org));
      if (!file.exists) return false;
      return readConfig(file.text, await loadYamlParser(), { org }).config?.index === 'action';
    } catch {
      return false;
    }
  };
  const tokenKind = async () => (await loadAuth(deps.kv))?.kind ?? 'oauth';

  async function handle(req: Request): Promise<unknown> {
    switch (req.type) {
      case 'auth:status':
        return { ...publicAuth(await loadAuth(deps.kv)), appSlug: APP_SLUG, flow: await pendingFlow() };
      case 'auth:start': {
        const d = await startDeviceFlow(deps.fetch, clientId);
        await deps.kv.set(FLOW_KEY, { deviceCode: d.deviceCode, userCode: d.userCode, verificationUri: d.verificationUri, interval: d.interval, expiresAt: Date.now() + d.expiresIn * 1000 });
        return { deviceCode: d.deviceCode, userCode: d.userCode, verificationUri: d.verificationUri, expiresIn: d.expiresIn, interval: d.interval };
      }
      case 'auth:poll': {
        const r = await pollDeviceFlow(deps.fetch, clientId, req.deviceCode, req.interval);
        if (r.state === 'error') await deps.kv.remove(FLOW_KEY);
        if (r.state !== 'done') return r;
        await deps.kv.remove(FLOW_KEY);
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
      {
        // Only repos and meta: entries of the Action index file that are not confirmed yet are never part of this.
        const snap = await deps.index.load(req.org);
        return (snap ? { repos: snap.repos, meta: snap.meta } : null) satisfies OrgSnapshot | null;
      }
      case 'org:refresh': {
        const publicOnly = !(await loadAuth(deps.kv));
        try {
          const opts = {
            force: req.force,
            concurrency: publicOnly ? 2 : 6,
            onProgress: (p: { loaded: number; estimatedTotal: number; phase?: 'action' }) => progress.set(req.org, { loaded: p.loaded, estimatedTotal: p.estimatedTotal, phase: p.phase }),
          };
          if (await wantsActionIndex(req.org)) return await refreshActionIndex(client, req.org, deps.index, { ...opts, publicOnly });
          return await refreshIndex(client, req.org, deps.index, opts);
        } finally {
          progress.delete(req.org);
        }
      }
      case 'org:details':
        return loadDetails(client, deps.kv, req.org, req.repos);
      case 'org:progress':
        return progress.get(req.org) ?? null;
      case 'org:config': {
        const file = req.cachedOnly ? await deps.kv.get<OrgFile>(`rg:file:${req.org}`) : await readOrgFile(client, deps.kv, req.org);
        if (!file) return null; // nothing cached yet
        if (!file.exists) return { exists: false } satisfies ConfigResult;
        const r = readConfig(file.text, await loadYamlParser(), { org: req.org });
        return { exists: true, sha: file.sha, config: r.config, error: r.error, line: r.line, warnings: r.warnings } satisfies ConfigResult;
      }
      case 'org:edit':
        return commitEdit(client, deps.kv, req.org, req.edit);
      case 'yaml:validate':
        return checkYaml(req.org, req.text);
      case 'org:apply-yaml':
        return commitYaml(client, deps.kv, req.org, req.text, req.baseSha, req.changes);
      case 'org:create-dotgithub':
        await createDotGithub(client, req.org);
        return { created: true };
      case 'newrepo:pending':
        await setPending(session, req.entry);
        return { saved: true };
      case 'newrepo:discard':
        await discardPending(session);
        return { discarded: true };
      case 'newrepo:landed':
        return filePending(client, session, req.org, req.repo);
      case 'prefs:get':
        return (await deps.kv.get<Partial<OrgPrefs>>(`rg:prefs:${req.org}`)) ?? {};
      case 'prefs:set': {
        const next = { ...(await deps.kv.get<Partial<OrgPrefs>>(`rg:prefs:${req.org}`)), ...req.prefs };
        await deps.kv.set(`rg:prefs:${req.org}`, next);
        return next;
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
