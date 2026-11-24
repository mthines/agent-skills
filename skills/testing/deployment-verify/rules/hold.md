---
title: Hold — a passing rollout waits at a committed step for a human approve or override
impact: HIGH
tags: [deployment-verify, hold, approval, human-in-the-loop, rollout]
---

# Hold

`release.yml` → `hold_after: <percent>` stops a passing rollout at that step until a human decides.
Absent, the rollout never holds: every existing config behaves as before.
A **hold** is a human gate; a `HOLD` verdict from `decide.mjs` is thin traffic and extends the same step ([`loop.md`](./loop.md#each-step)).
Never confuse the two.
**Why:** [`../references/design.md § A human hold`](../references/design.md#a-human-hold-and-an-earned-recommendation).

## Enter

[`scripts/tick.mjs`](../scripts/tick.mjs) enters the hold when all of these are true:

1. The contract has a `flag` (a no-flag change has one step, so nothing to hold before).
2. The step whose value equals `hold_after` got a `PASS` verdict.
3. It is not the last step; `hold_after` must be one of `steps` except the last, else the config fails to load with `release.yml hold_after: <n> must be one of steps [...]`.
   A new rollout whose contract `steps`, or whose `rollout: boolean` provider, leaves no such step stops before step 1: `hold_after: <n> is not a step before the last in this rollout's steps [...]`, never an unheld rollout.
   A rollout still in `deploy` or `baseline` counts as new (its flag has never been on); one already at a step is never stopped by a later `hold_after`.

On entering it:

| Does | Where |
| --- | --- |
| Leaves the flag at the held step | the provider; no `set` |
| Records `hold: { at, since, recommendation, reason, risk_class, degraded, decision: null }` and `phase: hold` | the state line ([`state.md`](./state.md)) |
| Prints `hold:` and `recommend:` lines | the report comment |
| Runs `on_exception` once with outcome `AWAITING_APPROVAL`, adds it to `notified`, exits `3` | [`notify.md`](./notify.md) |

`recommend:` comes from [`autonomy.md`](./autonomy.md); it is advisory and never advances the hold.

## Wait

Nothing is due at a hold: a tick with no decision returns the state untouched, writes no comment, and takes no lease.
There is no hold timeout: the flag stays at the held step until a human decides.

```text
✗ Wrong — an unattended tick sees recommendation AUTO at the hold and advances to 50 %
✓ Right — an unattended tick at a hold changes nothing; only approve or override moves it
```

## Decide

Only a human decides, in an attended session:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/tick.mjs --pr <n> --approve    # continue from the next step
node ${CLAUDE_SKILL_DIR}/scripts/tick.mjs --pr <n> --override   # flag → off, outcome OVERRIDDEN
```

| Decision | Effect | Signal event ([`autonomy.md`](./autonomy.md)) |
| --- | --- | --- |
| `--approve` | Record `decision: { action, at, by, seconds }` (`seconds` = time since `since`), set the next step in the same tick, continue | `approve` with `seconds` |
| `--override` | Record the decision, set the flag off, end `OVERRIDDEN` | `override` |

Refuse a decision when:

| Condition | Error |
| --- | --- |
| `--unattended`, or a prepared Agent0 sandbox | `a hold decision is a human's: refused in an unattended run` |
| `--all` | `a hold decision names one rollout: --pr <n> or --local, never --all` |
| The rollout is not at a hold | `not at a hold (phase <phase>) — nothing to approve` |

```text
✗ Wrong — an automation runs `tick.mjs --all --approve` to clear the holds overnight
✓ Right — the automation only ticks; a person runs `tick.mjs --pr 214 --approve` after reading the report
```
