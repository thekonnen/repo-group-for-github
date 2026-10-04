// Prints the pre-filled GitHub App registration link. Usage: node scripts/app-link.mjs [org]
const org = process.argv[2];
const perms = { metadata: 'read', contents: 'write', issues: 'write', pull_requests: 'read', administration: 'write', members: 'read' };
const base = org ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new` : 'https://github.com/settings/apps/new';
const p = new URLSearchParams({
  name: 'Repository Group for Github',
  description: 'Organizes the repositories of a GitHub organization into groups and subgroups. No server: data stays in GitHub and in your browser.',
  url: 'https://github.com/thekonnen/repo-group-for-github',
});
console.log(`${base}?${p}`);
