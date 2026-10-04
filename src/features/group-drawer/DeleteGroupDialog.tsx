import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { deleteImpact, displayName } from '../../core/edit';
import { nodeAt, type TreeModel } from '../../core/tree';
import type { Group } from '../../core/types';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import type { Controller, SaveResult } from '../grouped-view/controller';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** "infra/dagsrv" -> "Infra / Scheduler" with display names. */
const titled = (model: TreeModel, key: string): string =>
  key
    .split('/')
    .map((_, i, parts) => {
      const g = model.byKey.get(parts.slice(0, i + 1).join('/'))?.group;
      return g ? displayName(g) : parts[i];
    })
    .join(' / ');

/**
 * Delete group: a GitHub-style confirmation. It says what goes away and where the repositories land, and the red
 * button stays off until the person types the group's full path. One commit to repo-groups.yml; no repository is touched.
 */
export function DeleteGroupDialog({ ctl, path, groups, onClose }: { ctl: Controller; path: string[]; groups: Group[]; onClose: () => void }) {
  const s = ctl.store.get();
  const model = ctl.model()!;
  const node = nodeAt(model, path);
  const key = path.join('/');
  const impact = useMemo(() => deleteImpact(groups, path, s.repos.filter((r) => !r.archived)), [groups, key, s.repos]);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const kind = path.length > 1 ? 'subgroup' : 'group';

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('#rg-del-confirm')?.focus();
    return () => opener?.focus?.();
  }, []);

  if (!node || !impact) return null;
  const label = titled(model, key);
  const ok = typed.trim() === key;

  /** `fieldValue` is read from the input itself so a fast Enter right after typing or pasting is not judged on stale state. */
  const remove = async (fieldValue: string = typed) => {
    if (fieldValue.trim() !== key || busy) return;
    setBusy(true);
    setProblem('');
    const r: SaveResult = await ctl.save({ kind: 'delete', path });
    if (!r.ok) setProblem(r.message);
    setBusy(false); // on success the controller closed the drawer, and this dialog with it
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busy) onClose();
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
    <div class="rg-dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div class="rg-dialog" role="alertdialog" aria-modal="true" aria-labelledby="rg-del-title" aria-describedby="rg-del-body" ref={box} onKeyDown={onKey}>
        <div class="rg-dialog-head">
          <h2 id="rg-del-title">Delete {s.org} / {label}</h2>
          <button type="button" class="rg-chev" aria-label="Close" disabled={busy} onClick={onClose}><Icon name="x" /></button>
        </div>
        <div class="rg-dialog-body" id="rg-del-body">
          <div class="rg-del-hero">
            <Avatar name={node.group.name} label={displayName(node.group)} cls="rg-mini-av" />
            <b>{label}</b>
            <span class="rg-muted">
              {plural(impact.subgroups, 'subgroup')} · {plural(impact.rules, 'rule')} · {plural(impact.repos, 'repository', 'repositories')}
            </span>
          </div>

          <ul class="rg-del-effects">
            <li>
              This {kind}
              {impact.subgroups ? ` and its ${plural(impact.subgroups, 'subgroup')}` : ''} will be removed from <code>repo-groups.yml</code> in one commit. The file's history keeps them.
            </li>
            <li>
              <b>No repository is deleted.</b>{' '}
              {impact.parentKey
                ? `Its ${plural(impact.movedRules, 'rule')} move to ${titled(model, impact.parentKey)}, so its repositories stay there.`
                : 'It is a top-level group, so its repositories become Ungrouped unless another group\'s rules catch them.'}
            </li>
            {impact.repos > 0 && (
              <li>
                {plural(impact.repos, 'repository', 'repositories')} now in this {kind}: {impact.landing.map((l) => `${l.count} will be ${l.key ? `in ${titled(model, l.key)}` : 'Ungrouped'}`).join(', ')}.
              </li>
            )}
            {impact.hasTeams && <li>Team access already granted on GitHub is not removed; only the team tags go away.</li>}
            {impact.hasLogo && <li>Its logo file stays in <code>{s.org}/.github/logos</code>.</li>}
          </ul>

          <label for="rg-del-confirm" class="rg-del-label">
            To confirm, type <code>{key}</code> below
          </label>
          <input id="rg-del-confirm" class="rg-input rg-mono" value={typed} autocomplete="off" spellcheck={false} onInput={(e) => (setTyped((e.target as HTMLInputElement).value), setProblem(''))}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void remove((e.target as HTMLInputElement).value))} />
          {problem && <p class="rg-error" role="alert">{problem}</p>}
        </div>
        <div class="rg-dialog-foot">
          <button type="button" class="rg-btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" class="rg-btn rg-btn-danger-solid" id="rg-del-go" disabled={!ok || busy} onClick={() => void remove(typed)}>
            {busy ? 'Deleting…' : `I want to delete this ${kind}`}
          </button>
        </div>
      </div>
    </div>
  );
}
