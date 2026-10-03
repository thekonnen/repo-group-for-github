# Repository Group for Github

Browser extension (Chrome, Edge, Brave, Firefox) that organizes an organization's repositories into nested groups, shared through `repo-groups.yml` in `<org>/.github`. No server. Spec: [CLAUDE.md](CLAUDE.md).

## Develop

```bash
npm install
npm run dev            # Chromium (npm run dev:firefox for Firefox)
npm test
npm run build && npm run size
```

## Create the GitHub App

Generate a registration link with the permissions preselected:

```bash
node scripts/app-link.mjs            # personal account
node scripts/app-link.mjs <org>      # organization
```

Open it, then on the form:

1. Check **Enable Device Flow**.
2. Uncheck **Expire user authorization tokens** (checked by default).
3. Under *Where can this GitHub App be installed?* select **Any account** (the link cannot set it; the default is "Only on this account", which blocks installing on an org).
4. Expand *Repository* and *Organization* permissions and confirm the levels below.
5. Click **Create GitHub App**. Do not generate a client secret or private key.
6. Set the Client ID and slug in `src/config.ts`.
7. **Install App** on each account or org with **All repositories**.

Permissions: Metadata (read), Contents (read & write), Issues (read), Pull requests (read), Administration (read & write), Organization Members (read). Details in [docs/github-app.md](docs/github-app.md).

## Status

Milestones 1–2 done (scaffold, tested `core/`). Next: auth and data.
