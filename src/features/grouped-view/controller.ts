import { ago } from '../../core/time';
import { buildHash, parseHash } from '../../core/layers';
import type { IndexMeta } from '../../core/index-sync';
import type { RepoInfo } from '../../core/types';
import { defaultExpanded, memoTree, type TreeModel } from '../../core/tree';
import { hasGithubFilter } from '../../github/route';
import { CallError, type Call } from '../../github/client';
import type { ConfigResult, ErrorInfo, OrgPrefs, OrgSnapshot, Progress } from '../../github/messages';
import { createStore, type Store } from '../store';

export interface SignIn {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  error?: string;
}

export interface State {
  org: string;
  phase: 'loading' | 'signed-out' | 'ready';
  signIn: SignIn | null;
  repos: RepoInfo[];
  meta: IndexMeta | null;
  indexVersion: number;
  config: ConfigResult | null;
  refresh: { state: 'idle' | 'running' | 'paused'; progress: Progress | null; resumeAt: number | null };
  error: ErrorInfo | null;
  path: string[];
  view: 'grouped' | 'list';
  expanded: Set<string>;
  expandedTouched: boolean;
  tab: 'items' | 'ungrouped' | 'rules';
  query: string;
}

export interface Env {
  call: Call;
  location: Pick<Location, 'pathname' | 'search' | 'hash'>;
  history: Pick<History, 'pushState'>;
  open: (url: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export type Controller = ReturnType<typeof createController>;

const infoOf = (e: unknown): ErrorInfo => (e instanceof CallError ? e.info : { kind: 'other', message: e instanceof Error ? e.message : String(e) });

export function createController(org: string, env: Env) {
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const store: Store<State> = createStore<State>({
    org,
    phase: 'loading',
    signIn: null,
    repos: [],
    meta: null,
    indexVersion: 0,
    config: null,
    refresh: { state: 'idle', progress: null, resumeAt: null },
    error: null,
    path: parseHash(env.location.hash).layer === 'org' ? parseHash(env.location.hash).path : [],
    view: hasGithubFilter(env.location.search) ? 'list' : 'grouped',
    expanded: new Set(),
    expandedTouched: false,
    tab: 'items',
    query: '',
  });
  let disposed = false;
  let prefsTimer: ReturnType<typeof setTimeout> | undefined;

  const savePrefs = (prefs: Partial<OrgPrefs>) => {
    env.call({ type: 'prefs:set', org, prefs }).catch(() => {});
  };

  /** Tree for the current data; placement is memoized per (config sha, index version). */
  function model(): TreeModel | null {
    const s = store.get();
    if (!s.config) return null;
    const groups = s.config.exists && s.config.config ? s.config.config.groups : [];
    return memoTree(s.config.exists ? s.config.sha : null, `${s.org}:${s.indexVersion}`, groups, s.repos);
  }

  function applyDefaults() {
    const s = store.get();
    if (s.expandedTouched) return;
    const m = model();
    if (m) store.set({ expanded: defaultExpanded(m) });
  }

  async function loadCached() {
    const [snap, cfg] = await Promise.all([
      env.call<OrgSnapshot | null>({ type: 'org:cached', org }).catch(() => null),
      env.call<ConfigResult | null>({ type: 'org:config', org, cachedOnly: true }).catch(() => null),
    ]);
    if (snap) store.set({ repos: snap.repos, meta: snap.meta, indexVersion: store.get().indexVersion + 1 });
    if (cfg) store.set({ config: cfg });
    applyDefaults();
    return !!snap;
  }

  async function pollProgress() {
    while (store.get().refresh.state === 'running' && !disposed) {
      const p = await env.call<Progress | null>({ type: 'org:progress', org }).catch(() => null);
      if (store.get().refresh.state === 'running') store.set({ refresh: { ...store.get().refresh, progress: p } });
      await sleep(500);
    }
  }

  async function refresh(force = false) {
    if (store.get().refresh.state === 'running') return;
    store.set({ refresh: { state: 'running', progress: null, resumeAt: null }, error: null });
    void pollProgress();
    const cfgP = env.call<ConfigResult>({ type: 'org:config', org }).then((config) => store.set({ config }), (e) => store.set({ error: infoOf(e) }));
    try {
      const r = await env.call<any>({ type: 'org:refresh', org, force });
      if (r.status === 'paused') store.set({ refresh: { state: 'paused', progress: null, resumeAt: r.resumeAt ? Date.parse(r.resumeAt) : null } });
      else store.set({ repos: r.repos, meta: r.meta, indexVersion: store.get().indexVersion + 1, refresh: { state: 'idle', progress: null, resumeAt: null } });
    } catch (e) {
      const info = infoOf(e);
      if (info.kind === 'auth') store.set({ phase: 'signed-out' });
      else store.set({ error: info });
      if (store.get().refresh.state === 'running') store.set({ refresh: { state: 'idle', progress: null, resumeAt: null } });
    }
    await cfgP;
    applyDefaults();
  }

  async function init() {
    const prefs = await env.call<Partial<OrgPrefs>>({ type: 'prefs:get', org }).catch(() => ({}) as Partial<OrgPrefs>);
    if (prefs.expanded) store.set({ expanded: new Set(prefs.expanded), expandedTouched: true });
    if (!hasGithubFilter(env.location.search) && prefs.view) store.set({ view: prefs.view });
    const auth = await env.call<{ signedIn: boolean }>({ type: 'auth:status' }).catch(() => ({ signedIn: false }));
    if (disposed) return;
    if (!auth.signedIn) return void store.set({ phase: 'signed-out' });
    store.set({ phase: 'ready' });
    await loadCached();
    await refresh();
  }

  async function startSignIn() {
    try {
      const d = await env.call<SignIn & { expiresIn: number }>({ type: 'auth:start' });
      const flow: SignIn = { deviceCode: d.deviceCode, userCode: d.userCode, verificationUri: d.verificationUri, interval: d.interval };
      store.set({ signIn: flow });
      void pollSignIn(flow, Date.now() + d.expiresIn * 1000);
    } catch (e) {
      store.set({ signIn: { deviceCode: '', userCode: '', verificationUri: '', interval: 5, error: infoOf(e).message } });
    }
  }

  async function pollSignIn(flow: SignIn, deadline: number) {
    let interval = flow.interval;
    while (!disposed && store.get().signIn?.deviceCode === flow.deviceCode && Date.now() < deadline) {
      await sleep(interval * 1000);
      if (disposed || store.get().signIn?.deviceCode !== flow.deviceCode) return;
      try {
        const r = await env.call<any>({ type: 'auth:poll', deviceCode: flow.deviceCode, interval });
        if (r.state === 'pending') interval = r.interval;
        else if (r.state === 'error') return void store.set({ signIn: { ...flow, error: r.message } });
        else {
          store.set({ signIn: null, phase: 'ready' });
          await loadCached();
          await refresh();
          return;
        }
      } catch (e) {
        return void store.set({ signIn: { ...flow, error: infoOf(e).message } });
      }
    }
  }

  return {
    store,
    model,
    init,
    refresh,
    startSignIn,
    openVerification: (s: SignIn) => env.open(`${s.verificationUri}?user_code=${encodeURIComponent(s.userCode)}`),
    dispose() {
      disposed = true;
      clearTimeout(prefsTimer);
    },
    /** Hash changes (also back/forward): #infra/dagu. */
    syncHash() {
      const r = parseHash(env.location.hash);
      const path = r.layer === 'org' ? r.path : [];
      const m = model();
      const known = !m || !path.length || m.byKey.has(path.join('/'));
      store.set({ path: known ? path : [], tab: 'items', query: '' });
    },
    go(path: string[]) {
      const hash = buildHash({ layer: 'org', path });
      env.history.pushState(null, '', env.location.pathname + env.location.search + hash);
      const wasList = store.get().view !== 'grouped';
      store.set({ path, tab: 'items', query: '', view: 'grouped' });
      if (wasList) savePrefs({ view: 'grouped' });
    },
    setView(view: 'grouped' | 'list') {
      store.set({ view });
      savePrefs({ view });
    },
    toggleGroup(key: string) {
      const expanded = new Set(store.get().expanded);
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      store.set({ expanded, expandedTouched: true });
      clearTimeout(prefsTimer);
      prefsTimer = setTimeout(() => savePrefs({ expanded: [...expanded] }), 300);
    },
    setTab: (tab: State['tab']) => store.set({ tab, query: '' }),
    setQuery: (query: string) => store.set({ query }),
    updatedText: (meta: IndexMeta | null) => (meta?.lastIncrementalSync ? ago(meta.lastIncrementalSync) : ''),
  };
}
