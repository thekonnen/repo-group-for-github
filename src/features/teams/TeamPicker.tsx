import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { PERMISSIONS, labelOf } from '../../core/permissions';
import type { OrgTeam } from '../../github/messages';
import { Icon } from '../../ui/Icon';

/** Read / Triage / Write / Maintain / Admin, plus the org's custom roles and the current value if it is one. */
export function PermissionSelect({ value, onChange, label, customRoles = [] }: { value: string; onChange: (v: string) => void; label: string; customRoles?: string[] }) {
  const custom = [...new Set([...customRoles, ...((PERMISSIONS as readonly string[]).includes(value) ? [] : [value])])];
  return (
    <select class="rg-select" aria-label={label} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {PERMISSIONS.map((p) => <option key={p} value={p}>{labelOf(p)}</option>)}
      {custom.map((r) => <option key={r} value={r}>{r}</option>)}
    </select>
  );
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * "Add team": a button that opens a filterable listbox of the org's teams (arrows, Enter, Esc). When the team list could
 * not be read (`teams` is null) the person can type a slug instead. Reused by the New repository field.
 */
export function TeamPicker({ teams, exclude = [], onPick, label = 'Add team', loading }: { teams: OrgTeam[] | null; exclude?: string[]; onPick: (slug: string) => void; label?: string; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const q = text.trim().toLowerCase();
  const optionsFor = (raw: string) => {
    const f = raw.trim().toLowerCase();
    const list: { slug: string; name?: string; typed?: boolean }[] = (teams ?? [])
      .filter((t) => !exclude.includes(t.slug) && (!f || t.slug.toLowerCase().includes(f) || t.name.toLowerCase().includes(f)))
      .map((t) => ({ slug: t.slug, name: t.name }));
    if (teams === null && SLUG.test(raw.trim()) && !exclude.includes(raw.trim())) list.push({ slug: raw.trim(), typed: true });
    return list;
  };
  const options = optionsFor(text);
  const cur = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const away = (e: Event) => !box.current?.contains(e.target as Node) && close(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function close(refocus = true) {
    setOpen(false);
    setText('');
    setActive(0);
    if (refocus) btn.current?.focus();
  }
  const pick = (slug: string) => (onPick(slug), close());

  /** Reads the field's DOM value, not state, so a fast Enter after typing is not lost. */
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return void (e.preventDefault(), e.stopPropagation(), close());
    if (e.key === 'ArrowDown') return void (e.preventDefault(), setActive((cur + 1) % Math.max(1, options.length)));
    if (e.key === 'ArrowUp') return void (e.preventDefault(), setActive((cur - 1 + options.length) % Math.max(1, options.length)));
    if (e.key === 'Home' && !(e.target as HTMLInputElement).value) return void (e.preventDefault(), setActive(0));
    if (e.key === 'End' && !(e.target as HTMLInputElement).value) return void (e.preventDefault(), setActive(options.length - 1));
    if (e.key === 'Tab') return close(false);
    if (e.key === 'Enter') {
      e.preventDefault();
      const fresh = optionsFor((e.target as HTMLInputElement).value);
      const hit = fresh[text === (e.target as HTMLInputElement).value ? Math.min(cur, fresh.length - 1) : 0];
      if (hit) pick(hit.slug);
    }
  };

  return (
    <div class="rg-picker" ref={box}>
      <button type="button" class="rg-btn" ref={btn} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="plus" />{label}
      </button>
      {open && (
        <div class="rg-pop">
          <input
            ref={input}
            class="rg-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={options.length ? `${id}-o${cur}` : undefined}
            aria-label="Find a team"
            autocomplete="off"
            placeholder={teams === null ? 'Type a team slug' : 'Find a team'}
            value={text}
            onInput={(e) => (setText((e.target as HTMLInputElement).value), setActive(0))}
            onKeyDown={onKey}
          />
          <ul class="rg-listbox" role="listbox" id={`${id}-list`} aria-label="Teams">
            {options.map((o, i) => (
              <li key={o.slug} id={`${id}-o${i}`} role="option" aria-selected={i === cur} class={i === cur ? 'rg-active' : ''} onMouseDown={(e) => (e.preventDefault(), pick(o.slug))} onMouseMove={() => setActive(i)}>
                <Icon name="people" size={14} />
                <span class="rg-grow">{o.typed ? <>Use “{o.slug}”</> : o.slug}</span>
                {o.name && o.name !== o.slug && <span class="rg-muted">{o.name}</span>}
              </li>
            ))}
            {!options.length && <li class="rg-empty-opt" role="presentation">{loading ? 'Loading teams…' : teams === null ? 'Type a slug and press Enter.' : q ? 'No team matches.' : 'No more teams to add.'}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
