/**
 * ALL GitHub DOM selectors live here, each with fallbacks. Written from design/screenshots (the page is React and
 * its class names are not stable), so locators lean on text, hrefs and structure instead of classes.
 * If a mount point is not found the caller does nothing (CLAUDE.md §9).
 */

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function byText(doc: Document, selector: string, re: RegExp): Element | null {
  for (const el of Array.from(doc.querySelectorAll(selector))) if (re.test(norm(el.textContent))) return el;
  return null;
}

/** Lowest common ancestor of two nodes. */
export function commonAncestor(a: Element, b: Element): Element | null {
  for (let n: Element | null = a; n; n = n.parentElement) if (n.contains(b)) return n;
  return null;
}

/** The left sidebar list with All / Contributed by me / Admin access / ... */
export function findFilterList(doc: Document): Element | null {
  const labels = [/^Contributed by me$/i, /^Admin access$/i, /^Sources$/i, /^Forks$/i];
  for (const re of labels) {
    const item = byText(doc, 'a, button, [role="link"], [role="menuitem"], li', re);
    const list = item?.closest('ul, ol, nav, [role="list"], [role="menu"]');
    if (list) return list;
  }
  return doc.querySelector('nav[aria-label*="filter" i], nav[aria-label*="repositories" i]');
}

const NEW_REPO = 'a[href$="/repositories/new"], a[href*="/repositories/new?"], a[href*="/new?owner"]';
const SEARCH = 'input[placeholder*="Search repositories" i], input[aria-label*="Search repositories" i], input[type="search"]';

export interface OrgReposMount {
  /** GitHub's content column (search and list): hidden in grouped mode. */
  column: Element;
  /** Other parts of GitHub's own list UI (the "All" title row with its New repository button): hidden with the column. */
  extras: Element[];
  /** Sidebar filter list; our Groups tree goes right after it. May be missing. */
  filterList: Element | null;
}

const FILTER_TITLES = /^(All|Contributed by me|Admin access|Public|Private|Sources|Forks|Archived|Templates)$/i;

/** Highest ancestor of `el` that holds neither the column nor the sidebar: the whole header row it belongs to. */
function branchOutside(el: Element, column: Element, filterList: Element | null, doc: Document): Element | null {
  if (column.contains(el) || el.contains(column) || filterList?.contains(el)) return null;
  const stop = (n: Element) => !n.parentElement || n.parentElement === doc.body || n.parentElement === doc.documentElement || n.parentElement.contains(column) || !!(filterList && n.parentElement.contains(filterList));
  let top = el;
  while (!stop(top)) top = top.parentElement!;
  return top;
}

/** The title row GitHub renders above its list ("All" + New repository). It can live outside the list column. */
function findExtras(doc: Document, column: Element, filterList: Element | null): Element[] {
  const out = new Set<Element>();
  const outsidePageChrome = (el: Element) => !el.closest('header, [role="banner"], .rg-root');
  const candidates: Element[] = [
    ...Array.from(doc.querySelectorAll(NEW_REPO)).filter((a) => norm(a.textContent) === 'New repository'),
    ...Array.from(doc.querySelectorAll('h1, h2, h3')).filter((h) => FILTER_TITLES.test(norm(h.textContent))),
  ];
  for (const c of candidates) {
    if (!outsidePageChrome(c)) continue;
    const top = branchOutside(c, column, filterList, doc);
    if (top) out.add(top);
  }
  return [...out];
}

export function locateOrgRepos(doc: Document): OrgReposMount | null {
  const root = doc.querySelector('main') ?? doc.body;
  const search = root.querySelector(SEARCH);
  if (!search) return null;
  const filterList = findFilterList(doc);
  const newRepo = root.querySelector(NEW_REPO);
  const isRoot = (el: Element) => el === root || el === doc.body || el === doc.documentElement;
  // Stop climbing before the branch that holds the sidebar, or just under <main>.
  const atTop = (el: Element) => !el.parentElement || isRoot(el.parentElement) || !!(filterList && el.parentElement.contains(filterList));

  let column: Element | null = (newRepo && commonAncestor(search, newRepo)) || search;
  if (isRoot(column)) column = search;
  while (column && !atTop(column)) column = column.parentElement;
  // A column that would swallow the sidebar means we cannot isolate GitHub's list: do nothing.
  if (!column || column === search || isRoot(column) || (filterList && column.contains(filterList))) return null;
  return { column, extras: findExtras(doc, column, filterList), filterList };
}
