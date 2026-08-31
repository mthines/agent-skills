---
name: eval-iterate
description: >
  Iterates on a failing AI/LLM eval (an L2 suite, a golden-set / judge
  eval, or any eval gating a PR) until it is green AND confirmed, not
  just luckily passing once. Classifies the failure as a code bug, an
  eval-definition bug (stale golden item / criteria drift), judge-drift
  (silent grader version change), or flaky. Applies the minimal fix, then
  requires N consecutive confirming re-runs — 2 deterministic, 5 for
  anything a model call grades, since a flat "2" is statistically weak
  for a stochastic judge. Hard-capped at 5 fix iterations. Refuses to
  game the eval (Goodhart's Law: skip/delete/overwrite-in-place a case,
  loosen a threshold) without a second independent check plus
  `confidence(analysis) >= 90%` and a logged rationale. Composes
  `ai-engineering`, `confidence`, `critical`, `verify-behavior`. Use when
  an eval is failing on a PR and needs a real, non-gamed green. Triggers
  on "this eval is failing", "iterate on this eval", "fix this eval",
  "get this eval green", "optimize this eval", "/eval-iterate".
disable-model-invocation: false
argument-hint: '[<eval-target>|<pr-url>] [--max-iterations <n>]'
license: MIT
metadata:
  author: mthines
  version: '1.1.0'
  workflow_type: command
  tags:
    - evals
    - ai-engineering
    - iteration-loop
    - confidence-gate
    - check-gaming
    - golden-set
    - llm-as-judge
    - judge-drift
    - confirmation
---

# Eval Iterate

Drive a failing AI/LLM eval to a real green: diagnose, fix, re-run,
confirm — capped at 5 iterations, never by weakening the eval.

This `SKILL.md` is the **orchestration index**.
Load the matching rule file when you need detail — do not preload them.

| Phase | Goal | Required rule |
| ----- | ---- | ------------- |
| 0 | Resolve the target eval + capture the baseline failure | this file |
| 1 | Resolve how to run it | this file |
| 2 | Classify the failure (verdict required) | [`rules/eval-bug-classification.md`](./rules/eval-bug-classification.md) |
| 3 | Apply the minimal fix — gated if it touches the eval itself | [`rules/anti-gaming-guard.md`](./rules/anti-gaming-guard.md) |
| 4 | Re-run, then confirm with a second run | [`rules/convergence-confirmation.md`](./rules/convergence-confirmation.md) |
| 5 | Iterate or stop at the cap | this file |
| 6 | Report (structured exit summary) | this file |

Always read [`rules/anti-gaming-guard.md`](./rules/anti-gaming-guard.md)
before touching any eval definition (assertion, threshold, golden-set
item, judge prompt). The refusals in it apply on every iteration.

## Input

The user provides one of:

- An eval identifier — an L2 suite name (e.g. `tier-routing`), a golden-set
  file path, or a test/eval file path.
- A PR URL with a failing eval check.
- **Nothing** — if `$ARGUMENTS` is empty, auto-detect the failing eval
  check on the current branch's open PR (see Phase 0).
- `--max-iterations <n>` — lowers the cap below 5. **Never raises it.** A
  value above 5 is clamped to 5, not honored.

The argument is: `$ARGUMENTS`.

## Phase 0 — Resolve the target + capture the baseline

If `$ARGUMENTS` is empty, do not ask the user — resolve automatically:

1. Get the current branch and its open PR:
   ```bash
   git rev-parse --abbrev-ref HEAD
   gh pr list --head "<branch>" --state open --json number,url --limit 1
   ```
2. List failing checks and find the one that is an eval (name contains
   `eval`, `l2`, or matches a known suite):
   ```bash
   gh pr checks <pr-number> --repo <owner/repo>
   ```
3. If exactly one failing eval check is found, use it as the target. If
   more than one, list them and ask the user which to iterate on first —
   this skill iterates on **one target at a time**. If none is found,
   report that and stop; there is nothing to iterate on.

Whatever the source, before doing anything else, **run the target once and
capture the raw failure** (exit code, stderr/stdout, the specific
assertion or suite that failed). Never start from a remembered or assumed
failure — the baseline is evidence, not a guess. This raw output is
`BASELINE_FAILURE` and is quoted in the Phase 6 report.

