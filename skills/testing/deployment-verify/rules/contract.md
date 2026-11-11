---
title: Contract — what "broken" means for this change, written before the deploy
impact: HIGH
tags: [deployment-verify, contract, pr-body, thresholds]
---

# Contract

Every run judges one change against its contract.
The contract lives in the PR body, so it survives the merge and the worktree cleanup.
Write it before the PR merges; never write or edit it after the rollout starts.
**Why:** a threshold chosen after seeing the numbers is chosen to pass them.

## Shape

One fenced JSON block between the markers, anywhere in the PR body; JSON because the controller reads it with no dependencies:

````markdown
<!-- deployment-verify:v1 -->
```json
{
  "service": "ui",
  "root_spans": ["GET /api/checkout"],
  "flag": { "key": "checkoutV2", "provider": "posthog" },
  "cohort": { "attribute": "feature_flag.result.variant", "test": "true", "control": "false", "on": "root" },
  "reversibility": "flag",
  "thresholds": { "max_error_rate_delta_pp": 2 }
}
```
<!-- /deployment-verify:v1 -->
````

| Field | Meaning |
| --- | --- |
| `service` | Resource `service.name` the change runs in |
| `root_spans` | SERVER span names the flag changes; errors and latency are read here |
| `flag` | The flag the change ships behind; `provider` names a `release.yml` → `flags.providers[].name`. Omit for a change with no flag |
| `cohort` | The span attribute naming the cohort, its flag-on (`test`) and flag-off (`control`) values, and `on`: `root` or `child` ([`telemetry.md`](./telemetry.md)) |
| `reversibility` | `flag`, `redeploy`, or `irreversible` |
| `thresholds` | Optional; may only tighten `release.yml` thresholds |
| `steps` | Optional; overrides `release.yml` → `steps` for this change |

## Validate before step 1

Take the first row that fails; print its line and stop without touching the flag:

| Check | Stop line |
| --- | --- |
| No region in the PR body | `no contract — add a <!-- deployment-verify:v1 --> block to the PR body` |
| `flag.provider` names no `release.yml` provider | `unknown provider <name>` |
| `cohort.attribute` is `feature_flag.*` read from span **events** only | `cohort attribute must be a span attribute — span events are not queryable` |
| A `thresholds` key loosens `release.yml` (higher `max_*`, lower `min_*`) | `contract loosens <key> — thresholds may only tighten` |
| `reversibility: irreversible` | run in report-only mode: measure and decide, never roll back, say `irreversible — rollback needs a human` |

```text
✗ Wrong — loosens the error budget for this change:   "thresholds": { "max_error_rate_delta_pp": 20 }
✓ Right — a payment path tightens it:                 "thresholds": { "max_error_rate_delta_pp": 1, "min_test_requests": 50 }
```

## No flag

A change with no flag has no cohorts.
Run one step at 100 % with `baseline` as the reference ([`loop.md`](./loop.md#the-100--step)), and roll back with `release.yml` → `rollback` instead of the flag.
Say so in the report: `no flag — before/after only, attribution weaker`.
