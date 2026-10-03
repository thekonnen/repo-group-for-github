import { render } from 'preact';
import tokensCss from '../styles/tokens-page.css?inline';
import groupedCss from '../styles/grouped.css?inline';
import { call } from '../github/client';
import { locateOrgRepos } from '../github/selectors';
import { waitFor } from '../github/navigation';
import { createController, type Env } from './grouped-view/controller';
import { GroupedView } from './grouped-view/GroupedView';
import { SidebarTree } from './sidebar-tree/SidebarTree';
import { Overlay } from './Overlay';

export interface Mounted {
  key: string;
  root: HTMLElement;
  dispose(): void;
}

const STYLE_ID = 'rg-style';

function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = tokensCss + '\n' + groupedCss;
  doc.head.appendChild(style);
}

let warned = false;

/**
 * Mounts the grouped view next to GitHub's list on /orgs/<org>/repositories. Idempotent per URL (the caller keys it).
 * If a mount point is not found it logs once and does nothing.
 */
export async function mountOrgRepos(org: string, env?: Partial<Env>, doc: Document = document, timeoutMs = 8000): Promise<Mounted | null> {
  const found = await waitFor(() => locateOrgRepos(doc), timeoutMs, doc);
  if (!found) {
    if (!warned) console.debug('[RG] could not find the repositories list to take over; leaving the page as is');
    warned = true;
    return null;
  }
  ensureStyle(doc);
  const { column, extras, filterList } = found;
  const nativeParts = [column, ...extras];

  const root = doc.createElement('div');
  // Take on the column's own classes and inline style so GitHub's margins, padding and max-width apply to our view too.
  root.className = ['rg-root', ...Array.from(column.classList).filter((c) => c !== 'rg-hidden')].join(' ');
  const inline = column.getAttribute('style');
  if (inline) root.setAttribute('style', inline.replace(/display\s*:[^;]*;?/g, ''));
  root.dataset.rg = 'view';
  column.before(root);

  let side: HTMLElement | null = null;
  if (filterList) {
    side = doc.createElement('div');
    side.className = 'rg-root';
    side.dataset.rg = 'side';
    filterList.after(side);
  }

  const overlay = doc.createElement('div');
  overlay.className = 'rg-root';
  overlay.dataset.rg = 'overlay';
  doc.body.appendChild(overlay);

  const ctl = createController(org, {
    call,
    location: window.location,
    history: window.history,
    open: (url) => void window.open(url, '_blank', 'noopener'),
    ...env,
  });
  render(<GroupedView ctl={ctl} />, root);
  if (side) render(<SidebarTree ctl={ctl} />, side);
  render(<Overlay ctl={ctl} />, overlay);

  // GitHub's own list is hidden only while the grouped view (or its sign-in state) is showing.
  const sync = () => nativeParts.forEach((el) => el.classList.toggle('rg-hidden', ctl.store.get().view === 'grouped'));
  const unsubscribe = ctl.store.subscribe(sync);
  sync();
  const onHash = () => ctl.syncHash();
  window.addEventListener('hashchange', onHash);
  window.addEventListener('popstate', onHash);
  void ctl.init();

  return {
    key: `org-repos:${org}`,
    root,
    dispose() {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
      unsubscribe();
      ctl.dispose();
      render(null, root);
      if (side) render(null, side);
      render(null, overlay);
      overlay.remove();
      root.remove();
      side?.remove();
      nativeParts.forEach((el) => el.classList.remove('rg-hidden'));
    },
  };
}
