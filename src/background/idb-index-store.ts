import { idbGet, idbSet } from '../storage/idb';
import type { IndexStore } from './repo-index';

export const idbIndexStore: IndexStore = {
  async load(org) {
    return (await idbGet<{ repos: any[]; meta: any }>(`repos:${org}`)) ?? null;
  },
  async save(org, repos, meta) {
    await idbSet(`repos:${org}`, { repos, meta });
  },
};
