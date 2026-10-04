import { useEffect, useRef, useState } from 'preact/hooks';
import { displayName } from '../../core/edit';
import { labelOf } from '../../core/permissions';
import { teamTargetChanges } from '../../core/teams';
import type { TreeModel } from '../../core/tree';
import { Icon } from '../../ui/Icon';
import type { Controller, PendingMove } from './controller';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SHOWN = 8;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** "infra/dagsrv" -> "Infra / Scheduler" with display names; '' = Ungrouped. */
const titled = (model: TreeModel | null, key: string): string =>
  key
    ? key
        .split('/')
        .map((_, i, parts) => {
          const g = model?.byKey.get(parts.slice(0, i + 1).join('/'))?.group;
          return g ? displayName(g) : parts[i];
        })
        .join(' / ')
    : 'Ungrouped';

const noAccess = 'no access target';

const list = (names: string[]) => (
  <ul class="rg-mv-list">
    {names.slice(0, SHOWN).map((n) => <li key={n}><code>{n}</code></li>)}
    {names.length > SHOWN && <li class="rg-muted">+{names.length - SHOWN} more</li>}
  </ul>
);

/**
 * A4 confirmation: the move is only staged until the person clicks OK. Lists the repositories, skips the ones that are
 * already there and warns when a pattern still catches a repository sent to Ungrouped. A failed commit keeps the dialog
 * open with the error inline.
 */
