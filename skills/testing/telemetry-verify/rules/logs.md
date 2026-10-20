---
title: Backend logs — captured service logs plus browser evidence
impact: HIGH
tags:
  - telemetry-verify
  - logs
---

# Backend: `logs`

For a repo with no queryable telemetry backend.
Set `ingest_wait_seconds: 0`: logs are local and immediate.

| Source | From |
| --- | --- |
| Service logs | The stack driver's log capture for each component, sliced to the window: the probe's `log_offsets` byte range when `probes.jsonl` beside `--out` records one (the `command` driver), else the window's timestamps |
| Browser console errors and failed requests | The caller's browser evidence (the `ui-verify` run's captures) |
| Request timings | That network evidence, or an API probe's `curl -w '%{http_code} %{time_total}'` |

## Steps

1. **Pipe check.** Each component that served the window has at least one line in its slice.
   A silent component is `missing-signal` only when it normally writes one line per request; otherwise note `quiet (<component>)`.
2. **Errors.** Match error-shaped lines in each slice and group as in [`receipt.md § 2`](./receipt.md#2-errors-behind-a-green-ui):

   ```bash
   grep -nE '(^|[^a-z])(ERROR|FATAL|PANIC|panic:|Traceback|Unhandled|Exception|"level":"(error|fatal)"|level=(error|fatal)| 5[0-9]{2} )' <slice>
   ```

3. **Expectations.** Only log messages are checkable; spans, metrics, and web events are `not-checkable (logs)`, never confirmed.
4. **Journeys.** One line per criterion: method, path, status, duration, and the most informative log line the request produced.
5. **Performance.** From request timings; N+1 only when a line is written per query or outbound call, else `not-checkable (logs)`.

```text
✗ Wrong — grep the whole log file and report a startup error against this window
✓ Right — slice to the window; a line before the window is startup noise
```
