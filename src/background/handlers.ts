import { APP_SLUG, GITHUB_CLIENT_ID } from '../config';
import { loadYamlParser, readConfig } from '../core/yaml-read';
import type { Config } from '../core/types';
import type { ConfigResult, ErrorInfo, GroupSuggestion, OrgPrefs, SuggestMethod, OrgSnapshot, Progress, Request, Response, TeamsResult } from '../github/messages';
import { createClient, explainTokenRejection, GitHubError, type FetchLike } from './api';
import { describeToken, loadAuth, pollDeviceFlow, publicAuth, saveAuth, signOut, startDeviceFlow } from './auth';
import type { KV } from './kv';
import { commitEditWithLogo } from './commit-logo';
import { createLogoService, memoryLogoCache, type LogoCache, type Origins } from './logos';
import { hasPng, pngOf } from '../core/edit';
import { checkYaml, commitEdit, commitYaml, createDotGithub, EditError } from './commit';
import { discardPending, filePending, setPending } from './new-repo';
import { probeAccess, readOrgFile, type OrgFile } from './org-data';
import { clearCache, loadSettings, saveSettings, withinInterval } from './cache';
import { listOrgs } from './orgs';
import { ownerListPath, refreshIndex, type IndexStore } from './repo-index';
import { refreshActionIndex } from './action-index';
import { loadDetails } from './details';
import { loadWorkItems, newWorkCache } from './work-items';
import { cachedTeamSlugs, grantTeam, loadTeamAccess, loadTeams } from './teams-data';
import { teamSlugs } from '../core/teams';
import { postOrder } from '../core/placement';
import { suggest } from '../core/suggest';
import { askLlm, classifyPrompt, clearLlmConfig, configuredProviders, llmConfigured, llmOrigin, llmStatus, LlmError, loadLlmConfig, parseChoice, parseNewGroup, saveLlmConfig, setLlmAuto, setLlmFallback, type Provider } from './llm';

export interface Deps {
  fetch: FetchLike;
  kv: KV; // storage.local, background only
  index: IndexStore;
  session?: KV; // storage.session, background only (pending new repository)
  clientId?: string;
  now?: () => number;
  logos?: LogoCache; // blob SHA -> data URL (IndexedDB in the browser)
  origins?: Origins; // optional host permissions for logo links
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
  const logos = createLogoService({ client, fetch: deps.fetch, cache: deps.logos ?? memoryLogoCache(), origins: deps.origins });
  const workCache = newWorkCache();
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
  const fileLoads = new Map<string, Promise<OrgFile>>();
  const wantsActionIndex = async (org: string): Promise<boolean> => {
    try {
      // Never costs a request of its own: it reuses the org:config read that the page starts right before refreshing,
      // or the ETag cache.
      const file = (await fileLoads.get(org)) ?? (await deps.kv.get<OrgFile>(`rg:file:${org}`));
      if (!file || !file.exists) return false;
      return readConfig(file.text, await loadYamlParser(), { org }).config?.index === 'action';
    } catch {
      return false;
    }
  };
  const tokenKind = async () => (await loadAuth(deps.kv))?.kind ?? 'oauth';
  /** The signed-in user's own account (github.com/<login>), as opposed to an organization. */
  const isSelf = async (owner: string) => (await loadAuth(deps.kv))?.login?.toLowerCase() === owner.toLowerCase();

  /** Whether the browser has allowed requests to a provider's origin (an optional host permission asked in Options). */
  const canUseOrigin = async (origin: string) => !deps.origins || (await deps.origins.has(origin));
  /** New AI settings (provider, key, order, fallback): old answers and a pause no longer apply. */
  const resetAiState = async () => {
    await deps.kv.remove('rg:llm:cache');
    await deps.kv.remove('rg:llm:pause');
  };
  const llmDeps = () => ({ fetch: deps.fetch, kv: deps.kv, now: deps.now, canUse: canUseOrigin });

