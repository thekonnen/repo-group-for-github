import { idbDeleteWhere, idbGet, idbSet } from '../storage/idb';
import type { IndexStore } from './repo-index';

export const idbIndexStore: IndexStore = {
  async loadUnconfirmed(org) {
    return (await idbGet<any>(`unconfirmed:${org}`)) ?? null;
  },
  async saveUnconfirmed(org, entry) {
    await idbSet(`unconfirmed:${org}`, entry);
  },
  async load(org) {
    return (await idbGet<{ repos: any[]; meta: any }>(`repos:${org}`)) ?? null;
  },
  async save(org, repos, meta) {
    await idbSet(`repos:${org}`, { repos, meta });
  },
  async clear() {
    await idbDeleteWhere((k) => k.startsWith('repos:') || k.startsWith('unconfirmed:'));
  },
};
