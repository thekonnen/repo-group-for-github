import { labelOf } from '../../core/permissions';
import type { TeamTag } from '../../core/types';
import type { OrgTeam } from '../../github/messages';
import { Icon } from '../../ui/Icon';
import { PermissionSelect, TeamPicker } from './TeamPicker';

export interface InheritedTeam {
  slug: string;
  permission: string;
  from: string;
}

/**
 * Teams field of Edit group (F5/F12): own teams with a permission select and ×, "Add team", and the teams inherited from
 * ancestors (read-only, muted). `list` is null when the org's teams could not be read.
 */
export function TeamsField({
  org,
  teams,
  onChange,
  inherited,
  list,
  loading,
  customRoles,
  onSync,
  syncNote,
}: {
  org: string;
  teams: TeamTag[];
  onChange: (t: TeamTag[]) => void;
  inherited: InheritedTeam[];
  list: OrgTeam[] | null;
  loading?: boolean;
  customRoles?: string[];
  onSync?: () => void;
  /** Why Sync access is unavailable right now (e.g. unsaved team changes). */
  syncNote?: string | null;
}) {
  const unknown = list ? teams.filter((t) => !list.some((x) => x.slug === t.slug)) : [];
  return (
    <div class="rg-field" role="group" aria-labelledby="rg-f-teams-l">
      <label id="rg-f-teams-l">Teams</label>
      <ul class="rg-tlist" aria-label="Teams of this group">
        {teams.map((t, i) => (
          <li class="rg-trow" key={t.slug}>
            <span class="rg-tchip"><Icon name="people" size={12} />{t.slug}</span>
            <PermissionSelect value={t.permission} label={`Permission for ${t.slug}`} customRoles={customRoles} onChange={(permission) => onChange(teams.map((x, j) => (j === i ? { ...x, permission } : x)))} />
            <button type="button" class="rg-btn rg-icon-btn" aria-label={`Remove team ${t.slug}`} onClick={() => onChange(teams.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
          </li>
        ))}
        {inherited.map((t) => (
          <li class="rg-trow rg-inh" key={`inh:${t.slug}`}>
            <span class="rg-tchip rg-inh"><Icon name="people" size={12} />{t.slug}</span>
            <span class="rg-muted">{labelOf(t.permission)} · from {t.from}</span>
          </li>
        ))}
        {!teams.length && !inherited.length && <li class="rg-muted rg-trow">No teams yet. Tagged teams get access to every repository in this group.</li>}
      </ul>
      <div class="rg-trow-actions">
        <TeamPicker teams={list} loading={loading} exclude={teams.map((t) => t.slug)} onPick={(slug) => onChange([...teams, { slug, permission: 'push' }])} />
        {onSync && <button type="button" class="rg-btn" disabled={!!syncNote} onClick={onSync}>Sync access</button>}
      </div>
      {syncNote && <span class="rg-hint">{syncNote}</span>}
      {unknown.map((t) => <span class="rg-hint rg-warn" role="status" key={t.slug}>Team “{t.slug}” was not found in {org}.</span>)}
      <span class="rg-hint">Subgroups inherit these teams. Sync access only adds or raises a team’s access to repositories; it never removes or lowers it.</span>
    </div>
  );
}
