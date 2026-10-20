---
title: Setup — detect the repo, write `.agents/aw/` once, validate every dependency
impact: HIGH
tags:
  - setup
  - config
  - auth
  - idempotent
---

# Setup

`/verify setup` makes the whole suite (`verify`, `ui-verify`, `telemetry-verify`, `aw-tester`, `aw`) runnable in this repo.
It detects what it can, asks once for the rest, and writes the files in [`config.md`](./config.md).
It is safe to re-run: a re-run validates what exists and asks only about what broke or is missing.
`run` calls it inline when `.agents/aw/environments.yml` is absent.

## Phase A — Detect (no questions)

### A1 — Repo and existing config

Resolve the slug and load every config layer per [`config.md § Resolve`](./config.md#resolve-the-config-every-skill-before-any-other-step).
A value any layer already sets is validated, not asked again.

### A2 — Local stack (skipped when `environments.local.stack.driver` is set)

First row that matches; record the evidence:

| Evidence in the checkout | Driver | Prefill |
| --- | --- | --- |
| `CLAUDE.md`, `AGENTS.md`, README, or a repo skill names a dev-environment CLI that starts named components | `cli` | `stack.cli` from `<tool> --help` per [`stack/cli.md`](./stack/cli.md); `component_map` from the docs |
| `compose.yaml` / `docker-compose.y*ml` at the root with a service publishing a port | `compose` | `url` from the first published web port |
| `package.json` with a `dev` or `start` script | `command` | `run: <pm> run dev` (pm from the lockfile); port from `--port`/`-p`, else the framework default (Vite `5173`, Next.js `3000`, Astro `4321`) |
| `Procfile` / `Procfile.dev` | `command` | One entry per process line |
| `Makefile` with `run`, `dev`, or `serve` | `command` | `run: make <target>`; ask for the port |
| `manage.py` | `command` | `run: python manage.py runserver 8000` |
| `go.mod` with a `main` under `cmd/` | `command` | `run: go run ./cmd/<name>`; ask for the port |
| Nothing | `none` | Ask for `url` |

A monorepo with several matches → list them for Phase B.

### A3 — Auth, per environment

Detect login signals (`next-auth` / `auth.js` imports, `/api/auth` routes, OAuth config, Clerk), test backdoors (dev-only cookies, `E2E_AUTH_TOKEN`), and host deployment protection (`vercel.json`, a `VERCEL_AUTOMATION_BYPASS_SECRET` in CI config).
Apply [`auth.md § Reuse before you scaffold`](./auth.md#reuse-before-you-scaffold) before proposing any new script.

### A4 — Fixtures

`db:seed`, `db:reset`, `seed:*`, `test:setup` scripts → `fixtures.seed` / `fixtures.cleanup`.

### A5 — Preview URL

Read recent PRs' deployments and bot comments (`gh api repos/{owner}/{repo}/deployments`, the PR comments) to see how previews are published:

| Found | Write `environments.preview.url` |
| --- | --- |
| GitHub deployments or a Vercel / Netlify / Cloudflare / Render bot comment | `{ from: pr-deployment }` |
| A `github-actions[bot]` comment carrying a stable per-PR alias | add `comment: { authors: [github-actions], host_pattern: '<regex>' }` |
| A deterministic alias in CI config | add `template: '<https://…{pr}…>'` (`{pr}`, `{branch}`, `{sha}`) |
| No previews | omit `environments.preview` |

### A6 — UI surface

Propose `ui.yml` `surface` only when `ui-verify`'s `is-ui-diff.mjs` defaults would be wrong:
plain `.ts`/`.js` are UI in a frontend-only repo; only some monorepo packages are UI; components live in a non-default directory.

### A7 — Telemetry

| Evidence | Backend |
| --- | --- |
| A connected MCP server exposes `listDatasets` and the repo depends on OpenTelemetry (`@opentelemetry/`, `go.opentelemetry.io/otel`, `opentelemetry-`) or `@dash0/sdk-web` | `dash0-mcp` — ask for each environment's dataset; pick the server whose `listDatasets` contains it |
| Otherwise | `logs` |

The dataset may already be in the stack tool's config; when `notes.md` names that file and its keys, read **those keys only** — such files hold tokens. Read `.mcp.json` keys and URLs only, never headers.
For web events, record `web.service_name` from the web SDK init call.

### A8 — Dependencies

| Value | Probe | Fallback |
| --- | --- | --- |
| `ui-verify`, `telemetry-verify`, `attach-media`, `ux` | in the available skills | Note what degrades |
| LoreKit | `memory.list` callable | Lessons loop is a no-op |
| gh auth | `gh auth status` exits 0 | `blocked — run gh auth login` |
| Driver tool | `stack.cli.check` / `docker compose version` / the `run` binary on `PATH` | `blocked (<install hint>)` |

## Phase B — Ask (one batched `AskUserQuestion`)

Ask only what Phase A did not settle; pre-fill the detected value as the first option.

1. **Local stack** — driver, commands, URL (only when A2 was ambiguous or empty).
2. **Login per environment** — strategy from [`auth.md`](./auth.md); for the preview, whether it sits behind deployment protection.
3. **Test user** — email and role (the smoke spec and `E2E_EMAIL` default).
4. **Telemetry** — dataset per environment for a `dash0-mcp` candidate, or `logs`.
5. **Repo facts** — "Anything a new developer must know to run and test this repo (login, seed data, tenant, test commands, commit format)?" → `notes.md`. Skip when it exists.
6. **Your policies** — foreign stack (`teardown` / `ask` / `abort`), cleanup (`leave` / `teardown`), push and PR comment (`own-prs` / `always` / `never`). Skip when `~/.agents/aw/config.yml` has them.

`manual` login → warn: `Authed specs will be skipped (auth.strategy: manual). Add a test-mode login and re-run /verify setup to enable them.`

## Phase C — Probe the login

For each environment with `storage-state`: run `refresh.command` once (local: `url` exported as `PREVIEW_URL`; preview: only when a PR with a resolvable preview exists, else `unconfirmed (no preview yet)`).
The state file must be written and `authed_check` visible on `url`; a failure prints the script's output and returns to Phase B.
Env vars named in `refresh.env` that are unset → never prompt for values; record `unconfirmed (set <names> and re-run)`.

## Phase D — Write

1. Render the committed files from [`templates/aw/`](../templates/aw/) with only keys that differ from the template defaults: `.agents/aw/environments.yml`, `ui.yml`, `telemetry.yml`, and `notes.md`.
2. Copy the chosen login script from [`templates/scripts/`](../templates/scripts/) to `.agents/aw/scripts/auth/`.
3. Personal values (a dataset only you export to, the MCP server key, policies) → `~/.agents/aw/config.yml` under `repos.<slug>` and `policies`; merge, never drop another repo's block.
4. Gitignore the state directory: `grep -qx '.auth/' .gitignore || echo '.auth/' >> .gitignore` (or the reused convention's directory).
5. First run: show every file before writing. Re-run: show a unified diff and write only after the user confirms; an empty diff → `No changes — .agents/aw is up to date.`
6. Never overwrite an existing state file without asking.
7. Do not commit; print the paths for the user to review and commit.

## Phase E — Smoke and validate

Write `.agent/{branch}/aw-target.local.yml` per [`config.md § environments.yml`](./config.md#environmentsyml) and dispatch `aw-tester` with one spec:

```text
# Specs: Smoke
Target: local
## Spec 1: Home loads as the test user
url: /
preconditions:
  - User is logged in as {auth.identity.email}
flow:
  - WHEN page loads
    THEN page title is not "Error" and not "404"
    AND page does not contain {text: "Sign in"}
```

`green` → `ok`; `red` → show diagnostics and return to Phase B; `inconclusive` is expected for `manual`.
The smoke needs the local app up: start it per [`local-stack.md`](./local-stack.md) first, or skip with `smoke: skipped (stack not running)`.

Then print one line per dependency — `ok`, `degraded (<what falls back>)`, or `blocked (<fix>)`; setup succeeds when nothing is `blocked`:

```text
verify setup — acme/shop
  local      ok  command: web (pnpm dev → http://localhost:5173) · login storage-state ✓ · smoke green
  preview    ok  pr-deployment · login storage-state + bypass header · unconfirmed (no preview yet)
  telemetry  ok  dash0-mcp · local alice-local (personal) · preview default
  ui         ok  surface: apps/web/**
  deps       ok  ui-verify, telemetry-verify, attach-media, lorekit, gh
  wrote .agents/aw/{environments,ui,telemetry}.yml, notes.md, scripts/auth/login-headful.mjs — review and commit
  wrote ~/.agents/aw/config.yml (repos.acme/shop)
```

## Common mistakes

- Printing `.mcp.json` or a tool config to check it. **Fix:** read the named keys only; both hold tokens.
- Writing a personal dataset into a committed file. **Fix:** `~/.agents/aw/config.yml` → `repos.<slug>`.
- Picking a telemetry server because it is connected. **Fix:** its `listDatasets` must contain the dataset.
- Writing repo facts into a rule file. **Fix:** `notes.md`; `rules/` stays repo-agnostic.
