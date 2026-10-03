import type { Access } from '../core/access';
import type { IndexMeta } from '../core/index-sync';
import type { Edit } from '../core/edit';
import type { PendingRepo } from '../core/newrepo';
import type { Config, RepoInfo } from '../core/types';

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
  | { type: 'org:edit'; org: string; edit: Edit }
  | { type: 'org:create-dotgithub'; org: string }
  | { type: 'logos:get'; org: string; srcs: string[] } // F7: logo references of the org file -> data URLs
  | { type: 'logo:fetch-link'; url: string } // F7: an image from a link, for the cropper
  | { type: 'newrepo:pending'; entry: Omit<PendingRepo, 'createdAt'> }
  | { type: 'newrepo:discard' }
  | { type: 'newrepo:landed'; org: string; repo: string }
  | { type: 'yaml:validate'; org: string; text: string }
  | { type: 'org:apply-yaml'; org: string; text: string; baseSha: string | null; changes: number }
  | { type: 'prefs:get'; org: string }
  | { type: 'prefs:set'; org: string; prefs: Partial<OrgPrefs> };

/** Per-org view preferences. The content script never touches storage; it asks the background. */
export interface OrgPrefs {
  view: 'grouped' | 'list';
  expanded: string[];
}

/** The org's repo-groups.yml, parsed in the background so the page script stays small. */
export type ConfigResult =
  | { exists: false }
  | { exists: true; sha: string | null; config?: Config; error?: string; line?: number | null; warnings: string[] };

export interface Progress {
  loaded: number;
  estimatedTotal: number;
}

export type ErrorInfo = { kind: string; message: string; hint?: string; resetAt?: number };

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: ErrorInfo };

export interface OrgSnapshot {
  repos: RepoInfo[];
  meta: IndexMeta;
}

export type { Access };
