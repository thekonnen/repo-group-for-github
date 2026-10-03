import type { Access } from '../core/access';
import type { IndexMeta } from '../core/index-sync';
import type { RepoInfo } from '../core/types';

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
  | { type: 'org:access'; org: string };

export type ErrorInfo = { kind: string; message: string; hint?: string; resetAt?: number };

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: ErrorInfo };

export interface OrgSnapshot {
  repos: RepoInfo[];
  meta: IndexMeta;
}

export type { Access };
