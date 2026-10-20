---
title: Stack driver — a dev-environment CLI
impact: HIGH
tags:
  - cli
  - stack-driver
---

# Stack driver: `cli`

Implements the [`local-stack.md`](../local-stack.md) contract for a repo whose stack is run by its own CLI — a tool that starts named components with their dependencies, reports status, and tears down.
Every command comes from `stack.cli` in config; this file holds no tool names.
Component names are the tool's component names.

```yaml
stack:
  driver: cli
  cli:
    # Placeholders: {components} = the space-separated selection, {component} = one component,
    # {checkout} = the PR worktree root, {bound} = the checkout a foreign stack serves.
    check: "devstack version"                     # exits 0 when installed
    install_hint: "make devstack-install"         # printed with `blocked` when check fails
    status: "devstack status --output json"       # what runs, and which checkout it serves
    bound_checkout: ".checkout"                   # jq path in status output naming the served checkout; empty → use the port check only
    start: "devstack start {components} --output json"   # blocks until ready
    health: "devstack health --output json"       # exit 0 = healthy
    restart: "devstack restart {components} --output json"
    reload_config: "devstack config reload --output json"  # empty → restart every running component
    stop: "devstack stop {components} --output json"
    teardown: "devstack teardown --output json"   # never a flag that deletes data
    foreign_teardown: "devstack --repo-root {bound} teardown --output json"  # {bound} = the other checkout
    logs: "devstack logs {component} --lines 200 --output json"
    diagnose: "devstack diagnose {component} --lines 20 --output json"
  component_map:
    services/web/: [web]
    services/api/: [api, web]
  default: [web]
```

`setup` fills `stack.cli` from the tool's `--help` and the notes file, and asks for any command it cannot find.
A command that is empty is unsupported: the step that needs it says what it skipped.

## Step 1 — Snapshot and ownership

Run from the PR worktree:

```bash
eval "$CHECK" || echo "blocked — <tool> not installed ($INSTALL_HINT)"
eval "$STATUS"; echo "exit=$?"
lsof -nP -iTCP:<app port> -sTCP:LISTEN     # a hand-started dev server serves whichever checkout started it
```

| Observation | Contract result |
| --- | --- |
| `status` shows nothing running and nothing listens on the app port | `empty` |
| `status` shows components, and `bound_checkout` is this worktree | `same-checkout` — reuse healthy components |
| `bound_checkout` names another checkout | `foreign` — apply the foreign stack policy; teardown with `foreign_teardown` |
| A process outside the tool listens on the app port | `foreign` — after naming it, `kill <pid>` |
| `status` reports its daemon is stale (built from an older binary) for this checkout | `empty` after the tool's own kill/restart command, named in the notes file |

Never pass a flag that deletes data or reseeds: it wipes state the developer relies on.

## Step 2 — Start

Select components with `stack.component_map` (longest prefix wins; union over changed paths; none → `stack.default`).
A producer whose consumers are separate components is listed with them in the map; this driver does not infer a closure the tool does not.

```bash
eval "${START//\{components\}/$COMPONENTS}"   # a cold start may take minutes; let it wait
eval "$HEALTH"                                 # exit code is the answer
```

On a failed start, run `diagnose` for each failed component, fix the environment cause, and retry once.

## Step 3 — Usable

The contract's checks, with `stack.api_health_url` when set.
The notes file names any tenant or seed quirk (for example, "an empty 200 means the wrong dataset").

## Step 4 — Rebuild

| Contract action | Command |
| --- | --- |
| Restart a component | `restart` with the components that own the changed path |
| Config or env change | `reload_config`, else `restart` every running component |
| Path in `stack.hot_reload` | No command; wait for the dev server to recompile |

## Cleanup

| Contract action | Command |
| --- | --- |
| Full teardown | `teardown` |
| Partial | `stop` with the components this run started |

## Logs for the `logs` telemetry backend

`logs` per component, filtered to the probe window by timestamp.
Empty `logs` → the `logs` backend reads only browser and API-probe evidence, and the report says so.

## Common mistakes

- Reusing a stack because it was already up. **Fix:** Step 1's `bound_checkout` check; the tool must serve the PR worktree.
- Starting a producer without its consumers. **Fix:** list the consumers next to the producer in `component_map`.
