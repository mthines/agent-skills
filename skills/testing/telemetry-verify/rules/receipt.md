---
title: Receipt — journeys, findings, verdict, and the TELEMETRY block
impact: HIGH
tags:
  - telemetry-verify
  - receipt
  - findings
---

# Receipt

## 1. Journeys

One line per acceptance criterion the window exercised, following its main user action end to end:

```text
AC-2 confirms — click "Save" → POST /api/views 201 (84 ms) → views-service PUT /api/views (21 ms) → postgres INSERT (4 ms)
```

1. Start at the web event for the action (click, route change, or fetch) when browser traffic ran; else at the server span for the request.
2. Follow the fetch's propagated trace context to its backend trace, then each hop's child spans to the database or downstream call.
3. A fetch to the app's own API whose trace has no backend spans is an `unlinked` finding: either the web SDK does not propagate trace headers to that origin, or the server does not read them.
4. A criterion with a `telemetry:` claim adds its verdict word after the ID; any other criterion's line is evidence only and uses `seen`.

## 2. Errors behind a green UI

| Record in the window | Finding `kind` | Severity |
| --- | --- | --- |
| Server span with HTTP status ≥ 500, or an uncaught browser exception | `crash` | `high` |
| ERROR span status, ERROR log record, or a web event named `*error*` / `*exception*` | `telemetry-error` | `high` when the UI showed success, else `medium` |
| WARN log | `telemetry-error` | `low`, unless it repeats per request |
| A 4xx for input the criterion requires rejecting, or an error the diff logs on purpose | none — say why in one line | — |

Group by (service, operation, message with IDs and numbers stripped); one finding per group, citing the deepest failing span, stack frame, or first error line.

## 3. Performance

| Observation | Finding |
| --- | --- |
| A server span for a journey above `thresholds.interactive_span_ms` | `performance` |
| More than `thresholds.repeated_child_spans` identical children under one request (N+1) | `performance` |
| The same request issued twice for one user action | `performance` |
| Sequential sibling calls with no data dependency (waterfall) | `performance`, `low` |

## 4. Findings record

With `--out`, append one JSON line per finding in the `verify` skill's findings shape, IDs `T-<n>`:

```json
{"id":"T-1","kind":"unlinked","severity":"medium","source":"AC-2","surface":"api:PUT /api/views","observed":"fetch PUT /api/views has no backend spans in trace 4bf92f35","expected":"the web event's trace continues into views-service","evidence":["trace:4bf92f3577b34da6"],"in_scope":true,"status":"open"}
```

`kind` is one of `crash`, `telemetry-error`, `performance`, `missing-signal`, `unlinked`.

## 5. Verdict

| Situation | Verdict |
| --- | --- |
| Step 0 skipped | `null` |
| Any `telemetry:` criterion contradicted on a clean pipe | `contradicts` |
| Every `telemetry:` criterion confirmed | `confirms` |
| A criterion could not be decided: pipe `missing-signal` or `inconclusive`, `attribution: shared-window`, or the read was still growing at the last retry | `ambiguous` |
| No `telemetry:` criteria | the same rows over the diff's expected signals; none expected → `null` |

A degraded pipe never yields `contradicts`: absence on a broken pipe is not proof.
Findings are reported beside the verdict and never change it.

## Output

Print exactly this block; omit no line, and use `0` for empty counts:

```text
TELEMETRY <env> <from>..<to> · <backend> · server: <name|n/a>
pipe: ok | missing-signal: <components> | skipped (<reason>) | inconclusive (<reason>)
AC-2 confirms — click "Save" → POST /api/views 201 (84 ms) → views-service PUT /api/views (21 ms) → postgres INSERT (4 ms)
AC-3 contradicts — expected span checkout.submit with order.id; seen without order.id
signals: <n> confirmed, <m> missing (<names>), <k> not-checkable (<backend>)
findings: <n> — crash <a>, telemetry-error <b>, performance <c>, missing-signal <d>, unlinked <e>
[receipt] verdict: confirms|contradicts|ambiguous|null
```

Append ` · attribution: shared-window` to the first line when sessions could not be isolated.
On a skip, print the first two lines and the verdict line only.
