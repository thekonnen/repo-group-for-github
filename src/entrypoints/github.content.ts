import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountOrgRepos, mountTeamRepos, mountUserRepos, type Mounted } from '../features/mount';
import { mountNewRepo, mountRepoToast } from '../features/new-repo-field/mount';
import { watchUrl } from '../github/navigation';
import { hasGithubFilter, routeOf } from '../github/route';

/**
 * Runs at document_start, so GitHub's own list never paints before the grouped view replaces it (the "glitch" when opening
 * the page from a link). While we wait for the mount, `main` is hidden (still laid out, so nothing jumps) and a small folder animation shows after 150 ms, so fast loads never flash it; the page is shown again
 * as soon as the mount finished, failed, or after a safety timeout, so a page we cannot take over is never left blank.
 */
const EARLY_ID = 'rg-early-hide';
// Folder outline, drawn twice: a dim copy and a bright dash that runs around it (same idea as the loading animation
// the project took as reference). Colors come from GitHub's own Primer variables, so light, dark and dimmed just work.
const FOLDER = 'M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1Z';
const EARLY_CSS = `
main{visibility:hidden!important}
#${EARLY_ID}-loader{position:fixed;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;z-index:1;pointer-events:none;opacity:0;animation:rg-early-in .2s ease-out .15s forwards;color:var(--fgColor-default,var(--color-fg-default,#1f2328))}
@media (prefers-color-scheme:dark){html:not([data-color-mode=light]) #${EARLY_ID}-loader{color:var(--fgColor-default,var(--color-fg-default,#f0f6fc))}}
#${EARLY_ID}-loader svg{width:100%;height:100%;overflow:visible;fill:none;stroke:currentColor;stroke-width:1;stroke-linecap:round;stroke-linejoin:round}
#${EARLY_ID}-loader .bg{opacity:.25}
#${EARLY_ID}-loader .run{stroke-dasharray:30 70;animation:rg-early-run 1.5s linear infinite}
@keyframes rg-early-in{to{opacity:1}}
@keyframes rg-early-run{to{stroke-dashoffset:-100}}
@media (prefers-reduced-motion:reduce){#${EARLY_ID}-loader .run{animation:none;stroke-dasharray:none;opacity:.6}}`;
function hideEarly() {
  if (document.getElementById(EARLY_ID)) return;
  const style = document.createElement('style');
  style.id = EARLY_ID;
  style.textContent = EARLY_CSS;
  const loader = document.createElement('div');
  loader.id = `${EARLY_ID}-loader`;
  loader.setAttribute('role', 'status');
  loader.setAttribute('aria-label', 'Loading');
  loader.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path class="bg" d="${FOLDER}"/><path class="run" pathLength="100" d="${FOLDER}"/></svg>`;
  document.documentElement.append(style, loader);
  setTimeout(showPage, 4000);
}
const showPage = () => {
  document.getElementById(EARLY_ID)?.remove();
  document.getElementById(`${EARLY_ID}-loader`)?.remove();
};

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_start',
  main() {
    let current: Pick<Mounted, 'key' | 'root' | 'dispose'> | null = null;
    let token = 0;

    const first = routeOf(window.location);
    // Only a full page load of a page we take over in grouped view (a GitHub filter in the URL means the native list is wanted).
    if ((first?.kind === 'org-repos' || first?.kind === 'team-repos') && !hasGithubFilter(window.location.search)) hideEarly();

    // At document_start there is no <body> yet and the locators read it: wait for the DOM before looking for GitHub's list.
    const ready = document.readyState === 'loading' ? new Promise<void>((r) => document.addEventListener('DOMContentLoaded', () => r(), { once: true })) : Promise.resolve();

    const sync = async () => {
      await ready;
      const route = routeOf(window.location);
      const key = route ? `${route.kind}:${route.kind === 'user-repos' ? route.owner : route.org ?? ''}${route.kind === 'repo' ? '/' + route.repo : route.kind === 'team-repos' ? ':' + route.team : ''}` : null;
      // Turbo may have replaced the page: remount when our root is gone.
      if (current && key === current.key && current.root.isConnected) return showPage();
      current?.dispose();
      current = null;
      if (!route) return showPage();
      const mine = ++token;
      const mounted =
        route.kind === 'org-repos'
          ? await mountOrgRepos(route.org)
          : route.kind === 'user-repos'
            ? await mountUserRepos(route.owner)
            : route.kind === 'team-repos'
            ? await mountTeamRepos(route.org, route.team)
            : route.kind === 'new-repo'
              ? await mountNewRepo(route.org)
              : await mountRepoToast(route.org, route.repo);
      if (mine !== token) return mounted?.dispose(); // navigated away while waiting for GitHub's DOM
      current = mounted;
      requestAnimationFrame(showPage);
    };

    watchUrl(() => void sync());
  },
});
