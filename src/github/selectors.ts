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
  // GitHub renders the "All" title row inside a <header> too, so only the global header (the one with the logo) is skipped.
  const LOGO = 'a[href="/"], a[href="https://github.com/"], a[aria-label*="Homepage" i]';
  const outsidePageChrome = (el: Element) => {
    if (el.closest('.rg-root')) return false;
    const h = el.closest('header, [role="banner"]');
    return !(h && h.querySelector(LOGO));
  };
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

/**
 * F12: GitHub's team repositories page, /orgs/<org>/teams/<slug>/repositories. NOT written from a screenshot (the spec has
 * none): the locators lean on structure and hrefs, and the fixture in tests/fixtures/team-repos.html was written by hand.
 * We keep GitHub's team header and tabs and take over only the list column.
 */
const TEAM_TABS = 'a[href*="/teams/"][href$="/members"], a[href*="/teams/"][href$="/discussions"], a[href*="/teams/"][href$="/teams"], a[href*="/teams/"][href$="/projects"]';
const TEAM_SEARCH = 'input[placeholder*="repositor" i], input[aria-label*="repositor" i], input[placeholder*="Find" i], input[type="search"]';

export function locateTeamRepos(doc: Document, org: string): OrgReposMount | null {
  const root = doc.querySelector('main') ?? doc.body;
  const isRoot = (el: Element) => el === root || el === doc.body || el === doc.documentElement;
  const tabLink = root.querySelector(TEAM_TABS);
  const tabs = tabLink?.closest('nav, ul, [role="tablist"], [role="navigation"]') ?? tabLink?.parentElement ?? null;
  const heading = root.querySelector('h1');
  const isRepoLink = (a: Element) => {
    const href = a.getAttribute('href') ?? '';
    const path = href.replace(/^https:\/\/github\.com/, '').split(/[?#]/)[0].replace(/\/$/, '');
    const m = path.match(/^\/([^/]+)\/([^/]+)$/);
    return !!m && m[1].toLowerCase() === org.toLowerCase() && !tabs?.contains(a);
  };
  const search = Array.from(root.querySelectorAll(TEAM_SEARCH)).find((i) => !tabs?.contains(i)) ?? null;
  const link = Array.from(root.querySelectorAll('a[href]')).find(isRepoLink) ?? null;
  const anchor = (search && link && commonAncestor(search, link)) || search || link;
  if (!anchor || isRoot(anchor)) return null;
  // Climb to the widest element that still holds neither the team header nor the tabs.
  let column: Element = anchor;
  while (column.parentElement && !isRoot(column.parentElement) && !(tabs && column.parentElement.contains(tabs)) && !(heading && column.parentElement.contains(heading))) column = column.parentElement;
  if (column === search || column === link || /^(A|INPUT|BUTTON)$/.test(column.tagName)) return null; // cannot isolate the list
  return { column, extras: [], filterList: null };
}
