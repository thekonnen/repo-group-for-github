import type { Access } from '../core/access';
import type { IndexMeta } from '../core/index-sync';
import type { Edit } from '../core/edit';
import type { GrantResult } from '../core/grant';
import type { PendingRepo } from '../core/newrepo';
import type { TeamAccess } from '../core/teams';
import type { Config, Permission, RepoInfo } from '../core/types';
import type { Provider } from '../background/llm';

/** Content script / popup / options -> background. The token never leaves the background. */
export type Request =
  | { type: 'auth:status' }
  | { type: 'auth:start' }
  | { type: 'auth:poll'; deviceCode: string; interval: number }
  | { type: 'auth:pat'; token: string }
  | { type: 'auth:signout' }
  | { type: 'org:cached'; org: string }
  | { type: 'org:refresh'; org: string; force?: boolean }
  | { type: 'org:file'; org: string }
  | { type: 'org:access'; org: string }
  | { type: 'org:config'; org: string; cachedOnly?: boolean }
  | { type: 'org:progress'; org: string }
  | { type: 'org:details'; org: string; repos: string[] }
  | { type: 'org:edit'; org: string; edit: Edit }
  | { type: 'org:create-dotgithub'; org: string }
  | { type: 'logos:get'; org: string; srcs: string[] } // F7: logo references of the org file -> data URLs
  | { type: 'logo:fetch-link'; url: string } // F7: an image from a link, for the cropper
  | { type: 'newrepo:pending'; entry: Omit<PendingRepo, 'createdAt'> }
  | { type: 'newrepo:discard' }
  | { type: 'newrepo:landed'; org: string; repo: string }
  | { type: 'yaml:validate'; org: string; text: string }
  | { type: 'org:apply-yaml'; org: string; text: string; baseSha: string | null; changes: number }
  | { type: 'org:teams'; org: string; force?: boolean }
  | { type: 'team:access'; org: string; slugs: string[]; force?: boolean }
  | { type: 'team:members'; org: string; slugs: string[]; force?: boolean }
  | { type: 'team:grant'; org: string; team: string; repo: string; permission: Permission }
  | { type: 'prefs:get'; org: string }
  | { type: 'prefs:set'; org: string; prefs: Partial<OrgPrefs> }
  | { type: 'orgs:list'; force?: boolean }
  | { type: 'cache:clear' }
  | { type: 'settings:get' }
  | { type: 'settings:set'; settings: Partial<{ refreshMinutes: number }> }
  | { type: 'llm:status' }
  | { type: 'llm:save'; config: { mode?: Provider; apiKey?: string; baseUrl?: string; model?: string } }
  | { type: 'llm:auto'; auto: boolean }
  | { type: 'llm:fallback'; fallback: boolean }
  | { type: 'llm:clear'; mode?: Provider }
  | { type: 'llm:test'; mode?: Provider }
  | { type: 'suggest:group'; org: string; repo: { name: string; description?: string | null }; method?: SuggestMethod; /** Started by the page on its own (AI by default), not by a click: cheaper and rate limited. */ auto?: boolean };

/** Which classifier to run. Left out, the background tries rules, then the local score, then the AI only if the score is unsure. */
export type SuggestMethod = 'keywords' | 'llm';

/** Answer of `suggest:group`. `llm` means the local score was not sure and the AI picked. */
export interface GroupSuggestion {
  source: 'rule' | 'lexical' | 'llm' | 'uncertain';
  /** Group key ("infra/cloud") or null. */
  key: string | null;
  rule?: string;
  score: number;
  margin: number;
  /** Best three local candidates. */
  ranking: { key: string; score: number }[];
  model?: string;
  /** Which provider answered. */
  provider?: Provider;
  /** The first provider failed and the other one answered. */
  fallback?: boolean;
  /** No group fits: the AI proposes creating this one (the page asks before creating it). */
  newGroup?: { path: string[]; titles: string[]; descriptions: string[] };
  /** Why the AI was not used or failed, when it was needed. */
  llmError?: string;
}

/** Per-org view preferences. The content script never touches storage; it asks the background. */
export interface OrgPrefs {
  view: 'grouped' | 'list';
  expanded: string[];
  /** Order of the "All repositories" tab. */
  sort?: 'pushed' | 'name' | 'stars' | 'issues';
  /** Options > "Show grouped view by default". Used when the org has no saved view. Default true. */
  groupedByDefault?: boolean;
}

/** The org's repo-groups.yml, parsed in the background so the page script stays small. */
export type ConfigResult =
  | { exists: false }
  | { exists: true; sha: string | null; config?: Config; error?: string; line?: number | null; warnings: string[] };

export interface Progress {
  loaded: number;
  estimatedTotal: number;
  /** 'action': loading the organization index file; loaded/estimatedTotal are then a percentage out of 100. */
  phase?: 'action';
}

export type ErrorInfo = { kind: string; message: string; hint?: string; resetAt?: number };

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: ErrorInfo };

export interface OrgSnapshot {
  repos: RepoInfo[];
  meta: IndexMeta;
}

export type { Access };

/** F12: an organization team, from GraphQL. */
export interface OrgTeam {
  slug: string;
  name: string;
  privacy?: string;
  parent?: string | null;
  members?: number;
}

export interface TeamsResult {
  teams: OrgTeam[];
  /** Custom repository role -> base role; null when the user cannot read them (not an org owner). */
  customRoles: Record<string, string> | null;
}

export type { GrantResult, TeamAccess };

/** C3: members of the teams that give access to a group. */
export interface TeamMembersResult {
  members: Record<string, { login: string; name?: string | null; avatarUrl?: string }[]>;
  /** Teams whose members could not be read. forbidden: no Members permission. hidden: team not visible to the user. */
  unreadable: Record<string, 'forbidden' | 'hidden'>;
}
