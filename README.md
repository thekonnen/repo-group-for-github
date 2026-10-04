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

## Personal account

Open `github.com/<you>?tab=repositories` while signed in as that user: the grouped view replaces the list (your own profile only). Groups live in `<you>/.github/repo-groups.yml`, which the extension offers to create as a private repository the first time. Teams do not exist on personal accounts, so the Teams field is hidden. The GitHub App must be installed on your account with access to all repositories to see private ones.

## Optional: pre-built index for very large organizations (`index: action`)

By default each member builds the repository index with their own API calls (about 34 requests the first time for 3,400 repositories). An organization can instead let a scheduled workflow write `repo-index.json` into `<org>/.github`:

1. Copy `design/actions/repo-index.yml` to `<org>/.github/.github/workflows/repo-index.yml`.
2. Create the secret `RG_INDEX_TOKEN` (fine-grained token or GitHub App token: Metadata read on all repositories, Contents read & write on `<org>/.github`). The workflow runs hourly and commits `repo-index.json`.
3. Add `index: action` to `repo-groups.yml`.

The extension then downloads that one file instead of paginating, and confirms every entry with the member's own token (GraphQL `repository(owner:, name:)`, 50 per query) before showing it, so nobody sees a repository they cannot open. Entries show up as they are confirmed; a missing or invalid file falls back to the normal index.

**Privacy warning:** everyone who can read `<org>/.github` can read the names and descriptions of **all** repositories listed in `repo-index.json`, including private ones they cannot open. Only enable this in organizations where members already see every repository.

## Optional: AI group suggestion on "New repository"

Off by default. In **Options > AI assistant** choose Google Gemini, Anthropic (API key) or an OpenAI-compatible endpoint and paste a key. Without a key nothing is ever sent and the keyword suggestion (`src/core/suggest.ts`, runs in your browser) is used.

- **What is sent:** the new repository's name and description, plus your groups (names, descriptions, keywords, match rules and up to 4 repository names per group) go to the provider you chose. Nothing else.
- **The key** lives in extension `storage.local`, is used only by the background worker, is never logged and is stripped from error messages. The provider's origin is an optional host permission asked when you click Save.
- **Answers are strict:** the model must reply with JSON `{"group": "<existing group path>" | "none" | "new", "reason": "..."}`. Anything else (a path that does not exist, text around the JSON, ...) is rejected, so a malicious repository description cannot steer the result.
- **Never blocks GitHub's form:** the AI gets 4 seconds. When it is offline, slow, erroring or invalid, the closest keyword match is offered instead.
- **UI:** under the Group picker, a chip reads "Suggested: infra / dagsrv - why", marked `AI` or `keywords`, with **Accept**.
- Answers are cached per (name, description, config sha, setup) for one hour.

## Status

Milestones 1–6 done: scaffold, tested `core/`, background worker (device flow, token fallback, parallel repo index with cache, `repo-groups.yml` reader, access detection), and the read-only grouped view on `github.com/orgs/<org>/repositories` (groups and subgroups, sidebar tree, group pages at `#infra/dagsrv`, search, GitHub-list toggle), plus Edit group / New group. Org owners and members with write access to `<org>/.github` can edit groups and create groups and subgroups from the page (each save is a commit to `repo-groups.yml`). The YAML editor (Edit YAML) has the AI round-trip: copy the prompt with the file and repositories, paste the answer back, review the diff, commit. Groups have a display name (any characters) and a slug (`grupo-competicao`). Next: logos, new-repository field, teams (in progress).

The page selectors in `src/github/selectors.ts` were written from the screenshots in `design/screenshots`, not from live GitHub. If the grouped view does not appear, check them first (the extension logs `[RG] could not find the repositories list…` in the page console and leaves the page alone).

`npm run size` only reports the budgets from CLAUDE.md §10; add `--strict` to fail on them.
