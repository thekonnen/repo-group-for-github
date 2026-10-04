import type { MembersByTeam } from '../../core/members';
import { CallError, type Call } from '../../github/client';
import type { TeamMembersResult } from '../../github/messages';
import { createStore, type Store } from '../store';

export interface MembersState {
  /** Members of every team loaded so far. */
  members: MembersByTeam;
  unreadable: Record<string, 'forbidden' | 'hidden'>;
  loading: boolean;
  error: string | null;
  mode: 'person' | 'team';
}

export type MembersController = ReturnType<typeof createMembersController>;

/** Loads the members of the teams of a group (C3). Read only; the background caches per org + team. */
export function createMembersController(host: { org: string; call: Call }) {
  const store: Store<MembersState> = createStore<MembersState>({ members: {}, unreadable: {}, loading: false, error: null, mode: 'person' });
  let disposed = false;
  let seq = 0;

  return {
    store,
    setMode: (mode: MembersState['mode']) => store.set({ mode }),
    /** Loads the given team slugs (those not yet in the store, or all when `force`). */
    async load(slugs: string[], force = false) {
      const s = store.get();
      const need = slugs.filter((x) => force || (!(x in s.members) && !(x in s.unreadable)));
      if (!need.length) return;
      const mine = ++seq;
      store.set({ loading: true, error: null });
      try {
        const r = await host.call<TeamMembersResult>({ type: 'team:members', org: host.org, slugs: need, force });
        if (disposed || mine !== seq) return;
        const cur = store.get();
        store.set({ members: { ...cur.members, ...r.members }, unreadable: { ...cur.unreadable, ...r.unreadable }, loading: false });
      } catch (e) {
        if (disposed || mine !== seq) return;
        if (e instanceof CallError && e.info.kind === 'forbidden') {
          store.set({ loading: false, unreadable: { ...store.get().unreadable, ...Object.fromEntries(need.map((x) => [x, 'forbidden' as const])) } });
        } else {
          store.set({ loading: false, error: e instanceof CallError ? e.info.message : e instanceof Error ? e.message : String(e) });
        }
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
