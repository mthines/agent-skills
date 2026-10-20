---
title: Backend dash0-mcp — read spans, logs, metrics, and web events over the Dash0 MCP
impact: HIGH
tags:
  - telemetry-verify
  - dash0
  - mcp
---

# Backend: `dash0-mcp`

## Pick the server

Match servers by capability (a tool ending in `getSpans` or `getWebEvents`), never by a fixed prefix: one server may be named `mcp__Dash0__…`, `mcp__dash0-dev__…`, or anything else.

1. `mcp_server` is set (personal overlay, else `telemetry.yml`) → use only `mcp__<mcp_server>__*`; absent → `pipe: skipped (Dash0 MCP server '<name>' not connected)`.
2. Else exactly one server exposes the tools → use it.
3. Else use the one whose name contains `dev`; none or several → `pipe: inconclusive (several Dash0 MCP servers — set mcp_server in ~/.agents/aw/config.yml)`.

The dataset is `telemetry.yml` → `environments.<env>.dataset`, else `default`.
The server's `listDatasets` must contain it: another org's or region's server holds none of this traffic, and its empty answer proves nothing.

## Scope the records to this run

| Signal | Filter |
| --- | --- |
| Spans, logs | `service.namespace` = `environments.<env>.namespace` when set, else `service.name` in the components that served the window |
| Web events | the page-URL key contains `--host` (preview) or the environment's URL host; plus `service.name` = `web.service_name` when set |

Discover keys once per run with `getAttributeKeys` (scopes `spans`, `logs`, `web-events`); use the exact keys it returns for status, severity, route, and page URL, never a guessed one.

Isolate browser sessions: group web events by `session.id`.
On `--driver playwright`, keep sessions whose `user_agent.original` contains `HeadlessChrome` when the key exists.
On `--driver chrome`, or when more than one session remains, keep them all and set `attribution: shared-window`.

## Queries per step

| Step | Query |
| --- | --- |
| Pipe check | `getServiceCatalog` with the namespace filter and window; `getWebEvents` with `pagination.limit: 1` when browser traffic ran |
| Expectations | `getSpans` by span name, `getLogRecords` by body, `getMetricCatalog` for new metrics, `getWebEvents` by event name |
| Journeys | `getWebEvents` ordered `oldestFirst`; the request event's trace ID → `getTraceDetails` |
| Errors | `getSpans` with status ERROR; `getLogRecords` with severity ERROR or WARN; server spans with HTTP status ≥ 500; web events named `*error*` / `*exception*` |
| Performance | `getSpans` for each journey's route ordered by duration; `getTraceDetails` on the slowest to count identical children and find waterfalls |

Follow every cursor until exhausted or 200 records are read; past that, note `truncated at 200` and treat an unmatched expectation as `ambiguous`.
When a tool ending in `generateDash0Url` exists, add a link to each finding's evidence.

## Common mistakes

- Picking a server because it is connected. **Fix:** its `listDatasets` must contain the dataset.
- Calling a window clean after one empty query. **Fix:** the retries in SKILL.md Step 1, on the same window.
- Hard-coding `url.full`. **Fix:** discover the page-URL key with `getAttributeKeys`.
