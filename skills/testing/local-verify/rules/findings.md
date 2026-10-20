---
title: Findings — one record shape for every phase
impact: MEDIUM
tags:
  - findings
  - severity
  - schema
---

# Findings

Phases 3, 4, and 5 append to `.agent/{branch}/local-verify/findings.jsonl`, one JSON object per line.
Phase 6 renders the report from this file alone, so a finding not written here does not exist.

## Record

```json
{
  "id": "F-4",
  "kind": "ungraceful",
  "severity": "high",
  "source": "EC-9",
  "surface": "ui:/dashboards/new",
  "observed": "POST /api/views returned 500; form cleared and showed a blank toast",
  "expected": "Inline error, form keeps its values",
  "evidence": [".agent/feat-x/.aw-tester/captures/ec-9.png", "trace:4bf92f3577b34da6"],
  "in_scope": true,
  "status": "fixed",
  "fix_commit": "a1b2c3d",
  "reverified": "EC-9 pass after fix; no ERROR spans in window"
}
```

Update a record in place (rewrite its line) when its status changes; never append a duplicate ID.

## `kind`

| Kind | Use when |
| --- | --- |
| `functional` | An acceptance criterion's outcome is wrong or missing |
| `crash` | Uncaught exception, error boundary, blank screen, failed start, 5xx on valid input |
| `ungraceful` | Bad input or a failed dependency is handled without a usable message, loses data, or needs a reload |
| `ux` | Works, but confusing flow, wrong copy, missing loading/empty state (judge with the `ux` skill) |
| `a11y` | Keyboard trap, missing label, focus lost, contrast |
| `telemetry-error` | ERROR span, ERROR/WARN log, or unexpected 4xx/5xx the UI did not show |
| `performance` | Over `interactive_span_ms`, N+1 children, request waterfall, repeated identical calls |
| `missing-signal` | The feature's new path emits no span/log/metric, or an expected attribute is absent |
| `spec-drift` | The PR's behavior and the ticket's acceptance criteria disagree |

## `severity`

| Severity | Criterion |
| --- | --- |
| `critical` | Data loss, security exposure, crash or 5xx on the happy path |
| `high` | An acceptance criterion fails, or a crash/5xx on an edge input |
| `medium` | Ungraceful but recoverable; performance over threshold; missing signal on a new path |
| `low` | Polish: copy, spacing, a WARN log with no user impact |

## `in_scope`

`true` when the finding is in code the PR changed, or is a behavior the PR's acceptance criteria cover.
`false` for pre-existing problems in untouched code — reported, fixed only under [`fix-loop.md § Scope`](./fix-loop.md#scope).

## `status`

`open` → `fixed` (with `fix_commit` and `reverified`) · `escalated` (needs a human: product decision, out-of-repo cause) · `wont-fix` (with the reason, e.g. intended behavior per ticket).
