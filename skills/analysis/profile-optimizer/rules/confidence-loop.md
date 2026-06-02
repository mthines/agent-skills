---
title: Confidence Loop — Iterate Until the Diagnosis Holds
impact: HIGH
tags:
  - confidence
  - iteration
  - quality-gate
  - analysis
---

# Confidence Loop

After Phase 3 (root-cause mapping), invoke the `confidence` skill in
`analysis` mode. Performance diagnoses fail in predictable ways
(symptom mistaken for cause, fiber resolved to the wrong file, fix
recommended without checking the call stack) — the gate catches them.

## Invocation

```text
Skill(skill="confidence", args="analysis")
```

Provide the confidence skill with:

- The hotspot list from Phase 2 with measured numbers.
- The root-cause mapping from Phase 3 with file paths.
- The proposed first-line fix.
- The estimated ms saved and how it was estimated.

## Gate

`confidence` returns a score 0–100. Apply this table:

| Score        | Action                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------- |
| **≥ 90%**    | Proceed to Phase 5 — write the optimisation report.                                                  |
| **70–89%**   | One deep-dive iteration. Re-read the profile, expand call stacks, verify file mappings.              |
| **< 70%**    | Surface the gap to the user — do **not** recommend a code change on speculation.                     |

## What a deep-dive iteration looks like

When confidence is 70–89%, do **one** of the following — pick the one that
most directly addresses the dimension the score lost points on:

1. **Expand the call stack.** Re-read the trace and walk children of the
   hot event. The cause is usually one or two frames deeper than the first
   guess.
2. **Verify the source mapping.** Open the file at the line range you
   named and confirm the code actually does what the profile says it does.
3. **Cross-correlate React + Chrome.** If both files are available, find
   the React commit window inside the slowest Chrome task and compare.
4. **Re-read `changeDescriptions` / `args.data`.** The export already
   contains the answer; the first read may have missed it.
5. **Check whether the fix would actually save the measured cost.** A
   `React.memo` only helps if the props are reference-equal after the
   fix. A worker only helps if the work is parallelisable.

After the iteration, re-run `confidence(analysis)`. If still 70–89%,
do **at most one more** deep-dive, then escalate.

## Stop conditions

Stop after at most **two** deep-dives, regardless of score. Continued
iteration past two is a sign the analysis lacks information the profile
cannot supply (e.g. the source isn't visible, or a different recording is
needed).

When stopping below 90%, output:

```text
Confidence: <score>%. Below the 90% gate after 2 deep-dives.

What I'm confident about:
- <fact 1>
- <fact 2>

What I'm not confident about:
- <gap 1> — to close, need: <evidence>
- <gap 2> — to close, need: <evidence>

Next step: <ask the user a specific question, OR request an additional profile, OR propose a probe>.
```

This honest stop is the desired behaviour. A confidently wrong fix is
worse than a clearly framed unknown.

## Common mistakes

- Treating one passing iteration as enough when the score is 80%. **Fix:**
  the gate is 90%; iterate until it clears or stop.
- Doing a deep-dive that changes the conclusion but not running
  `confidence` again. **Fix:** every iteration ends with a re-score.
- Hiding low confidence behind hedging language ("probably", "should").
  **Fix:** state the score and the gap explicitly.
- Iterating > 2 times because "the next pass might find it". **Fix:**
  cap at two; below 90% after two means escalate.
