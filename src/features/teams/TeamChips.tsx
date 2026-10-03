import { useEffect, useRef, useState } from 'preact/hooks';
import { labelOf } from '../../core/permissions';
import type { Permission } from '../../core/types';
import { Icon } from '../../ui/Icon';

export interface ChipTeam {
  slug: string;
  permission?: Permission;
  /** Defined by an ancestor group: shown muted. */
  inherited?: boolean;
  from?: string;
}

export const teamUrl = (org: string, slug: string) => `https://github.com/orgs/${org}/teams/${slug}/repositories`;

const tip = (t: ChipTeam) => [t.slug, t.permission ? labelOf(t.permission) : '', t.inherited && t.from ? `from ${t.from}` : ''].filter(Boolean).join(' · ');

/**
 * Team chips (people icon + slug). At most `max`, then a "+n" button that shows the rest. Clicking a chip opens the team's
 * repositories page; with `onSync` the chip opens a small menu instead (open page / Sync access). Reused by the New
 * repository field.
 */
export function TeamChips({ org, teams, max = 2, active, onSync }: { org: string; teams: ChipTeam[]; max?: number; active?: string; onSync?: (slug: string) => void }) {
  const [all, setAll] = useState(false);
  if (!teams.length) return null;
  const shown = all ? teams : teams.slice(0, max);
  const more = teams.length - shown.length;
  return (
    <span class="rg-tchips">
      {shown.map((t) => {
        const cls = `rg-tchip${t.inherited ? ' rg-inh' : ''}${active === t.slug ? ' rg-on' : ''}`;
        return onSync ? (
          <MenuChip key={t.slug} org={org} t={t} cls={cls} onSync={onSync} />
        ) : (
          <a key={t.slug} class={cls} href={teamUrl(org, t.slug)} title={tip(t)}><Icon name="people" size={12} />{t.slug}</a>
        );
      })}
      {more > 0 && <button type="button" class="rg-tchip rg-more" title={teams.slice(shown.length).map((t) => t.slug).join(', ')} aria-label={`Show ${more} more teams`} onClick={() => setAll(true)}>+{more}</button>}
    </span>
  );
}

function MenuChip({ org, t, cls, onSync }: { org: string; t: ChipTeam; cls: string; onSync: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false));
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => (document.removeEventListener('mousedown', away), document.removeEventListener('keydown', esc, true));
  }, [open]);
  return (
    <span class="rg-tmenu" ref={box}>
      <button type="button" class={cls} title={tip(t)} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="people" size={12} />{t.slug}
      </button>
      {open && (
        <div class="rg-menu" role="menu" aria-label={`Team ${t.slug}`}>
          <a role="menuitem" href={teamUrl(org, t.slug)}>Open repositories page</a>
          <button type="button" role="menuitem" onClick={() => (setOpen(false), onSync(t.slug))}>Sync access…</button>
        </div>
      )}
    </span>
  );
}
