# Anti-Gaming Guard

An eval that can be made to pass by editing the eval is not an eval — it's
theater. This guard applies whenever Phase 2 classifies a failure as
`eval-bug` and Phase 3 needs to touch the eval's own definition
(assertion, threshold, golden-set item, judge prompt, gate percentage).

This mirrors the `checks.yaml` "executor-immutable, check-gaming
forbidden" pattern used elsewhere in this repo (see
`autonomous-workflow`'s Phase 4 checks loop), adapted for evals: evals are
not literally immutable in the same absolute sense — `ai-engineering`'s
own methodology (`rules/evals.md` §5) says stale golden items *should* be
corrected — but every loosening edit is gated, logged, and never silent.

## Hard refusals — never do these to make an eval pass

1. **Never skip, delete, or exclude a failing case.** No `.skip`,
   `xfail`, `it.only` elsewhere, commenting out a golden-set item, or
   removing a suite from a `--suite` allowlist to dodge a failure.
2. **Never loosen a threshold or gate percentage without the gate below.**
   `EVAL_GATE`, a pass-rate floor, a judge-agreement threshold — none of
   these move without a documented, evidence-backed rationale and a
   passing confidence check.
3. **Never change an `expected` value to match the current output without
   independently verifying the new value is actually correct.** Matching
   the eval to whatever the code currently does is not a fix — it deletes
   the eval's ability to catch this exact regression next time. Hand-
   inspect the trace first (`ai-engineering/rules/evals.md` §5 step 4).
4. **Never swap the judge model to one more likely to agree with the
   actor** without re-validating sample agreement against human labels
   (`ai-engineering/rules/evals.md` §3, mitigation 4). Judge-shopping to
   get a pass is the same failure mode as p-hacking.
5. **Never suppress or catch the eval framework's own failure exit code**
   (a bare `try { runEval() } catch {}`, a `|| true` on the run command,
   an `exit(0)` inserted anywhere in the eval's own control flow).
6. **Never disable the CI step that gates this eval** — no
   `continue-on-error: true`, no removing it from the required-checks
   list, no narrowing its `paths:` trigger to stop it from running on the
   PR that's failing it.

Any of the above, discovered at Phase 6 report time or later, is reported
as a violation even if it produced a green run — a green run obtained this
way is never `confirmed-green`.

## What is allowed, and how it is gated

An `eval-bug` verdict permits fixing the eval, subject to both of these:

1. **`confidence(analysis) >= 90%`.** Dispatch
   `Skill("confidence", "analysis")` scored against this eval-specific
   framing of its three dimensions:

   | Dimension | What to evaluate for an eval-definition edit |
   | --------- | ---------------------------------------------- |
   | Evidence strength | Is there concrete evidence the current assertion/golden item/threshold is wrong — a documented behavior change in this PR, a hand-inspected trace showing the "expected" value was never correct, a human-labelled sample disagreeing with the judge? |
   | Root cause certainty | Is the eval definition the actual problem, or is this rationalizing around a real regression in the code under test? |
   | Outcome confidence | Will this edit still catch the failure mode it was originally written for, or does it silently narrow what the eval can detect? |

   A score below 90% blocks the edit — return to Phase 2 and re-examine
   whether the verdict should actually be `code-bug`, or escalate to the
   user with the low-confidence rationale rather than applying it anyway.

2. **A logged rationale**, one entry per edit, carried into the Phase 6
   report:

   ```text
   eval-definition edit
     File: <path>
     What changed: <old value/assertion -> new value/assertion, one line>
     Why: <the specific evidence from the confidence(analysis) run>
     confidence(analysis): <score>%
   ```

   Treat the golden set as code (`ai-engineering/rules/evals.md` §5):
   this log entry is the PR-review-visible equivalent of a commit message
   explaining a production golden-set change, not optional bookkeeping.

## The gate is per-edit, not per-iteration

If one iteration touches two golden-set items, both need their own
confidence run and their own log entry — a single high score on one edit
does not cover a second, unrelated edit bundled into the same fix.
