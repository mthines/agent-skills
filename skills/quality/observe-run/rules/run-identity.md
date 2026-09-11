---
title: observe-run — two-layer run identity
impact: HIGH
tags:
  - observe-run
  - run-identity
  - resource-attributes
  - cardinality
---

# Two-layer run identity

Every `observe-run` invocation stamps identity at two layers.
Conflating them is the mistake this file exists to prevent: a dataset answers "whose telemetry is
this," a resource attribute answers "which run, on which branch, on which machine."

## Layer 1 — dataset (coarse tenancy)

The dataset is the coarsest unit of tenancy Dash0 offers, and it buys three concrete things:

1. **Blast radius as a correctness guarantee.** A query scoped to a dev dataset cannot leak into,
   or be leaked into by, production data — the isolation is structural, not a filter that could be
   forgotten.
2. **Retention and cost control.** Dev-run telemetry is disposable, high-volume, and short-lived;
   it does not need production's retention window or its cost profile.
3. **No pollution of production dashboards, SLOs, or check rules.** A dev run's spans never
   contribute a data point to a prod SLO's error budget or trip a prod check rule's threshold.

**Recommend creating a dev dataset. Never assume one exists.**
This repo's own organization has 7 datasets today, and none of them is a dev or local one — the
gap this recommendation exists to close, not a hypothetical.

A dataset alone is not enough: it cannot discriminate iteration 3 of a dev loop from iteration 6,
nor one laptop's run from another's on a shared dev dataset.
That discrimination is layer 2's job.

## Layer 2 — resource attributes (fine run identity)

Stamp these three resource attributes on every span, log, and metric a run produces (via
`--resource-attribute` at rung 2, or the SDK's resource configuration at rung 1):

| Attribute | Source | Purpose |
| --- | --- | --- |
| `deployment.environment.name` | Real OTel semantic-convention key | Distinguishes dev/local from staging/prod at the resource level |
| `vcs.ref.head.name` | Real OTel semantic-convention key | Ties a run's telemetry to the branch that produced it |
| `dev.run.id` | **Deliberately custom** | Discriminates one invocation from the next — see below |

### `dev.run.id` is deliberately custom

`otel-semantic-conventions` mandates searching the attribute registry before inventing a key.
`dev.run.id` was searched for and does not exist in the registry — there is no standard attribute
for "which invocation of a dev-loop command produced this telemetry."
It is invented deliberately, once, and named here so a future author does not re-invent a
differently-spelled equivalent.

### The cardinality caution

`dev.run.id` is **unbounded** — a new value every invocation, forever.
That is harmless as a **resource attribute on traces**: Dash0 indexes resource attributes for
filtering, and an unbounded set of filter values costs nothing extra to store per span.

It is a **cardinality bomb the moment it reaches a metric dimension.**
A metric's series count is the product of its dimensions' cardinalities; an unbounded dimension
means an unbounded number of series, which degrades query performance and can blow out a metrics
backend's memory budget.

### Correct

```text
--resource-attribute dev.run.id=run-2026-09-11T20:45:00Z-a1b2c3
```
Applied at the resource level of a trace. Filterable, disposable, and never touches a metric
dimension.

### Incorrect

```text
metric: otlp_proxy_requests_total{dev.run.id="run-2026-09-11T20:45:00Z-a1b2c3", ...}
```
✗ WRONG — using `dev.run.id` as a metric label creates one new time series per invocation,
forever. Use it as a resource/span attribute on traces and logs only; never as a metric dimension.

## What this rule does not do

- It does not decide which rung stamps these attributes — see [`rules/rungs.md`](./rungs.md).
- It does not validate other semantic-convention keys beyond the three named above — defer to
  `otel-semantic-conventions` when installed.
