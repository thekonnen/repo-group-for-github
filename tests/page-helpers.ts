import { vi } from 'vitest';
import { example } from './fixtures';
import type { Request } from '../src/github/messages';

export const at = (min: number) => new Date(Date.parse('2026-01-10T12:00:00Z') - min * 60000).toISOString();
export const repos = [
  ['konnen-litellm', 31, 'AI Gateway for TheKonnen'], ['litellm', 46], ['konnen-authentik', 120], ['konnen-checkmate', 180, 'Deploy checkmate using authentik as sso login'],
  ['authentik', 300], ['konnen-dagu', 302], ['dagu', 360], ['keep_supabase_alive', 780], ['omniroute', 900], ['dags-repo', 2900],
].map(([name, min, description]: any) => ({ name, description: description ?? '', pushedAt: at(min), private: true, language: 'Shell', stars: 0, forks: 0, openIssuesAndPrs: 0 }));

export const ownerAccess = { access: { level: 'owner', canWriteOrg: true, hasOrgFile: true, suggestMode: false, canForkSuggest: true, syncNeedsRepoAdmin: false, publicOnly: false } };
export const memberAccess = { access: { level: 'member', canWriteOrg: false, hasOrgFile: true, suggestMode: true, canForkSuggest: true, syncNeedsRepoAdmin: true, publicOnly: false } };

export function fakeCall(opts: { signedIn?: boolean; config?: any; access?: any; edit?: (req: any) => any } = {}) {
  const log: Request[] = [];
  const config = opts.config ?? { exists: true, sha: 'sha1', config: example(), warnings: [] };
  const call = vi.fn(async (req: Request): Promise<any> => {
    log.push(req);
    switch (req.type) {
      case 'auth:status': return { signedIn: opts.signedIn ?? true };
      case 'prefs:get': return {};
      case 'prefs:set': return {};
      case 'org:cached': return { repos, meta: { lastFullSync: at(5), lastIncrementalSync: at(5), total: repos.length } };
      case 'org:config': return config;
      case 'org:refresh': return { status: 'ok', mode: 'incremental', repos, meta: { lastFullSync: at(5), lastIncrementalSync: at(0), total: repos.length } };
      case 'org:progress': return null;
      case 'org:access': return opts.access ?? ownerAccess;
      case 'org:edit': if (opts.edit) return opts.edit(req); throw new Error('unexpected org:edit');
      case 'org:create-dotgithub': return { created: true };
      case 'auth:start': return { deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 };
      default: throw new Error('unexpected ' + req.type);
    }
  });
  return { call: call as any, log };
}

