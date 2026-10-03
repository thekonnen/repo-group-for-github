/** First path segments that are GitHub pages, not accounts. */
const RESERVED = new Set([
  'about', 'apps', 'codespaces', 'collections', 'contact', 'dashboard', 'enterprise', 'enterprises', 'events', 'explore', 'features', 'gist', 'issues', 'login', 'logout',
  'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'search', 'security', 'settings', 'signup', 'site', 'sponsors', 'topics', 'trending', 'users',
]);

/**
 * The organization a github.com tab is about: `/orgs/<org>/...` always, `/<org>/...` only when `isKnownOrg` says
 * the first segment is one of the user's organizations (it could just as well be a personal account).
 */
export function orgFromUrl(url: string | undefined, isKnownOrg: (login: string) => boolean): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== 'github.com') return null;
  const [first, second] = u.pathname.split('/').filter(Boolean);
  if (!first) return null;
  if (first === 'orgs') return second ?? null;
  if (RESERVED.has(first.toLowerCase())) return null;
  return isKnownOrg(first) ? first : null;
}

export const groupedViewUrl = (org: string) => `https://github.com/orgs/${encodeURIComponent(org)}/repositories`;
