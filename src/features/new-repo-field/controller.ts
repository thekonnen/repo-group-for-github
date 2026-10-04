import type { Access } from '../../core/access';
import { findGroup } from '../../core/placement';
import { describeDestination, pickerOptions, type Destination } from '../../core/newrepo';
import { normName } from '../../core/glob';
import { cleanTeams } from '../../core/edit';
import { effectiveTeams } from '../../core/teams';
import { buildTree } from '../../core/tree';
import type { Group, RepoInfo, TeamTag } from '../../core/types';
import type { Call } from '../../github/client';
import type { EditResult } from '../../background/commit';
import type { ConfigResult, GroupSuggestion, OrgSnapshot, OrgTeam, SuggestMethod, TeamsResult } from '../../github/messages';
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
  /** An AI key is set (Options > AI assistant), so the AI pill can run. */
  llmReady: boolean;
  /** Ask the AI on its own when no rule matches (Options > AI assistant; on by default). */
  llmAuto: boolean;
  /** Last "classify now" request (Keywords or AI pill) for the current name; cleared when the name changes. */
  suggestion: Suggestion | null;
}

export interface Suggestion {
  method: SuggestMethod;
  /**
   * found: a group was picked. none: the method was not sure. error: the call failed (message says why).
   * new: nothing fits and the AI proposes `newGroup`. creating: that group is being committed.
   */
  status: 'loading' | 'found' | 'none' | 'error' | 'new' | 'creating';
  key: string | null;
  message?: string;
  model?: string;
  newGroup?: { path: string[]; titles: string[]; descriptions: string[] };
  /** The picked group did not exist; it was created from the AI's proposal. */
  created?: boolean;
  /** How many levels of `newGroup.path` were taken (1 = only the top group). */
  chosenDepth?: number;
  /** Which AI provider answered, and whether it was the fallback. */
  provider?: 'gemini' | 'custom';
  fallback?: boolean;
  /** Ran by itself (AI by default) rather than from a click. */
  auto?: boolean;
}

/** AI by default waits for the name to be done: leaving the field, or this long without typing. */
const AUTO_DELAY_MS = 2500;
const AUTO_MIN_NAME = 3;

export interface NrEnv {
  call: Call;
  /** `rg_group` of the URL, if any. */
  presetGroup?: string;
}

export type NrController = ReturnType<typeof createNewRepoController>;

