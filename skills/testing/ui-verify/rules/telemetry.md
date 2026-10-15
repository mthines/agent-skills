---
title: Telemetry check — confirm the run's web events reached Dash0 and say what the PR claims
impact: HIGH
tags:
  - ui-verify
  - dash0
  - web-events
  - rum
  - telemetry
---

# Telemetry check

After the spec run (and the adversarial pass), read the Dash0 web events the run's own browser sessions emitted on the preview, and check them against what the change should produce.
The browser proved what the user sees; this step proves what the product's telemetry saw.
**It never changes the verdict from Step 4** — its findings travel in a separate `telemetry:` block, exactly like the adversarial pass.

## Contents

- [When it runs](#when-it-runs)
- [Step 1: Pick the Dash0 MCP server](#step-1-pick-the-dash0-mcp-server)
- [Step 2: Build the query window](#step-2-build-the-query-window)
- [Step 3: Discover the keys, then fetch the run's events](#step-3-discover-the-keys-then-fetch-the-runs-events)
- [Step 4: Judge the oracles](#step-4-judge-the-oracles)
- [Step 5: Return the telemetry block](#step-5-return-the-telemetry-block)
- [Configuration](#configuration)

## When it runs

A run that already stopped (`NOT RUN …`, or a terminal `inconclusive: …`) never reaches this step.
Otherwise check these in order; the first that fails records its line and ends the step:

| Condition | When it fails, record |
| --- | --- |
| `--no-telemetry` was not passed | `telemetry: skipped (--no-telemetry)` |
| the overlay does not set `telemetry.enabled: false` | `telemetry: skipped (disabled in preview.yml)` |
| the app ships a Dash0 web SDK: the overlay has a `telemetry.dash0` block, or a `package.json` in the repo depends on `@dash0/sdk-web` | `telemetry: skipped (no Dash0 web SDK in this app)` |
| a Dash0 MCP server is connected — some available tool's name ends in `getWebEvents` | `telemetry: skipped (no Dash0 MCP server connected)` |

The SDK condition exists because an app that never instrumented its frontend would report `no-events` on every run, a finding about the repo rather than the PR.

## Step 1: Pick the Dash0 MCP server

Previews report to a non-production Dash0 environment, so the server is normally the **Dash0 Dev MCP**.
Match servers by capability (a tool ending in `getWebEvents`), never by a fixed prefix: the same server may be spelled `mcp__Dash0__…`, `mcp__dash0-dev__…`, or another name.

1. The overlay names `telemetry.dash0.mcp_server` → use only the tools whose prefix is `mcp__<that name>__`. When none exist, record `telemetry: inconclusive (Dash0 MCP server '<name>' not connected)`.
2. Exactly one server exposes `getWebEvents` → use it.
3. Several do → use the one whose server name contains `dev` (case-insensitive). When none or more than one does, record `telemetry: inconclusive (several Dash0 MCP servers — set telemetry.dash0.mcp_server in preview.yml)`.

Name the chosen server in the block as `server:`.

## Step 2: Build the query window

[`runner.md § Step 4`](./runner.md#step-4-select-the-driver-and-run) records `RUN_STARTED_AT` (UTC ISO-8601, before the dispatch), and § Step 4b records `RUN_ENDED_AT` after the adversarial pass returns (or right after Step 4 when 4b did not run).

- `timeRange.from` = `RUN_STARTED_AT` minus 30 seconds.
- `timeRange.to` = `now`.
- `dataset` = `telemetry.dash0.dataset` from the overlay, else `default`.

Never widen the window past the run to "find something" — events outside it are someone else's.

## Step 3: Discover the keys, then fetch the run's events

Attribute keys differ by SDK version, so discover them; never hard-code a URL key.

1. Call `getAttributeKeys` with `scope: "web-events"`, the window, the dataset, and `regex: "url|page|user_agent|session"`.
   Pick the **page-URL key**: `url.full` when present, else `page.url`, else the first key containing `url`.
   No URL key → `telemetry: inconclusive (no page-URL attribute on web events in <dataset>)`.
2. Fetch with `getWebEvents`: the dataset, the window, `ordering: "oldestFirst"`, `pagination.limit: 50`, and the filter `{ key: <page-URL key>, operator: "contains", value: <preview host> }`.
   Add `{ key: "service.name", operator: "is", value: <telemetry.dash0.service_name> }` when the overlay sets it.
   Request `eventAttributeKeys` = the tool's defaults plus the page-URL key and `user_agent.original` when step 1 found it.
   Follow the returned cursor until it is exhausted or 200 events are read; past 200, note `truncated at 200 events`.
3. **Isolate the run's sessions.** Group events by `session.id`.
   On the `playwright` driver, keep only sessions whose `user_agent.original` contains `HeadlessChrome` when that key exists.
   On the `chrome` driver the browser is the user's own, so keep every session in the window and set `attribution: shared-window`.
   More than one remaining session on the `playwright` driver also sets `attribution: shared-window`: another visitor may have been on the preview.
4. **Ingestion lag.** Zero events after isolation → wait 30 seconds and repeat step 2, at most 4 attempts in total (about two minutes).

```text
❌ WRONG — one query, then a red
getWebEvents(...) → 0 events → telemetry: red (no-events)        # Dash0 had not ingested the run yet

✅ RIGHT
getWebEvents(...) → 0 · wait 30 s → 0 · wait 30 s → 12 events in 1 session → judge the oracles
```

## Step 4: Judge the oracles

Judge each oracle over the isolated events only.
Every finding cites exactly one oracle, the event it rests on (`name`, `dash0.web.event.title`, page URL, timestamp, `session.id`), and a severity from this table.

| Oracle | Finding when | Severity |
| --- | --- | --- |
| `no-events` | zero events after the four attempts — the preview's instrumentation is broken or exports nowhere | `high` |
| `error-event` | an event whose name contains `error` or `exception` (case-insensitive), or whose `dash0.web.event.status.code` is `ERROR` | `high` |
| `request-failure` | a request event (`dash0.web.request.type` set) to the preview origin, or an origin in `adversarial.allowed_origins`, with an HTTP status ≥ 500 | `medium` |
| `page-view-missing` | a spec's `**Start:**` path (or a grammar spec's first `url:`) has no page-view event whose page URL ends in that path | `medium` |
| `diff-event-missing` | a custom event name the PR adds (below) has no event of that name in a session where its spec passed | `medium` |

**Custom event names the PR adds.** From the PR diff's added lines, collect the first string argument of every `sendEvent(` call (the Dash0 web SDK's custom-event API) plus every match of each regex in `telemetry.dash0.event_patterns`.
A name the diff only removes or renames is not expected.

**Exclude the adversarial pass's own noise.** Events whose timestamp falls inside the adversarial pass and whose cause is a probe — a stubbed endpoint, an aborted request, the `ui-verify-adv` marker in the event — are not findings: the probe caused them on purpose.
A crash the adversarial pass already reported as `crash` is cited by its `ADV-NN` id, never reported twice.

Never judge an event the window did not return, and never call a missing event a pass.

## Step 5: Return the telemetry block

```yaml
telemetry:
  status: green | red | inconclusive | skipped
  reason: <one line; omit on green>
  server: mcp__dash0-dev
  dataset: default
  window: 2026-10-15T09:12:03Z..now
  attempts: 2
  sessions: 1
  attribution: run-only | shared-window
  events: 37
  findings:
    - id: TEL-1
      oracle: error-event
      severity: high
      event: "exception — TypeError: Cannot read properties of undefined (reading 'id')"
      page: https://myapp-pr-212.vercel.app/dashboards/d-42
      at: 2026-10-15T09:12:41Z
      session: 6f1c…
  notes: <optional>
```

`status` is `red` when there is at least one finding, `green` when every oracle was judged with none, `inconclusive` when Step 1 or Step 3 could not judge, and `skipped` from [When it runs](#when-it-runs).
When the server exposes a tool ending in `generateDash0Url`, add a `link:` per finding pointing at its session.

The summary line, which callers relay verbatim: `telemetry: <events> events in <sessions> sessions, <N> findings (<H> high, <M> medium)`, followed by ` — shared-window` when `attribution` is `shared-window`; or the `skipped (…)` / `inconclusive (…)` line.

## Configuration

Every key is optional, under `telemetry:` in `.claude/aw-targets/preview.yml`:

```yaml
telemetry:
  enabled: true                   # false skips the check for this repo
  dash0:
    mcp_server: dash0-dev         # the MCP server name; pins Step 1
    dataset: default
    service_name: my-frontend     # narrows events to the website's service.name
    event_patterns:               # extra regexes whose first capture is a custom event name
      - "track\\(['\"]([^'\"]+)"
```

Never put a Dash0 token here — the MCP server holds its own credentials.
