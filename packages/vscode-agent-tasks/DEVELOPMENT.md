# Development Guide — vscode-agent-tasks

## Prerequisites

- Node.js 18+
- pnpm 10.13+
- VS Code 1.85+

Install workspace dependencies from the repo root:

```bash
pnpm install
```

## Build

```bash
# One-off build (also runs version.sh to bump version)
nx build vscode-agent-tasks

# Watch mode (no version bump)
nx dev vscode-agent-tasks
```

The build uses esbuild to bundle `src/extension.ts` into `dist/extension.js`. The `vscode` package is marked external (provided by VS Code at runtime).

## Test

```bash
nx test vscode-agent-tasks
```

Tests use vitest and only cover pure parser functions (`markdown-parser.ts`). VS Code API interactions are tested manually.

## Lint

```bash
nx lint vscode-agent-tasks
```

## Package (.vsix)

```bash
nx package vscode-agent-tasks
```

Produces `dist/packages/vscode-agent-tasks/agent-tasks-<version>.vsix`.

To install locally for manual smoke testing:

```bash
code --install-extension dist/packages/vscode-agent-tasks/agent-tasks-*.vsix
```

## Versioning

The `version.sh` script reads conventional commits since the last `vscode-agent-tasks-v*` tag and calculates the next semver bump (`feat` → minor, `BREAKING CHANGE` → major, everything else → patch).

```bash
# Dry-run (no changes)
nx version vscode-agent-tasks --configuration=dry-run

# Actually bump
nx version vscode-agent-tasks
```

## Release

Requires `VSCE_PAT` environment variable (VS Code Marketplace Personal Access Token) and optionally `OVSX_PAT` (Open VSX).

```bash
# Dry-run
nx release vscode-agent-tasks --configuration=dry-run

# Publish to VS Code Marketplace + Open VSX
nx release vscode-agent-tasks --configuration=ci
```

The first release (`v0.1.x`) must be done manually from a maintainer's machine. CI/CD wiring is planned as a follow-up.

## Directory structure

```
packages/vscode-agent-tasks/
  src/
    extension.ts           # Activation, command registration
    parsers/
      markdown-parser.ts   # Pure TS — no VS Code dependency
      markdown-parser.test.ts
    providers/
      agent-tasks-provider.ts  # TreeDataProvider
    watchers/
      artifact-watcher.ts      # fs.watch + VS Code fallback
  dist/                    # esbuild output (gitignored)
  scripts/
    version.sh             # Conventional-commit version bumper
  package.json             # VS Code extension manifest
  project.json             # Nx targets
```

## Nx workspace bootstrap notes

The `agent-skills` repo was bootstrapped with Nx 22.4 + pnpm 10.13 to match the `gw-tools` workspace. If you need to update Nx or pnpm versions, keep them in sync with `gw-tools.git` for cross-repo familiarity.

Key files:
- `nx.json` — workspace Nx config (plugins, release settings)
- `tsconfig.base.json` — shared TS base (strict, no `paths`)
- `pnpm-workspace.yaml` — workspace packages pattern
