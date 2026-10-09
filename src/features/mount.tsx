import { render } from 'preact';
import tokensCss from '../styles/tokens-page.css?inline';
import groupedCss from '../styles/grouped.css?inline';
import { call } from '../github/client';
import { findTeamName, locateOrgRepos, locateTeamRepos, locateUserRepos } from '../github/selectors';
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
export async function mountOrgRepos(org: string, env?: Partial<Env>, doc: Document = document, timeoutMs = 8000, team?: string, personal = false): Promise<Mounted | null> {
  const found = await waitFor(() => (personal ? locateUserRepos(doc) : team ? locateTeamRepos(doc, org) : locateOrgRepos(doc)), timeoutMs, doc);
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
  root.className = ['rg-root', ...(found.inherit === false ? [] : Array.from(column.classList).filter((c) => c !== 'rg-hidden'))].join(' ');
  const inline = found.inherit === false ? null : column.getAttribute('style');
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
    team,
    teamName: team ? findTeamName(doc, org, team) ?? undefined : undefined,
    location: window.location,
    history: window.history,
    open: (url) => void window.open(url, '_blank', 'noopener'),
    ...env,
  });
  render(<GroupedView ctl={ctl} />, root);
  if (side) render(<SidebarTree ctl={ctl} />, side);
  render(<Overlay ctl={ctl} />, overlay);

  // GitHub's content column can have a viewport-sized minimum height. A banner *before* that
  // column leaves a huge gap before its search and rows; put the banner inside the column instead.
  const viewClass = root.className;
  const viewStyle = root.getAttribute('style');
  // Without a usable sign-in, keep GitHub's real repository list visible regardless of the saved view.
  const sync = () => {
    const s = ctl.store.get();
    if (s.phase === 'signed-out') {
      root.className = 'rg-root';
      root.removeAttribute('style');
      column.prepend(root);
    } else if (root.parentElement === column) {
      column.before(root);
      root.className = viewClass;
      if (viewStyle === null) root.removeAttribute('style');
      else root.setAttribute('style', viewStyle);
    }
    nativeParts.forEach((el) => el.classList.toggle('rg-hidden', s.phase === 'ready' && s.view === 'grouped'));
  };
  const unsubscribe = ctl.store.subscribe(sync);
  sync();
  const onHash = () => ctl.syncHash();
  window.addEventListener('hashchange', onHash);
  window.addEventListener('popstate', onHash);
  void ctl.init();

  return {
    key: team ? `team-repos:${org}:${team}` : personal ? `user-repos:${org}` : `org-repos:${org}`,
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

/** F12: the same view on /orgs/<org>/teams/<slug>/repositories, limited to what the team can access. */
export const mountTeamRepos = (org: string, team: string, env?: Partial<Env>, doc: Document = document, timeoutMs = 8000) => mountOrgRepos(org, env, doc, timeoutMs, team);


/** The same view on the signed-in user's own profile, /<login>?tab=repositories. Does nothing on anyone else's profile. */
export async function mountUserRepos(owner: string, env?: Partial<Env>, doc: Document = document, timeoutMs = 8000): Promise<Mounted | null> {
  const who = await (env?.call ?? call)<{ signedIn: boolean; login?: string }>({ type: 'auth:status' }).catch(() => null);
  if (!who?.signedIn || who.login?.toLowerCase() !== owner.toLowerCase()) return null;
  return mountOrgRepos(owner, env, doc, timeoutMs, undefined, true);
}
