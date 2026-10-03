import type { Access } from '../../core/access';
import { findGroup } from '../../core/placement';
import { describeDestination, pickerOptions, type Destination } from '../../core/newrepo';
import { normName } from '../../core/glob';
import { buildTree } from '../../core/tree';
import type { Group, RepoInfo } from '../../core/types';
import type { Call } from '../../github/client';
import type { ConfigResult, OrgSnapshot } from '../../github/messages';
import { createStore, type Store } from '../store';

export interface NrState {
  org: string | null;
  phase: 'loading' | 'ready' | 'hidden';
  groups: Group[];
  repos: RepoInfo[];
  /** Can commit to <org>/.github. False for members (F15): org filing is not offered. */
  canWrite: boolean;
  /** Name as typed in GitHub's input. */
  rawName: string;
  /** Explicit pick ('' = Automatic). */
  pickedKey: string;
}

export interface NrEnv {
  call: Call;
  /** `rg_group` of the URL, if any. */
  presetGroup?: string;
}

export type NrController = ReturnType<typeof createNewRepoController>;

/** State of the Group field on "Create a new repository" (F9). The page glue feeds it the name and the owner. */
export function createNewRepoController(env: NrEnv) {
  const store: Store<NrState> = createStore<NrState>({ org: null, phase: 'loading', groups: [], repos: [], canWrite: true, rawName: '', pickedKey: '' });
  let seq = 0;

  /** (Re)loads the org's file, index cache and access. An org without a repo-groups.yml hides the field. */
  async function setOrg(org: string | null) {
    if (org && store.get().org === org) return; // already loaded or loading
    const mine = ++seq;
    if (!org) return store.set({ org, phase: 'hidden', groups: [], pickedKey: '' });
    store.set({ org, phase: 'loading' });
    try {
      const [cfg, snap, acc] = await Promise.all([
        env.call<ConfigResult | null>({ type: 'org:config', org }),
        env.call<OrgSnapshot | null>({ type: 'org:cached', org }).catch(() => null),
        env.call<{ access: Access }>({ type: 'org:access', org }).catch(() => null),
      ]);
      if (mine !== seq) return;
      const groups = cfg && cfg.exists && cfg.config ? cfg.config.groups : null;
      if (!groups) return store.set({ phase: 'hidden', groups: [], pickedKey: '' });
      const canWrite = acc ? acc.access.canWriteOrg : true;
      const preset = env.presetGroup && findGroup(groups, env.presetGroup.split('/')) ? env.presetGroup : '';
      store.set({ phase: 'ready', groups, repos: snap?.repos ?? [], canWrite, pickedKey: canWrite ? preset : '' });
    } catch (e) {
      if (mine === seq) {
        console.debug('[RG] could not load the groups for the new repository field', e);
        store.set({ phase: 'hidden' });
      }
    }
  }

  const setName = (rawName: string) => store.get().rawName !== rawName && store.set({ rawName });
  const pick = (pickedKey: string) => store.set({ pickedKey: store.get().canWrite ? pickedKey : '' });

  const finalName = (): string => normName(store.get().rawName);

  function destination(): Destination {
    const s = store.get();
    return describeDestination(s.groups, finalName(), s.canWrite ? s.pickedKey : '');
  }

  function options() {
    const s = store.get();
    return pickerOptions(s.groups, buildTree(s.groups, s.repos).placed);
  }

  /** Entry for the background to file the repo once it exists. */
  function pendingEntry() {
    const s = store.get();
    const name = finalName();
    if (!s.org || s.phase !== 'ready' || !name) return null;
    return { org: s.org, repo: name, groupPath: s.canWrite ? s.pickedKey : '', explicit: s.canWrite && !!s.pickedKey, teams: [] as { slug: string; permission: string }[] };
  }

  return { store, setOrg, setName, pick, destination, options, pendingEntry, finalName };
}
