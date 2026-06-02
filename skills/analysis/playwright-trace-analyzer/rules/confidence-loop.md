---
title: Confidence Loop — Iterate until the diagnosis holds
impact: HIGH
tags:
  - confidence
  - iteration
  - quality-gate
  - analysis
---

# Confidence Loop

After Phase 3 (root-cause mapping), invoke the `confidence` skill in
`analysis` mode. E2E flake diagnoses fail in predictable ways
(symptom mistaken for cause, race named at the wrong layer, fix
recommended without checking the network log) — the gate catches them.

## Invocation

```text
Skill(skill="confidence", args="analysis")
```

Provide the confidence skill with:

- The failure mode and primary metric from Phase 1.
- The hotspot list from Phase 2 with measured numbers.
- The race condition named in Phase 3, with its evidence chain.
- The proposed fix and estimated saving.

## Gate

`confidence` returns a score 0–100. Apply this table:

| Score        | Action                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------- |
| **≥ 90%**    | Proceed to Phase 5 — write the fix plan.                                                            |
| **70–89%**   | One deep-dive iteration. Re-read the trace, expand `before`/`after` snapshots, verify mappings.     |
| **< 70%**    | Surface the gap to the user — do **not** recommend a code change on speculation.                    |

## What a deep-dive iteration looks like

When confidence is 70–89%, do **one** of the following — pick the one
that most directly addresses the dimension the score lost points on:

1. **Re-read the call log.** `after.error.message` contains
   Playwright's full auto-wait narrative. The first read often misses
   a retry condition.
2. **Cross-check the network log.** The most common miss is a
   network-bound action diagnosed as a UI race.
3. **Check the DOM snapshot at the failure timestamp.** `resources/`
   contains pre/post snapshots. Open the snapshot at `before.startTime`
   to see the actual DOM the action saw.
4. **Diff against a passing trace.** If the user has both, run
   [`scripts/trace-diff.mjs`](../scripts/trace-diff.mjs) and re-anchor
   on the fork point.
5. **Verify the source mapping.** Open the file at the line range
   named and confirm the code does what the trace says.
6. **Check whether the fix actually closes the race.** A
   `toBeEnabled` wait only helps if the disabled state is what
   blocked the click. Confirm by reading the call log.

After the iteration, re-run `confidence(analysis)`. If still
70–89%, do **at most one more** deep-dive, then escalate.

## Stop conditions

Stop after at most **two** deep-dives, regardless of score. Continued
iteration past two is a sign the trace lacks information you need
(e.g. tracing was off for the relevant region, the failure happened
in a frame not captured, the dev server was down before recording
started).

When stopping below 90%, output:

```text
Confidence: <score>%. Below the 90% gate after 2 deep-dives.

What I'm confident about:
- <fact 1>
- <fact 2>

What I'm not confident about:
- <gap 1> — to close, need: <evidence: a passing trace / re-run with --trace=on / app source for X>
- <gap 2> — to close, need: <evidence>

Next step: <ask the user a specific question, OR request another trace, OR propose a probe>.
```

This honest stop is the desired behaviour. A confidently wrong fix
that papers over a flake is worse than a clearly framed unknown.

## Common mistakes

- **Treating one passing iteration as enough when the score is 80%.**
  The gate is 90%; iterate until it clears or stop.
- **Doing a deep-dive that changes the conclusion but not running
  `confidence` again.** Every iteration ends with a re-score.
- **Hiding low confidence behind hedging language.** State the score
  and the gap explicitly.
- **Iterating > 2 times because "the next pass might find it".** Cap
  at two; below 90% after two means escalate.