If the target's grading involves any model call (an LLM-as-judge
assertion, a model-scored golden-set item), also record `JUDGE_MODEL` —
the grader model name + version — at this same baseline moment. A silent
grader-version change between baseline and confirmation is a distinct
failure mode (`judge-drift`, Phase 2) that a code-only diff would miss
entirely.

Print the resolved target before continuing:
`Target: <eval identifier> on branch <branch> (cap: <n>/5)`.

## Phase 1 — Resolve how to run it

Discovery order (stop at the first that matches):

1. **This repo's own suites** — if the target names an L1 check or an L2
   suite key from `scripts/eval/l2.mjs`'s `SUITES`:
   ```bash
   node scripts/eval/l1.mjs                       # deterministic contract checks
   ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs --suite <name>   # behavioral suite
   ```
2. **Project eval script** — check `package.json` for an `eval`, `evals`,
   or `test:eval` script and run that.
3. **CI workflow step** — read the `.github/workflows/*.yml` step whose
   name matches the failing check and extract its exact run command.
4. **Ask** — if none of the above resolves a command, ask the user for the
   exact command that runs this eval. Do not guess a command and run it
   speculatively against a repo you do not understand.

Record the resolved command as `RUN_CMD`. Every re-run in this skill uses
the same `RUN_CMD` — changing the run command mid-loop invalidates the
comparison between iterations.

Also classify the target's **grading path** once, here — it decides the
Phase 4 confirmation bar: does any part of `RUN_CMD`'s pass/fail decision
involve a model call (an LLM-as-judge assertion, a model-scored
golden-set item), or is it purely deterministic (exit code, type/schema
check, string/regex assertion)? Record this as `GRADING_PATH` (`judge` or
`deterministic`). See
[`rules/convergence-confirmation.md`](./rules/convergence-confirmation.md).

## Phase 2 — Classify the failure (verdict required)

Pick exactly one verdict per iteration before writing anything.
Full decision table, signals, and per-verdict notes:
[`rules/eval-bug-classification.md`](./rules/eval-bug-classification.md).

Verdicts at a glance:

