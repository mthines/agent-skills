---
title: Telemetry — measuring the cohorts so the numbers can be trusted
impact: HIGH
tags: [deployment-verify, telemetry, d0ql, cohorts, ingest]
---

# Telemetry

Every number the verdict sees comes from one query shape per window: per cohort, the request count, the error count, and the average duration of the contract's `root_spans`.

## Rules

1. **Errors are read on the root SERVER span.** A failed request is `status_code = 'ERROR'`; a successful one is `UNSET`, not `OK`. Never treat `UNSET` as unknown.
2. **Pass the window through the tool's `timeRange`** as ISO-8601 with `Z`. Never compare `timestamp` to a string literal in the query; its time zone is not guaranteed.
3. **Scope on the change's own attributes**, not on time alone: `service.name`, the `root_spans`, and the cohort attribute's two values. A window that also holds an earlier step's traffic is caught by the step check in [`loop.md`](./loop.md#confirm-the-step-is-live).
4. **Wait for ingestion.** Measure only after `ingest_wait_seconds` past the window end. When the skill sent the traffic, compare the counted total with the requests sent; below 90 %, wait another `ingest_wait_seconds` and measure again.
5. **Span events are not queryable.** A flag read recorded only as a `feature_flag.evaluation` span event cannot split cohorts; the attribute must be on a span.

```text
✗ Wrong — WHERE timestamp >= '2026-11-11 10:15:38'   (zone-dependent; returned earlier steps)
✓ Right — timeRange { from: "2026-11-11T10:15:38Z", to: "2026-11-11T10:16:30Z" }
```

## Query — cohort attribute on the root span (`cohort.on: root`)

```sql
SELECT span_attributes['<cohort.attribute>'] AS variant,
       count() AS n,
       countIf(status_code = 'ERROR') AS errors,
       round(avg(duration) / 1000000, 1) AS avg_ms
FROM spans
WHERE resource_attributes['service.name'] = '<service>'
  AND kind = 'SERVER'
  AND name IN (<root_spans>)
  AND span_attributes['<cohort.attribute>'] IN ('<test>', '<control>')
GROUP BY variant
```

## Query — cohort attribute on a child span (`cohort.on: child`)

A framework's `getActiveSpan()` inside a handler often returns an inner span (Next.js: `executing api route …`), whose status stays `UNSET` when the response is a 500.
Join the child to its root by `trace_id`:

```sql
SELECT c.span_attributes['<cohort.attribute>'] AS variant,
       count() AS n,
       countIf(r.status_code = 'ERROR') AS errors,
       round(avg(r.duration) / 1000000, 1) AS avg_ms
FROM spans AS c
INNER JOIN spans AS r ON c.trace_id = r.trace_id
WHERE c.resource_attributes['service.name'] = '<service>'
  AND c.span_attributes['<cohort.attribute>'] IN ('<test>', '<control>')
  AND r.kind = 'SERVER'
  AND r.name IN (<root_spans>)
GROUP BY variant
```

Recommend `cohort.on: root` in the report whenever a run needed the join: it is cheaper and cannot double-count.

## D0QL limits (Dash0)

| Not supported | Use |
| --- | --- |
| `quantile`, percentiles | `avg` and `max`; the latency rule is average-based |
| `toDateTime`, `toDateTime64` | the tool's `timeRange` |
| span events | span attributes |

Every `SELECT` returns at most 20 rows unless it aggregates; the cohort query returns two.

## Into `decide.mjs`

Map the rows to the stats shape: the `test` row → `test`, the `control` row → `control`, a missing row → `{ "n": 0, "errors": 0, "avg_ms": 0 }`.
Add `baseline` from the pre-rollout window ([`loop.md`](./loop.md#baseline)).
