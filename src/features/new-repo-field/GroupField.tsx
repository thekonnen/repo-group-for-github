import { useEffect, useRef, useState } from 'preact/hooks';
import { pathLabel, type Destination } from '../../core/newrepo';
import type { Group } from '../../core/types';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { useStore } from '../store';
import type { NrController } from './controller';

const AUTO = '';

/** The sentence under the path; same text as destinationSentence() with code and bold. */
function Sentence({ d, groups }: { d: Destination; groups: Group[] }) {
  switch (d.kind) {
    case 'empty':
      return <>Type a name to see which group it lands in.</>;
    case 'auto-hit':
      return <>Lands here because it matches the rule <code>{d.rule}</code>. Pick another group to override.</>;
    case 'auto-miss':
      return <>No rule matches this name yet, so it will show under Ungrouped. Pick a group to file it now.</>;
    case 'same':
      return <>Already matches the rule <code>{d.rule}</code> of this group. repo-groups.yml stays the same.</>;
    case 'diff':
      return <>Adds <code>{d.name}</code> to the match list of <b>{pathLabel(d.pickedKey, groups)}</b> in repo-groups.yml (otherwise it would land in {d.autoKey ? pathLabel(d.autoKey, groups) : 'Ungrouped'}).</>;
  }
}

const ExtTag = () => (
  <span class="rg-ext-tag">
    <i />
    Repository Group
  </span>
);

/** Group block of "Create a new repository" (F9). The Teams block (F12) goes directly below it, as a sibling component. */
export function GroupField({ ctl }: { ctl: NrController }) {
  const s = useStore(ctl.store);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  if (s.phase !== 'ready') return null;

  const d = ctl.destination();
  const opts = ctl.options();
  const keys = [AUTO, ...opts.map((o) => o.key)];
  const name = d.name || 'new-repository';
  const chain = d.destKey ? d.destKey.split('/') : [];
  const chainLabels = d.destKey ? pathLabel(d.destKey, s.groups).split(' / ') : [];

  return (
    <div class="rg-nr" id="rg-nr-group" data-rg="new-repo-group">
      <div class="rg-inject">
        <div class="rg-inject-head">
          <label id="rg-nr-label" for="rg-nr-picker">Group</label>
          <ExtTag />
        </div>
        {s.canWrite ? (
          <Picker ctl={ctl} open={open} setOpen={setOpen} active={active} setActive={setActive} keys={keys} btn={btn} list={list} />
        ) : (
          <span class="rg-hint" id="rg-nr-note">
            Org groups are read-only for you, so this repository is filed by the match rules of {s.org}/.github. You can organize it in My groups afterwards.
          </span>
        )}
        <div class="rg-nr-dest" id="rg-nr-dest" aria-live="polite">
          <div class="rg-dest-path">
            <Avatar name={s.org ?? ''} cls="rg-mini-av" root />
            {s.org}
            {chain.map((c, i) => (
              <>
                <span aria-hidden="true">/</span>
                <Avatar key={'a' + i} name={c} label={chainLabels[i]} cls="rg-mini-av" />
                {chainLabels[i]}
              </>
            ))}
            <span aria-hidden="true">/</span>
            <b>{name}</b>
          </div>
          <span class="rg-hint">
            <Sentence d={d} groups={s.groups} />
          </span>
        </div>
      </div>
    </div>
  );
}

interface PickerProps {
  ctl: NrController;
  open: boolean;
  setOpen: (v: boolean) => void;
  active: number;
  setActive: (n: number) => void;
  keys: string[];
  btn: { current: HTMLButtonElement | null };
  list: { current: HTMLUListElement | null };
}

function Picker({ ctl, open, setOpen, active, setActive, keys, btn, list }: PickerProps) {
  const s = ctl.store.get();
  const d = ctl.destination();
  const opts = ctl.options();
  const optId = (k: string) => `rg-opt-${k === AUTO ? 'auto' : k.replace(/[^\w-]/g, '_')}`;

  const show = () => {
    setActive(Math.max(0, keys.indexOf(s.pickedKey)));
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const choose = (k: string) => {
    ctl.pick(k);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector('.rg-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show();
    }
  };
  const onListKey = (e: KeyboardEvent) => {
    const last = keys.length - 1;
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (e.key === 'ArrowDown') (stop(), setActive(Math.min(last, active + 1)));
    else if (e.key === 'ArrowUp') (stop(), setActive(Math.max(0, active - 1)));
    else if (e.key === 'Home') (stop(), setActive(0));
    else if (e.key === 'End') (stop(), setActive(last));
    else if (e.key === 'Enter' || e.key === ' ') (stop(), choose(keys[active]));
    else if (e.key === 'Escape') (stop(), close(true));
    else if (e.key === 'Tab') close(false);
  };

  const picked = s.pickedKey ? opts.find((o) => o.key === s.pickedKey) : null;
  const auto = d.autoKey ? pathLabel(d.autoKey, s.groups) : null;
  return (
    <div class="rg-picker-wrap">
      <button
        type="button"
        class="rg-picker"
        id="rg-nr-picker"
        ref={btn}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="rg-nr-pop"
        aria-labelledby="rg-nr-label rg-nr-picker-lbl"
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onButtonKey}
      >
        <span class="rg-lbl" id="rg-nr-picker-lbl">
          {picked ? (
            <span class="rg-lbl-in">
              <Avatar name={picked.name} label={picked.label} cls="rg-mini-av" />
              {pathLabel(picked.key, s.groups)}
            </span>
          ) : (
            <span class="rg-lbl-in">
              <Icon name="sparkle" />
              Automatic{auto && <span class="rg-muted"> → {auto}</span>}
            </span>
          )}
        </span>
        <span class="rg-caret"><Icon name="chev" /></span>
      </button>
      <ul
        class="rg-pop"
        id="rg-nr-pop"
        role="listbox"
        aria-labelledby="rg-nr-label"
        tabIndex={-1}
        hidden={!open}
        ref={list}
        aria-activedescendant={open ? optId(keys[active]) : undefined}
        onKeyDown={onListKey}
      >
        <li
          role="option"
          id={optId(AUTO)}
          class={active === 0 ? 'rg-active' : ''}
          aria-selected={s.pickedKey === AUTO}
          onMouseMove={() => setActive(0)}
          onClick={() => choose(AUTO)}
        >
          <span class="rg-tick">{s.pickedKey === AUTO && <Icon name="check" />}</span>
          <Icon name="sparkle" />
          <span>
            Automatic <span class="rg-muted">· by match rules</span>
          </span>
        </li>
        <li class="rg-sep" role="presentation" />
        {opts.map((o, i) => (
          <li
            role="option"
            key={o.key}
            id={optId(o.key)}
            class={active === i + 1 ? 'rg-active' : ''}
            aria-selected={s.pickedKey === o.key}
            style={{ paddingLeft: `${8 + o.depth * 18}px` }}
            onMouseMove={() => setActive(i + 1)}
            onClick={() => choose(o.key)}
          >
            <span class="rg-tick">{s.pickedKey === o.key && <Icon name="check" />}</span>
            <Avatar name={o.name} label={o.label} cls="rg-mini-av" />
            <span>{o.label}</span>
            <span class="rg-count">{o.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
