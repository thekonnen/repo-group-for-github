import { ago } from '../../core/time';
import { buildHash, parseHash } from '../../core/layers';
import type { IndexMeta } from '../../core/index-sync';
import type { Access } from '../../core/access';
import { editLogoPath, finalName, moveRepos as planMoves, type MovePlan, pngOf, type Edit } from '../../core/edit';
import type { Group } from '../../core/types';
import { writeConfig } from '../../core/yaml-write';
import { proposeForkGroups, withForkGroups, type ForkProposal } from '../../core/fork-groups';
import type { RepoInfo } from '../../core/types';
import { defaultExpanded, memoTree, SORT_KEYS, type SortKey, type TreeModel } from '../../core/tree';
import { hasGithubFilter } from '../../github/route';
import { CallError, type Call } from '../../github/client';
import type { ConfigResult, ErrorInfo, OrgPrefs, OrgSnapshot, Progress } from '../../github/messages';
import { DETAILS_MAX_REPOS, type DetailsMap } from '../../core/details';
import { createLogoStore } from '../logos/logo-store';
import { createStore, type Store } from '../store';
import { createTeamsController } from '../teams/teams-controller';
import { createMembersController } from '../members/members-controller';

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
  tab: 'items' | 'ungrouped' | 'rules' | 'all' | 'members';
  sort: SortKey;
  query: string;
  access: Access | null;
  /** Separate open issue / PR counts (F14), loaded lazily for small groups. */
  details: DetailsMap;
  drawer: { mode: 'edit' | 'new'; path: string[]; focus?: 'logo' } | null;
  yaml: { text: string } | null;
  toast: { text: string; kind: 'ok' | 'error' } | null;
  /** A4: repositories ticked in the list. Cleared after a commit and when the group, tab or search changes. */
  selected: string[];
  /** A4: a move waiting for the person's OK. Nothing is committed until `confirmMove`. */
  pendingMove: PendingMove | null;
}

export interface PendingMove {
  /** The repositories that were asked for (including the ones already there). */
  repos: string[];
  to: string[];
  /** What the commit would do; `error` when the destination is gone. */
  plan: Pick<MovePlan, 'moved' | 'already' | 'stillCaught'> & { error?: string };
}

export type SaveResult = { ok: true } | { ok: false; message: string };

export interface Conflict {
  sha: string | null;
  config: import('../../core/types').Config | null;
}
export type ApplyResult = SaveResult | { ok: false; conflict: Conflict };

export interface YamlCheck {
  config?: import('../../core/types').Config;
  error?: string;
  line?: number | null;
  warnings: string[];
  stripped: boolean;
}

