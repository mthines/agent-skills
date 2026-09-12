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

Stamp these three resource attributes on a run's telemetry (via `--resource-attribute` at rung 2, or
the SDK's resource configuration at rung 1).
**The signals each one goes on differ**, and the difference is load-bearing rather than an
oversight — see [the cardinality caution](#the-cardinality-caution) below:

| Attribute | Stamp on | Source | Purpose |
| --- | --- | --- | --- |
| `deployment.environment.name` | spans, logs, **and** metrics | Real OTel semantic-convention key | Distinguishes dev/local from staging/prod at the resource level |
| `vcs.ref.head.name` | spans, logs, **and** metrics | Real OTel semantic-convention key | Ties a run's telemetry to the branch that produced it |
| `dev.run.id` | spans and logs **only — never metrics** | **Deliberately custom** | Discriminates one invocation from the next — see below |

The first two are bounded (a handful of environments, a bounded set of live branches), so they cost
a metric nothing. `dev.run.id` is unbounded by construction and must never reach a metric
dimension.

### The `Stamp on` column is not free at rung 2 — pick the mechanism that can honour it

Stating a per-signal constraint does not make it satisfiable, and at rung 2 the obvious mechanism
**cannot** satisfy it. `--resource-attribute` upserts onto **every forwarded batch**
([`reader-adapters.md § Decoration flags`](./reader-adapters.md#decoration-flags)) and the proxy
forwards metrics as well as spans and logs (its `stats` event counts `metrics.rate` / `metrics.total`
/ `metrics.failed`). There is no per-signal scoping flag. So passing `dev.run.id` to the proxy
performs the exact anti-pattern the row above forbids, on every run where the process under test
emits a metric.

The two bounded keys are unaffected — they are *supposed* to reach metrics — so the flag keeps
carrying those. For `dev.run.id`, pick the first row that applies:

| Situation | Mechanism |
| --- | --- |
| The process under test emits **no** metrics over OTLP during the run | `--resource-attribute dev.run.id=<run-id>` is safe — there is no metric for it to land on. Confirm from the `stats` event's `metrics.total == 0` rather than assuming |
| It emits metrics **and** its SDK resource is configurable per provider | Stamp `dev.run.id` **SDK-side on the tracer and logger providers only**, leaving the meter provider's resource without it; pass the proxy only the two bounded keys |
| It emits metrics and its resource is not separable | **Rung 2 is unavailable for this run — fall back to rung 1**, where the SDK owns the resource and the constraint is satisfiable by construction |

**Row 3 is a rung change, not a degraded rung 2, and the difference is load-bearing.** The first
draft of this table said *"omit `dev.run.id` at rung 2 and scope the query by time window instead"*,
which reads like an acceptable degradation and is not: it creates a rung-2 state the rest of the
pipeline **cannot serve**, and the failure is the worst kind — a silent wrong verdict rather than a
missing one.

The mechanism is worth stating once, because the asymmetry that produces it is not obvious. At rung
2 the two inputs to a verdict come from different places and are scoped differently:

| Input | Source at rung 2 | Scoped by |
| --- | --- | --- |
| `totals` | `spans.total` on the proxy's `dash0.cli.otlp_proxy.stats` event | the **proxy's own lifetime** — it is started for this run and its counters begin at zero. The event carries **no** resource-attribute dimension, so `dev.run.id` cannot scope it and does not need to |
| the observed set | `dash0 spans query --filter "dev.run.id is <run-id>"` | `dev.run.id`, and **nothing else** — that filter is how the set is *defined* ([`receipt-mapping.md`](./receipt-mapping.md)) |

Drop `dev.run.id` and only the second one breaks. `totals` still counts every span the app emitted,
while the observed set matches **nothing** — so `CLEAN` AND `totals > 0` with the span "not in the
observed set" selects **`contradicts`**, on spans the app demonstrably emitted. That is the exact
inversion the `NOT CLEAN ⇒ ambiguous, never contradicts` rule exists to prevent, arriving by a path
that rule does not cover: the collection was never degraded, only unreadable.

Widening to a time window does not rescue it. The observed set is defined by the attribute filter,
and a window re-admits a concurrent run's spans — the *other* failure
[`receipt-mapping.md`](./receipt-mapping.md) names, grading this run on another run's evidence.

**So a rung-2 run requires `dev.run.id`. There is no rung-2 path without it**, and every reader may
therefore treat the attribute as present whenever rung 2 was selected — which is what keeps
`rungs.md`'s unconditional filter and `SKILL.md`'s Definition-of-Done box true rather than
aspirational.

Rung 2's **zero app config change** property (see [`rungs.md`](./rungs.md)) is about the *exporter
endpoint*: an OTel SDK at default endpoint configuration already points at the proxy's ports. It was
never a claim that no resource can be set app-side, and row 2 above is the one place rung 2 asks for
a line of app configuration.

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
