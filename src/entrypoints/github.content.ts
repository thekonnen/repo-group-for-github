import { defineContentScript } from 'wxt/utils/define-content-script';
import { mountOrgRepos, type Mounted } from '../features/mount';
import { watchUrl } from '../github/navigation';
import { routeOf } from '../github/route';

export default defineContentScript({
  matches: ['https://github.com/*'],
  main() {
    let current: Mounted | null = null;
    let token = 0;

    const sync = async () => {
      const route = routeOf(window.location);
      const key = route ? `${route.kind}:${route.org}` : null;
      // Turbo may have replaced the page: remount when our root is gone.
      if (current && key === current.key && current.root.isConnected) return;
      current?.dispose();
      current = null;
      if (!route) return;
      const mine = ++token;
      const mounted = await mountOrgRepos(route.org);
      if (mine !== token) return mounted?.dispose(); // navigated away while waiting for GitHub's DOM
      current = mounted;
    };

    watchUrl(() => void sync());
  },
});
