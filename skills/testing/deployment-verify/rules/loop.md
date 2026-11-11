---
title: Loop — baseline, then one rollout step at a time, each gated by decide.mjs
impact: HIGH
tags: [deployment-verify, rollout, loop, hold, baseline]
---

# Loop

[`scripts/tick.mjs`](../scripts/tick.mjs) measures and acts; [`scripts/decide.mjs`](../scripts/decide.mjs) decides. This file is their specification; never run the loop by hand when the controller can.
Never override, round, or reinterpret its verdict.
**Why:** a model reading its own rollout numbers talks itself into PASS.

```bash
node ${CLAUDE_SKILL_DIR}/scripts/decide.mjs thresholds.json < stats.json   # exit 0 PASS, 10 HOLD, 20 ROLLBACK
```

`thresholds.json` = `release.yml` → `thresholds` merged with the contract's `thresholds`.

## Baseline

Before step 1, with the flag at its off value, measure one window of `step_window_minutes` (local and preview: send `traffic` with `{n}` = 200).
Keep the `control` row as `baseline`; it is the reference at 100 % and the recovery target after a rollback.
A baseline with fewer than `min_reference_requests` requests → extend the window once; still short → stop: `not enough traffic to verify — <n> requests in <m> min`.

## Each step

For each value in `steps` (`[100]` for a `rollout: boolean` provider or a change with no flag):

1. **Set.** Run the provider's `set` with `{value}` = the step. Non-zero exit → stop, flag untouched since the last passed step.
2. **Propagate.** Wait `propagation_seconds`.
3. **Traffic.** Production: wait `step_window_minutes`. Local and preview: run `traffic` with `{n}` = `ceil(min_test_requests / (step / 100) × 1.5)`, at least 200. Record `from` and `to` around it.
4. **Measure.** One cohort query over the window ([`telemetry.md`](./telemetry.md)), after the ingest wait.
5. **Confirm the step is live** (below). Not live → stop.
6. **Decide.** Pipe the stats to `decide.mjs` and act on the exit code:

| Verdict | Act |
| --- | --- |
| PASS | Record the step as passed; next step |
| HOLD | Extend: production waits another `step_window_minutes`, local and preview send `traffic` again; re-measure the whole step window. Past `max_hold_minutes` on this step → set the last passed step's value (`0` before the first), end with `INCONCLUSIVE` |
| ROLLBACK | [`rollback.md`](./rollback.md) |

At most one action per verdict; never advance on HOLD.

```text
✗ Wrong — HOLD at 1 % (test 0 < 20), advance to 10 % "to get more data"
✓ Right — HOLD at 1 %: send more traffic at 1 % and re-measure; reaching 20 test requests takes about 2,000
```

## Confirm the step is live

A `set` that exited 0 proves nothing about traffic.
With `share = test.n / (test.n + control.n)`:

| Step | Live when |
| --- | --- |
| 1–99 % | `share ≥ step / 200` once `test.n + control.n ≥ 200`; fewer requests → HOLD |
| 100 % | `control.n = 0`, or `share ≥ 0.95` |

Not live after one extension → stop and set the last passed step: `flag change not visible in telemetry — check the provider's set command and the cohort attribute`.

## The 100 % step

No control cohort is left, so `decide.mjs` compares `test` with `baseline` when `control.n` is 0.
Always pass `baseline` in the stats at 100 %; without it the verdict is HOLD until the hold cap.

## Done

After 100 % passes, leave the flag on, end with `PASS`, and say what was not watched: `no soak window — this run ends at <time>`.
Every stop above that changed nothing ends with `STOPPED`; one that returned the flag ends with `INCONCLUSIVE`.