export function MoveDialog({ ctl, move }: { ctl: Controller; move: PendingMove }) {
  const s = ctl.store.get();
  const model = ctl.model();
  const box = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const { plan, to } = move;
  const key = to.join('/');
  const dest = key ? `${s.org} / ${titled(model, key)}` : 'Ungrouped';
  const n = plan.moved.length;
  const canCommit = n > 0 && !plan.error;
  const share = move.mode === 'share';
  const what = plural(n, 'repository', 'repositories');
  const skipped = (names: string[]) => `${names.slice(0, SHOWN).join(', ')}${names.length > SHOWN ? `, +${names.length - SHOWN} more` : ''}`;
  // A3: groups that still list a repository sent to Ungrouped. Exact-name entries can be removed; rules only warn.
  const exactShared = plan.stillShared.filter((x) => x.exact);
  const ruleShared = plan.stillShared.filter((x) => !x.exact);
  const droppable = !share && !to.length ? exactShared.length : 0;
  // Informational: the target team access follows the home group. A move grants and removes nothing by itself.
  const groups = s.config && s.config.exists && s.config.config ? s.config.config.groups : [];
  const teamLines = new Map<string, number>();
  if (!share && n > 0)
    for (const repo of plan.moved)
      for (const c of teamTargetChanges(groups, model?.placed.get(repo) ?? '', key))
        {
          const line = `${c.slug}: ${c.from ? labelOf(c.from) : noAccess} -> ${c.to ? labelOf(c.to) : noAccess}`;
          teamLines.set(line, (teamLines.get(line) ?? 0) + 1);
        }

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const target = box.current?.querySelector<HTMLElement>('#rg-mv-ok') ?? box.current?.querySelector<HTMLElement>('#rg-mv-cancel');
    target?.focus();
    return () => opener?.isConnected && opener.focus?.();
  }, []);

  const confirm = async () => {
    if (busy || !canCommit) return;
    setBusy(true);
    setProblem('');
    const r = await ctl.confirmMove();
    if (!r.ok) setProblem(r.message);
    setBusy(false); // on success the controller closed the dialog
  };
  const cancel = () => !busy && ctl.cancelMove();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
      return;
    }
    if (e.key !== 'Tab' || !box.current) return;
    const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const [a, z] = [items[0], items[items.length - 1]];
    if (e.shiftKey && document.activeElement === a) (e.preventDefault(), z.focus());
    else if (!e.shiftKey && document.activeElement === z) (e.preventDefault(), a.focus());
  };

  return (
    <div class="rg-dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div class="rg-dialog" role="alertdialog" aria-modal="true" aria-labelledby="rg-mv-title" aria-describedby="rg-mv-body" ref={box} onKeyDown={onKey}>
        <div class="rg-dialog-head">
          <h2 id="rg-mv-title">{share ? (n > 0 || plan.error ? `Also list ${what} in ${dest}` : `Also list in ${dest}`) : n > 0 || plan.error ? `Move ${what} to ${dest}` : `Move to ${dest}`}</h2>
          <button type="button" class="rg-chev" aria-label="Close" disabled={busy} onClick={cancel}><Icon name="x" /></button>
        </div>
        <div class="rg-dialog-body" id="rg-mv-body">
          {plan.error && <p class="rg-error" role="alert">{plan.error}</p>}
          {n > 0 && (
            <>
              <p>
                {share ? (
                  n === 1 ? <>Its home stays in <b>{titled(model, model?.placed.get(plan.moved[0]) ?? '')}</b>; it will be listed here too, by exact name in the shared list of <b>{titled(model, key)}</b>.</>
                  : <>Their homes stay where they are; they will be listed here too, by exact name in the shared list of <b>{titled(model, key)}</b>.</>
                ) : to.length
                  ? <>These repositories will be listed by exact name in <b>{titled(model, key)}</b> and taken out of the other groups' exact lists.</>
                  : <>These repositories will be taken out of the exact lists of their groups.</>}
              </p>
              {list(plan.moved)}
            </>
          )}
          {share && plan.already.length > 0 && (
            <p class="rg-mv-note" role="status">Already listed in {titled(model, key)}, skipped: {skipped(plan.already)}.</p>
          )}
          {share && plan.redundant.length > 0 && (
            <p class="rg-mv-note" role="status">Already live in {titled(model, key)} or below it, skipped: {skipped(plan.redundant)}.</p>
          )}
          {share && n === 0 && !plan.error && <p class="rg-mv-note" role="status">There is nothing to commit.</p>}
          {!share && plan.wasListed.length > 0 && (
            <p class="rg-mv-note" role="status">
              Already listed here through a shared rule. Moving makes {plan.wasListed.length === 1 ? 'it' : 'them'} live here: {skipped(plan.wasListed)}.
            </p>
          )}
          {!share && teamLines.size > 0 && (
            <div class="rg-mv-note" role="status">
              <b>Team access targets change.</b> Nothing is granted or removed by a move; Sync access uses the new target.
              <ul class="rg-mv-list">
                {[...teamLines].map(([line, c]) => <li key={line}>{line}{n > 1 ? <span class="rg-muted"> ({plural(c, 'repository', 'repositories')})</span> : ''}</li>)}
              </ul>
            </div>
          )}
          {!share && plan.already.length > 0 && (
            <p class="rg-mv-note" role="status">
              {n === 0 && !plan.stillCaught.length
                ? `${plan.already.length === 1 ? `${plan.already[0]} is` : `All ${plan.already.length} selected repositories are`} already in ${key ? titled(model, key) : 'Ungrouped'}. There is nothing to commit.`
                : `Already in ${key ? titled(model, key) : 'Ungrouped'}, skipped: ${plan.already.slice(0, SHOWN).join(', ')}${plan.already.length > SHOWN ? `, +${plan.already.length - SHOWN} more` : ''}.`}
            </p>
          )}
          {plan.stillCaught.length > 0 && (
            <p class="rg-mv-note rg-mv-warn" role="status">
              <b>A rule still catches {plan.stillCaught.length === 1 ? 'this repository' : 'these repositories'}.</b>{' '}
              {plan.stillCaught.slice(0, SHOWN).map((c) => `${c.repo} stays in ${titled(model, c.key)} (rule ${c.rule})`).join('; ')}
              {plan.stillCaught.length > SHOWN ? `; +${plan.stillCaught.length - SHOWN} more` : ''}. Edit that rule to release it.
            </p>
          )}
          {droppable > 0 && (
            <label class="rg-mv-note rg-check-row">
              <input type="checkbox" id="rg-mv-drop-shared" checked={move.dropShared} onChange={(e) => ctl.setDropShared((e.target as HTMLInputElement).checked)} />{' '}
              Also stop listing {droppable === 1 && plan.moved.length === 1 ? 'it' : 'them'} in groups that share {droppable === 1 && plan.moved.length === 1 ? 'it' : 'them'} ({droppable})
            </label>
          )}
          {!share && ruleShared.length > 0 && (
            <p class="rg-mv-note rg-mv-warn" role="status">
              <b>A shared rule still lists {ruleShared.length === 1 ? 'this repository' : 'these repositories'}.</b>{' '}
              {ruleShared.slice(0, SHOWN).map((c) => `${c.repo} in ${titled(model, c.key)} (rule ${c.rule})`).join('; ')}
              {ruleShared.length > SHOWN ? `; +${ruleShared.length - SHOWN} more` : ''}. Edit that group to release it.
            </p>
          )}
          {problem && <p class="rg-error" role="alert">{problem}</p>}
        </div>
        <div class="rg-dialog-foot">
          <button type="button" class="rg-btn" id="rg-mv-cancel" disabled={busy} onClick={cancel}>{canCommit ? 'Cancel' : 'Close'}</button>
          {canCommit && (
            <button type="button" class="rg-btn rg-btn-primary" id="rg-mv-ok" disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Committing…' : 'OK, commit to repo-groups.yml'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
