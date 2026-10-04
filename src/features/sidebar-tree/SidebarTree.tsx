import { useEffect, useState } from 'preact/hooks';
import { sideItems } from '../../core/tree';
import { Icon } from '../../ui/Icon';
import { useLogoSrc } from '../logos/logo-store';
import type { Controller } from '../grouped-view/controller';
import { dropTarget } from '../grouped-view/dnd';
import { useStore } from '../store';
import { SidebarTeams } from '../teams/SidebarTeams';

/** Groups tree below GitHub's own filter list (F2). */
export function SidebarTree({ ctl }: { ctl: Controller }) {
  const s = useStore(ctl.store);
  const model = ctl.model();
  if (!model || s.phase !== 'ready' || !model.root.children.length) return null;
  const cur = s.path.join('/');
  const movable = ctl.canMove();
  return (
    <div class="rg-side">
      <div class="rg-divider" />
      <div class="rg-side-head">
        <span>Groups</span>
        <span class="rg-ext-tag"><i />Repository Group</span>
      </div>
      <ul class="rg-nav-list">
        {sideItems(model).map((it) => (
          <li key={it.key}>
            <button
              type="button"
              class="rg-nav-item"
              style={{ paddingLeft: 8 + it.depth * 16 }}
              aria-current={s.view === 'grouped' && cur === it.key ? 'true' : undefined}
              onClick={() => ctl.go(it.key ? it.key.split('/') : [])}
              {...(movable ? dropTarget(ctl, it.key ? it.key.split('/') : []) : {})}
            >
              <SideIcon ctl={ctl} folder={!!it.key} logo={it.logo} />
              <span>{it.name}</span>
              <span class="rg-count">{it.total}</span>
            </button>
          </li>
        ))}
      </ul>
      <SidebarTeams ctl={ctl} />
    </div>
  );
}

/** Logo (16px) when the group has one that loads, otherwise GitHub's folder icon. */
function SideIcon({ ctl, folder, logo }: { ctl: Controller; folder: boolean; logo: string | null }) {
  const src = useLogoSrc(ctl.logos, logo);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) return <img class="rg-tree-logo" src={src} alt="" onError={() => setFailed(true)} />;
  return <Icon name={folder ? 'folder' : 'repo'} />;
}
