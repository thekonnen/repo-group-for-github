import { teamSlugs } from '../../core/teams';
import { Icon } from '../../ui/Icon';
import type { Controller } from '../grouped-view/controller';
import { useStore } from '../store';
import { teamUrl } from './TeamChips';

/** Teams section of the sidebar (F2/F12): the teams that appear in repo-groups.yml. Each opens its repositories page. */
export function SidebarTeams({ ctl }: { ctl: Controller }) {
  const s = useStore(ctl.store);
  const cfg = s.config;
  const slugs = cfg && cfg.exists && cfg.config ? teamSlugs(cfg.config.groups) : [];
  if (!slugs.length) return null;
  return (
    <>
      <div class="rg-divider" />
      <div class="rg-side-head">
        <span>Teams</span>
        <span class="rg-ext-tag"><i />Repository Group</span>
      </div>
      <ul class="rg-nav-list" aria-label="Teams in repo-groups.yml">
        {slugs.map((slug) => (
          <li key={slug}>
            <a class="rg-nav-link" href={teamUrl(s.org, slug)}>
              <Icon name="people" />
              <span>{slug}</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