/** State of the Group field on "Create a new repository" (F9). The page glue feeds it the name and the owner. */
export function createNewRepoController(env: NrEnv) {
  const store: Store<NrState> = createStore<NrState>({ org: null, phase: 'loading', groups: [], repos: [], canWrite: true, rawName: '', pickedKey: '', teams: [], teamsTouched: false, isOwner: false, personal: false, teamList: null, customRoles: [], llmReady: false, llmAuto: true, suggestion: null });
  let seq = 0;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let sseq = 0; // guards a slow answer against a newer name or request

  /** (Re)loads the org's file, index cache and access. An org without a repo-groups.yml hides the field. */
  async function setOrg(org: string | null) {
    if (org && store.get().org === org) return; // already loaded or loading
    const mine = ++seq;
    sseq++;
    clearTimeout(autoTimer);
    if (!org) return store.set({ org, phase: 'hidden', groups: [], pickedKey: '', teams: [], teamsTouched: false, suggestion: null });
    store.set({ org, phase: 'loading', teams: [], teamsTouched: false, teamList: null, suggestion: null });
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
      void loadLlmReady(mine);
    } catch (e) {
      if (mine === seq) {
        console.debug('[RG] could not load the groups for the new repository field', e);
        store.set({ phase: 'hidden' });
      }
    }
  }

  /** Whether an AI key is set. A failed read just leaves the AI pill off. */
  async function loadLlmReady(mine: number) {
    try {
      const r = await env.call<{ configured: boolean; auto?: boolean }>({ type: 'llm:status' });
      if (mine !== seq) return;
      store.set({ llmReady: !!r.configured, llmAuto: r.auto !== false });
      scheduleAuto(); // a name already typed before the status arrived
    } catch {
      /* the AI pill stays off */
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

  /**
   * AI by default: once the name is done (the person left the field, or stopped typing for a while), if no rule
   * catches it and nothing was picked by hand, ask the AI. Only with a key set and the option on; it never creates
   * a group by itself. One request per finished name, not one per pause while typing.
   */
  function scheduleAuto(committed = false) {
    clearTimeout(autoTimer);
    const s = store.get();
    if (s.phase !== 'ready' || !s.canWrite || !s.llmReady || !s.llmAuto) return;
    const name = finalName();
    if (name.length < AUTO_MIN_NAME) return;
    const fire = () => {
      const now = store.get();
      if (now.suggestion || now.pickedKey !== '' || finalName() !== name) return;
      if (destination().kind !== 'auto-miss') return;
      void classify('llm', true);
    };
    if (committed) fire();
    else autoTimer = setTimeout(fire, AUTO_DELAY_MS);
  }

  /** The person left the name field (Tab, click elsewhere or Enter): the name is final, no need to wait. */
  const nameCommitted = () => scheduleAuto(true);

  const setName = (rawName: string) => {
    if (store.get().rawName === rawName) return;
    sseq++;
    store.set({ rawName, suggestion: null });
    syncTeams();
    scheduleAuto();
  };
  const pick = (pickedKey: string) => {
    store.set({ pickedKey: store.get().canWrite ? pickedKey : '' });
    syncTeams();
  };
  /**
   * "Classify now" with one method (the Keywords and AI pills). A group found is picked right away, so the destination,
   * the teams and the commit follow it like any other pick; the person can still change it.
   */
  async function classify(method: SuggestMethod, auto = false) {
    const s = store.get();
    const name = finalName();
    if (!s.org || s.phase !== 'ready' || !s.canWrite || !name) return;
    if (method === 'llm' && !s.llmReady) {
      return store.set({ suggestion: { method, status: 'error', key: null, message: 'Set up an AI key first: extension Options > AI assistant.', auto } });
    }
    const mine = ++sseq;
    store.set({ suggestion: { method, status: 'loading', key: null, auto } });
    try {
      const r = await env.call<GroupSuggestion>({ type: 'suggest:group', org: s.org, repo: { name }, method, ...(auto ? { auto: true } : {}) });
      if (mine !== sseq) return;
      if (r.key && findGroup(store.get().groups, r.key.split('/'))) {
        pick(r.key);
        store.set({ suggestion: { method, status: 'found', key: r.key, model: r.model, provider: r.provider, fallback: r.fallback, auto } });
      } else if (r.newGroup) {
        store.set({ suggestion: { method, status: 'new', key: null, model: r.model, provider: r.provider, fallback: r.fallback, newGroup: r.newGroup, auto } });
      } else if (r.llmError) {
        store.set({ suggestion: { method, status: 'error', key: null, message: r.llmError, model: r.model, auto } });
      } else {
        store.set({ suggestion: { method, status: 'none', key: null, auto } });
      }
    } catch (e) {
      if (mine === sseq) store.set({ suggestion: { method, status: 'error', key: null, message: e instanceof Error ? e.message : String(e), auto } });
    }
  }

  /**
   * Creates the group the AI proposed, down to `depth` levels (1 = only the top group, 2 = group/subgroup, ...), with the
   * same commit as "New group", then picks the last level, so the repo is filed there when it is created.
   * Levels that already exist are reused, so a depth that is already there only selects it.
   */
  async function createSuggestedGroup(depth: number) {
    const s = store.get();
    const sg = s.suggestion;
    if (!sg?.newGroup || sg.status !== 'new' || !s.org || !s.canWrite) return;
    const { titles, descriptions } = sg.newGroup;
    const path = sg.newGroup.path.slice(0, Math.max(1, Math.min(depth, sg.newGroup.path.length)));
    const mine = ++sseq;
    store.set({ suggestion: { ...sg, status: 'creating', chosenDepth: path.length } });
    try {
      let groups = s.groups;
      let created = false;
      for (let i = 0; i < path.length; i++) {
        if (findGroup(groups, path.slice(0, i + 1))) continue;
        const edit = { kind: 'new' as const, parent: path.slice(0, i), name: path[i], title: titles[i], description: descriptions[i] ?? '', match: [] };
        const r = await env.call<EditResult>({ type: 'org:edit', org: s.org, edit });
        if (r.status === 'needs-repo') throw new Error(`${s.org} has no .github repository for the groups file yet. Create it from the grouped view first.`);
        if (r.status !== 'ok') throw new Error('The groups file changed on GitHub. Reload the page and try again.');
        groups = r.config.groups;
        created = true;
      }
      if (mine !== sseq) return;
      const key = path.join('/');
      store.set({ groups });
      pick(key);
      store.set({ suggestion: { ...sg, status: 'found', key, created, chosenDepth: path.length } });
    } catch (e) {
      if (mine === sseq) store.set({ suggestion: { ...sg, status: 'error', message: e instanceof Error ? e.message : String(e) } });
    }
  }

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

  return { store, setOrg, setName, nameCommitted, pick, classify, createSuggestedGroup, setTeams, destination, options, pendingEntry, finalName };
}
