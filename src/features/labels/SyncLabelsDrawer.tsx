import { useState } from 'preact/hooks';
import { installationsUrl } from '../../core/grant';
import { Drawer } from '../../ui/Drawer';
import type { Controller } from '../grouped-view/controller';
import { useStore } from '../store';
import type { LabelRowState } from './labels-controller';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Sync labels (C2): one row per (repository, label or milestone) that the repository does not have. Add-only. */
export function SyncLabelsDrawer({ ctl }: { ctl: Controller }) {
  const l = ctl.labels;
  const { sync } = useStore(l.store);
  const s = ctl.store.get();
  const [copy, setCopy] = useState<{ done: boolean; fallback: string | null }>({ done: false, fallback: null });
  if (!sync) return null;

  const { rows } = sync;
  const running = sync.phase === 'running';
  const applicable = rows.filter((r) => r.canApply);
  const skipped = rows.filter((r) => !r.canApply);
  const pending = rows.filter((r) => r.checked && r.canApply && r.result?.state !== 'ok');
  const done = rows.filter((r) => r.result?.state === 'ok').length;
  const failed = rows.filter((r) => r.result?.state === 'error').length;
  const noApp = s.access?.level === 'no-app';

  const doCopy = async () => {
    const text = l.listText(rows);
    try {
      await navigator.clipboard.writeText(text);
      setCopy({ done: true, fallback: null });
    } catch {
      setCopy({ done: false, fallback: text }); // clipboard refused: show the text selected
    }
  };

  return (
    <Drawer
      title="Sync labels"
      titleId="rg-labels-title"
      onClose={() => l.closeSync()}
      footer={
        <>
          <span class="rg-grow">Only adds what is missing. It never changes, renames, recolors or deletes a label or milestone.</span>
          <button type="button" class="rg-btn" onClick={() => l.closeSync()}>{done || failed ? 'Close' : 'Cancel'}</button>
          <button type="button" class="rg-btn rg-btn-primary" disabled={running || !pending.length || sync.phase === 'loading'} onClick={() => void l.apply()}>
            {running ? 'Adding…' : `Add to repositories${pending.length ? ` (${pending.length})` : ''}`}
          </button>
        </>
      }
    >
      {sync.phase === 'loading' ? (
        <p class="rg-muted" role="status">Reading the labels and milestones of the repositories…</p>
      ) : sync.error ? (
        <p class="rg-error" role="alert">{sync.error}</p>
      ) : (
        <>
          <h3 class="rg-sync-head">
            {applicable.length || done || failed
              ? `Add ${plural(applicable.length + done, 'label or milestone', 'labels and milestones')} to ${plural(new Set(rows.filter((r) => r.canApply).map((r) => r.row.repo)).size, 'repository', 'repositories')}`
              : 'Every repository already has the default labels and milestones'}
          </h3>
          {!rows.length && <p class="rg-muted">Nothing to sync in {plural(sync.repos, 'repository', 'repositories')}.</p>}
          {sync.paused && <p class="rg-hint" role="status">{sync.paused}. Some repositories were not checked; open this drawer again later.</p>}
          {!!sync.unreadable.length && (
            <p class="rg-hint rg-warn" role="status">
              {plural(sync.unreadable.length, 'repository was', 'repositories were')} skipped: {sync.unreadable.slice(0, 3).map((u) => u.repo).join(', ')}{sync.unreadable.length > 3 ? '…' : ''}. {sync.unreadable[0].message}
            </p>
          )}
          {running && sync.progress && (
            <div class="rg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={sync.progress.total} aria-valuenow={sync.progress.done} aria-label="Adding labels and milestones">
              <i style={{ width: `${Math.round((sync.progress.done / Math.max(1, sync.progress.total)) * 100)}%` }} />
            </div>
          )}
          {!!rows.length && (
            <div class="rg-sync" role="table" aria-label="Labels and milestones to add">
              <div class="rg-sync-row rg-sync-th" role="row">
                <span role="columnheader">
                  <input type="checkbox" aria-label="Select all" disabled={running || !applicable.length} checked={!!applicable.length && applicable.every((r) => r.checked || r.result?.state === 'ok')} onChange={(e) => l.setAll((e.target as HTMLInputElement).checked)} />
                </span>
                <span role="columnheader">Repository</span>
                <span role="columnheader">Name</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">Status</span>
              </div>
              {rows.map((r) => <Row key={r.id} r={r} running={running} onToggle={() => l.toggleRow(r.id)} org={s.org} />)}
            </div>
          )}
          {!!skipped.length && <p class="rg-hint" role="note">{plural(skipped.length, 'label', 'labels')} already exist with a different color. They are left as they are.</p>}
          {(done > 0 || failed > 0) && !running && (
            <p role="status" class={failed ? 'rg-error' : 'rg-ok'}>{done > 0 && `${plural(done, 'row', 'rows')} added. `}{failed > 0 && `${plural(failed, 'row', 'rows')} failed.`}</p>
          )}
          {!!applicable.length && (
            <div><button type="button" class="rg-linkish" onClick={doCopy}>Copy list</button></div>
          )}
          {copy.done && <p class="rg-hint" role="status">Copied.</p>}
          {copy.fallback && (
            <div class="rg-field">
              <textarea class="rg-input rg-mono" readOnly rows={6} value={copy.fallback} aria-label="List to copy" ref={(el) => el?.select()} />
              <span class="rg-hint">Press Ctrl+C or ⌘C to copy.</span>
            </div>
          )}
          {noApp && <p class="rg-hint">Repository Group for Github is not installed in {s.org}, so labels cannot be added from here.</p>}
        </>
      )}
    </Drawer>
  );
}

function Row({ r, running, onToggle, org }: { r: LabelRowState; running: boolean; onToggle: () => void; org: string }) {
  const res = r.result;
  const row = r.row;
  return (
    <div class={`rg-sync-row${r.canApply ? '' : ' rg-off'}`} role="row" data-repo={row.repo} data-kind={row.kind} data-name={row.name}>
      <span role="cell">
        <input type="checkbox" checked={r.checked} disabled={!r.canApply || running || res?.state === 'ok'} aria-label={`Add ${row.kind} ${row.name} to ${row.repo}`} onChange={onToggle} />
      </span>
      <span role="cell" class="rg-sync-repo"><a href={`https://github.com/${org}/${row.repo}`}>{row.repo}</a></span>
      <span role="cell">
        {row.kind === 'label' && <i class="rg-swatch" style={{ background: `#${row.label.color}` }} aria-hidden="true" />}
        <span class="rg-mono">{row.name}</span>
      </span>
      <span role="cell" class="rg-muted">{row.kind === 'label' ? 'Label' : 'Milestone'}</span>
      <span role="cell" class="rg-muted">{r.canApply ? 'Missing' : 'Exists'}</span>
      {row.kind === 'label' && row.status === 'differs' && !res && <span class="rg-sync-note rg-muted">exists (different color) · skipped</span>}
      {res?.state === 'running' && <span class="rg-sync-note rg-muted">Adding…</span>}
      {res?.state === 'ok' && <span class="rg-sync-note rg-ok">Added</span>}
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
