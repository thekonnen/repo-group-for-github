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

Permissions: Metadata (read), Contents (read & write), Issues (read & write), Pull requests (read), Administration (read & write), Organization Members (read), Organization Custom properties (read, only for `prop:` rules; an owner must accept it on an existing install). Details in [docs/github-app.md](docs/github-app.md).

**Default labels and milestones (C2).** A group can list `labels` and `milestones` in `repo-groups.yml`; subgroups inherit them and the closest definition of a name wins. **Edit group → Sync labels** adds the ones a repository is missing (`POST /repos/{org}/{repo}/labels` and `/milestones`). It is add-only: existing labels and milestones are never changed, recolored, renamed or deleted, and a label that exists with a different color is shown and skipped. Creating labels and milestones needs the App permission **Issues: Read & write**. If you installed the App before this feature, an org owner must accept the new permission at `https://github.com/organizations/<org>/settings/installations`; until then Sync labels fails with a message that points there.

## Custom property rules (organizations)

A group can take repositories by an organization custom property instead of the name: `match: ["prop:client=Acme"]` puts every repository whose `client` property is `Acme` in the group. The value accepts `*` (`prop:team=da*`), property names and values ignore case, and a multi-select property matches when any of its values does. Precedence is the same as for names: a rule without `*` counts as exact, one with `*` as a pattern; the deepest group wins. The group page shows these rules as "client: Acme". Values with spaces are not supported yet (use `*` for the space, `prop:client=Acme*Corp`).

The properties are read with `GET /orgs/{org}/properties/values`, only when the org file has a `prop:` rule, and cached with the refresh interval. They need the App permission **Organization → Custom properties: Read**. Without it (or before an owner accepts the update) nothing breaks: those rules match nothing and the Match rules tab shows a hint. Personal accounts have no custom properties and skip this.

## Personal account

Open `github.com/<you>?tab=repositories` while signed in as that user: the grouped view replaces the list (your own profile only). Groups live in `<you>/.github/repo-groups.yml`, which the extension offers to create as a private repository the first time. Teams do not exist on personal accounts, so the Teams field is hidden. The GitHub App must be installed on your account with access to all repositories to see private ones.

## Forks grouped by upstream (`fork-of:`)

Forks of one project often sit loose with generic names. A match rule `fork-of:<owner>` catches every fork whose upstream is owned by `<owner>` (`fork-of:macfuse`); `fork-of:<owner>/<repo>` catches forks of one upstream repository. Without `*` it ranks like an exact name, with `*` like a pattern (§5.3). The upstream is read lazily with GraphQL (forks only, 50 per query), cached, and stored in the local index. In the **Ungrouped** tab, **Auto-group forks** proposes one group per upstream owner with 2 or more ungrouped forks and opens the YAML editor with that draft; nothing is saved until you click **Apply and commit**. Works on personal accounts and organizations.

## Group by GitHub topic

A match rule `topic:<name>` puts every repository that has that GitHub topic in the group, so new repositories file themselves when they are tagged:

```yaml
groups:
  - name: ml
    match: ["topic:machine-learning", "topic:ml-*"]
```

Topics match case-insensitively and exactly; `*` works as a wildcard. They follow the same precedence as name rules (exact beats pattern, deepest group wins). The UI shows the rule as `topic: machine-learning`. Repositories indexed before this feature get their topics on the next full re-index (use **Re-index**).

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

## Context for AI agents

On any group page, the **Context for agents** menu in the header copies a Markdown "context pack" of the group (path, description, match rules, team names, every repository in the group and its subgroups with URL and clone URL, and a short "how these repositories relate" section built only from the data we have; anything unknown is marked unknown). **Download .md** saves it as `<org>-<group-path>-context.md`; **Copy AGENTS.md snippet** copies a short block to paste into a repository's `AGENTS.md` or `CLAUDE.md`. The pack is capped at 8,000 characters, with a note and a count of omitted repositories. It uses only repositories in your own index, makes no network calls and commits nothing. The generator is `src/core/agent-context.ts`.

## Repositories that are not in any group

When some repositories match no group, the top-level page shows a callout ("12 repositories are not in any group yet") with **Review ungrouped** (opens the Ungrouped tab) and **Start with AI** (opens the YAML editor scoped to "Ungrouped only"), and the sidebar shows a count badge. Ungrouped repositories that appeared since your last visit get a **New** label; the set already seen is kept per org in `storage.local` (`rg:prefs:<org>`, key `unassignedSeen`). It is all derived from the local index and placement, with no extra API calls; archived repositories are never counted. Dismissing the callout hides it for the browser session. Nothing is shown when every repository is grouped.

