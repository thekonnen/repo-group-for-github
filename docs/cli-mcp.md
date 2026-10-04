# CLI and MCP server

`packages/cli/` lets a terminal or an AI agent read and edit `repo-groups.yml` in `<org>/.github`, with the same
placement, validation, diff and writer code as the extension (`src/core`). It is a separate Node >= 20 program: the
extension build (WXT, `srcDir: src`) never includes it.

## Build

```sh
npm ci
npm run build:cli          # writes packages/cli/dist/rg.mjs (one file, js-yaml bundled, no runtime dependencies)
node packages/cli/dist/rg.mjs --help
```

## Auth and organization

- `GITHUB_TOKEN`: a fine-grained or classic personal access token. It needs to read the organization's repositories and
  Contents read/write on `<org>/.github` (writes only). The token is read from the environment, sent only as an
  `Authorization` header to `api.github.com`, and never printed or logged.
- Organization: `--org <org>` or `RG_ORG`.

## Commands

| Command | What it does |
|---|---|
| `list-groups` | Group tree with repository counts and rules |
| `list-repos [--ungrouped \| --group <path>] [--limit N]` | Repositories the token can access (REST, paginated) and the group each lands in |
| `show-group <path>` | Rules, teams, subgroups and repositories of one group |
| `suggest [--limit N]` | Ungrouped repositories with a suggested group (`core/suggest.ts`) |
| `validate [file]` | Validate a file (`-` = stdin), or the file on GitHub. Exit code 1 when invalid |
| `diff <file>` | What replacing `repo-groups.yml` with `<file>` would change |
| `move-repo <repo> <group>` | List the repo by exact name in the group (removed from other groups' exact lists) |
| `add-rule <group> <rule>` | Add a name or pattern such as `dags-*` |
| `create-group <path> [--description ".."]` | Create a group or subgroup (the parent must exist) |
| `apply <file>` | Replace the file with `<file>` (fenced AI answers are accepted) |
| `mcp` | Run the MCP server on stdio |

**Write commands (`move-repo`, `add-rule`, `create-group`, `apply`) are dry-run by default**: they print the diff list
and commit nothing. Add `--yes` to commit to the default branch of `<org>/.github` with a message like
`chore(repo-groups): file kite-nflow in infra/dagsrv`. If the file changed under you (409/422), the file is fetched again
and the same change is re-applied once. `apply` never overwrites a file that changed since it was read. Other options:
`--json`, `--yaml` (also print the resulting YAML).

```sh
export GITHUB_TOKEN=ghp_...   # your token
export RG_ORG=thekonnen

rg list-groups
rg suggest --limit 20
rg move-repo keep_alive_job infra/dagsrv          # dry run: shows "→ keep_alive_job: ungrouped → infra/dagsrv"
rg move-repo keep_alive_job infra/dagsrv --yes    # commits
rg add-rule infra/dagsrv "dagsrv-*" --yes
rg create-group infra/billing --description "Billing jobs" --yes
rg diff proposed.yml && rg apply proposed.yml --yes
```

## MCP server (stdio)

`rg mcp` speaks newline-delimited JSON-RPC 2.0 (`initialize`, `ping`, `tools/list`, `tools/call`), implemented
directly with no SDK. Tools: `list_groups`, `list_repos`, `show_group`, `suggest`, `move_repo`, `add_rule`,
`create_group`, `validate`, `diff`, `apply`. Every tool accepts an optional `org`.

The write tools (`move_repo`, `add_rule`, `create_group`, `apply`) are **dry-run unless the call passes `apply: true`**
(exactly `true`). They return the diff list and the commit message; `include_yaml: true` adds the resulting YAML.

Claude Code:

```sh
claude mcp add repo-groups --env GITHUB_TOKEN=ghp_... --env RG_ORG=thekonnen -- node /path/to/repo/packages/cli/dist/rg.mjs mcp
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "repo-groups": {
      "command": "node",
      "args": ["/path/to/repo/packages/cli/dist/rg.mjs", "mcp"],
      "env": { "GITHUB_TOKEN": "ghp_...", "RG_ORG": "thekonnen" }
    }
  }
}
```

Example conversation: "File the ungrouped repositories." The agent calls `suggest`, then `move_repo` for each
confident one (dry run, shows the diff), and after you agree repeats with `apply: true`. For many changes at once it
can build a full YAML and use `diff` then `apply`.

## Limits

- The repo list is what the token can access, as in the extension. Archived repositories are hidden from counts.
- Direct commits only. If the default branch of `<org>/.github` is protected, the command stops with a clear error.
- Tests: `npm test -- cli`.
