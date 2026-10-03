# Repository Group for Github

Browser extension (Chrome, Edge, Brave, Firefox) that organizes the repositories of a GitHub organization into groups and subgroups. The build spec is [CLAUDE.md](CLAUDE.md); the mockup in `design/` is the source of truth for look and behavior.

## Develop

```bash
npm install
npm run dev            # Chromium, with HMR
npm run dev:firefox
npm test               # Vitest, core/ logic
npm run typecheck
npm run build && npm run size   # budgets from CLAUDE.md §10
```

## Status

| Milestone | State |
|---|---|
| 1. Scaffold (WXT, TS, Preact, CI, size check) | done |
| 2. Core (`src/core/`: glob, placement, YAML read/write/validate, diff, highlight, AI prompt, teams, index-sync, access levels, layers, My groups chunking) | done, tested |
| 3. Auth and data (device flow, PAT, REST index, caches, access detection) | next |
| 4+ UI features (grouped view, drawers, YAML editor, logos, new-repo field, teams, My groups, F15 modes) | todo |

## Open items

`src/config.ts` needs the GitHub App client id and slug (CLAUDE.md §15). Nothing that talks to GitHub works without it.
