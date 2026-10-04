import { useEffect, useRef, useState } from 'preact/hooks';
import { displayName } from '../../core/edit';
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
          <h2 id="rg-mv-title">{n > 0 || plan.error ? `Move ${plural(n, 'repository', 'repositories')} to ${dest}` : `Move to ${dest}`}</h2>
          <button type="button" class="rg-chev" aria-label="Close" disabled={busy} onClick={cancel}><Icon name="x" /></button>
        </div>
        <div class="rg-dialog-body" id="rg-mv-body">
          {plan.error && <p class="rg-error" role="alert">{plan.error}</p>}
          {n > 0 && (
            <>
              <p>
                {to.length
                  ? <>These repositories will be listed by exact name in <b>{titled(model, key)}</b> and taken out of the other groups' exact lists.</>
                  : <>These repositories will be taken out of the exact lists of their groups.</>}
              </p>
              {list(plan.moved)}
            </>
          )}
          {plan.already.length > 0 && (
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
