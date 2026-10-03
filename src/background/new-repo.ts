import { describeDestination, pathLabel, PENDING_TTL_MS, type GrantOutcome, type PendingRepo } from '../core/newrepo';
import { runPool } from '../core/pool';
import { loadYamlParser, readConfig } from '../core/yaml-read';
import type { Client } from './api';
import { commitEdit } from './commit';
import type { KV } from './kv';
import { readOrgFile, type OrgFile } from './org-data';
import { grantTeam } from './teams-data';

const KEY = 'rg:pending-repo';

/** Result for the toast on the repo page. */
export interface FiledResult {
  groupKey: string; // '' = ungrouped
  /** The group path with display names, for the toast. */
  groupLabel?: string;
  committed: boolean;
  /** Plain-language reason when the commit failed. */
  error?: string;
  /** Echo of the pending entry. */
  teams: PendingRepo['teams'];
  /** One outcome per selected team (F12). A failed filing never stops these, and a failed grant never stops the filing. */
  grants: GrantOutcome[];
}

export const setPending = (kv: KV, p: Omit<PendingRepo, 'createdAt'>): Promise<void> => kv.set(KEY, { ...p, createdAt: Date.now() } satisfies PendingRepo);
export const discardPending = (kv: KV): Promise<void> => kv.remove(KEY);

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The browser landed on https://github.com/<org>/<repo>: the repo exists, so file it. The entry is consumed
 * first, so reloads of the repo page never commit twice. Returns null when nothing was pending for this repo.
 */
export async function filePending(client: Client, kv: KV, org: string, repo: string): Promise<FiledResult | null> {
  const p = await kv.get<PendingRepo>(KEY);
  const filed = await fileInGroup(client, kv, org, repo);
  if (!filed || !p) return filed;
  return { ...filed, grants: await grantTeams(client, kv, org, p) };
}

/** Grants each selected team its permission on the new repo (PUT only, explicit permission), 3 at a time. */
async function grantTeams(client: Client, kv: KV, org: string, p: PendingRepo): Promise<GrantOutcome[]> {
  const teams = (p.teams ?? []).filter((t) => t.slug && t.permission);
  return runPool(teams, 3, async (t): Promise<GrantOutcome> => {
    try {
      const r = await grantTeam(client, kv, org, t.slug, p.repo, t.permission);
      return r.ok ? { team: t.slug, permission: t.permission, ok: true } : { team: t.slug, permission: t.permission, ok: false, message: r.message };
    } catch (e) {
      return { team: t.slug, permission: t.permission, ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

async function fileInGroup(client: Client, kv: KV, org: string, repo: string): Promise<FiledResult | null> {
  const p = await kv.get<PendingRepo>(KEY);
  if (!p) return null;
  if (Date.now() - p.createdAt > PENDING_TTL_MS) {
    await kv.remove(KEY);
    return null;
  }
  if (!same(p.org, org) || !same(p.repo, repo)) return null; // another repo page: keep waiting
  await kv.remove(KEY);

  const file = p.explicit ? await readOrgFile(client, kv, org) : await kv.get<OrgFile>(`rg:file:${org}`);
  const parsed = file?.exists ? readConfig(file.text, await loadYamlParser(), { org }) : null;
  if (!parsed?.config) return { groupKey: '', committed: false, teams: p.teams, grants: [] };
  const d = describeDestination(parsed.config.groups, p.repo, p.explicit ? p.groupPath : '');
  const groupLabel = pathLabel(d.destKey, parsed.config.groups);
  if (!d.needsCommit) return { groupKey: d.destKey, groupLabel, committed: false, teams: p.teams, grants: [] }; // the rules already place it
  try {
    await commitEdit(client, kv, org, { kind: 'file', path: d.pickedKey.split('/'), repo: p.repo });
    return { groupKey: d.destKey, groupLabel, committed: true, teams: p.teams, grants: [] };
  } catch (e) {
    return { groupKey: d.destKey, groupLabel, committed: false, error: e instanceof Error ? e.message : String(e), teams: p.teams, grants: [] };
  }
}
