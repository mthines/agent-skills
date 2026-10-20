---
title: Telemetry backend — captured logs and browser evidence
impact: HIGH
tags:
  - telemetry-backend
  - logs
---

# Telemetry backend: `logs`

Implements the [`telemetry-review.md`](../telemetry-review.md) steps from evidence that needs no observability backend:

| Source | Where it comes from |
| --- | --- |
| Service logs | The stack driver's § Logs section (`procs/<name>.log` byte ranges, `docker compose logs --since/--until`, the `cli` driver's `logs` command) |
| Browser console and failed requests | Phase 3: `ui-verify` or `playwright-cli` evidence for each probe |
| Request timings | Phase 3 network evidence; API probes record `curl -w '%{http_code} %{time_total}'` |

`ingest_wait_seconds` is `0`: logs are local and immediate.
Under the `none` stack driver there are no service logs; only the browser and API-probe sources apply, and the report says so.

## Step 0 — Pipe check

Each component that served the window must have at least one log line in it.
A silent component is a `missing-signal` finding only when its normal output includes a line per request (an access log); otherwise record `pipe: quiet (<component> logs no per-request line)` and continue.

## Step 1 — Errors

Slice each component's log to the window, then match error-shaped lines:

```bash
grep -nE '(^|[^a-z])(ERROR|FATAL|CRITICAL|PANIC|panic:|Traceback|Unhandled|UnhandledPromiseRejection|Exception|"level":"(error|fatal)"|level=(error|fatal)| 5[0-9]{2} )' <window-slice>
```

Group matches by (component, first line of the message with IDs, numbers, and timestamps stripped).
Carry the full multi-line stack trace that follows a match as evidence.
Add Phase 3's uncaught console errors (browser exceptions) and failed requests with status ≥ 500 (server errors).

## Step 2 — Performance

Use Phase 3 network timings and API-probe `time_total` per request.
When a component writes access logs with a duration field, use those instead; they exclude browser overhead.
N+1 is checkable only when a log line is written per query or per outbound call; otherwise `not-checkable (logs)`.

## Step 3 — Expected signals

Only log messages are checkable: confirm each new `logger.*` / `log.*` message from the diff appears in the window.
New spans and metrics are `not-checkable (logs)`.

## Step 4 — Flow picture

One line per acceptance criterion: method, path, status, duration, and the most informative log line the request produced.

## Common mistakes

- Grepping the whole log file. **Fix:** slice to the probe window; earlier errors belong to earlier probes or to startup.
- Counting a startup warning as a finding of every probe. **Fix:** a line before the first window is startup noise, reported once if at all.
