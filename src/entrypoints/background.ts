import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createHandler } from '../background/handlers';
import { idbIndexStore } from '../background/idb-index-store';
import { idbGet, idbSet } from '../storage/idb';
import { areaKV } from '../background/kv';
import type { Request } from '../github/messages';

export default defineBackground(() => {
  const handle = createHandler({
    fetch: (input, init) => fetch(input, init),
    kv: areaKV(browser.storage.local as any),
    index: idbIndexStore,
    logos: { get: (k) => idbGet(`logos:${k}`), set: (k, v) => idbSet(`logos:${k}`, v) },
    origins: {
      has: (origin) => browser.permissions.contains({ origins: [origin] }),
      request: (origin) => browser.permissions.request({ origins: [origin] }),
    },
  });
  browser.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
    handle(msg).then(sendResponse);
    return true; // async response
  });
  console.debug('[RG] background ready');
});
