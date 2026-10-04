import { useEffect, useState } from 'preact/hooks';
import { aggregateMembers, filterPeople, filterTeamGroups, membersByTeam, viaTeams, viaText, type TeamMember } from '../../core/members';
import { labelOf } from '../../core/permissions';
import type { Group } from '../../core/types';
import { Icon } from '../../ui/Icon';
import { teamUrl } from '../teams/TeamChips';
import { useStore } from '../store';
import type { Controller } from '../grouped-view/controller';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function PersonRow({ m, children }: { m: TeamMember; children?: preact.ComponentChild }) {
  return (
    <li class="rg-row rg-member">
      {m.avatarUrl ? <img class="rg-member-av" src={m.avatarUrl} alt="" width={32} height={32} loading="lazy" /> : <span class="rg-member-av rg-member-av-empty" aria-hidden="true">{m.login[0]?.toUpperCase()}</span>}
      <div class="rg-member-main">
        <a class="rg-member-login" href={`https://github.com/${m.login}`}>{m.login}</a>
        {m.name && <span class="rg-muted"> {m.name}</span>}
        {children}
      </div>
    </li>
  );
}

/** "Members" tab of a group page (C3): people reaching the group through its effective teams. Read only. */
export function MembersPanel({ ctl, org, groups, path }: { ctl: Controller; org: string; groups: Group[]; path: string[] }) {
  const mc = ctl.members;
  const s = useStore(mc.store);
  const [query, setQuery] = useState('');
  const vias = viaTeams(groups, path);
  const slugs = vias.map((v) => v.team);
  const key = slugs.join(',');
  useEffect(() => {
    void mc.load(slugs);
  }, [key]);

  const forbiddenTeams = slugs.filter((x) => s.unreadable[x] === 'forbidden');
  const hiddenTeams = slugs.filter((x) => s.unreadable[x] === 'hidden');
  const shownPeople = filterPeople(aggregateMembers(groups, path, s.members), query);
  const shownTeams = filterTeamGroups(membersByTeam(groups, path, s.members), query);

  return (
    <div class="rg-members" data-rg="members">
      <p class="rg-muted rg-members-note" data-rg="members-note">
        This shows <b>team membership</b> only. It does not include individual collaborators on a repository, or the implicit access of organization owners.
      </p>
      {!vias.length ? (
        <div class="rg-box"><div class="rg-empty"><b>No teams are tagged on this group</b>Tag a team on this group or on a group above it to see who gets access.</div></div>
      ) : (
        <>
          {forbiddenTeams.length > 0 && (
            <div class="rg-banner rg-banner-warn" role="status" data-rg="members-forbidden">
              <span class="rg-grow"><b>Team members are not available.</b> GitHub did not let the extension read the members of {forbiddenTeams.join(', ')}. An org owner may need to accept the “Members: Read” permission for Repository Group for Github in the organization settings.</span>
            </div>
          )}
          {hiddenTeams.length > 0 && (
            <div class="rg-banner rg-banner-warn" role="status" data-rg="members-hidden">
              <span class="rg-grow"><b>Some teams are not visible to you:</b> {hiddenTeams.join(', ')}. Their members are left out.</span>
            </div>
          )}
          {s.error && <div class="rg-banner rg-banner-warn" role="alert"><span class="rg-grow"><b>Could not load team members.</b> {s.error}</span></div>}
          <div class="rg-toolbar">
            <label class="rg-search">
              <Icon name="search" />
              <input type="search" placeholder="Search people or teams" aria-label="Search people or teams" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
            </label>
            <div class="rg-view-seg rg-seg-text" role="group" aria-label="Group members by">
              <button type="button" aria-pressed={s.mode === 'person'} onClick={() => mc.setMode('person')}>By person</button>
              <button type="button" aria-pressed={s.mode === 'team'} onClick={() => mc.setMode('team')}>By team</button>
            </div>
          </div>
          <div class="rg-box">
            <div class="rg-box-head">
              <span>{s.mode === 'person' ? plural(shownPeople.length, 'person', 'people') : plural(shownTeams.length, 'team', 'teams')}{s.loading ? ' · loading…' : ''}</span>
            </div>
            {s.mode === 'person' ? (
              shownPeople.length ? (
                <ul class="rg-members-list">
                  {shownPeople.map((p) => (
                    <PersonRow key={p.login} m={p}>
                      <div class="rg-member-via">
                        {p.via.map((v) => (
                          <span key={v.team} class="rg-muted">
                            {' '}<a href={teamUrl(org, v.team)}>{v.team}</a>{viaText(v).slice(`via ${v.team}`.length)}
                          </span>
                        ))}
                      </div>
                    </PersonRow>
                  ))}
                </ul>
              ) : (
                <Empty loading={s.loading} query={query} />
              )
            ) : shownTeams.length ? (
              shownTeams.map((t) => (
                <section key={t.team} class="rg-members-team">
                  <h3>
                    <a href={teamUrl(org, t.team)}>{t.team}</a> <span class="rg-muted">· {labelOf(t.permission)}{t.inherited ? ` · inherited from ${t.from}` : ''}</span>
                  </h3>
                  {t.people.length ? (
                    <ul class="rg-members-list">{t.people.map((m) => <PersonRow key={m.login} m={m} />)}</ul>
                  ) : (
                    <div class="rg-empty rg-muted">{s.unreadable[t.team] ? 'Members not available.' : s.loading ? 'Loading…' : 'No members.'}</div>
                  )}
                </section>
              ))
            ) : (
              <Empty loading={s.loading} query={query} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Empty({ loading, query }: { loading: boolean; query: string }) {
  if (loading) return <div class="rg-empty"><b>Loading members…</b></div>;
  const q = query.trim();
  return <div class="rg-empty"><b>{q ? 'No one matches your search' : 'No members found'}</b>{q ? 'Try another name or team.' : 'The tagged teams have no visible members.'}</div>;
}
