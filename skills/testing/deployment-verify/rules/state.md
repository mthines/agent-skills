---
title: State — one rollout survives many short runs
impact: HIGH
tags: [deployment-verify, state, resume, tick, lease, automation]
---

# State

A rollout lasts hours; an automation run lasts minutes.
So every run is a **tick**: read the state, do the one unit of work that is due, write the state, exit.
[`scripts/tick.mjs`](../scripts/tick.mjs) implements every tick below with no model; this file is its specification.
The state lives on the PR, never in the sandbox or `.agent/`, so any later run on any host continues it.

## Where

| Thing | Where | Written by |
| --- | --- | --- |
| Opt-in | The `deployment-verify` label on the PR | the author, or `aw` when it writes the contract |
| State | A hidden JSON line inside the report comment: `<!-- deployment-verify:v1:state {...} -->` | every tick |
| Finished | The label swapped for `deployment-verify:done` | the tick that reaches a terminal outcome |

Find the report comment by its marker `<!-- deployment-verify:v1:report -->` (`gh api repos/{owner}/{repo}/issues/<n>/comments --paginate`).
Edit it in place with `gh api -X PATCH repos/{owner}/{repo}/issues/comments/<id>`; never post a second one.

## Shape

```json
{
  "phase": "deploy | baseline | step | rollback | done",
  "env": "production",
  "deploy_live_at": "2026-11-11T08:38:38Z",
  "baseline": { "n": 575, "errors": 0, "avg_ms": 5.2, "from": "…Z", "to": "…Z" },
  "step_index": 1,
  "step_value": 10,
  "last_passed_value": 1,
  "step_set_at": "…Z",
  "hold_since": null,
  "steps": [{ "value": 1, "from": "…Z", "to": "…Z", "test": {}, "control": {}, "verdict": "PASS", "reason": "…" }],
  "outcome": null,
  "notified": ["ROLLED_BACK"],
  "lease": { "holder": "<run id>", "until": "…Z" }
}
```

## One tick

1. **Find work.** `--pr <n>`: that PR. `--all`: `gh pr list --state merged --label deployment-verify --json number` — every merged PR still in progress.
2. **Take the lease.** Skip the PR when `lease.until` is in the future and `holder` is not this run. Otherwise write `lease = { holder: <run id>, until: now + 15 min }`, re-read the comment, and continue only if `holder` is still this run.
3. **Do the due unit** for the phase:

| `phase` | Due when | Unit of work |
| --- | --- | --- |
| absent | always | Validate the contract, write the first state with `phase: deploy`, post the report comment |
| `deploy` | always | One deploy-detection check ([`config.md`](./config.md#deploy-detection)); live → record `deploy_live_at`, `phase: baseline` |
| `baseline` | `step_window_minutes` after `deploy_live_at` | Measure the baseline ([`loop.md`](./loop.md#baseline)); enough → `phase: step`, `step_index: 0` |
| `step`, flag not yet set | always | Set the step's value, record `step_set_at` |
| `step`, flag set | `propagation_seconds + step_window_minutes` after `step_set_at`, plus the ingest wait | Measure, confirm live, decide, act ([`loop.md`](./loop.md#each-step)) |
| `rollback` | the ingest wait after the rollback | Prove recovery ([`rollback.md`](./rollback.md#prove-recovery)) |
| `done` | never | Nothing |

   Not due yet → change nothing but the lease, and exit.
4. **Write the state and the report table**, release the lease (`lease: null`), notify if an outcome is new ([`notify.md`](./notify.md)), and swap the label when `phase` is `done`.

On `local` and `preview`, where the skill sends the traffic itself, a single tick may run all due units back to back; the state is still written after each.

```text
✗ Wrong — one automation run sleeps through four 10-minute windows (the run times out mid-rollout, flag stuck at 50 %)
✓ Right — a @every 10m run ticks; each tick sets or measures one step and exits
```

## Interrupted ticks

A tick that dies after `set` but before writing the state leaves the flag ahead of the state.
The next tick sees `step_set_at` absent, runs `set` again — `set` is idempotent — and continues.
A lease that expired with `phase: rollback` is the one case that cannot wait: the next tick runs the rollback `set` again before anything else.