- `code-bug` — the code under test is wrong; the eval correctly caught it.
- `eval-bug` — the eval itself is wrong (stale golden item, miscalibrated
  judge, wrong assertion, threshold set without basis). Tag it with a
  subtype — `mis-specified` (the eval's existing logic is simply wrong)
  or `stale-criteria` (the eval never anticipated this case — legitimate
  criteria drift, not a mistake) — per
  [`rules/eval-bug-classification.md`](./rules/eval-bug-classification.md).
- `judge-drift` — `GRADING_PATH` is `judge`, and the grader model name +
  version now serving the re-run differs from the `JUDGE_MODEL` recorded
  at baseline. The fix is pinning the grader version, not editing the
  eval or the code — see
  [`rules/eval-bug-classification.md`](./rules/eval-bug-classification.md).
- `flaky` — re-run `RUN_CMD` once immediately, unchanged, with
  `JUDGE_MODEL` confirmed unchanged. If it now passes, note the flake and
  treat non-determinism itself as an `eval-bug` (an eval that isn't
  reproducible is broken) rather than spending a fix iteration guessing
  at a code change.
- `unsure` — the failure output does not clearly support any of the
  above. Do not guess. Use `Skill("ai-engineering", "review <target>")`
  scoped to the evals area for a second look; if still unsure after that,
  stop and escalate to the user with the raw evidence rather than burning
  iterations on speculative fixes.

## Phase 3 — Apply the minimal fix

- `code-bug` → fix the code under test. No eval file is touched. Normal
  code-change discipline applies (smallest change that fixes the root
  cause, consistent with the surrounding code).
- `judge-drift` → pin the grader model version in the eval's own config.
  No assertion, golden item, or code is touched.
- `eval-bug` → **read
  [`rules/anti-gaming-guard.md`](./rules/anti-gaming-guard.md) before
  editing anything.** Every edit to an assertion, threshold, golden-set
  item, or judge prompt requires (1) a second independent check — a
  fresh `Skill("critical", "analysis")` pass or explicit user
  confirmation, not just this run's own self-graded score, (2)
  `confidence(analysis) >= 90%`, and (3) a logged rationale — no
  exceptions, no matter how obviously "just a typo in the expected
  value" it looks.

Hard refusals (full list, including Goodhart's-Law framing, in
[`rules/anti-gaming-guard.md`](./rules/anti-gaming-guard.md)):

- Never skip, delete, `.skip`/`xfail`, or exclude a failing case to make
  the suite pass.
- Never loosen a threshold, gate percentage, or assertion without a
  logged, evidence-backed rationale and the gates above.
- Never overwrite an existing golden-set case in place — a legitimate
  correction adds a new/superseding case and keeps the original runnable
  as a regression guard.
- Never suppress or catch the eval framework's failure exit code.
- Never disable the CI step that runs this eval (`continue-on-error`,
  removing it from `paths:`, etc.).

## Phase 4 — Re-run, then confirm

`N` is the confirmation bar decided at Phase 1's `GRADING_PATH`
classification: **2** for `deterministic`, **5** for `judge`. Full
rationale and procedure in
[`rules/convergence-confirmation.md`](./rules/convergence-confirmation.md).

1. Run `RUN_CMD`. If it fails, this iteration did not succeed — go to
   Phase 5 (do not stop here and call it done).
2. If it passes, **do not declare victory on one pass.** Run `RUN_CMD`
   again, unchanged, for a total of `N` consecutive passes. Stop at the
   first failure inside that window — a single fail disproves
   `CONFIRMED` regardless of how many runs already passed; treat it as a
   failed iteration and continue, not a flake to explain away.
3. If `GRADING_PATH` is `judge`, all `N` passes is evidence the fix isn't
   a fluke — it is not proof the judge itself is well-calibrated
   (repeated sampling cancels random noise, not a systematically wrong
   judge). Do not overstate `CONFIRMED` as more than that.

## Phase 5 — Iterate or stop at the cap

- `CONFIRMED` → stop. Go to Phase 6 with outcome `confirmed-green`.
- Not confirmed, and iterations used < cap (default 5, never raised past
  5 by `--max-iterations`) → increment the iteration counter, return to
  Phase 2 with the latest failure output as new evidence. Do not repeat
  the same fix that already failed to confirm — the new evidence must
  change the classification or the fix, or the loop is not converging and
  should stop early rather than spend the remaining budget on repetition.
- Not confirmed, and iterations used == cap → stop. Go to Phase 6 with
  outcome `max-iterations`. **Do not continue past the cap under any
  circumstance**, including a user re-request mid-loop — a fresh
  invocation with an explicit reset is a new run, not an extension of this
  one.

## Phase 6 — Report

Always end with a structured summary, regardless of outcome:

```text
eval-iterate run
  Outcome: <confirmed-green | escalated | max-iterations>
  Target: <eval identifier> (<RUN_CMD>)
  Grading path: <deterministic | judge>  JUDGE_MODEL: <name+version, if judge>
  Baseline failure: <one-line cause, quoting BASELINE_FAILURE>
  Iterations: <N>/<cap>
  Per-iteration verdicts: <code-bug | eval-bug(subtype) | judge-drift | flaky | unsure>, ...
  Eval-definition edits: <none | one entry per edit — see rules/anti-gaming-guard.md's log format>
  Confirmation: <N-of-N consecutive green runs of RUN_CMD, N per grading path | not reached>
```

On `confirmed-green`, include the fix applied per iteration and the final
confirming run outputs (or a pointer to them).

On `max-iterations` or `escalated`, include what was tried per iteration,
the current best hypothesis, and what a human should look at next. Never
present a still-failing or unconfirmed eval as passing.

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files |
| ----- | ----- |
| 2 | [`rules/eval-bug-classification.md`](./rules/eval-bug-classification.md) |
| 3 | [`rules/anti-gaming-guard.md`](./rules/anti-gaming-guard.md) |
| 4 | [`rules/convergence-confirmation.md`](./rules/convergence-confirmation.md) |

## Composition, not reimplementation

This skill is a thin loop around three existing skills — it never
reimplements their logic:

- **`ai-engineering`** (evals concern, `rules/evals.md`) owns the eval
  methodology this skill's classification draws on: error-analysis-first,
  golden-set sizing, LLM-as-judge bias mitigations, narrow rubrics.
  Dispatch it with `Skill("ai-engineering", "review <target>")` when
  Phase 2's classification needs a second opinion.
- **`confidence`** (`analysis` mode) owns the score gating any
  eval-definition edit. This skill never invents its own scoring rubric —
  it calls `Skill("confidence", "analysis")` and reads the `Final` score.
- **`critical`** (`analysis` mode) supplies the second, independent check
  an eval-definition edit needs beyond the fixing agent's own confidence
  score — dispatch it fresh, without the proposed edit already in its
  context, to challenge the rationale adversarially.
- **`verify-behavior`** (`change` mode) owns the execute-and-receipt
  mechanic for the re-run in Phase 4. This skill supplies the
  `expected: "RUN_CMD exits 0"` framing; `verify-behavior` supplies the
  isolated execution and the receipt.

If a companion skill is not installed in the current environment, fall
back to running the equivalent step in-context (e.g. score the
eval-definition edit yourself using `confidence`'s `analysis` dimensions
table) rather than skipping the gate.

## Core Principles

1. **Confirmed, not merely green.** A single pass proves nothing about a
   flaky suite or a lucky sample. The bar scales with how the eval grades:
   2 consecutive passes for a deterministic check, 5 for anything a model
   call scores — binomial statistics make a flat "2" indefensible for a
   stochastic judge. See
   [`rules/convergence-confirmation.md`](./rules/convergence-confirmation.md).
2. **Classify before you touch anything.** A code-bug and an eval-bug look
   identical from the failure output alone until you read the eval's own
   logic — guessing wrong wastes an iteration and, worse, can mask a real
   regression as an eval problem. A silent judge-version bump is a third,
   easy-to-miss possibility — check `JUDGE_MODEL` before blaming the code
   or the eval.
3. **The eval is not free to edit, and self-review doesn't count.** Treat
   it like `checks.yaml`'s executor-immutable spirit: any loosening edit
   needs a second independent check, a confidence gate, and a written
   rationale — never a silent fix-to-pass, and never a single agent
   grading its own proposed edit. This is Goodhart's Law in four shapes
   (regressive, extremal, causal, adversarial) — see
   [`rules/anti-gaming-guard.md`](./rules/anti-gaming-guard.md).
4. **The cap is hard.** 5 iterations, never more, regardless of how close
   the last run looked — a pragmatic ceiling, not a number derived from
   eval-specific research. A loop that isn't converging by iteration 5
   needs a human, not iteration 6.
5. **Evidence over assumption.** Every classification and every re-run is
   grounded in an actual command's actual output — never "it should pass
   now."
6. **A corrected case is a new case, not an edit.** The failing golden
   item is itself the strongest evidence a real failure mode exists;
   overwriting it in place destroys the regression guard it represents.

## Anti-patterns (one-liners — full list in the rules)

- Declaring victory on a single green run — or on N green runs of a
  deterministic check while treating a judge-graded check the same way.
- Deleting, skipping, or overwriting-in-place the failing case instead of
  fixing why it fails or superseding it with a new, versioned case.
- Loosening a threshold or assertion without a confidence-gated rationale
  and a second independent check.
- Guessing the classification instead of reading the eval's own failure
  output and logic — including checking `JUDGE_MODEL` before assuming a
  code or eval regression.
- Continuing past 5 iterations because "just one more try."
- Reusing a different `RUN_CMD` between iterations, making runs
  incomparable.

## Definition of Done

- [ ] Baseline failure (and `JUDGE_MODEL`, if judge-graded) captured from
      an actual run, not assumed.
- [ ] `RUN_CMD` and `GRADING_PATH` resolved once and held constant across
      iterations.
- [ ] Every iteration has an explicit verdict (Phase 2), including
      `judge-drift` and an `eval-bug` subtype where applicable.
- [ ] Any eval-definition edit passed a second independent check plus the
      `confidence(analysis) >= 90%` gate, is logged with its rationale,
      and left the original case retained rather than overwritten.
- [ ] The eval passed **N consecutive times** (2 deterministic / 5 judge)
      before being reported `confirmed-green`.
- [ ] The iteration cap (≤ 5, never raised) was respected.
- [ ] The structured report (Phase 6) was printed, regardless of outcome.
