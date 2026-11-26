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

## Contents

[Files](#files) · [Resolve](#resolve-the-config-every-skill-before-any-other-step) · [Personal keys](#personal-keys) · [`environments.yml`](#environmentsyml) · [`flags`](#flags) · [`ui.yml`](#uiyml) · [`verify`](#verify--path-scoped-environments) · [`telemetry.yml`](#telemetryyml) · [Rules](#rules)

## Files

| Path | Committed | Read by | Holds |
| --- | --- | --- | --- |
| `.agents/aw/environments.yml` | yes | every skill in the suite | Per environment (`local`, `preview`): URL, stack, login, fixtures |
| `.agents/aw/ui.yml` | yes | `ui-verify`, `aw-tester` | What counts as a UI change, driver, screenshots, recording, the adversarial pass |
| `.agents/aw/telemetry.yml` | yes | `telemetry-verify` | Backend, dataset and service per environment, web SDK events, thresholds |
| `.agents/aw/notes.md` | yes | every skill in the suite | Repo facts: login quirks, test commands, commit format, which telemetry server is right |
| `.agents/aw/ux.md` | yes | `ux` (via `aw`'s quality pass) | The house UX rubric: `when <situation>, we <do X>, not <Y>` lines; format in the `ux` skill's `rules/house-rubric.md` |
| `.agents/aw/release.yml` | yes | `deployment-verify` | Deploy detection, flag providers, rollback commands, rollout steps, thresholds per environment, and the `pipeline:` block `atelier`'s Deliver stage reads |
| `.agents/aw/scripts/` | yes | `environments.yml` commands | Runnable helpers: `auth/login-headful.mjs`, `auth/login-credentials.mjs`, `auth/refresh-preview.mjs`, `flags/` set-and-restore scripts, seed scripts. No secrets |
| `.agents/aw/.env.test-user` | never (gitignored) | `login-hook.mjs` only, never an agent | `TESTING_USERNAME`, `TESTING_PASSWORD` for the fixture test user ([`auth.md § The login hook`](./auth.md#the-login-hook-autonomous-sign-in)) |
| `~/.agents/aw/config.yml` | never | every skill in the suite | Your policies, and your per-repo overrides under `repos.<owner>/<name>` |

Templates: [`templates/aw/`](../templates/aw/).
A missing file means its defaults; a missing `environments.yml` means the suite is not set up — run `/aw-verify setup`.

## Resolve the config (every skill, before any other step)

1. Slug: `git remote get-url origin` → `<owner>/<name>` (no `origin` → `local/<checkout dir name>`).
2. Read the committed file the skill needs, drop every [personal key](#personal-keys) from it, then deep-merge `~/.agents/aw/config.yml` → `repos.<slug>.<file stem>` over it (`environments`, `ui`, or `telemetry`).
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
  pr_comment: always      # always | own-prs | never — standalone ui-verify / telemetry-verify regions only
  trusted_bots: []        # bot logins (no `app/`, no `[bot]`) whose PRs aw-verify's aggregate posts to without asking, like your own
credentials:
  provider: bitwarden     # env | bitwarden | 1password — where the fixture test user's login is read from
repos:
  acme/shop:
    telemetry:
      mcp_server: dash0-dev
      environments: { local: { dataset: alice-local } }
```

## Personal keys

Some keys are read only from `~/.agents/aw/config.yml`; the same key in a committed file is ignored, because it grants something to whoever runs the agent.
Under `repos.<slug>`, a key keeps its committed path, so an `environments.yml` key sits under `environments.environments.<env>` (the file stem, then the file's own top-level `environments`).

| Key | Path in `~/.agents/aw/config.yml` | Meaning |
| --- | --- | --- |
| `credentials.provider` | `credentials.provider` | Where the fixture test user's login is read from: `env`, `bitwarden`, or `1password` ([`auth.md`](./auth.md#the-agent-reads-a-session-it-does-not-type-the-login)) |
| `sign_in_host` | `repos.<slug>.environments.environments.<env>.auth.sign_in_host` | The one host on which the agent may sign in itself as the repo's test user ([`auth.md § Pre-authorized sign-in`](./auth.md#pre-authorized-sign-in)) |
| `policies.*` | `policies`, `repos.<slug>.policies` | Run policies ([Resolve](#resolve-the-config-every-skill-before-any-other-step)) |

```yaml
# ✓ ~/.agents/aw/config.yml
repos:
  acme/shop:
    environments:
      environments:
        local: { auth: { sign_in_host: shop-test.accounts.dev } }
# ✗ Wrong — one level short: `environments.local` is not a key of environments.yml, so nothing merges
repos: { acme/shop: { environments: { local: { auth: { sign_in_host: shop-test.accounts.dev } } } } }
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
At run time the caller writes `aw-tester`'s target file from one environment to `.agent/{branch}/aw-target.<env>.yml` (`name: <env>`, `base_url: <resolved url>`, plus that environment's `auth` with `identities` dropped, `fixtures`, and `ui.yml`'s `constraints`); that file is never committed.
With `--as <role>` the file is `.agent/{branch}/aw-target.<env>.<role>.yml` and its `auth` is the environment's `auth` with `identities.<role>` merged over it, `identities` dropped ([`auth.md § Several identities`](./auth.md#several-identities)); `aw-tester` always reads a flat `auth`.

### `flags`

`environments.<env>.flags` says how a run sets a feature flag in each service, so a criterion that needs a flag state never waits for a human.
The protocol is [`flags.md`](./flags.md).

```yaml
    flags:                            # on a hosted environment: `flags: manual`
      web:                            # a name the repo picks, one per service that reads flags
        components: [web]             # restarted to apply, named as in stack.component_map
        shared: true                  # the file is read by other checkouts too (default false)
        set: 'AW_FLAGS_BACKUP_DIR={backup_dir} .agents/aw/scripts/flags/flags.sh web set {key} {value}'
        restore: 'AW_FLAGS_BACKUP_DIR={backup_dir} .agents/aw/scripts/flags/flags.sh web restore {key}'
        apply: ['<stack-cli> reload-config --no-restart', '<stack-cli> restart web']
        verify: '.agents/aw/scripts/flags/flags.sh web verify {key}'
```

| Field | Meaning |
| --- | --- |
| `set`, `restore` | Commands run from the checkout root. `{key}`, `{value}`, `{backup_dir}` are substituted. `{backup_dir}` is one folder per service ([`flags.md`](./flags.md)). `set` saves the original value under it once; `restore` puts that value back, or removes a key that was absent, then deletes what it saved; with nothing saved it does nothing and exits 0 |
| `apply` | Commands, in order, that make the running service read the change; empty when the service reads the file on every request |
| `verify` | Prints the value the running service holds; empty when it cannot be observed (reported as `set, not observed`) |
| `components`, `shared` | What `apply` restarts, and whether other checkouts see the change. When `shared` is true, `apply` must reload without restarting other checkouts, then restart only this checkout's `components` |

A repo ships the commands as a script under `.agents/aw/scripts/flags/` so a run never composes a file edit itself.
A value that is a secret, or a file that holds one, never appears in a command, in `flags.json`, or in the report.

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
verify:                               # optional: which environment proves a diff, and when — below
  rules:
    - { paths: ['apps/web/**', 'packages/ui/**'], env: preview, when: after-pr }
    - { paths: ['services/**'], env: local }
  default: { env: checks }
```

### `verify` — path-scoped environments

A monorepo proves a web change on the PR preview and a service change on the local stack; `verify:` says which, per path.

| Key | Meaning |
| --- | --- |
| `rules` | Ordered list of `{paths, env, when}`. The **first** rule whose `paths` globs cover **every** changed file wins; a diff that spans two rules matches neither. Globs take `**`, `*`, and `?` only: no braces (`*.{ts,tsx}` matches nothing), and a directory is `apps/web/**`, never bare `apps/web` |
| `default` | `{env, when}` (or a bare env name), used when no rule matches or there are no `rules`; it takes no `paths` |
| `env` | `preview` (browser run on the PR preview), `local` (the full local run: the stack, each criterion through the local UI and API, and the telemetry, even when no changed file is UI), `checks` (recorded test runs, [`checks-mode.md`](./checks-mode.md)) |
| `when` | `before-pr` or `after-pr`; the default is `after-pr` for `preview` (a preview exists only once the PR does) and `before-pr` otherwise. `after-pr`: the run needs the PR's own deployment, so the PR opens first (the `autonomous-workflow` skill's *Lite verify*) |

No `verify:` block, or rules that match nothing with no `default` → `VERIFY_ENV: none`: the caller keeps today's routing (`is-ui-diff.mjs`, then `local` or `checks`).
Callers never read the block themselves; they run [`verify-env.mjs`](../scripts/verify-env.mjs) and read its last line.
With `--tier` it also decides the run that tier takes, on the line after `VERIFY_ENV:`: Micro always `checks`; Lite and Full `local` or `preview` when the rule says so and `environments.yml` exists, `checks` when it is missing; with `none`, `local` on a UI diff and `checks` otherwise:

```bash
V="${AW_VERIFY_DIR:-$HOME/.claude/skills/aw-verify}/scripts/verify-env.mjs"
node "$V" --base origin/main                                    # VERIFY_ENV: preview after-pr | … | none
node "$V" --base origin/main --tier lite --ui-diff no           # VERIFY_RUN: local before-pr | checks before-pr | preview after-pr
```

```yaml
# ✗ Wrong — a catch-all rule: paths are for scoping, a fallback has none
rules: [{ paths: ['**'], env: checks }]
# ✓ Right
default: { env: checks }
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
loops: 3                             # fix iterations; 3 is also the cap
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
