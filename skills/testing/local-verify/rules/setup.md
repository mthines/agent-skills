---
title: Setup — detect the repo, store its values once, validate dependencies
impact: HIGH
tags:
  - setup
  - config
  - idempotent
---

# Setup

`/local-verify setup` makes the skill runnable in the current repo.
It detects what it can, asks only what it cannot, and stores every repo-specific value in config so no rule ever names a repo.
It is safe to re-run: a re-run validates what exists and asks only about what broke or is missing.
`run` calls it inline when no config covers the current repo.

## Config files

| Layer (later wins) | Path | Holds |
| --- | --- | --- |
| Skill defaults | [`templates/local-verify.yml.template`](../templates/local-verify.yml.template) | Generic defaults |
| Team | `.claude/local-verify.yml` (committed) | Values every developer of the repo shares: `stack` driver and commands, `component_map`, `app_url`, `aw_target`, `intent.tracker`, `telemetry.backend`, `notes` |
| Personal, global | `~/.claude/local-verify.local.yml` | Top level: your policies. `repos.<owner>/<name>`: your values for that repo (`telemetry.dataset`, `telemetry.mcp_server`, `telemetry.namespace`, overrides) |
| Personal, worktree | `.claude/local-verify.local.yml` (gitignored) | Overrides for this worktree only |

`notes` is a path to a Markdown file of repo facts, relative to the checkout root (team) or absolute or `~`-prefixed (personal).
Write it at `.claude/local-verify.md` for a team, or `~/.claude/local-verify/<owner>-<name>.md` for yourself.
It holds facts, never commands the config already holds: auth and tenant quirks, the commit format, slash-only skills, test commands, which telemetry server is the right one.

## Phase A — Detect (no questions yet)

### A1 — Repo and existing config

```bash
git remote get-url origin        # → slug <owner>/<name>, from https or ssh form, without .git
```

No `origin` → slug is the checkout's directory name, prefixed `local/`.
Load every layer that exists; a value already set by any layer is not asked again.

### A2 — Stack driver (skipped when config sets one)

Take the first row that matches; record the evidence:

| Evidence in the checkout | Driver | Prefill |
| --- | --- | --- |
| The repo's `CLAUDE.md`, `AGENTS.md`, README, or a repo skill names a dev-environment CLI that starts named components (`<tool> start <component>`) | `cli` | Fill `stack.cli` from `<tool> --help` and the docs per [`stack/cli.md`](./stack/cli.md); `component_map` from the docs' component list |
| `compose.yaml`, `compose.yml`, `docker-compose.yml`, or `docker-compose.yaml` at the root, defining a service that publishes a port | `compose` | `app_url` from the first published web port |
| `package.json` with a `dev` or `start` script | `command` | `run: <pm> run dev` (pm from the lockfile: `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lock*` → `bun`, else `npm`); port from `--port`/`-p`, else the framework default (Vite `5173`, Next.js `3000`, Astro `4321`) |
| `Procfile` or `Procfile.dev` | `command` | One entry per process line |
| `Makefile` with a `run`, `dev`, or `serve` target | `command` | `run: make <target>`; ask for the port |
| `manage.py` | `command` | `run: python manage.py runserver 8000` |
| `go.mod` with a `main` package under `cmd/` | `command` | `run: go run ./cmd/<name>`; ask for the port |
| Nothing above | `none` | Ask for `app_url` |

For a monorepo with several matches, list them and let Phase B pick.

### A3 — Telemetry backend (skipped when config sets one)

| Evidence | Backend |
| --- | --- |
| A Dash0 MCP server is connected (`mcp__<server>__listDatasets` callable) **and** the repo depends on OpenTelemetry (`@opentelemetry/`, `go.opentelemetry.io/otel`, `opentelemetry-` in a manifest) | `dash0-mcp` candidate — ask for the dataset; pick the server whose `listDatasets` contains it |
| Otherwise | `logs` |

The dataset and namespace may already be in the stack tool's own config; when the notes file names that file and its keys, read **those keys only** — such files hold tokens.
Read `.mcp.json` keys and URLs only, never headers.

### A4 — Shared dependencies

