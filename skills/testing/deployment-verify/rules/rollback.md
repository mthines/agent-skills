---
title: Rollback — fastest reversal first, then prove recovery from telemetry
impact: HIGH
tags: [deployment-verify, rollback, recovery, policy]
---

# Rollback

Apply the `rollback` policy ([`config.md`](./config.md#policy)) before acting; unattended runs apply [`automation.md`](./automation.md#the-answer-to-every-question).
Write `phase: rollback` to the state before the reversal runs, so an interrupted tick repeats it ([`state.md`](./state.md#interrupted-ticks)).
`reversibility: irreversible` never rolls back automatically, whatever the policy.

## Act

Take the first row that applies:

| Change has | Do |
| --- | --- |
| A flag | Run the provider's `set` with the off value (`0`, or `false` for `boolean`); wait `propagation_seconds` |
| No flag, a `release.yml` → `rollback` entry with `kind: platform` | Run its `run` command |
| Nothing else | `kind: revert-pr`: `gh pr create` reverting the merge commit, titled `revert: <PR title>`, linking the evidence; never merge it yourself |

A flag rollback is the only one that leaves the deploy in place, so it is always first.

```text
✗ Wrong — error spike at 10 % → open a revert PR, wait for CI and a deploy (tens of minutes)
✓ Right — error spike at 10 % → set the flag to 0 (seconds plus propagation), then report
```

## Prove recovery

Measure one more window, the same way as a step, after the ingest wait:

| Result | Report |
| --- | --- |
| `test.n = 0` and the control error rate ≤ `baseline` + `max_error_rate_delta_pp` | `RECOVERED in <seconds from verdict to the first clean window>`; outcome `ROLLED_BACK` |
| Test traffic still arriving | Extend once by `propagation_seconds`; still arriving → `ESCALATE — rollback did not take effect` |
| No test traffic but errors stay high | `ESCALATE — errors persist after rollback; likely not this change` |

`ESCALATE` ends the rollout, leads the report, and is notified at once ([`notify.md`](./notify.md)); a human takes over.

## Hand off the cause

The verdict says what broke, not why.
After `ROLLED_BACK`, write the evidence (the contract, every step's stats and verdict, the windows, the query) into the report, then:

- When the telemetry MCP server exposes `runTask` (Dash0 Agent0), ask it for the cause of errors on `root_spans` in the failing window and quote its answer with its thread link.
- End the report with the next command: `/fix-bug <PR URL> — failing window <from>..<to>`.
