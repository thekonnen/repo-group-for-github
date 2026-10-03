import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Right-side modal drawer: role=dialog, closes on Esc or backdrop click, keeps Tab inside, returns focus. */
export function Drawer({ title, titleId, onClose, children, footer }: { title: string; titleId: string; onClose: () => void; children: ComponentChildren; footer: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('.rg-drawer-body input, .rg-drawer-body textarea, .rg-drawer-body button') ?? ref.current;
    first?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const [a, z] = [items[0], items[items.length - 1]];
    const active = ref.current.getRootNode() instanceof ShadowRoot ? (ref.current.getRootNode() as ShadowRoot).activeElement : document.activeElement;
    if (e.shiftKey && active === a) (e.preventDefault(), z.focus());
    else if (!e.shiftKey && active === z) (e.preventDefault(), a.focus());
  };

  return (
    <div class="rg-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="rg-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} onKeyDown={onKey}>
        <div class="rg-drawer-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" class="rg-chev" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div class="rg-drawer-body">{children}</div>
        <div class="rg-drawer-foot">{footer}</div>
      </div>
    </div>
  );
}
