import { useState } from 'preact/hooks';
import { installationsUrl } from '../../core/grant';
import { labelOf } from '../../core/permissions';
import { Drawer } from '../../ui/Drawer';
import type { Controller } from '../grouped-view/controller';
import { useStore } from '../store';
import type { SyncRowState } from './teams-controller';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Sync access (F12): one row per (repository, team) whose access is below the target. Only adds or raises access. */
export function SyncDrawer({ ctl }: { ctl: Controller }) {
  const t = ctl.teams;
  const { sync } = useStore(t.store);
  const s = ctl.store.get();
  const [copy, setCopy] = useState<{ done: boolean; fallback: string | null }>({ done: false, fallback: null });
  if (!sync) return null;

  const { rows } = sync;
  const running = sync.phase === 'running';
  const applicable = rows.filter((r) => r.canApply);
  const owner = s.access?.level === 'owner';
  const pending = rows.filter((r) => r.checked && r.canApply && r.result?.state !== 'ok');
  const done = rows.filter((r) => r.result?.state === 'ok').length;
  const failed = rows.filter((r) => r.result?.state === 'error').length;
  const readOnly = sync.phase === 'review' && !applicable.length;
  const who = sync.headline.teams.length === 1 ? sync.headline.teams[0] : plural(sync.headline.teams.length, 'team', 'teams');

  const doCopy = async () => {
    const text = t.listText(rows);
    try {
      await navigator.clipboard.writeText(text);
      setCopy({ done: true, fallback: null });
    } catch {
      setCopy({ done: false, fallback: text }); // clipboard refused: show the text selected
    }
  };

  return (
    <Drawer
      title="Sync access"
      titleId="rg-sync-title"
      onClose={() => t.closeSync()}
      footer={
        <>
          <span class="rg-grow">Only adds or raises access. It never removes a team or lowers a permission.</span>
          <button type="button" class="rg-btn" onClick={() => t.closeSync()}>{done || failed ? 'Close' : 'Cancel'}</button>
          {readOnly ? (
            <button type="button" class="rg-btn rg-btn-primary" disabled={!rows.length} onClick={doCopy}>Copy list</button>
          ) : (
            <button type="button" class="rg-btn rg-btn-primary" disabled={running || !pending.length || sync.phase === 'loading'} onClick={() => void t.grant()}>
              {running ? 'Granting…' : `Grant access${pending.length ? ` (${pending.length})` : ''}`}
            </button>
          )}
        </>
      }
    >
      {sync.phase === 'loading' ? (
        <p class="rg-muted" role="status">Reading what {who} can access…</p>
      ) : sync.error ? (
        <p class="rg-error" role="alert">{sync.error}</p>
      ) : (
        <>
          <h3 class="rg-sync-head">{rows.length || done || failed ? `Give ${who} access to ${plural(sync.headline.repos, 'repository', 'repositories')}` : `${who} already has the access set in repo-groups.yml`}</h3>
          {!rows.length && <p class="rg-muted">Nothing to sync{sync.groupKey ? ` in ${sync.groupKey}` : ''}.</p>}
          {!!rows.length && !owner && (
            <p class="rg-hint" role="note">
              You can update the {plural(new Set(applicable.map((r) => r.row.repo)).size, 'repository', 'repositories')} you administer. Org owners can update all of them.
              {readOnly && ' Copy the list and send it to an org owner or a repository admin.'}
            </p>
          )}
          {running && sync.progress && (
            <div class="rg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={sync.progress.total} aria-valuenow={sync.progress.done} aria-label="Granting access">
              <i style={{ width: `${Math.round((sync.progress.done / Math.max(1, sync.progress.total)) * 100)}%` }} />
            </div>
          )}
          {!!rows.length && (
            <div class="rg-sync" role="table" aria-label="Access to grant">
              <div class="rg-sync-row rg-sync-th" role="row">
                <span role="columnheader">
                  <input type="checkbox" aria-label="Select all" disabled={running || !applicable.length} checked={!!applicable.length && applicable.every((r) => r.checked || r.result?.state === 'ok')} onChange={(e) => t.setAll((e.target as HTMLInputElement).checked)} />
                </span>
                <span role="columnheader">Repository</span>
                <span role="columnheader">Team</span>
                <span role="columnheader">Current</span>
                <span role="columnheader">Target</span>
              </div>
              {rows.map((r) => <Row key={r.id} r={r} running={running} onToggle={() => t.toggleRow(r.id)} org={s.org} />)}
            </div>
          )}
          {(done > 0 || failed > 0) && !running && (
            <p role="status" class={failed ? 'rg-error' : 'rg-ok'}>{done > 0 && `${plural(done, 'row', 'rows')} granted. `}{failed > 0 && `${plural(failed, 'row', 'rows')} failed.`}</p>
          )}
          {copy.done && <p class="rg-hint" role="status">Copied. Send it to an org owner or a repository admin.</p>}
          {copy.fallback && (
            <div class="rg-field">
              <textarea class="rg-input rg-mono" readOnly rows={6} value={copy.fallback} aria-label="List to copy" ref={(el) => el?.select()} />
              <span class="rg-hint">Press Ctrl+C or ⌘C to copy.</span>
            </div>
          )}
          {s.access?.level === 'no-app' && <p class="rg-hint">Repository Group for Github is not installed in {s.org}, so access cannot be changed from here.</p>}
        </>
      )}
    </Drawer>
  );
}

function Row({ r, running, onToggle, org }: { r: SyncRowState; running: boolean; onToggle: () => void; org: string }) {
  const res = r.result;
  return (
    <div class={`rg-sync-row${r.canApply ? '' : ' rg-off'}`} role="row" data-repo={r.row.repo} data-team={r.row.team}>
      <span role="cell">
        <input type="checkbox" checked={r.checked} disabled={!r.canApply || running || res?.state === 'ok'} aria-label={`Give ${r.row.team} ${labelOf(r.row.target)} on ${r.row.repo}`} onChange={onToggle} />
      </span>
      <span role="cell" class="rg-sync-repo"><a href={`https://github.com/${org}/${r.row.repo}`}>{r.row.repo}</a></span>
      <span role="cell" class="rg-mono">{r.row.team}</span>
      <span role="cell" class="rg-muted">{labelOf(r.row.current)}</span>
      <span role="cell"><b>{labelOf(r.row.target)}</b></span>
      {!r.canApply && !res && <span class="rg-sync-note rg-muted">Needs an org owner or a repo admin</span>}
      {res?.state === 'running' && <span class="rg-sync-note rg-muted">Granting…</span>}
      {res?.state === 'ok' && <span class="rg-sync-note rg-ok">Granted</span>}
      {res?.state === 'error' && (
        <span class="rg-sync-note rg-error" role="alert">
          {res.kind === 'permissions' ? permissionsText(res.message, org) : res.message}
          {res.detail && <span class="rg-muted"> ({res.detail})</span>}
        </span>
      )}
    </div>
  );
}

/** "... in Settings → GitHub Apps." with that phrase linked to the installation settings (§6). */
function permissionsText(message: string, org: string) {
  const link = 'Settings → GitHub Apps';
  const i = message.indexOf(link);
  if (i < 0) return message;
  return <>{message.slice(0, i)}<a href={installationsUrl(org)} target="_blank" rel="noopener"><b>{link}</b></a>{message.slice(i + link.length)}</>;
}
