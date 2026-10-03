import { canApplyRow } from '../../core/access';
import { runPool } from '../../core/pool';
import { labelOf } from '../../core/permissions';
import { placement } from '../../core/placement';
import { buildTeamTree } from '../../core/team-view';
import { effectiveTeams, inGroup, syncPlan, untaggedAccess, withGranted, type SyncRow, type TeamAccess } from '../../core/teams';
import type { TreeModel } from '../../core/tree';
import type { Group, Permission, RepoInfo } from '../../core/types';
import { CallError, type Call } from '../../github/client';
import type { GrantResult, OrgTeam, TeamsResult } from '../../github/messages';
import { createStore, type Store } from '../store';
import type { State } from '../grouped-view/controller';

/** One checkbox row of the Sync access drawer. */
export interface SyncRowState {
  id: string;
  row: SyncRow;
  /** The user may apply it (org owner, or admin of that repository). */
  canApply: boolean;
  checked: boolean;
  result?: { state: 'running' } | { state: 'ok' } | { state: 'error'; kind: string; message: string; detail?: string };
}

export interface SyncState {
  teams: string[];
  groupKey: string | null;
  phase: 'loading' | 'review' | 'running';
  /** Row and repository counts when the drawer opened ("Give core_team access to 5 repositories"). */
  headline: { repos: number; teams: string[] };
  rows: SyncRowState[];
  error: string | null;
  /** Rows finished in the current run. */
  progress: { done: number; total: number } | null;
}

export interface TeamsState {
  list: OrgTeam[] | null;
  listLoading: boolean;
  listError: string | null;
  customRoles: Record<string, string> | null;
  access: TeamAccess;
  accessError: string | null;
  sync: SyncState | null;
}

/** What the teams features need from the page controller (kept narrow so the two do not depend on each other's types). */
export interface TeamsHost {
  org: string;
  /** The team whose repositories page is open (F12), if any. */
  team?: string;
  /** Display name of the team, for titles. */
  teamName?: string;
  call: Call;
  store: Store<State>;
  /** Called after a team's access is in: the page can now build its tree (default expanded groups). */
  afterAccess?: () => void;
}

export type TeamsController = ReturnType<typeof createTeamsController>;

export const rowId = (r: Pick<SyncRow, 'team' | 'repo'>) => `${r.team}\u0000${r.repo}`;
const GRANT_CONCURRENCY = 3;
const message = (e: unknown) => (e instanceof CallError ? e.info.message : e instanceof Error ? e.message : String(e));

