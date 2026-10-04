import { useEffect, useRef, useState } from 'preact/hooks';
import type { SideItem } from '../../core/tree';
import { Icon } from '../../ui/Icon';
import { Avatar } from '../../ui/Avatar';

export interface PickItem extends SideItem {
  /** Marks the group the repository is in now. It stays selectable (the move is then a no-op with a toast). */
  current?: boolean;
}

/** Fixed position below (or above) the anchor, kept inside the viewport: the list box clips absolute popovers. */
export function placeBelow(anchor: DOMRect, width: number, height: number, vw: number, vh: number): { left: number; top: number } {
  const left = Math.max(8, Math.min(anchor.left, vw - width - 8));
  const below = anchor.bottom + 4;
  const top = below + height > vh - 8 && anchor.top - 4 - height >= 8 ? anchor.top - 4 - height : below;
  return { left, top };
}

/**
 * Small listbox popover to choose a group (A4 "Move to…"). Keyboard: arrows, Home/End, Enter/Space choose, Esc closes
 * and returns focus to the anchor, Tab closes. `aria-activedescendant` tracks the active option.
 */
export function GroupPicker({ items, label, anchor, onPick, onClose }: { items: PickItem[]; label: string; anchor: HTMLElement | null; onPick: (key: string) => void; onClose: (refocus: boolean) => void }) {
  const list = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(Math.max(0, items.findIndex((i) => i.current)));
  const pos = anchor ? placeBelow(anchor.getBoundingClientRect(), 300, Math.min(320, items.length * 36 + 12), window.innerWidth, window.innerHeight) : { left: 8, top: 8 };
  const optId = (k: string) => `rg-mv-${k ? k.replace(/[^\w-]/g, '_') : 'root'}`;

  useEffect(() => {
    list.current?.focus();
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !anchor?.contains(t)) onClose(false);
    };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, []);
  useEffect(() => {
    list.current?.querySelector('.rg-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const onKey = (e: KeyboardEvent) => {
    const last = items.length - 1;
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (e.key === 'ArrowDown') (stop(), setActive((a) => Math.min(last, a + 1)));
    else if (e.key === 'ArrowUp') (stop(), setActive((a) => Math.max(0, a - 1)));
    else if (e.key === 'Home') (stop(), setActive(0));
    else if (e.key === 'End') (stop(), setActive(last));
    else if (e.key === 'Enter' || e.key === ' ') (stop(), onPick(items[active].key));
    else if (e.key === 'Escape') (stop(), onClose(true));
    else if (e.key === 'Tab') onClose(false);
  };

  return (
    <ul
      class="rg-pop rg-move-pop"
      role="listbox"
      tabIndex={-1}
      aria-label={label}
      aria-activedescendant={items[active] ? optId(items[active].key) : undefined}
      ref={list}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKey}
    >
      {items.map((it, i) => (
        <li
          key={it.key}
          id={optId(it.key)}
          role="option"
          aria-selected={!!it.current}
          class={i === active ? 'rg-active' : ''}
          style={{ paddingLeft: 8 + it.depth * 16 }}
          onMouseMove={() => active !== i && setActive(i)}
          onClick={() => onPick(it.key)}
        >
          {it.key ? <Avatar name={it.key.split('/').pop()!} label={it.name} cls="rg-mini-av" /> : <Icon name="repo" />}
          <span>{it.key ? it.name : 'Ungrouped (top level)'}</span>
          {it.current && <span class="rg-muted">current</span>}
          <span class="rg-count">{it.total}</span>
        </li>
      ))}
    </ul>
  );
}
