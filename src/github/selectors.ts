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
  /** False when the column's own classes and style (a bordered box) must not be copied onto our view. */
  inherit?: boolean;
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
 * F12: GitHub's team repositories page, /orgs/<org>/teams/<slug>/repositories. Mirrors a screenshot the user sent (dark theme),
 * not captured HTML: a single centered column with the heading "Repositories with direct access", a row with a
 * "Find a repository…" field and a green "Add repository" button, then a bordered list box ("Select all" header, one row per
 * repository with the full `org/repo` name and a "Role: Write" menu). There is no sidebar.
 * Grouped mode hides the search field and the list box and keeps the heading and "Add repository"; our view goes where
 * the list box was. The locator does not depend on rows (an empty team still has the search field).
 */
const TEAM_SEARCH = 'input[placeholder*="Find a repository" i], input[aria-label*="Find a repository" i], input[placeholder*="repositor" i], input[aria-label*="repositor" i]';
const ADD_REPO = /^Add repositor(y|ies)$/i;

/** Display name of the team ("Konnen_Team") from the breadcrumb or header; the slug always comes from the URL. */
export function findTeamName(doc: Document, org: string, slug: string): string | null {
  // The real page names the team in its "Add repository to Konnen_Team" dialog.
  const dialog = doc.querySelector('details-dialog[aria-label^="Add repository to "]')?.getAttribute('aria-label');
  const fromDialog = norm(dialog?.replace(/^Add repository to /i, ''));
  if (fromDialog) return fromDialog;
  const want = `/orgs/${org}/teams/${slug}`.toLowerCase();
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const path = (a.getAttribute('href') ?? '').replace(/^https:\/\/github\.com/, '').split(/[?#]/)[0].replace(/\/$/, '').toLowerCase();
    const t = norm(a.textContent);
    if (path === want && t) return t;
  }
  return null;
}

/**
 * Classic server-rendered markup of the real page (stable class names): `form.subnav-search`, `.table-list-header` (Select all)
 * and `#org-team-repositories` / `ul.team-listing` (the rows). Our view goes before the first of the list parts, which is
 * right after the `.subnav` toolbar; the heading and the "Add repository" button stay. Nothing is moved or removed:
 * GitHub's bulk-actions script lives on the container around them.
 */
function locateTeamReposClassic(doc: Document): (OrgReposMount & { inherit: false }) | null {
  const root = doc.querySelector('main') ?? doc.body;
  const list = root.querySelector('#org-team-repositories') ?? root.querySelector('ul.team-listing');
  const header = root.querySelector('.table-list-header');
  const search = root.querySelector('form.subnav-search') ?? root.querySelector('input.js-team-search-field')?.closest('form') ?? null;
  const parts = [header, list].filter((e): e is Element => !!e && !e.contains(search) && !(search && search.contains(e)));
  if (!parts.length) return null;
  parts.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1)); // document order
  const extras = [...parts.slice(1), ...(search ? [search] : [])];
  return { column: parts[0], extras, filterList: null, inherit: false };
}

export function locateTeamRepos(doc: Document, org: string): (OrgReposMount & { inherit: false }) | null {
  return locateTeamReposClassic(doc) ?? locateTeamReposGeneric(doc, org);
}

