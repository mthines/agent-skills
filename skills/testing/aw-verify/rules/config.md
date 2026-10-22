---
title: Config — the committed `.agents/aw/` suite config and the personal overlay
impact: HIGH
tags:
  - config
  - aw
  - verify
  - ui-verify
  - telemetry-verify
---

# Config

Every skill in the verification suite — `aw-verify`, `ui-verify`, `telemetry-verify`, `aw-tester`, and `aw` — reads its repo values from `.agents/aw/`.
`/aw-verify setup` writes it; nothing else does.
It is committed, so a teammate who clones the repo runs `/aw-verify` with no setup.

## Files

| Path | Committed | Read by | Holds |
| --- | --- | --- | --- |
| `.agents/aw/environments.yml` | yes | every skill in the suite | Per environment (`local`, `preview`): URL, stack, login, fixtures |
| `.agents/aw/ui.yml` | yes | `ui-verify`, `aw-tester` | What counts as a UI change, driver, screenshots, recording, the adversarial pass |
| `.agents/aw/telemetry.yml` | yes | `telemetry-verify` | Backend, dataset and service per environment, web SDK events, thresholds |
| `.agents/aw/notes.md` | yes | every skill in the suite | Repo facts: login quirks, test commands, commit format, which telemetry server is right |
| `.agents/aw/scripts/` | yes | `environments.yml` commands | Runnable helpers: `auth/login-headful.mjs`, `auth/login-credentials.mjs`, `auth/refresh-preview.mjs`, seed scripts. No secrets |
| `~/.agents/aw/config.yml` | never | every skill in the suite | Your policies, and your per-repo overrides under `repos.<owner>/<name>` |

Templates: [`templates/aw/`](../templates/aw/).
A missing file means its defaults; a missing `environments.yml` means the suite is not set up — run `/aw-verify setup`.

## Resolve the config (every skill, before any other step)

1. Slug: `git remote get-url origin` → `<owner>/<name>` (no `origin` → `local/<checkout dir name>`).
2. Read the committed file the skill needs, then deep-merge `~/.agents/aw/config.yml` → `repos.<slug>.<file stem>` over it (`environments`, `ui`, or `telemetry`).
   Maps merge key by key; a list or a scalar replaces.
3. Policies come from `~/.agents/aw/config.yml` → `policies`, overridden by `repos.<slug>.policies`.
4. Read `notes.md` when it exists.

```yaml
# ~/.agents/aw/config.yml
version: 1
policies:
  foreign_stack: ask      # teardown | ask | abort — a stack this run did not start
  cleanup: leave          # leave | teardown
  push: own-prs           # always | own-prs | never — fix commits
  pr_comment: always      # always | own-prs | never — the verify comment (default always)
repos:
  acme/shop:
    telemetry:
      mcp_server: dash0-dev
      environments: { local: { dataset: alice-local } }
```

## `environments.yml`

```yaml
version: 1
environments:
  local:
    url: http://localhost:5173
    stack:
      driver: command                 # cli | compose | command | none — rules/local-stack.md
      commands: [{ name: web, run: pnpm dev, port: 5173, ready_url: http://localhost:5173 }]
      # also: component_map, default, hot_reload, config_files, api_health_url, cli, compose, ready_timeout_seconds
    auth:
      strategy: storage-state         # none | storage-state | bypass-header | manual
      storage_state: .auth/local.json # gitignored
      authed_check: '{role: "button", name: "Account menu"}'
      refresh: { when: missing-or-expired, command: node .agents/aw/scripts/auth/login-credentials.mjs, env: [E2E_EMAIL, E2E_PASSWORD], timeout_seconds: 600 }
      identity: { email: test+aw@example.com, role: admin }
    fixtures:
      seed: { command: pnpm db:seed, idempotent: true }
      references: { dashboardId: ${SEED_DASHBOARD_ID} }
  preview:
    url:
      from: pr-deployment             # GitHub deployments API + provider bot comment
      comment: { authors: [github-actions], host_pattern: 'shop-pr-\d+\.vercel\.app' }
      template: 'https://shop-pr-{pr}.vercel.app'   # optional; reachability-checked
    auth:
      strategy: storage-state
      bypass_header: { name: x-vercel-protection-bypass, env: VERCEL_AUTOMATION_BYPASS_SECRET }
      storage_state: .auth/preview.json
      refresh: { when: always, command: node .agents/aw/scripts/auth/refresh-preview.mjs, env: [PREVIEW_USER, PREVIEW_PASSWORD] }
```

`auth` fields: [`auth.md`](./auth.md). `auth` and `fixtures` keep the field meanings `aw-tester` reads.
At run time the caller writes `aw-tester`'s target file from one environment to `.agent/{branch}/aw-target.<env>.yml` (`name: <env>`, `base_url: <resolved url>`, plus that environment's `auth`, `fixtures`, and `ui.yml`'s `constraints`); that file is never committed.

## `ui.yml`

```yaml
version: 1
surface:                              # what counts as a UI change (is-ui-diff); absent → the script's defaults
  include: ['apps/web/**', 'packages/ui/**']
  exclude: ['**/*.test.tsx']
driver: auto                          # auto | chrome | playwright
screenshots: true
recording: true
constraints: { parallelism: 1, reset_between_specs: false }
adversarial:
  enabled: true
  max_probes: 24
  time_budget_minutes: 10
  allowed_origins: [https://api.staging.example.com]
  deny_actions: ['/reset workspace/i']
  mock_endpoints: ['POST /api/invites/**']
  mask_testids: [user-avatar]
```

## `telemetry.yml`

```yaml
version: 1
backend: dash0-mcp                    # dash0-mcp | logs | none
mcp_server: ""                        # the Dash0 MCP server key; usually personal (~/.agents/aw/config.yml)
environments:
  local:   { dataset: "", namespace: local }        # dataset is personal
  preview: { dataset: default, service_name: shop-web }
web:
  service_name: shop-web              # the website's service.name, for web events
  event_patterns: ["track\\(['\"]([^'\"]+)"]   # capture 1 = a custom event name
ingest_wait_seconds: 45
thresholds: { interactive_span_ms: 1000, repeated_child_spans: 10 }
loops: 2
```

## Rules

- **Never write a secret** to any of these files: tokens stay in `.mcp.json`, credentials in env vars, login state in the gitignored `storage_state` file.
- **Personal values stay personal:** a dataset only you export to, the MCP server key, and policies go in `~/.agents/aw/config.yml`, never in a committed file.
- **No repo value in a skill's `rules/`:** ports, commands, datasets, and component names live here.

```yaml
# ✗ Wrong — committed .agents/aw/telemetry.yml
environments: { local: { dataset: alice-local } }
# ✓ Right — ~/.agents/aw/config.yml
repos: { acme/shop: { telemetry: { environments: { local: { dataset: alice-local } } } } }
```
