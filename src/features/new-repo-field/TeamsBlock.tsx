import { Icon } from '../../ui/Icon';
import { PermissionSelect, TeamPicker } from '../teams/TeamPicker';
import { useStore } from '../store';
import type { NrController } from './controller';
import { ExtTag } from './GroupField';

/**
 * Teams block of "Create a new repository" (F12), directly below the Group block. Pre-filled with the effective teams of the
 * destination group; once the person edits it, changing the group no longer changes it.
 */
export function TeamsBlock({ ctl }: { ctl: NrController }) {
  const s = useStore(ctl.store);
  if (s.phase !== 'ready' || s.personal) return null;
  const set = (i: number, permission: string) => ctl.setTeams(s.teams.map((t, j) => (j === i ? { ...t, permission } : t)));
  return (
    <div class="rg-nr" id="rg-nr-teams" data-rg="new-repo-teams">
      <div class="rg-inject">
        <div class="rg-inject-head">
          <label id="rg-nr-teams-label">Teams</label>
          <ExtTag />
        </div>
        <ul class="rg-tlist" aria-labelledby="rg-nr-teams-label">
          {s.teams.map((t, i) => (
            <li class="rg-trow" key={t.slug}>
              <span class="rg-tchip"><Icon name="people" size={12} />{t.slug}</span>
              <PermissionSelect value={t.permission} label={`Permission for ${t.slug}`} customRoles={s.customRoles} onChange={(p) => set(i, p)} />
              <button type="button" class="rg-btn rg-icon-btn" aria-label={`Remove team ${t.slug}`} onClick={() => ctl.setTeams(s.teams.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
            </li>
          ))}
          {!s.teams.length && <li class="rg-trow rg-muted">No teams. Add one to give it access to the new repository.</li>}
        </ul>
        <div class="rg-trow-actions">
          <TeamPicker teams={s.teamList} exclude={s.teams.map((t) => t.slug)} onPick={(slug) => ctl.setTeams([...s.teams, { slug, permission: 'push' }])} />
        </div>
        <span class="rg-hint" id="rg-nr-teams-hint">
          These teams get access right after the repository is created.
          {!s.isOwner && ' You need admin access to the new repository to give teams access. As its creator you usually have it.'}
        </span>
      </div>
    </div>
  );
}
