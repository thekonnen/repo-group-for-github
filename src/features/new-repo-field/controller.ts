import type { Access } from '../../core/access';
import { findGroup } from '../../core/placement';
import { describeDestination, pickerOptions, type Destination } from '../../core/newrepo';
import { normName } from '../../core/glob';
import { cleanTeams } from '../../core/edit';
import { effectiveTeams } from '../../core/teams';
import { buildTree } from '../../core/tree';
import type { Group, RepoInfo, TeamTag } from '../../core/types';
import type { Call } from '../../github/client';
import type { ConfigResult, OrgSnapshot, OrgTeam, TeamsResult } from '../../github/messages';
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
  /** Teams that get access right after creation (F12). Pre-filled from the destination group until edited by hand. */
  teams: TeamTag[];
  teamsTouched: boolean;
  /** Org owners can always give teams access; others need admin on the new repo (they usually have it as its creator). */
  isOwner: boolean;
  /** The owner is the signed-in user's own account: no teams. */
  personal: boolean;
  /** The org's teams for the picker; null when they could not be read (then a slug can be typed). */
  teamList: OrgTeam[] | null;
  customRoles: string[];
}

export interface NrEnv {
  call: Call;
  /** `rg_group` of the URL, if any. */
  presetGroup?: string;
}

export type NrController = ReturnType<typeof createNewRepoController>;

/** State of the Group field on "Create a new repository" (F9). The page glue feeds it the name and the owner. */
export function createNewRepoController(env: NrEnv) {
  const store: Store<NrState> = createStore<NrState>({ org: null, phase: 'loading', groups: [], repos: [], canWrite: true, rawName: '', pickedKey: '', teams: [], teamsTouched: false, isOwner: false, personal: false, teamList: null, customRoles: [] });
  let seq = 0;

  /** (Re)loads the org's file, index cache and access. An org without a repo-groups.yml hides the field. */
  async function setOrg(org: string | null) {
    if (org && store.get().org === org) return; // already loaded or loading
    const mine = ++seq;
    if (!org) return store.set({ org, phase: 'hidden', groups: [], pickedKey: '', teams: [], teamsTouched: false });
    store.set({ org, phase: 'loading', teams: [], teamsTouched: false, teamList: null });
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
      store.set({ phase: 'ready', groups, repos: snap?.repos ?? [], canWrite, isOwner: acc?.access.level === 'owner', personal: !!acc?.access.personal, pickedKey: canWrite ? preset : '' });
      syncTeams();
      void loadTeamList(org, mine);
    } catch (e) {
      if (mine === seq) {
        console.debug('[RG] could not load the groups for the new repository field', e);
        store.set({ phase: 'hidden' });
      }
    }
  }

  /** The org's teams, for the picker. Failing to read them only means a slug has to be typed. */
  async function loadTeamList(org: string, mine: number) {
    try {
      const r = await env.call<TeamsResult>({ type: 'org:teams', org });
      if (mine === seq) store.set({ teamList: r.teams, customRoles: r.customRoles ? Object.keys(r.customRoles) : [] });
    } catch (e) {
      console.debug('[RG] could not list the teams of the org', e);
    }
  }

  /** Until the person edits the teams, they follow the destination: its effective teams (own + inherited). */
  function syncTeams() {
    const s = store.get();
    if (s.teamsTouched || s.phase !== 'ready') return;
    const key = destination().destKey;
    const teams = Object.entries(effectiveTeams(s.groups, key ? key.split('/') : [])).map(([slug, t]) => ({ slug, permission: t.permission }));
    if (JSON.stringify(teams) !== JSON.stringify(s.teams)) store.set({ teams });
  }

  const setName = (rawName: string) => {
    if (store.get().rawName === rawName) return;
    store.set({ rawName });
    syncTeams();
  };
  const pick = (pickedKey: string) => {
    store.set({ pickedKey: store.get().canWrite ? pickedKey : '' });
    syncTeams();
  };
  /** A manual edit: from now on the teams stay as the person set them. */
  const setTeams = (teams: TeamTag[]) => store.set({ teams, teamsTouched: true });

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
    return { org: s.org, repo: name, groupPath: s.canWrite ? s.pickedKey : '', explicit: s.canWrite && !!s.pickedKey, teams: cleanTeams(s.teams).map((t) => ({ slug: t.slug, permission: t.permission })) };
  }

  return { store, setOrg, setName, pick, setTeams, destination, options, pendingEntry, finalName };
}