| Value | Probe | Fallback |
| --- | --- | --- |
| ui-verify | `ui-verify` in the available skills | Note: the browser phase drives Playwright via `playwright-cli` |
| aw-target | `.claude/aw-targets/<aw_target>.yml` exists, when `aw_target` is set | Note: run `/aw-setup --target local` for an authenticated browser |
| attach-media | `attach-media` in the available skills | Note: screenshots stay local |
| `ux` | `ux` skill available | Note: judgment falls back to codebase precedent |
| LoreKit | `memory.list` callable | Note: lessons loop is a no-op |
| gh auth | `gh auth status` exits 0 | `blocked — run gh auth login` |
| Tracker | `intent.tracker: linear` → a Linear MCP tool is available | Note: intent comes from the PR only |
| Driver tool | `stack.cli.check` for `cli`; `docker compose version` for `compose`; the `run` binary on `PATH` for `command` | `blocked (<install hint>)` |

## Phase B — Ask (one batched `AskUserQuestion`)

Ask only what Phase A could not settle, plus the policies not already in the global personal file; pre-fill the detected value as the first option.

1. **Stack driver, commands, and app URL** — only when A2 was ambiguous or found nothing.
2. **Telemetry** — only for a `dash0-mcp` candidate: which dataset (or `logs`).
3. **Repo facts** — "Anything a new developer must know to run and test this repo locally (login, seed data, tenant, commit format)?" Free text, stored in the notes file. Skip when `notes` exists.
4. **Where to store shared values** — `team` (write `.claude/local-verify.yml` and `.claude/local-verify.md`, for you to commit) / `personal` (recommended when you are not sure the team wants it: `repos.<slug>` and `~/.claude/local-verify/<owner>-<name>.md`).
5. **Foreign stack** — `teardown` / `ask` (recommended for shared machines) / `abort`.
6. **Cleanup** — `leave` (recommended) / `teardown`.
7. **Push and PR comment** — `own-prs` (recommended) / `always` / `never`, for each.

## Phase C — Write

1. Render [`templates/local-verify.local.yml.template`](../templates/local-verify.local.yml.template): policies at the top level, this repo's values under `repos.<slug>`.
   Merge into an existing `~/.claude/local-verify.local.yml`; never drop another repo's block.
   On a re-run, show a unified diff and write only after the user confirms a changed field.
2. **Team storage:** write `.claude/local-verify.yml` with only keys that differ from the skill defaults, and the notes file beside it.
   Never write a personal key (`dataset`, `mcp_server`, `namespace`, policies) to a team file.
   Do not commit; print the two paths for the user to review and commit.
3. **Migrate a preset-era file.** A `~/.claude/local-verify.local.yml` whose `repos.<slug>` block or top level sets `preset:` was written for a skill version that shipped repo presets.
   Ask the user for the former preset's values, or read them from a file they point at, write them into `repos.<slug>` (or the team file), drop `preset:`, show the diff, and write on confirmation.
4. A worktree file `.claude/local-verify.local.yml` → confirm `git check-ignore -q .claude/local-verify.local.yml`; not ignored → add `**/.claude/local-verify.local.yml` to the root `.gitignore`.

## Phase D — Validate

Print one line per dependency: `ok`, `degraded (<what falls back>)`, or `blocked (<fix>)`.
Setup succeeds when nothing is `blocked`.

```text
local-verify setup — acme/shop
  stack        ok  command: web (pnpm run dev → http://localhost:5173)
  telemetry    ok  logs (service logs + browser evidence)
  ui-verify    degraded (no aw-target; specs run without login)
  attach-media ok
  lorekit      ok
  tracker      ok  github-issue
  notes        ok  .claude/local-verify.md (team — review and commit)
  wrote ~/.claude/local-verify.local.yml (repos.acme/shop), .claude/local-verify.yml
```

## Common mistakes

- Printing a tool config or `.mcp.json` to check it. **Fix:** read the named keys only; both hold tokens.
- Putting repo values at the top level of the global file. **Fix:** they leak into every other repo; use `repos.<slug>`.
- Picking a telemetry server because it is connected. **Fix:** its `listDatasets` must contain the dataset the local services export to.
- Writing a repo's facts into a rule file. **Fix:** they go in the notes file; `rules/` stays repo-agnostic.
