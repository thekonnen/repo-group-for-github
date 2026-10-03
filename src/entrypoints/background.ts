import { defineBackground } from 'wxt/utils/define-background';
export default defineBackground(() => {
  // Auth, API calls, caching, commits and the pending-new-repo watcher land here (milestones 3+).
  console.debug('[RG] background ready');
});