  // AI calls started by the page on its own are cheap on purpose: cached, shared, capped and paused on failure.
  const AUTO_PER_MINUTE = 6;
  const PAUSE_MS = 10 * 60_000;
  const CACHE_MAX = 50;
  const CACHE_TTL_MS = 60 * 60_000;
  const PAUSE_KEY = 'rg:llm:pause';
  const CACHE_KEY = 'rg:llm:cache';
  const autoRuns: number[] = [];
  const inflight = new Map<string, Promise<GroupSuggestion>>();
  const clock = () => (deps.now ?? Date.now)();
  const hash = (text: string) => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  type CachedAnswer = { key?: string | null; newGroup?: GroupSuggestion['newGroup']; model?: string; provider?: Provider; fallback?: boolean; none?: string };
  const loadCache = async () => (await deps.kv.get<{ k: string; at: number; v: CachedAnswer }[]>(CACHE_KEY)) ?? [];

  /** Asks the AI (cached by name + description + groups, one call at a time per question) and fills `out`. */
  async function askGroups(cfg: Config, org: string, repo: { name: string; description?: string | null }, out: GroupSuggestion, auto: boolean): Promise<GroupSuggestion> {
    const choices = postOrder(cfg.groups).map((n) => ({ key: n.key, title: n.group.title, description: n.group.description, keywords: n.group.keywords }));
    const prompt = classifyPrompt(choices, repo);
    // The cache is per question AND per way of answering: another primary provider, the fallback switched, or another
    // model must not be served an answer from a different setup.
    const cfgNow = await loadLlmConfig(deps.kv);
    const setup = [cfgNow?.primary, cfgNow?.fallback !== false, configuredProviders(cfgNow).join('+'), cfgNow?.custom?.model, cfgNow?.custom?.baseUrl].join('/');
    const cacheKey = [org, repo.name.toLowerCase(), repo.description ?? '', hash(JSON.stringify(choices)), hash(setup)].join('|');
    const answer = (a: CachedAnswer): GroupSuggestion => {
      if (a.key) return { ...out, source: 'llm', key: a.key, model: a.model, provider: a.provider, fallback: a.fallback };
      if (a.newGroup) return { ...out, source: 'uncertain', key: null, model: a.model, provider: a.provider, fallback: a.fallback, newGroup: a.newGroup };
      return { ...out, source: 'uncertain', key: null, model: a.model, provider: a.provider, fallback: a.fallback, llmError: `The AI found no fitting group (it answered: "${a.none ?? ''}").` };
    };

    const cached = (await loadCache()).find((e) => e.k === cacheKey && clock() - e.at < CACHE_TTL_MS);
    if (cached) return answer(cached.v);

    if (auto) {
      const pause = await deps.kv.get<number>(PAUSE_KEY);
      const now = clock();
      while (autoRuns.length && now - autoRuns[0] > 60_000) autoRuns.shift();
      if ((pause && pause > now) || autoRuns.length >= AUTO_PER_MINUTE) {
        return { ...out, source: 'uncertain', key: null, llmError: 'Automatic AI is paused for a few minutes to protect your quota. Click AI to try now.' };
      }
    }
    const running = inflight.get(cacheKey);
    if (running) return running;

    const run = (async (): Promise<GroupSuggestion> => {
      try {
        if (auto) autoRuns.push(clock());
        const { text, model, provider, fallback } = await askLlm({ ...llmDeps(), maxTries: auto ? 2 : undefined }, prompt);
        const key = parseChoice(text, choices.map((c) => c.key));
        const a: CachedAnswer = key ? { key, model, provider, fallback } : { model, provider, fallback, newGroup: parseNewGroup(text) ?? undefined, none: parseNewGroup(text) ? undefined : text.replace(/\s+/g, ' ').slice(0, 80) };
        const list = (await loadCache()).filter((e) => e.k !== cacheKey && clock() - e.at < CACHE_TTL_MS);
        await deps.kv.set(CACHE_KEY, [...list, { k: cacheKey, at: clock(), v: a }].slice(-CACHE_MAX));
        await deps.kv.remove(PAUSE_KEY); // it worked: automatic runs may resume
        return answer(a);
      } catch (e) {
        if (auto) await deps.kv.set(PAUSE_KEY, clock() + PAUSE_MS); // quota or outage: stop asking on our own for a while
        return { ...out, source: 'uncertain', key: null, llmError: e instanceof Error ? e.message : String(e) }; // an explicit AI request that fails must not look answered
      }
    })();
    inflight.set(cacheKey, run);
    try {
      return await run;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  /**
   * Without `method`: rules, then the local score, then the AI (only when the score is unsure and a key is set).
   * `keywords` runs the local score alone; `llm` asks the AI right away, whatever the score says.
   */
  async function suggestGroup(org: string, repo: { name: string; description?: string | null }, method?: SuggestMethod, auto = false): Promise<GroupSuggestion> {
    const file = await readOrgFile(client, deps.kv, org);
    const cfg = file.exists ? readConfig(file.text, await loadYamlParser(), { org }).config : undefined;
    if (!cfg) throw new Error(`${org} has no valid repo-groups.yml to classify against.`);
    const s = suggest(cfg.groups, repo);
    const out: GroupSuggestion = { source: s.source, key: s.key, rule: s.rule, score: s.score, margin: s.margin, ranking: s.ranking.slice(0, 3) };
    if (method === 'keywords') return out;
    if (method !== 'llm' && (s.source !== 'uncertain' || !llmConfigured(await loadLlmConfig(deps.kv)))) return out;
    return askGroups(cfg, org, repo, out, auto);
  }

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
        if (!req.force) {
          // Inside the refresh interval a visit costs no request: serve the cached snapshot.
          const cached = await deps.index.load(req.org);
          // An Action index still being confirmed is never served from here: the flow below resumes it.
          const confirming = !!(await deps.index.loadUnconfirmed?.(req.org));
          if (cached && !confirming && withinInterval(cached.meta, (await loadSettings(deps.kv)).refreshMinutes, (deps.now ?? Date.now)())) return { status: 'ok', mode: 'incremental', repos: cached.repos, meta: cached.meta };
        }
        try {
          const self = await isSelf(req.org);
          const opts = {
            listPath: self ? ownerListPath : undefined,
            force: req.force,
            now: deps.now,
            concurrency: publicOnly ? 2 : 6,
            onProgress: (p: { loaded: number; estimatedTotal: number; phase?: 'action' }) => progress.set(req.org, { loaded: p.loaded, estimatedTotal: p.estimatedTotal, phase: p.phase }),
          };
          if (!self && (await wantsActionIndex(req.org))) return await refreshActionIndex(client, req.org, deps.index, { ...opts, publicOnly });
          return await refreshIndex(client, req.org, deps.index, opts);
        } finally {
          progress.delete(req.org);
        }
      }
      case 'org:details':
        return loadDetails(client, deps.kv, req.org, req.repos);
      case 'org:work-items': {
        // Only repos of the user's own index: a name the user cannot open is never queried (F15 §5).
        const idx = await deps.index.load(req.org);
        const known = new Set((idx?.repos ?? []).map((r) => r.name));
        return loadWorkItems(client, workCache, req.org, req.repos.filter((n) => known.has(n)), req.depth, { now: deps.now });
      }
      case 'org:progress':
        return progress.get(req.org) ?? null;
      case 'org:config': {
        let fileP: Promise<OrgFile | undefined>;
        if (req.cachedOnly) fileP = deps.kv.get<OrgFile>(`rg:file:${req.org}`);
        else {
          const p = readOrgFile(client, deps.kv, req.org);
          fileLoads.set(req.org, p);
          p.then(() => undefined, () => undefined).then(() => fileLoads.get(req.org) === p && fileLoads.delete(req.org));
          fileP = p;
        }
        const file = await fileP;
        if (!file) return null; // nothing cached yet
        if (!file.exists) return { exists: false } satisfies ConfigResult;
        const load = await loadYamlParser();
        let r = readConfig(file.text, load, { org: req.org });
        // Unknown team slugs are only a warning. The team list is fetched when the file tags teams (cached, 5 min).
        if (r.config && teamSlugs(r.config.groups).length && !(await isSelf(req.org))) {
          const t = await loadTeams(client, deps.kv, req.org, { now: deps.now }).catch(() => null);
          if (t) r = readConfig(file.text, load, { org: req.org, knownTeams: t.teams.map((x) => x.slug) });
        }
        return { exists: true, sha: file.sha, config: r.config, error: r.error, line: r.line, warnings: r.warnings } satisfies ConfigResult;
      }
      case 'org:edit': {
        if (!hasPng(req.edit)) return commitEdit(client, deps.kv, req.org, req.edit);
        const r = await commitEditWithLogo(client, deps.kv, req.org, req.edit);
        const png = pngOf(req.edit);
        if (r.status === 'ok' && r.logoSha && png) {
          await logos.prime(req.org, r.logoSha, `data:image/png;base64,${png}`).catch(() => {});
        }
        return r;
      }
      case 'logos:get':
        return logos.load(req.org, req.srcs);
      case 'logo:fetch-link':
        return logos.fetchLink(req.url);
      case 'org:teams':
        if (await isSelf(req.org)) return { teams: [], customRoles: null } satisfies TeamsResult; // a personal account has no teams
        return loadTeams(client, deps.kv, req.org, { force: req.force, now: deps.now });
      case 'team:access':
        if (await isSelf(req.org)) return {};
        return loadTeamAccess(client, deps.kv, req.org, req.slugs, { force: req.force, now: deps.now });
      case 'team:grant':
        return grantTeam(client, deps.kv, req.org, req.team, req.repo, req.permission);
      case 'yaml:validate':
        return checkYaml(req.org, req.text, await cachedTeamSlugs(deps.kv, req.org));
      case 'org:apply-yaml':
        return commitYaml(client, deps.kv, req.org, req.text, req.baseSha, req.changes);
      case 'org:create-dotgithub':
        await createDotGithub(client, req.org, await isSelf(req.org));
        return { created: true };
      case 'newrepo:pending':
        await setPending(session, req.entry);
        return { saved: true };
      case 'newrepo:discard':
        await discardPending(session);
        return { discarded: true };
      case 'newrepo:landed':
        return filePending(client, session, req.org, req.repo, deps.index);
      case 'prefs:get':
        return (await deps.kv.get<Partial<OrgPrefs>>(`rg:prefs:${req.org}`)) ?? {};
      case 'prefs:set': {
        const next = { ...(await deps.kv.get<Partial<OrgPrefs>>(`rg:prefs:${req.org}`)), ...req.prefs };
        await deps.kv.set(`rg:prefs:${req.org}`, next);
        return next;
      }
      case 'orgs:list': {
        const auth = await loadAuth(deps.kv);
        if (!auth) return { orgs: [], fetchedAt: 0 };
        return listOrgs(client, deps.kv, { minutes: (await loadSettings(deps.kv)).refreshMinutes, now: (deps.now ?? Date.now)(), user: auth.login, force: req.force });
      }
      case 'cache:clear':
        return clearCache(deps.kv, deps.index, deps.logos);
      case 'settings:get':
        return loadSettings(deps.kv);
      case 'settings:set':
        return saveSettings(deps.kv, req.settings);
      case 'llm:status':
        return llmStatus(deps.kv);
      case 'llm:save': {
        const status = await saveLlmConfig(deps.kv, req.config);
        await resetAiState();
        // the Options page asks for the browser permission right before saving; check it took
        const origin = llmOrigin({ mode: req.config.mode === 'custom' ? 'custom' : 'gemini', baseUrl: (await loadLlmConfig(deps.kv))?.custom?.baseUrl });
        if (origin && !(await canUseOrigin(origin))) throw new LlmError(`The browser has not allowed requests to ${origin.replace('/*', '')}. Save again and accept the prompt.`);
        return status;
      }
      case 'llm:auto':
        return setLlmAuto(deps.kv, req.auto);
      case 'llm:fallback': {
        const status = await setLlmFallback(deps.kv, req.fallback);
        await resetAiState();
        return status;
      }
      case 'llm:clear': {
        const status = await clearLlmConfig(deps.kv, req.mode);
        await resetAiState();
        return status;
      }
      case 'llm:test': {
        // one provider on its own (no fallback), so a failure says which one is wrong
        const { model, provider } = await askLlm({ ...llmDeps(), only: req.mode }, 'Reply with the single word OK.');
        return { model, provider };
      }
      case 'suggest:group':
        return suggestGroup(req.org, req.repo, req.method, req.auto);
      case 'org:file':
        return readOrgFile(client, deps.kv, req.org);
      case 'org:access':
        return probeAccess(client, req.org, (await tokenKind()) as 'oauth' | 'pat', await isSelf(req.org));
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
