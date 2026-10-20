---
title: Local stack — the PR's code, running, usable, and owned
impact: HIGH
tags:
  - stack
  - drivers
  - teardown
---

# Local stack

Phase 2 brings up exactly the processes the feature needs, from the PR's checkout, and proves they serve real requests.
This file defines the contract every stack driver follows.
The commands live in the driver file named by `stack.driver`.

| `stack.driver` | Driver file | Use when |
| --- | --- | --- |
| `cli` | [`stack/cli.md`](./stack/cli.md) | A dev-environment CLI starts named components and reports status (a repo's own stack tool) |
| `compose` | [`stack/compose.md`](./stack/compose.md) | A `docker compose` file brings the app up |
| `command` | [`stack/command.md`](./stack/command.md) | One or more shell commands start the app (`pnpm dev`, `make run`, `go run ./cmd/server`, a `Procfile`) |
| `none` | this file, [§ The `none` driver](#the-none-driver) | The developer starts the app; the run only uses `app_url` |

Load the driver file before Step 1.
When `notes` is set, read that file as well; it holds repo facts the driver needs.

## Step 1 — Snapshot and ownership

The driver checks what already runs and whether it serves **this** checkout.
It records one of three results in `.agent/{branch}/local-verify/stack.json`:

| Result | Meaning | Action |
| --- | --- | --- |
| `empty` | Nothing runs | This run owns what it starts. Go to Step 2. |
| `same-checkout` | Processes from this checkout already run | Reuse healthy ones. This run owns only what it starts. |
| `foreign` | Something on the app's ports or under the driver's control serves a **different** checkout or an unknown process | Apply the foreign stack policy below. |

A process whose working directory cannot be read is `foreign`.
Never assume an unknown listener on `app_url`'s port serves this checkout.

### Foreign stack policy (`stack.foreign_stack`)

| Policy | Action |
| --- | --- |
| `teardown` | Say in one line what is being stopped (process, PID, checkout), then stop it with the driver's teardown command. Keep data volumes. |
| `ask` | One `AskUserQuestion`: tear down / abort. |
| `abort` | Stop with `blocked — stack bound to <checkout or pid>`. |

Record `owned: whole-stack` after a takeover, so cleanup knows what it may remove.

## Step 2 — Pick and start components

Map every changed path to component names with `stack.component_map` (longest prefix wins; union over paths; nothing matches → `stack.default`).
Component names mean what the driver says: the `cli` tool's components, compose services, or `stack.commands[].name` entries.
An empty `component_map` means "start `stack.default`"; an empty `stack.default` means "start everything the driver knows".

The driver starts the set once, waiting for readiness.
On a failed start, read the driver's diagnostics, fix the environment cause (disk, Docker, credentials, a missing `.env`), and retry once.
A start failure caused by the PR's own code is a finding (`kind: crash`), and Phase 5 fixes it.

## Step 3 — Prove it is usable

Running means the port answers; usable means a real request works.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$APP_URL"     # 2xx, or a 3xx to sign-in
[ -n "$API_HEALTH_URL" ] && curl -fsS "$API_HEALTH_URL"   # only when stack.api_health_url is set
```

Then call one endpoint or route the feature itself uses (from `intent.md` surfaces).
An empty result with HTTP 200 usually means the wrong seed data, tenant, or environment, not a bug — check the notes file and the repo's README before recording a finding.

## Step 4 — Rebuild after a fix

| Changed | Action |
| --- | --- |
| A path listed in `stack.hot_reload` (prefix match) | Wait for the dev server to recompile; no restart |
| Any other path | The driver's restart command for the components that own the path (Step 2's map), then Step 3 again |
| Env or config files (`.env*`, files in `stack.config_files`) | The driver's full restart for every running component |

Never wipe data or reseed between verification loops; one run, one stack session.

## Cleanup

Runs in Phase 7, after the report is written.

| `stack.cleanup` (or `--keep-stack`) | Owned | Action |
| --- | --- | --- |
| `leave` / `--keep-stack` | any | Leave everything up; print what is running and `app_url`. |
| `teardown` | `whole-stack` | The driver's full teardown. Keep data volumes. |
| `teardown` | partial | Stop only the components this run started. |

## The `none` driver

The developer owns the app; the run never starts, restarts, or stops anything.

1. Step 1: `lsof -nP -iTCP:<app port> -sTCP:LISTEN` must show a listener; none → `blocked — nothing on <app_url>; start the app or set stack.driver`.
   Read its working directory with `lsof -a -p <pid> -d cwd -Fn`; outside this checkout → warn once in the terminal and the report (`stack served by <dir>`), then continue.
2. Step 2: skipped.
3. Step 3: as above.
4. Step 4: wait for hot reload; when the fix needs a restart, ask the developer once with `AskUserQuestion` and wait.
5. Cleanup: nothing.

Telemetry under `none` has no captured service logs; the `logs` backend reads only browser and API-probe evidence.

## Common mistakes

- Trusting an app already on the port. **Fix:** Step 1's ownership check; the process must serve the PR worktree.
- Deleting volumes during a takeover. **Fix:** never — it wipes seeded data the developer relies on.
- Starting a producer without its consumers. **Fix:** list the consumers in the `component_map` entry, next to the producer.
