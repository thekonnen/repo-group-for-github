import { defineContentScript } from 'wxt/utils/define-content-script';
export default defineContentScript({
  matches: ['https://github.com/*'],
  main() {
    // Routes to features by URL (grouped view, new-repo field, team page). Milestone 4+.
    console.debug('[RG] content script loaded');
  },
});
