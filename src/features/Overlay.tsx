import { useStore } from './store';
import type { Controller } from './grouped-view/controller';
import { GroupDrawer } from './group-drawer/GroupDrawer';
import { YamlDrawer } from './yaml-editor/YamlDrawer';
import { SyncDrawer } from './teams/SyncDrawer';

/** Drawers and the toast live in their own root on <body>, away from GitHub's layout. */
export function Overlay({ ctl }: { ctl: Controller }) {
  const s = useStore(ctl.store);
  return (
    <>
      <GroupDrawer ctl={ctl} />
      <SyncDrawer ctl={ctl} />
      <YamlDrawer ctl={ctl} />
      {s.toast && (
        <div class={`rg-toast${s.toast.kind === 'error' ? ' rg-err' : ''}`} role="status">
          <span>{renderCode(s.toast.text)}</span>
        </div>
      )}
    </>
  );
}



/** `org/.github/repo-groups.yml` in the toast is shown as code. */
function renderCode(text: string) {
  const m = text.match(/^(.*?)([\w.-]+\/\.github\/repo-groups\.yml)(.*)$/);
  return m ? <>{m[1]}<code>{m[2]}</code>{m[3]}</> : text;
}