## Optional: one repository in several groups (`shared`)

Each repository has one home group, chosen by `match`. A group can also list repositories that live elsewhere, like a tag:

```yaml
groups:
  - name: platform
    match: ["lib-core"]
  - name: payments
    match: ["pay-*"]
    shared: ["lib-core", "ui-*"]   # also shown here
```

`lib-core` stays in `platform` (its primary group, used for ungrouped detection, team access and Sync access) and is also listed in `payments` with an "also in Platform" label. It is counted once in every total. `shared` takes the same rule kinds as `match` (names, `*` patterns, `topic:`, `prop:`, `fork-of:`). Files without `shared` behave exactly as before.

In the grouped view, **Send to…** and drag & drop *move* a repository (change its home); **Also list in…** (row menu, selection bar, or Alt/Option-drag) only adds an extra listing. A shared row is drawn as a link (link icon, dashed look, a "linked from <home>" chip that opens the original). It cannot be moved or selected; use its **Remove link** button to stop listing it in that group (the repository and its home are untouched). If a shared rule, not a name, lists it, Remove link points you to Edit group instead.

## Optional: weekly pull request that proposes a reorganization

An organization can let a scheduled workflow keep `repo-groups.yml` tidy. Once a week it lists the repositories, files new ones into a group when it is confident, lists the rest under "Needs a human decision", proposes removing exact names whose repository is gone, and opens (or updates) one pull request from `repo-groups/reorg-<date>`. It never pushes to the default branch and opens nothing when there is nothing to propose.

1. Copy `design/actions/repo-groups-reorg.yml` to `<org>/.github/.github/workflows/repo-groups-reorg.yml` and `design/actions/reorg.mjs` to `<org>/.github/.github/scripts/reorg.mjs`.
2. Create the secret `REPO_GROUPS_TOKEN` (Metadata read on all repositories; Contents and Pull requests read & write on `<org>/.github`).
3. Run it once with `dry_run` on.

The script is generated: edit `src/core` or `src/action`, then run `npm run build:action` (a test fails when the committed file is stale). Details and privacy notes: [docs/reorg-action.md](docs/reorg-action.md).

## Group summary

Each group page (org groups, My groups and team pages) shows "Pushed in 30 days" next to "Last push" in the stats row, and under it a language bar (top 5 + Other, by repository count) and a 12-week gradient line. The sparkline counts **repositories by the week of their last push**, taken from the local index; it is not commit activity. Archived repositories are excluded, subgroups are included, and no extra requests are made.

## Status

Milestones 1–6 done: scaffold, tested `core/`, background worker (device flow, token fallback, parallel repo index with cache, `repo-groups.yml` reader, access detection), and the read-only grouped view on `github.com/orgs/<org>/repositories` (groups and subgroups, sidebar tree, group pages at `#infra/dagsrv`, search, GitHub-list toggle), plus Edit group / New group. Org owners and members with write access to `<org>/.github` can edit groups and create groups and subgroups from the page (each save is a commit to `repo-groups.yml`). The YAML editor (Edit YAML) has the AI round-trip: copy the prompt with the file and repositories, paste the answer back, review the diff, commit. Groups have a display name (any characters) and a slug (`grupo-competicao`). Next: logos, new-repository field, teams (in progress).

The page selectors in `src/github/selectors.ts` were written from the screenshots in `design/screenshots`, not from live GitHub. If the grouped view does not appear, check them first (the extension logs `[RG] could not find the repositories list…` in the page console and leaves the page alone).

`npm run size` only reports the budgets from CLAUDE.md §10; add `--strict` to fail on them.

## Group README

A group can have a presentation page. Add `readme:` to the group in `repo-groups.yml`, either inline Markdown or a path inside `<org>/.github`:

```yaml
groups:
  - name: infra
    readme: |
      # Infra
      Owned by the **platform** team. See [the runbook](https://example.com/runbook).
  - name: ai
    readme: "readmes/ai.md"
```

The group page then opens on an **About** tab. Edit group has a README field with Write and Preview tabs: keep the text inside the YAML, save it as `readmes/<group-path>.md` (committed together with `repo-groups.yml`), or point to an existing file. The Markdown renderer is built in (headings, lists, links, code, quotes, tables); raw HTML is shown as text and only `http`, `https` and `mailto` links work. A README is limited to 64 KB. The AI prompt tells the model to keep every `readme` untouched.

## License

[MIT](LICENSE) © 2026 Konnen Software House