function locateTeamReposGeneric(doc: Document, org: string): (OrgReposMount & { inherit: false }) | null {
  const root = doc.querySelector('main') ?? doc.body;
  const isRoot = (el: Element) => el === root || el === doc.body || el === doc.documentElement;
  const heading = Array.from(root.querySelectorAll('h1, h2, h3, h4')).find((h) => /^Repositories with direct access$/i.test(norm(h.textContent))) ?? null;
  const search = root.querySelector(TEAM_SEARCH);
  if (!heading && !search) return null;
  const addBtn = Array.from(root.querySelectorAll('a, button')).find((b) => ADD_REPO.test(norm(b.textContent))) ?? null;

  // The list box: the "Select all" header, or else the first repository link (`/<org>/<repo>`).
  const selectAll = Array.from(root.querySelectorAll('label, span, div, button')).find((e) => e.children.length < 3 && /^Select all$/i.test(norm(e.textContent))) ?? null;
  const repoLink =
    Array.from(root.querySelectorAll('a[href]')).find((a) => {
      const path = (a.getAttribute('href') ?? '').replace(/^https:\/\/github\.com/, '').split(/[?#]/)[0].replace(/\/$/, '');
      const m = path.match(/^\/([^/]+)\/([^/]+)$/);
      return !!m && m[1].toLowerCase() === org.toLowerCase() && !/^(teams|people|settings)$/i.test(m[2]);
    }) ?? null;
  const anchor = selectAll ?? repoLink;
  const keepsOthers = (el: Element) => !!((search && el.contains(search)) || (heading && el.contains(heading)) || (addBtn && el.contains(addBtn)));
  let box: Element | null = null;
  if (anchor) {
    box = anchor;
    while (box.parentElement && !isRoot(box.parentElement) && !keepsOthers(box.parentElement)) box = box.parentElement;
    if (keepsOthers(box)) box = null;
  }
  if (!box) {
    // Empty team: the blank state is whatever follows the search row.
    let row: Element | null = search;
    const together = search && addBtn ? commonAncestor(search, addBtn) : null;
    if (together && !isRoot(together)) row = together;
    else while (row && row.parentElement && !isRoot(row.parentElement) && !(heading && row.parentElement.contains(heading))) row = row.parentElement;
    box = row?.nextElementSibling ?? null;
  }
  if (!box || isRoot(box)) return null;

  // GitHub's search field (without the "Add repository" button next to it).
  const extras: Element[] = [];
  if (search) {
    let field: Element = search;
    while (field.parentElement && !isRoot(field.parentElement) && !((heading && field.parentElement.contains(heading)) || (addBtn && field.parentElement.contains(addBtn))) && !field.parentElement.contains(box)) field = field.parentElement;
    if (!field.contains(box) && field !== box) extras.push(field);
  }
  // The rows can sit in a sibling of the "Select all" header: hide that block too.
  if (repoLink && !box.contains(repoLink)) {
    let rows: Element | null = repoLink;
    while (rows && rows.parentElement !== box.parentElement) rows = rows.parentElement;
    if (rows && rows !== box && !extras.includes(rows)) extras.push(rows);
  }
  return { column: box, extras, filterList: null, inherit: false };
}

/* ------------------------------------------------------------------------------------------------------------------
 * "Create a new repository" (F9). Written from design/screenshots/github-new-repository.png, NOT from live HTML.
 * ------------------------------------------------------------------------------------------------------------------ */

const DESC_INPUT = 'input[name="repository[description]"], #repository_description, input[aria-label="Description" i], textarea[aria-label="Description" i]';
const NAME_INPUT = 'input[name="repository[name]"], #repository-name-input, #repository_name, input[aria-label*="Repository name" i]';
const COUNTER = /^\d[\d,]*\s*\/\s*\d+\s*characters?$/i;

/** The control a <label> (matched by text) points at. */
function inputByLabel(doc: Document, re: RegExp): HTMLInputElement | null {
  for (const l of Array.from(doc.querySelectorAll('label'))) {
    if (!re.test(norm(l.textContent))) continue;
    const id = l.getAttribute('for');
    const el = (id && doc.getElementById(id)) || l.parentElement?.querySelector('input, textarea');
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el as HTMLInputElement;
  }
  return null;
}

export interface NewRepoMount {
  /** The Group block goes right after this element: the "0 / 350 characters" counter, or the Description field. */
  after: Element;
  nameInput: HTMLInputElement | null;
  description: HTMLInputElement;
  form: HTMLFormElement | null;
}

/** Finds where the Group block goes. Null (inject nothing) when the Description field cannot be found. */
export function locateNewRepo(doc: Document): NewRepoMount | null {
  const description = (doc.querySelector(DESC_INPUT) as HTMLInputElement | null) ?? inputByLabel(doc, /^Description$/i);
  if (!description) return null;
  const nameInput = (doc.querySelector(NAME_INPUT) as HTMLInputElement | null) ?? inputByLabel(doc, /^Repository name\b/i);
  // The counter lives in the same field block as the input, below it.
  let counter: Element | null = null;
  for (let box: Element | null = description.parentElement, i = 0; box && !counter && i < 4; box = box.parentElement, i++) {
    if (box.querySelector(NAME_INPUT)) break; // climbed into another field
    counter = Array.from(box.querySelectorAll('span, p, div, small')).find((e) => e.children.length === 0 && COUNTER.test(norm(e.textContent))) ?? null;
  }
  const form = description.closest('form');
  return { after: counter ?? description, nameInput, description, form };
}

/** Login shown by the Owner dropdown ("thekonnen"), for /new where the owner is not in the URL. */
export function findOwnerLogin(doc: Document): string | null {
  for (const l of Array.from(doc.querySelectorAll('label, span, div, legend'))) {
    if (l.children.length > 0 || !/^Owner\s*\*?$/i.test(norm(l.textContent))) continue;
    for (let box = l.parentElement, i = 0; box && i < 3; box = box.parentElement, i++) {
      const b = box.querySelector('button, summary, [role="combobox"]');
      const t = norm(b?.textContent);
      if (t) return t.split(' ')[0];
    }
  }
  return null;
}

/** Name the person typed, as GitHub's input holds it. */
export const readRepoName = (m: NewRepoMount): string => m.nameInput?.value ?? '';

/** The button that submits the form (a second signal next to the form's submit event). */
export function findCreateButton(doc: Document): HTMLButtonElement | null {
  return (Array.from(doc.querySelectorAll('button')).find((b) => /^Create repository$/i.test(norm(b.textContent))) as HTMLButtonElement | undefined) ?? null;
}
