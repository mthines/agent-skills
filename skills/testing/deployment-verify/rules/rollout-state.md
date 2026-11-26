---
title: Rollout state — one gauge point per transition, for the live pipeline board
impact: MEDIUM
tags: [deployment-verify, telemetry, otlp, dash0, dashboards, rollout]
---

# Rollout state

After a tick writes the PR comment, [`scripts/rollout-state.mjs`](../scripts/rollout-state.mjs) exports one `deployment.rollout.state` gauge point when the rollout moved.
It is what lets a dashboard show a merged PR's rollout as it happens, after atelier's own run has ended.
Telemetry never decides: no tick reads it, and a failed export never changes an outcome or a tick's exit code.

## When it sends

| Tick result | Sends |
| --- | --- |
| first state, or a new `phase`, `step_value`, or `outcome` | one point |
| only a lease or a window changed | nothing |
| no PR (`--local`), no PR URL, or no export endpoint | nothing |

```text
✗ a point on every tick: a 10-minute rollout sends dozens, and a lease change looks like progress
✓ a point per transition: deploy → baseline → step 1 → step 10 → done
```

## Export

Export is opt-in and uses atelier's settings, so a rollout lands in the dataset its run did: `ATELIER_TELEMETRY=off` wins, then `ATELIER_OTLP_ENDPOINT` (+ `_HEADERS`), then `PR_REVIEWER_OTLP_ENDPOINT` (+ `_HEADERS`).
A host's own `OTEL_EXPORTER_OTLP_ENDPOINT` is never picked up.
A scheduled automation needs one of these set to export; without one the rollout still runs and reports on the PR.
The encoder is pr-reviewer's `otlp.mjs`, found at `DEPLOYMENT_VERIFY_OTLP_MJS`, this checkout, the installed agent, or the Agent0 install.

## Schema

Resource `service.name` is `deployment-verify`; `service.instance.id` is `<owner>/<repo>#<pr>`.
Every attribute and metric name below is a dashboard contract: renaming one empties the panels that read it.

| Metric | Type | Value |
| --- | --- | --- |
| `deployment.rollout.state` | GAUGE, seconds | the transition's epoch seconds, so `topk by (atelier_work_ref) (1, …)` reads a rollout's newest state |

| Attribute | Values |
| --- | --- |
| `atelier.work.ref` | the PR URL; the same value atelier's run carries, so a board joins on it |
| `vcs.repository.name`, `vcs.owner.name`, `vcs.change.id` | the PR's repo and number |
| `deployment.phase` | `deploy` · `baseline` · `step` · `hold` · `rollback` · `done` |
| `deployment.step` | the percent at a `step` or `hold`; absent otherwise |
| `deployment.outcome` | set on `done`: `PASS`, `ROLLED_BACK`, `ESCALATE`, `INCONCLUSIVE`, … |
| `deployment.env` | `production`, `preview`, `local` |
| `atelier.smoke` | `true` when `deployment.env` is `local`; every panel drops it |

The free-text reason stays on the PR comment; a metric label is bounded.

```promql
# correct: a rollout's newest state, finished rollouts removed (a hold is not finished)
topk by (atelier_work_ref) (1, last_over_time({otel_metric_name="deployment.rollout.state", service_name="deployment-verify", atelier_smoke=""}[7d]))
  unless on (atelier_work_ref) last_over_time({otel_metric_name="deployment.rollout.state", service_name="deployment-verify", atelier_smoke="", deployment_phase="done"}[7d])

# incorrect: every phase a rollout passed through, so one PR is listed once per phase
last_over_time({otel_metric_name="deployment.rollout.state", service_name="deployment-verify", atelier_smoke=""}[7d])
```