export function createTeamsController(host: TeamsHost) {
  const { org, team } = host;
  const store = createStore<TeamsState>({ list: null, listLoading: false, listError: null, customRoles: null, access: {}, accessError: null, sync: null });
  let started = false;
  let disposed = false;
  let listPromise: Promise<void> | null = null;

  const groups = (): Group[] => {
    const c = host.store.get().config;
    return c && c.exists && c.config ? c.config.groups : [];
  };
  const repos = (): RepoInfo[] => host.store.get().repos.filter((r) => !r.archived);
  const bump = () => host.store.set({ indexVersion: host.store.get().indexVersion + 1 });
  const customBase = () => store.get().customRoles ?? undefined;

  /** The org's teams (for pickers) and custom roles. Safe to call often; one request at a time. */
  function ensureList(force = false): Promise<void> {
    const s = store.get();
    if (!force && (s.list || listPromise)) return listPromise ?? Promise.resolve();
    store.set({ listLoading: true, listError: null });
    listPromise = host
      .call<TeamsResult>({ type: 'org:teams', org, force })
      .then(
        (r) => void store.set({ list: r.teams, customRoles: r.customRoles, listLoading: false }),
        (e) => void store.set({ listLoading: false, listError: message(e) }),
      )
      .finally(() => {
        listPromise = null;
      });
    return listPromise;
  }

  /** Loads access for the given teams into the store. Failures set `accessError` and keep what we had. */
  async function loadAccess(slugs: string[], force = false): Promise<boolean> {
    try {
      const loaded = await host.call<TeamAccess>({ type: 'team:access', org, slugs, force });
      if (disposed) return false;
      store.set({ access: { ...store.get().access, ...loaded }, accessError: null });
      bump();
      host.afterAccess?.();
      return true;
    } catch (e) {
      if (!disposed) {
        // A team page with no data must not spin forever: mark the team as loaded-but-empty.
        const access = { ...store.get().access };
        for (const s of slugs) if (!(s in access)) access[s] = {};
        store.set({ access, accessError: message(e) });
        bump();
        host.afterAccess?.();
      }
      return false;
    }
  }

  // Memo for the team page tree and plan.
  let treeMemo: { key: string; model: TreeModel } | null = null;
  let planMemo: { cfg: unknown; repos: unknown; access: unknown; rows: SyncRow[]; untagged: string[] } | null = null;

  /**
   * Team page: the org's group tree over only the repositories the team can access, without empty groups.
   * `undefined` = not a team page, `null` = still loading the team's access.
   */
  function teamModel(sha: string | null, version: string, g: Group[], all: RepoInfo[]): TreeModel | null | undefined {
    if (!team) return undefined;
    const s = store.get();
    if (!(team in s.access)) return null;
    const key = `${sha}|${version}|${team}`;
    if (treeMemo?.key !== key) treeMemo = { key, model: buildTeamTree(g, all, s.access, team) };
    return treeMemo.model;
  }

  /** Team page banners: rows that would raise access, and repos the team reaches outside its tagged groups. */
  function banners(): { rows: SyncRow[]; untagged: string[] } | null {
    if (!team) return null;
    const s = store.get();
    const cfg = host.store.get().config;
    if (!(team in s.access) || !cfg || !cfg.exists || !cfg.config) return null;
    const all = host.store.get().repos;
    if (!planMemo || planMemo.cfg !== cfg || planMemo.repos !== all || planMemo.access !== s.access) {
      const live = repos();
      planMemo = {
        cfg,
        repos: all,
        access: s.access,
        rows: syncPlan(cfg.config.groups, live, s.access, team, customBase()),
        untagged: untaggedAccess(cfg.config.groups, live, s.access, team),
      };
    }
    return { rows: planMemo.rows, untagged: planMemo.untagged };
  }

  const repoLabel = (name: string): string | undefined => {
    const p = team ? store.get().access[team]?.[name] : undefined;
    return p ? labelOf(p) : undefined;
  };

  /** Rows of the sync plan for some teams, optionally only for repos in a group (and below). */
  function plan(slugs: string[], groupKey: string | null): SyncRow[] {
    const g = groups();
    const s = store.get();
    const placed = groupKey == null ? null : placement(g, repos());
    const rows: SyncRow[] = [];
    for (const slug of slugs) rows.push(...syncPlan(g, repos(), s.access, slug, customBase()));
    return rows
      .filter((r) => groupKey == null || (placed ? inGroup(placed[r.repo] ?? '', groupKey) : true))
      .sort((a, b) => a.team.localeCompare(b.team) || a.repo.localeCompare(b.repo));
  }

  function setSync(patch: Partial<SyncState> | null) {
    store.set({ sync: patch === null ? null : ({ ...store.get().sync!, ...patch } as SyncState) });
  }
  function setRow(id: string, patch: Partial<SyncRowState>) {
    const sync = store.get().sync;
    if (!sync) return;
    store.set({ sync: { ...sync, rows: sync.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } });
  }

  /** Opens the Sync access drawer for these teams (all repos, or only those in `groupKey`). */
  async function openSync(opts: { teams: string[]; groupKey?: string | null }) {
    const slugs = [...new Set(opts.teams)];
    const groupKey = opts.groupKey ?? null;
    store.set({ sync: { teams: slugs, groupKey, phase: 'loading', headline: { repos: 0, teams: slugs }, rows: [], error: null, progress: null } });
    // Custom role ranks come with the team list; reading it must never block the drawer.
    const [ok] = await Promise.all([loadAccess(slugs, true), ensureList()]);
    if (disposed || !store.get().sync) return;
    if (!ok) return setSync({ phase: 'review', error: store.get().accessError ?? 'Could not read the teams’ access.' });
    const access = host.store.get().access;
    const admin = new Map(host.store.get().repos.map((r) => [r.name, r.viewerIsAdmin]));
    const rows: SyncRowState[] = plan(slugs, groupKey).map((row) => {
      const canApply = access ? canApplyRow(access, admin.get(row.repo)) : false;
      return { id: rowId(row), row, canApply, checked: canApply };
    });
    setSync({ phase: 'review', rows, error: null, headline: { repos: new Set(rows.map((r) => r.row.repo)).size, teams: slugs } });
  }

  function toggleRow(id: string) {
    const sync = store.get().sync;
    if (!sync || sync.phase === 'running') return;
    store.set({ sync: { ...sync, rows: sync.rows.map((r) => (r.id === id && r.canApply && r.result?.state !== 'ok' ? { ...r, checked: !r.checked } : r)) } });
  }

  function setAll(checked: boolean) {
    const sync = store.get().sync;
    if (!sync || sync.phase === 'running') return;
    store.set({ sync: { ...sync, rows: sync.rows.map((r) => (r.canApply && r.result?.state !== 'ok' ? { ...r, checked } : r)) } });
  }

  /** Applies the checked rows, 3 at a time. Only PUT; never removes or lowers anything (the plan has no such rows). */
  async function grant() {
    const sync = store.get().sync;
    if (!sync || sync.phase !== 'review') return;
    const todo = sync.rows.filter((r) => r.checked && r.canApply && r.result?.state !== 'ok');
    if (!todo.length) return;
    setSync({ phase: 'running', progress: { done: 0, total: todo.length }, rows: sync.rows.map((r) => (todo.includes(r) ? { ...r, result: undefined } : r)) });
    const granted: SyncRow[] = [];
    await runPool(todo, GRANT_CONCURRENCY, async (r) => {
      setRow(r.id, { result: { state: 'running' } });
      let res: GrantResult;
      try {
        res = await host.call<GrantResult>({ type: 'team:grant', org, team: r.row.team, repo: r.row.repo, permission: r.row.target });
      } catch (e) {
        res = { ok: false, kind: 'other', message: message(e) };
      }
      if (res.ok) {
        granted.push(r.row);
        setRow(r.id, { result: { state: 'ok' }, checked: false });
      } else setRow(r.id, { result: { state: 'error', kind: res.kind, message: res.message, detail: res.detail } });
      const p = store.get().sync?.progress;
      if (p) setSync({ progress: { ...p, done: p.done + 1 } });
    });
    if (disposed) return;
    // Show the new access right away, then re-read it from GitHub so the cache and the page match.
    let access = store.get().access;
    for (const r of granted) access = withGranted(access, r.team, r.repo, r.target, customBase());
    store.set({ access });
    bump();
    if (granted.length) {
      const slugs = [...new Set(granted.map((r) => r.team))];
      await loadAccess(slugs, true);
      let merged = store.get().access;
      for (const r of granted) merged = withGranted(merged, r.team, r.repo, r.target, customBase());
      store.set({ access: merged });
      bump();
    }
    if (store.get().sync) setSync({ phase: 'review', progress: null });
  }

  /** Plain text for "Copy list": repo, team, permission, one per line. */
  const listText = (rows: SyncRowState[]): string => rows.map((r) => `${host.org}/${r.row.repo}\t${r.row.team}\t${labelOf(r.row.target)}`).join('\n');

  /** Team page: read the team's access as soon as the user is signed in. */
  function onReady() {
    if (started || !team) return;
    started = true;
    void loadAccess([team]);
    void ensureList();
  }
  const unsubscribe = host.store.subscribe(() => {
    if (host.store.get().phase === 'ready') onReady();
  });

  return {
    store,
    team,
    /** What people read for the team: its display name, or the slug. */
    label: host.teamName || team,
    ensureList,
    loadAccess,
    teamModel,
    banners,
    repoLabel,
    openSync,
    closeSync: () => store.set({ sync: null }),
    toggleRow,
    setAll,
    grant,
    listText,
    effective: (path: string[]) => effectiveTeams(groups(), path),
    onReady,
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}

export type { Permission };
