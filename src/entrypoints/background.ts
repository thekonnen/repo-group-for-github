import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createHandler } from '../background/handlers';
import { idbIndexStore } from '../background/idb-index-store';
import { areaKV } from '../background/kv';
import type { Request } from '../github/messages';

export default defineBackground(() => {
  const handle = createHandler({
    fetch: (input, init) => fetch(input, init),
    kv: areaKV(browser.storage.local as any),
    index: idbIndexStore,
    session: areaKV((browser.storage as any).session ?? browser.storage.local),
  });
  browser.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
    handle(msg).then(sendResponse);
    return true; // async response
  });
  console.debug('[RG] background ready');
});