export interface Env {
  call: Call;
  location: Pick<Location, 'pathname' | 'search' | 'hash'>;
  history: Pick<History, 'pushState'>;
  open: (url: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Team repositories page (F12): the slug of the team whose page is open. */
  team?: string;
  /** Display name of that team ("Core_Team"), when the page shows it. */
  teamName?: string;
}

export type Controller = ReturnType<typeof createController>;

const infoOf = (e: unknown): ErrorInfo => (e instanceof CallError ? e.info : { kind: 'other', message: e instanceof Error ? e.message : String(e) });

export function createController(org: string, env: Env) {
  // The team page keeps its own view preferences, apart from the org page.
  const prefsOrg = env.team ? `${org}/teams/${env.team}` : org;
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
    sort: 'pushed',
    query: '',
    access: null,
    details: {},
    drawer: null,
    yaml: null,
    toast: null,
    selected: [],
    pendingMove: null,
  });
  const teams = createTeamsController({ org, team: env.team, teamName: env.teamName, call: env.call, store, afterAccess: () => applyDefaults() });
  const members = createMembersController({ org, call: env.call });
  // Logos load through the background; every config change asks for the references it has not seen yet (F7).
  const logos = createLogoStore(env.call, org);
  let logoCfg: unknown;
  store.subscribe(() => {
    const cfg = store.get().config;
    if (cfg === logoCfg) return;
    logoCfg = cfg;
    const refs: string[] = [];
    const walk = (gs: Group[]) => gs.forEach((g) => (g.logo && refs.push(g.logo), walk(g.groups)));
    if (cfg && cfg.exists && cfg.config) walk(cfg.config.groups);
    logos.want(refs);
  });
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let prefsTimer: ReturnType<typeof setTimeout> | undefined;

  const savePrefs = (prefs: Partial<OrgPrefs>) => {
    env.call({ type: 'prefs:set', org: prefsOrg, prefs }).catch(() => {});
  };

  /** Tree for the current data; placement is memoized per (config sha, index version). */
  function model(): TreeModel | null {
    const s = store.get();
    if (!s.config) return null;
    const groups = s.config.exists && s.config.config ? s.config.config.groups : [];
    const sha = s.config.exists ? s.config.sha : null;
    const team = teams.teamModel(sha, `${s.org}:${s.indexVersion}`, groups, s.repos);
    if (team !== undefined) return team;
    return memoTree(sha, `${s.org}:${s.indexVersion}`, groups, s.repos);
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
    void ensureParents();
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
    void ensureParents();
  }

  async function init() {
    const prefs = await env.call<Partial<OrgPrefs>>({ type: 'prefs:get', org: prefsOrg }).catch(() => ({}) as Partial<OrgPrefs>);
    if (prefs.expanded) store.set({ expanded: new Set(prefs.expanded), expandedTouched: true });
    if (prefs.sort && SORT_KEYS.includes(prefs.sort)) store.set({ sort: prefs.sort });
    if (!hasGithubFilter(env.location.search)) {
      // A saved view wins; otherwise Options > "Show grouped view by default" (default on) decides.
      const view = prefs.view ?? (prefs.groupedByDefault === false ? 'list' : undefined);
      if (view) store.set({ view });
    }
    const auth = await env.call<{ signedIn: boolean }>({ type: 'auth:status' }).catch(() => ({ signedIn: false }));
    if (disposed) return;
    if (!auth.signedIn) return void store.set({ phase: 'signed-out' });
    store.set({ phase: 'ready' });
    void loadAccess();
    await loadCached();
    await refresh();
  }

  /** Who may edit the org file; edit buttons stay hidden until we know. */
  async function loadAccess() {
    try {
      const r = await env.call<{ access: Access }>({ type: 'org:access', org });
      if (!disposed) store.set({ access: r.access });
    } catch {
      /* stays hidden */
    }
  }

  function showToast(text: string, kind: 'ok' | 'error' = 'ok') {
    clearTimeout(toastTimer);
    store.set({ toast: { text, kind } });
    toastTimer = setTimeout(() => store.set({ toast: null }), 6000);
  }

  async function save(edit: Edit, created = false, toast?: string): Promise<SaveResult> {
    try {
      const r = await env.call<any>({ type: 'org:edit', org, edit });
      if (r.status === 'needs-repo') {
        // <owner>/.github does not exist yet: create it (private) and save again, in the same click.
        if (created) return { ok: false, message: `Could not create ${org}/.github.` };
        await env.call({ type: 'org:create-dotgithub', org });
        return save(edit, true, toast);
      }
      const before = store.get();
      const logoFile = editLogoPath(edit);
      const png = pngOf(edit);
      if (logoFile && png) logos.put(logoFile, `data:image/png;base64,${png}`);
      const next: Partial<State> = { config: { exists: true, sha: r.sha, config: r.config, warnings: r.warnings }, indexVersion: before.indexVersion + 1, drawer: null };
      const expanded = new Set(before.expanded);
      if (edit.kind === 'new' && edit.parent.length) expanded.add(edit.parent.join('/')); // creating a group expands its parent
      if (edit.kind === 'edit') {
        const old = edit.path.join('/');
        const renamed = [...edit.path.slice(0, -1), finalName(edit.name)];
        if (old !== renamed.join('/')) {
          for (const k of [...expanded]) if (k === old || k.startsWith(old + '/')) (expanded.delete(k), expanded.add(renamed.join('/') + k.slice(old.length)));
          if (before.path.join('/') === old || before.path.join('/').startsWith(old + '/')) {
            const path = [...renamed, ...before.path.slice(edit.path.length)];
            env.history.pushState(null, '', env.location.pathname + env.location.search + buildHash({ layer: 'org', path }));
            next.path = path;
          }
        }
      }
      if (edit.kind === 'delete') {
        const gone = edit.path.join('/');
        for (const k of [...expanded]) if (k === gone || k.startsWith(gone + '/')) expanded.delete(k);
        const here = before.path.join('/');
        if (here === gone || here.startsWith(gone + '/')) {
          // the page being viewed no longer exists: go to the parent group (or the top level)
          const path = edit.path.slice(0, -1);
          env.history.pushState(null, '', env.location.pathname + env.location.search + buildHash({ layer: 'org', path }));
          next.path = path;
        }
      }
      next.expanded = expanded;
      next.expandedTouched = true;
      store.set(next);
      savePrefs({ expanded: [...expanded] });
      showToast(toast ?? (edit.kind === 'delete' ? `Deleted ${edit.path.join('/')} · committed to ${org}/.github/repo-groups.yml` : `Committed to ${org}/.github/repo-groups.yml`));
      return { ok: true };
    } catch (e) {
      return { ok: false, message: infoOf(e).message };
    }
  }

  const destLabel = (to: string[]) => (to.length ? to.join(' / ') : 'Ungrouped');

  /**
   * A4: stages a move of one or more repositories to a group ([] = Ungrouped) and opens the confirmation. Nothing is
   * committed here.
   */
  function stageMove(repos: string[], to: string[]) {
    const s = store.get();
    const groups = s.config && s.config.exists && s.config.config ? s.config.config.groups : null;
    if (!groups || !repos.length) return;
    const plan = planMoves(groups, repos, to);
    store.set({
      pendingMove: { repos: [...new Set(repos)], to, plan: 'error' in plan ? { moved: [], already: [], stillCaught: [], error: plan.error } : { moved: plan.moved, already: plan.already, stillCaught: plan.stillCaught } },
    });
  }

  /**
   * A4: the OK of the confirmation: one commit for every repository that changes. The toast only appears after the commit
   * succeeded; on failure the message goes back to the dialog, which stays open. A conflict is re-applied once by the
   * background (§7).
   */
  async function confirmMove(): Promise<SaveResult> {
    const p = store.get().pendingMove;
    if (!p) return { ok: true };
    if (p.plan.error) return { ok: false, message: p.plan.error };
    if (!p.plan.moved.length) return { ok: false, message: 'Nothing to commit.' };
    const n = p.plan.moved.length;
    const what = n === 1 ? p.plan.moved[0] : `${n} repositories`;
    const warn = p.plan.stillCaught.length ? ` · ${p.plan.stillCaught.map((c) => `${c.repo} is still matched by ${c.rule} in ${c.key}`).join('; ')}` : '';
    const r = await save({ kind: 'move', repos: p.plan.moved, to: p.to }, false, `Moved ${what} to ${destLabel(p.to)} · committed to ${org}/.github/repo-groups.yml${warn}`);
    if (r.ok) store.set({ pendingMove: null, selected: [] });
    return r;
  }

  let detailsKey = '';
  /** Asks the background for split issue / PR counts of these repos (groups of 200 or fewer). Never throws. */
  async function ensureDetails(names: string[]) {
    const have = store.get().details;
    const missing = names.filter((n) => !have[n]);
    if (!missing.length || names.length > DETAILS_MAX_REPOS || store.get().phase !== 'ready') return;
    const key = names.join('\n');
    if (key === detailsKey) return; // same request already made for this group and index
    detailsKey = key;
    try {
      const d = await env.call<DetailsMap>({ type: 'org:details', org, repos: names });
      if (!disposed && d) store.set({ details: { ...store.get().details, ...d } });
    } catch {
      /* the combined number stays */
    }
  }

  let parentsFor = -1;
  /** Fork upstreams (A5): asks the background once per index version when some fork has no parent yet. Never throws. */
  async function ensureParents() {
    const s = store.get();
    if (s.phase !== 'ready' || parentsFor === s.indexVersion || !s.repos.some((r) => r.fork && r.parent === undefined)) return;
    parentsFor = s.indexVersion;
    try {
      const map = await env.call<Record<string, string | null>>({ type: 'org:parents', org });
      if (disposed || !map) return;
      const cur = store.get();
      let changed = false;
      const repos = cur.repos.map((r) => {
        if (!r.fork || r.parent !== undefined || !(r.name in map)) return r;
        changed = true;
        return { ...r, parent: map[r.name] };
      });
      if (changed) {
        parentsFor = cur.indexVersion + 1;
        store.set({ repos, indexVersion: cur.indexVersion + 1 });
      }
    } catch {
      /* fork-of rules just wait for the next visit */
    }
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

  /** The saved file as the writer would emit it: what the YAML editor opens with and "Reset to saved file" returns to. */
  function savedText(): string {
    const s = store.get();
    const cfg = s.config && s.config.exists && s.config.config ? s.config.config : { version: 1, index: 'api' as const, groups: [] };
    return writeConfig(cfg, `${org}/.github/repo-groups.yml`);
  }

  return {
    store,
    teams,
    members,
    logos,
    /** Loads an image from a link in the background (CORS-free, asks for the site's permission). Resolves to a data URL. */
    fetchLogoLink: async (url: string) => (await env.call<{ dataUrl: string }>({ type: 'logo:fetch-link', url })).dataUrl,
    model,
    init,
    refresh,
    ensureDetails,
    /** A5: one proposed group per upstream owner with 2+ ungrouped forks. Nothing is saved. */
    forkProposals(): ForkProposal[] {
      const s = store.get();
      const cfg = s.config && s.config.exists && s.config.config ? s.config.config : null;
      return proposeForkGroups(cfg ? cfg.groups : [], s.repos);
    },
    /** A5: opens the YAML editor with the proposed groups added, for review. The user confirms with Apply and commit. */
    openForkDraft() {
      const s = store.get();
      const cfg = s.config && s.config.exists && s.config.config ? s.config.config : { version: 1, index: 'api' as const, groups: [] as Group[] };
      const proposals = proposeForkGroups(cfg.groups, s.repos);
      if (!proposals.length) return;
      store.set({ drawer: null, yaml: { text: writeConfig({ ...cfg, groups: withForkGroups(cfg.groups, proposals) }, `${org}/.github/repo-groups.yml`) } });
    },
    startSignIn,
    openVerification: (s: SignIn) => env.open(`${s.verificationUri}?user_code=${encodeURIComponent(s.userCode)}`),
    dispose() {
      disposed = true;
      teams.dispose();
      members.dispose();
      clearTimeout(prefsTimer);
      clearTimeout(toastTimer);
    },
    save,
    stageMove,
    confirmMove,
    cancelMove: () => store.set({ pendingMove: null }),
    toggleSelect(name: string) {
      const cur = store.get().selected;
      store.set({ selected: cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name] });
    },
    selectAll: (names: string[]) => store.set({ selected: [...new Set(names)] }),
    clearSelection: () => store.set({ selected: [] }),
    /** A4: moving needs write access to the org file; the team page is a read-only view. */
    canMove(): boolean {
      const s = store.get();
      return !!s.access?.canWriteOrg && !env.team && !!s.config && s.config.exists && !!s.config.config;
    },
    savedText,
    openYaml(text?: string) {
      store.set({ drawer: null, yaml: { text: text ?? savedText() } });
    },
    closeYaml: () => store.set({ yaml: null }),
    async validateYaml(text: string): Promise<YamlCheck> {
      try {
        return await env.call<YamlCheck>({ type: 'yaml:validate', org, text });
      } catch (e) {
        return { error: infoOf(e).message, warnings: [], stripped: false };
      }
    },
    async applyYaml(text: string, changes: number, created = false): Promise<ApplyResult> {
      try {
        const before = store.get();
        const baseSha = before.config && before.config.exists ? before.config.sha : null;
        const r = await env.call<any>({ type: 'org:apply-yaml', org, text, baseSha, changes });
        if (r.status === 'needs-repo') {
          // <owner>/.github does not exist yet: create it (private) and apply again, in the same click.
          if (created) return { ok: false, message: `Could not create ${org}/.github.` };
          await env.call({ type: 'org:create-dotgithub', org });
          return this.applyYaml(text, changes, true);
        }
        if (r.status === 'conflict') return { ok: false, conflict: { sha: r.sha, config: r.config } };
        store.set({ config: { exists: true, sha: r.sha, config: r.config, warnings: r.warnings }, indexVersion: before.indexVersion + 1, yaml: null });
        showToast(`Committed to ${org}/.github/repo-groups.yml`);
        return { ok: true };
      } catch (e) {
        return { ok: false, message: infoOf(e).message };
      }
    },
    /** "Reload and keep my text": adopt the file as it is on GitHub now, so the editor diffs against it. */
    rebase(c: Conflict) {
      const before = store.get();
      const config: ConfigResult = c.config
        ? { exists: true, sha: c.sha, config: c.config, warnings: [] }
        : c.sha
          ? { exists: true, sha: c.sha, error: 'The file on GitHub has a problem.', warnings: [] }
          : { exists: false };
      store.set({ config, indexVersion: before.indexVersion + 1 });
    },
    openDrawer: (mode: 'edit' | 'new', path: string[], focus?: 'logo') => store.set({ drawer: { mode, path, ...(focus ? { focus } : {}) } }),
    closeDrawer: () => store.set({ drawer: null }),
    dismissToast: () => (clearTimeout(toastTimer), store.set({ toast: null })),
    /** Hash changes (also back/forward): #infra/dagsrv. */
    syncHash() {
      const r = parseHash(env.location.hash);
      const path = r.layer === 'org' ? r.path : [];
      const m = model();
      const known = !m || !path.length || m.byKey.has(path.join('/'));
      store.set({ path: known ? path : [], tab: 'items', query: '', selected: [] });
    },
    go(path: string[]) {
      const hash = buildHash({ layer: 'org', path });
      env.history.pushState(null, '', env.location.pathname + env.location.search + hash);
      const wasList = store.get().view !== 'grouped';
      store.set({ path, tab: 'items', query: '', view: 'grouped', selected: [] });
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
    setTab: (tab: State['tab']) => store.set({ tab, query: '', selected: [] }),
    setSort(sort: SortKey) {
      store.set({ sort });
      savePrefs({ sort });
    },
    setQuery: (query: string) => store.set(query === store.get().query ? { query } : { query, selected: [] }),
    updatedText: (meta: IndexMeta | null) => (meta?.lastIncrementalSync ? ago(meta.lastIncrementalSync) : ''),
  };
}
