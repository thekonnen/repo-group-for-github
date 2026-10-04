import { useEffect, useRef, useState } from 'preact/hooks';
import { sideItems } from '../../core/tree';
import { Icon } from '../../ui/Icon';
import type { Controller } from './controller';
import { GroupPicker, placeBelow, type PickItem } from './GroupPicker';

/**
 * The "⋯" menu of a repository row (A4). One entry today: "Move to…", which opens the group picker.
 * Keyboard: Enter/Space/ArrowDown on the button opens the menu, Esc closes it and returns focus.
 */
export function RepoMenu({ ctl, repo, current }: { ctl: Controller; repo: string; current: string }) {
  const [mode, setMode] = useState<'closed' | 'menu' | 'pick'>('closed');
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
  const model = mode === 'pick' ? ctl.model() : null;
  const items: PickItem[] = model ? sideItems(model).map((i) => ({ ...i, current: i.key === current })) : [];
  const menuPos = mode === 'menu' && btn.current ? placeBelow(btn.current.getBoundingClientRect(), 200, 44, window.innerWidth, window.innerHeight) : { left: 8, top: 8 };

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
          <button type="button" role="menuitem" class="rg-menu-item" ref={item} onClick={() => setMode('pick')}>Move to…</button>
        </div>
      )}
      {mode === 'pick' && model && (
        <GroupPicker
          items={items}
          label={`Move ${repo} to`}
          anchor={btn.current}
          onClose={close}
          onPick={(key) => {
            close(true);
            void ctl.moveRepo(repo, key ? key.split('/') : []);
          }}
        />
      )}
    </span>
  );
}
