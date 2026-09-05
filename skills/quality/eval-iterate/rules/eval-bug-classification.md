# Eval-Bug Classification

## Contents

- [Decision table](#decision-table)
- [Judge-drift is not a code-bug or an eval-bug](#judge-drift-is-not-a-code-bug-or-an-eval-bug)
- [How to decide, not guess](#how-to-decide-not-guess)
- [Criteria drift — when "the eval was incomplete" isn't gaming](#criteria-drift--when-the-eval-was-incomplete-isnt-gaming)
- [Flaky is not free](#flaky-is-not-free)
- [Examples](#examples)

Every iteration picks exactly one verdict before any fix is written.
This is the same discipline `ci-auto-fix` applies to CI failures
(`rules/verdicts.md`), specialized for AI/LLM evals: a failing eval can
mean the code under test regressed, or that the eval itself is wrong.
Guessing which one — instead of reading the evidence — is the single
biggest way this loop wastes iterations.

## Decision table

| Signal in the failure output | Verdict |
| ----------------------------- | ------- |
| The eval's expected value / golden item is demonstrably correct (matches documented behavior, a prior passing snapshot, or product intent) and the actual output changed | `code-bug` |
| The assertion checks something the code was never supposed to guarantee (over-strict schema check, exact-string match on a field that's allowed to vary) | `eval-bug` (subtype `mis-specified`) |
| The golden-set item's `expected` field predates a deliberate, already-shipped behavior change and was never updated | `eval-bug` (subtype `mis-specified`) |
| The failure surfaces a real gap the eval never covered — a case the criteria didn't anticipate, not a case the criteria got wrong | `eval-bug` (subtype `stale-criteria` — see "Criteria drift" below) |
| A numeric threshold/gate (e.g. `EVAL_GATE`) was set without a documented basis and a single borderline case trips it | `eval-bug` (subtype `mis-specified`) — lowering the gate still needs the confidence gate in `rules/anti-gaming-guard.md` |
| The check is LLM-judge-graded, and the judge/grader model name+version recorded at baseline (`JUDGE_MODEL`) differs from the version now serving the re-run | `judge-drift` |
| Re-running the identical command with no code change flips the result, and `JUDGE_MODEL` is unchanged | `flaky` |
| The failure output doesn't clearly support any row above | `unsure` |

## Judge-drift is not a code-bug or an eval-bug

A silent judge/grader model-version bump can flip a passing eval to failing
(and vice versa) with zero change to the code under test or the eval
definition — a documented Cohen's d=4.37 score shift from a single GPT-4o
version bump has been measured in practice. Record `JUDGE_MODEL` (grader
model name + version string) alongside `BASELINE_FAILURE` in Phase 0, and
record it again before scoring each confirmation run in Phase 4. If the
two differ:

1. Classify as `judge-drift`, not `code-bug`/`eval-bug`/`flaky`.
2. The fix is to **pin the grader model version** in the eval's own config
   (most frameworks — promptfoo, Braintrust — support this) so the next
   run is reproducible, not to edit the assertion or golden item.
3. If the drift itself revealed a real quality change worth accepting,
   that is a deliberate re-baseline decision, not a same-iteration fix —
   escalate to the user rather than silently re-scoring against the new
   judge inside this loop.

## How to decide, not guess

1. **Read the eval's own source**, not just its failure message. For an
   L2-style suite, read the golden case (`{"id","input","expected","notes"}`)
   and the rubric section it reads live from the target skill. For a
   golden-set eval, read the item's `notes` field — a well-maintained
   golden set documents *why* each expected value is what it is
   (`ai-engineering/rules/evals.md` §2).
2. **Reproduce by hand** where cheap: if the eval is an LLM-as-judge call,
   read the actual model output being judged. Is it actually wrong, or is
   the judge's rubric miscalibrated?
3. **Check version history** on the failing assertion/golden item — a
   `git log -p` or `git blame` on the specific line often shows whether it
   was added for a real observed failure (`ai-engineering/rules/evals.md`
   §1: "write evaluators for failures you've observed, not failures you
   fear") or was speculative.
4. **When still unsure**, dispatch `Skill("ai-engineering", "review
   <target>")` scoped to the evals area for a second read before choosing
   `unsure` and escalating. Do not default to `code-bug` just because it
   is the verdict that avoids touching the eval — that bias produces
   fixes that don't address the actual regression.

## Criteria drift — when "the eval was incomplete" isn't gaming

Not every `eval-bug` is a mistake. Shankar et al. ("Who Validates the
Validators?", UIST '24) document "criteria drift": it is often impossible
to fully specify an eval's criteria before seeing real outputs — a new
failure mode discovered mid-review, or an existing criterion that needed
reinterpreting, is expected evolution, not a badly-written eval. Tag an
`eval-bug` edit `stale-criteria` (rather than `mis-specified`) when the
evidence shows the eval never anticipated this case, as opposed to
`mis-specified` when the eval's existing logic is simply wrong. Both
subtypes still go through the full gate in `rules/anti-gaming-guard.md` —
the subtype changes the rationale you log, not whether the gate applies.

## Flaky is not free

A `flaky` verdict on its first appearance in a run does not consume a
fix iteration — re-running once to confirm the flake is cheap and
mandatory before touching anything. But flaky is never the terminal
verdict:

- If the eval is nondeterministic by design (an LLM-as-judge call with no
  temperature pinning, no majority-vote, no seed), that non-determinism
  **is** an eval-bug — an eval nobody can trust to fail loudly is worse
  than no eval — and Phase 3's fix should address the determinism
  (temperature, sampling, or a tolerance band), gated the same as any
  other `eval-bug` edit.
- A `flaky` verdict that recurs across iterations (2+ times) on the same
  target without a code change in between means the eval's flakiness is
  the actual bug — reclassify as `eval-bug` on the next occurrence rather
  than re-running indefinitely.

## Examples

**`code-bug`**: golden case `triage-014` expects `intent: refund`; the
prompt change in this PR made the model return `intent: support` for the
same input; the `notes` field on `triage-014` documents this was a real
production failure mode being guarded against. → fix the prompt, not the
golden case.

**`eval-bug`**: the `tier-routing` suite's golden case for a 6-file
change expects `Lite`, but the tier table in `autonomous-workflow`'s
`SKILL.md` Step 1 (the live rubric this suite reads — the `aw` dispatcher
links it rather than holding a copy) was intentionally changed in this PR to route
6-file changes to `Full` — a deliberate, documented decision in the same
PR. → the golden case is stale, not the code. Update it with a `notes`
line explaining the routing-table change it now reflects, gated per
`rules/anti-gaming-guard.md`.

**`unsure`**: an LLM-as-judge eval fails with "expected: pass, got: fail"
and no further detail, on a rubric that was not touched by this PR and a
prompt that was also not touched by this PR. → dispatch `ai-engineering`
before guessing; the failure may be judge drift, not either failure mode
above.
