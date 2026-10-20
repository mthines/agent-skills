---
title: Telemetry review — read the run back through a second witness
impact: HIGH
tags:
  - telemetry
  - logs
  - traces
  - performance
---

# Telemetry review

Phase 4 reads every probe window back through what the services recorded, to find what the browser could not see: swallowed errors, slow paths, N+1 queries, and missing signals.
It also builds a short picture of how each acceptance criterion flows through the services, which goes into the report's "Under the hood" section.
This file defines the steps; the queries live in the backend file named by `telemetry.backend`.

| `telemetry.backend` | Backend file | Witness | Use when |
| --- | --- | --- | --- |
| `dash0-mcp` | [`telemetry/dash0-mcp.md`](./telemetry/dash0-mcp.md) | Spans, logs, and web events in a Dash0 dataset, read over MCP | The local services export OpenTelemetry to a Dash0 dataset and a Dash0 MCP server can read it |
| `logs` | [`telemetry/logs.md`](./telemetry/logs.md) | Service logs captured by the stack driver, plus browser console and network evidence from Phase 3 | No queryable telemetry backend; the default |
| `none` | — | — | Phase 4 is `SKIPPED (telemetry.backend: none)`; the report says so |

A backend that is configured but unreachable is `SKIPPED (<reason>)`, never silently swapped for another backend.

## Step 0 — Wait, then confirm the pipe

For each window in `probes.jsonl`, the backend queries `from = window_start - 30s`, `to = window_end + 60s`.
If `now < window_end + telemetry.ingest_wait_seconds`, sleep the difference first (the `logs` backend sets this to `0`).

Before reading an absence as good news, the backend proves it **can** see the window: at least one record from each component started in Phase 2 that served the window.
A component that served requests but left no record is a `missing-signal` finding, unless the backend's pipe check names a config cause.

## Step 1 — Errors

The backend returns every error-shaped record in the window, grouped by (service, operation, message).
Each distinct group is a `telemetry-error` finding, with these exceptions:

| Record | Finding |
| --- | --- |
| A server error (HTTP ≥ 500) while the UI showed success | `crash` |
| An uncaught browser exception | `crash` |
| WARN only | `low`, unless it repeats per request |
| A 4xx for an edge case that must be rejected, or an error the PR deliberately logs | None — say why in one line |

For each finding, locate the deepest failing point (span, stack frame, or first error line) — that is where Phase 5 starts.

## Step 2 — Performance

For each endpoint and route in `intent.md` surfaces:

1. The slowest server-side duration over `telemetry.thresholds.interactive_span_ms` → `performance`.
2. More than `telemetry.thresholds.repeated_child_spans` identical child operations under one request → `performance` (N+1).
3. The same request issued twice by the UI for one action → `performance`.
4. Compare with a baseline only when one exists (the same probe in an earlier loop). No baseline → judge against the threshold alone.

## Step 3 — Expected signals

Grep the diff for new instrumentation (`tracer.start`, `startActiveSpan`, `span.setAttribute`, `logger.`, `log.`, `console.error`, `meter.create`, semconv constants).
For each new span name, log message, or metric the backend can see: confirm it appears in the window with the attributes the code sets.
Absent, or present without its attributes → `missing-signal`.
A new error path with no log or span status → `missing-signal` (the `measurable` principle: a failure must be visible).
A signal type the backend cannot see (spans or metrics under `logs`) is `not-checkable (<backend>)` in the report, never a pass.

## Step 4 — Flow picture

For each acceptance criterion, one line for its main request:

```text
AC-2 POST /api/views → web-api (38 ms) → views-service PUT /api/views (21 ms) → postgres INSERT (4 ms)   total 71 ms, 0 errors   # dash0-mcp
AC-2 POST /api/views 201 in 84 ms; api log: "view created id=…"; 0 error lines                            # logs
```

## Looping

After Phase 5 fixes, the re-verified probes produce new windows; run Steps 0–3 on those windows only.
Stop when a loop adds no new findings or at `--loops` (default `telemetry.loops`).
A finding seen in every loop despite a fix is `escalated`, with the trace IDs or log lines as evidence.

## Common mistakes

- Querying immediately after a probe. **Fix:** Step 0's ingest wait.
- Calling a window clean when the service sent nothing. **Fix:** Step 0's pipe check.
- Using a wide time range that mixes in other activity. **Fix:** probe windows plus the backend's service filter.
