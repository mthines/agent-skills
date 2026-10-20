---
title: Telemetry backend — Dash0 over MCP
impact: HIGH
tags:
  - telemetry-backend
  - dash0
  - mcp
---

# Telemetry backend: `dash0-mcp`

Implements the [`telemetry-review.md`](../telemetry-review.md) steps against a Dash0 dataset, through the MCP server named by `telemetry.mcp_server` (tools `mcp__<server>__*`).

| Config | Meaning |
| --- | --- |
| `telemetry.mcp_server` | The MCP server key whose datasets include `telemetry.dataset` |
| `telemetry.dataset` | Where the local services export (e.g. `alice-local`) |
| `telemetry.namespace` | The `service.namespace` the local services report; empty → filter by `service.name` of the started components instead |

**Use only a server whose `listDatasets` result contains `telemetry.dataset`.**
Another connected Dash0 server (a production org, a different region) does not hold local telemetry; an empty answer from it proves nothing.
No `<server>` tools in the session → `SKIPPED (no <server> MCP — add it to .mcp.json and restart)`.
`setup` records the server by matching each candidate's `listDatasets` against the dataset, and the repo notes file may name the correct server (for example, a development-region server rather than the production connector).

## Step 0 — Pipe check

```text
mcp__<server>__getServiceCatalog { dataset, timeRange, filters: [{ key: "service.namespace", operator: "is", value: "<namespace>" }] }
```

A component that served the window but reports zero requests → `missing-signal`; check that the stack exports telemetry (the `cli` driver's tool config, or the repo notes file, names the switch) before blaming the service.
Discover attribute keys once per run with `getAttributeKeys` (scopes `spans`, `logs`); use the exact keys it returns for status, severity, and route.

## Step 1 — Errors

| Query | Maps to |
| --- | --- |
| `getSpans` with span status = ERROR, namespace filter, window | Error groups |
| `getLogRecords` with severity ERROR or WARN, namespace filter, window | Error groups; WARN rules apply |
| Server spans with HTTP status ≥ 500 | Server errors |
| `getWebEvents` for the UI service, exception events (only when the UI exports RUM to this dataset) | Browser exceptions |

Open one representative trace per group with `getTraceDetails` and take the deepest failing span.

## Step 2 — Performance

1. `getSpans` filtered to the route and window, ordered by duration.
2. `getTraceDetails` on the slowest trace; count identical child spans under one parent, and flag sequential sibling calls that do not depend on each other (waterfall).

## Step 3 — Expected signals

Spans, logs, and metrics are all checkable: `getSpans` / `getLogRecords` by name or body, `getMetricCatalog` for new metrics.

## Step 4 — Flow picture

`getTraceDetails` on each acceptance criterion's main request; one hop per service with its duration.
