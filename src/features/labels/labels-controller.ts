import { labelRowId, labelsListText, labelsPlan, isApplicable, type ExistingMap, type LabelRow } from '../../core/labels';
import { runPool } from '../../core/pool';
import { placement } from '../../core/placement';
import { inGroup } from '../../core/teams';
import type { Group, RepoInfo } from '../../core/types';
import { CallError, type Call } from '../../github/client';
import type { GrantResult, LabelStateResult } from '../../github/messages';
import type { State } from '../grouped-view/controller';
import { createStore, type Store } from '../store';

/** One checkbox row of the Sync labels drawer. */
export interface LabelRowState {
  id: string;
  row: LabelRow;
  /** Missing in the repository, so it can be added. A label with another color is shown but never applied. */
  canApply: boolean;
  checked: boolean;
  result?: { state: 'running' } | { state: 'ok' } | { state: 'error'; kind: string; message: string; detail?: string };
}

export interface LabelsSyncState {
  groupKey: string;
  phase: 'loading' | 'review' | 'running';
  rows: LabelRowState[];
  /** Repositories that were looked at. */
  repos: number;
  /** Repositories that could not be read, and why. */
  unreadable: { repo: string; message: string }[];
  /** Reading stopped early because of the rate limit. */
  paused: string | null;
  error: string | null;
  progress: { done: number; total: number } | null;
}

export interface LabelsState {
  sync: LabelsSyncState | null;
}

export interface LabelsHost {
  org: string;
  call: Call;
  store: Store<State>;
}

export type LabelsController = ReturnType<typeof createLabelsController>;

const CONCURRENCY = 3;
const message = (e: unknown) => (e instanceof CallError ? e.info.message : e instanceof Error ? e.message : String(e));

export function createLabelsController(host: LabelsHost) {
  const { org } = host;
  const store = createStore<LabelsState>({ sync: null });
  let disposed = false;

  const groups = (): Group[] => {
    const c = host.store.get().config;
    return c && c.exists && c.config ? c.config.groups : [];
  };
  const repos = (): RepoInfo[] => host.store.get().repos.filter((r) => !r.archived);

  const setSync = (patch: Partial<LabelsSyncState> | null) => store.set({ sync: patch === null ? null : ({ ...store.get().sync!, ...patch } as LabelsSyncState) });
  function setRow(id: string, patch: Partial<LabelRowState>) {
    const sync = store.get().sync;
    if (sync) store.set({ sync: { ...sync, rows: sync.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } });
  }
  const mapRows = (rows: LabelRow[]): LabelRowState[] =>
    rows
      .sort((a, b) => a.repo.localeCompare(b.repo) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
      .map((row) => ({ id: labelRowId(row), row, canApply: isApplicable(row), checked: isApplicable(row) }));

  /** Opens Sync labels for the repositories of a group (and its subgroups). Reads each repository's labels and milestones first. */
  async function openSync(groupKey: string) {
    store.set({ sync: { groupKey, phase: 'loading', rows: [], repos: 0, unreadable: [], paused: null, error: null, progress: null } });
    const placed = placement(groups(), repos());
    const names = repos().filter((r) => inGroup(placed[r.name] ?? '', groupKey)).map((r) => r.name);
    let read: LabelStateResult;
    try {
      read = await host.call<LabelStateResult>({ type: 'labels:read', org, repos: names });
    } catch (e) {
      if (!disposed && store.get().sync) setSync({ phase: 'review', error: message(e) });
      return;
    }
    if (disposed || !store.get().sync) return;
    const existing: ExistingMap = read.state;
    const rows = mapRows(labelsPlan(groups(), repos().filter((r) => names.includes(r.name)), existing));
    setSync({ phase: 'review', rows, repos: names.length, unreadable: read.failed, paused: read.paused?.message ?? null, error: null });
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

  /** Applies the checked rows, 3 at a time. Only POST: it creates what is missing and never updates, renames or deletes. */
  async function apply() {
    const sync = store.get().sync;
    if (!sync || sync.phase !== 'review') return;
    const todo = sync.rows.filter((r) => r.checked && r.canApply && r.result?.state !== 'ok');
    if (!todo.length) return;
    setSync({ phase: 'running', progress: { done: 0, total: todo.length }, rows: sync.rows.map((r) => (todo.includes(r) ? { ...r, result: undefined } : r)) });
    await runPool(todo, CONCURRENCY, async (r) => {
      setRow(r.id, { result: { state: 'running' } });
      let res: GrantResult;
      try {
        res =
          r.row.kind === 'label'
            ? await host.call<GrantResult>({ type: 'labels:add', org, repo: r.row.repo, label: { name: r.row.label.name, color: r.row.label.color, ...(r.row.label.description ? { description: r.row.label.description } : {}) } })
            : await host.call<GrantResult>({ type: 'milestone:add', org, repo: r.row.repo, milestone: r.row.milestone });
      } catch (e) {
        res = { ok: false, kind: 'other', message: message(e) };
      }
      if (res.ok) setRow(r.id, { result: { state: 'ok' }, checked: false });
      else setRow(r.id, { result: { state: 'error', kind: res.kind, message: res.message, detail: res.detail } });
      const p = store.get().sync?.progress;
      if (p) setSync({ progress: { ...p, done: p.done + 1 } });
    });
    if (!disposed && store.get().sync) setSync({ phase: 'review', progress: null });
  }

  return {
    store,
    openSync,
    closeSync: () => store.set({ sync: null }),
    toggleRow,
    setAll,
    apply,
    listText: (rows: LabelRowState[]) => labelsListText(org, rows.map((r) => r.row)),
    dispose() {
      disposed = true;
    },
  };
}
