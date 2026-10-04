import { useEffect, useRef, useState } from 'preact/hooks';
import { sideItems } from '../../core/tree';
import { Icon } from '../../ui/Icon';
import type { Controller } from './controller';
import { GroupPicker, placeBelow, type PickItem } from './GroupPicker';

/** The group list of the picker: "Ungrouped (top level)", then every group and subgroup. */
export const pickItems = (ctl: Controller, current?: string): PickItem[] => {
  const model = ctl.model();
  return model ? sideItems(model).map((i) => ({ ...i, current: current !== undefined && i.key === current })) : [];
};

/**
 * The "⋯" menu of a repository row (A4). Entries: "Send to…" (move) and "Also list in…" (A3), both open the group picker. Picking a group only
 * stages the move; the confirmation dialog commits it.
 * Keyboard: Enter/Space/ArrowDown on the button opens the menu, Esc closes it and returns focus.
 */
export function RepoMenu({ ctl, repo, current }: { ctl: Controller; repo: string; current: string }) {
  const [mode, setMode] = useState<'closed' | 'menu' | 'pick' | 'share'>('closed');
  const btn = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mode === 'menu') item.current?.focus();
  }, [mode]);
  useEffect(() => {
    if (mode !== 'menu') return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!item.current?.parentElement?.contains(t) && !btn.current?.contains(t)) setMode('closed');
    };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [mode]);

  const close = (refocus: boolean) => {
    setMode('closed');
    if (refocus) btn.current?.focus();
  };
  const items = mode === 'pick' ? pickItems(ctl, current) : mode === 'share' ? pickItems(ctl).filter((i) => i.key) : []; // "Also list in…" needs a real group
  const menuPos = mode === 'menu' && btn.current ? placeBelow(btn.current.getBoundingClientRect(), 200, 80, window.innerWidth, window.innerHeight) : { left: 8, top: 8 };

  return (
    <span class="rg-kebab-wrap">
      <button
        type="button"
        class="rg-btn rg-kebab"
        ref={btn}
        aria-label={`More actions for ${repo}`}
        aria-haspopup="menu"
        aria-expanded={mode !== 'closed'}
        onClick={() => setMode(mode === 'closed' ? 'menu' : 'closed')}
        onKeyDown={(e) => e.key === 'ArrowDown' && (e.preventDefault(), setMode('menu'))}
      >
        <Icon name="kebab" />
      </button>
      {mode === 'menu' && (
        <div class="rg-pop rg-menu" role="menu" style={{ left: menuPos.left, top: menuPos.top }} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close(true))}>
          <button type="button" role="menuitem" class="rg-menu-item" ref={item} onClick={() => setMode('pick')}>Send to…</button>
          <button type="button" role="menuitem" class="rg-menu-item" onClick={() => setMode('share')}>Also list in…</button>
        </div>
      )}
      {(mode === 'pick' || mode === 'share') && items.length > 0 && (
        <GroupPicker
          items={items}
          label={mode === 'share' ? `Also list ${repo} in` : `Send ${repo} to`}
          anchor={btn.current}
          onClose={close}
          onPick={(key) => {
            close(false); // focus goes to the confirmation dialog
            if (mode === 'share') ctl.stageShare([repo], key.split('/'));
            else ctl.stageMove([repo], key ? key.split('/') : []);
          }}
        />
      )}
    </span>
  );
}

/** "N selected · Send to… · Clear" above the list (A4). */
export function SelectionBar({ ctl, selected }: { ctl: Controller; selected: string[] }) {
  const [open, setOpen] = useState<'' | 'move' | 'share'>('');
  const btn = useRef<HTMLButtonElement>(null);
  const shareBtn = useRef<HTMLButtonElement>(null);
  if (!selected.length) return null;
  return (
    <div class="rg-selbar" role="region" aria-label="Selected repositories">
      <b>{selected.length} selected</b>
      <span class="rg-muted">·</span>
      <button type="button" class="rg-btn rg-btn-primary" ref={btn} aria-haspopup="listbox" aria-expanded={open === 'move'} onClick={() => setOpen(open === 'move' ? '' : 'move')}>Send to…</button>
      <button type="button" class="rg-btn" ref={shareBtn} aria-haspopup="listbox" aria-expanded={open === 'share'} onClick={() => setOpen(open === 'share' ? '' : 'share')}>Also list in…</button>
      <button type="button" class="rg-btn" onClick={() => ctl.clearSelection()}>Clear</button>
      {open && (
        <GroupPicker
          items={open === 'share' ? pickItems(ctl).filter((i) => i.key) : pickItems(ctl)}
          label={open === 'share' ? `Also list ${selected.length} selected in` : `Send ${selected.length} selected to`}
          anchor={open === 'share' ? shareBtn.current : btn.current}
          onClose={(refocus) => (setOpen(''), refocus && (open === 'share' ? shareBtn : btn).current?.focus())}
          onPick={(key) => {
            const mode = open;
            setOpen('');
            if (mode === 'share') ctl.stageShare(selected, key.split('/'));
            else ctl.stageMove(selected, key ? key.split('/') : []);
          }}
        />
      )}
    </div>
  );
}
