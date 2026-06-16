---
name: test-autofix
description: >
  Diagnoses failing tests across any project, classifies each failure as a
  test-bug, prod-bug, or unsure, confidence-gates the fix (auto-apply at
  >=90%, 80-89 ask, <80 escalate), applies it, and re-runs until green.
  Surface-driven: reads per-project configuration from a surface file keyed
  by normalised git remote URL. Bootstrap auto-detects the stack on first
  run and proposes a surface diff for user approval. Hard-refuses to delete
  tests, add .skip/.only, or weaken assertions. Regression-detects after
  every fix: reverts on new failure instead of stacking. Triggers on "fix
  my failing tests", "tests are red", "auto-fix tests", "heal the tests",
  "/test-autofix".
disable-model-invocation: false
argument-hint: '[<surface>|<file-path>] [--plan-only] [--max-iterations <n>]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - tests
    - auto-fix
    - confidence-gate
    - regression-detection
    - guardrails
    - stack-agnostic
    - surface-driven
    - bootstrap
---

# test-autofix

Autonomously diagnose and fix failing tests in any project, with hard
guardrails so the loop never devolves into "make the red go away".

This `SKILL.md` is the **orchestration index**.
Load the matching rule file when you need detail — do not preload them.

| Phase | Goal | Required rule |
| ----- | ---- | ------------- |
| 0 | Resolve the surface (bootstrap or validate) | [`rules/bootstrap.md`](./rules/bootstrap.md) + [`rules/surface-validation.md`](./rules/surface-validation.md) |
| 1 | Detect which test surface(s) are failing; build fix plan | this file + [`templates/plan-artifact.md`](./templates/plan-artifact.md) |
| 2 | Per failure: classify as test-bug / prod-bug / unsure | [`rules/verdicts.md`](./rules/verdicts.md) |
| 3 | Per failure: draft the smallest possible fix | this file |
| 3.5 | Confidence gate — before any edit | [`rules/confidence-gate.md`](./rules/confidence-gate.md) |
| 4 | Apply + verify single failing test | this file + [`rules/anti-patterns.md`](./rules/anti-patterns.md) |
| 5 | test-provenance-guard (optional companion) | invoke `Skill("test-provenance-guard")` |
| 6 | Outer loop: re-run full surface; regression-detect | [`rules/regression-detection.md`](./rules/regression-detection.md) |
| 7 | Report (structured exit summary) | [`templates/exit-summary.md`](./templates/exit-summary.md) |

Always read [`rules/anti-patterns.md`](./rules/anti-patterns.md) first.
The hard refusals apply to every phase.

## Input

The user provides one of:

- Nothing — auto-run every surface defined in the project surface file.
- A surface name (`vitest`, `unit`, `integration`, etc.) — run only that surface.
- A file path — narrow detection and re-run to that file.
- `--surface <path>` — override the surface file lookup entirely.
- `--plan-only` — diagnose and produce the plan artifact; do not write code.
- `--max-iterations N` — outer-loop cap (default 5).

The argument is: `$ARGUMENTS`.

## Phase 0 — Resolve the surface

Determine the surface file for the current project. Phase 0 is a hard
two-branch decision; pick exactly one path and follow it through.

### Step 1 — Pick the resolution branch

- **If `--surface <path>` was passed** → branch A.
- **Otherwise** → branch B.

### Branch A — `--surface <path>` override

Use the file at `<path>` directly as the surface. **Do NOT compute the project
key, do NOT scan `surfaces/`, do NOT run bootstrap.**

Still validate per [`rules/surface-validation.md`](./rules/surface-validation.md),
but tolerate the project-key mismatch warning (it's expected when overriding).

When validation passes, jump straight to Phase 1.

### Branch B — Auto-resolve from project key

1. Compute the project key per [`rules/project-keying.md`](./rules/project-keying.md).

2. Look for `surfaces/<project-key>.md` next to this skill file.
   The skill's own directory is resolved by following the symlink chain of
   the loaded `SKILL.md`:
   ```bash
   readlink -f "$(dirname "$0")"
   ```
   If that fails (model-invocation context), default to
   `~/.agents/skills/test-autofix/surfaces/`.

3. **If no surface file is found** → run bootstrap per
   [`rules/bootstrap.md`](./rules/bootstrap.md). Bootstrap detects the stack,
   proposes a surface diff, waits for user approval, then writes the file.
   Do NOT proceed to Phase 1 until the surface exists.

4. **If a surface file exists** → validate it per
   [`rules/surface-validation.md`](./rules/surface-validation.md). If validation
   fails, propose an update diff and ask once. If the user declines the update,
   escalate — do not run with an invalid surface.

## Phase 1 — Detect failures and build the plan

1. Run the detect command from the surface file:
   ```bash
   <detect-command>
   ```
   If `--path <file>` was supplied, append it to narrow the run.
   If the cache-bust-flag is set in the surface and a prior run was cached-green,
   append the flag to force a real run.

2. Parse failures using the `failure-parser` regex from the surface file.
   Group by file, then by failure type.

3. If every surface is green: stop immediately. Tell the user. Do not invent work.

4. Write the fix plan to `.agent/{branch}/test-autofix-plan.md` using
   [`templates/plan-artifact.md`](./templates/plan-artifact.md).
   The plan is read-only documentation of intent.
   Order: high-confidence test-bug fixes first, prod-bug suspects last.

## Phase 2 — Classify each failure (verdict required)

For every failure, apply the rubric in [`rules/verdicts.md`](./rules/verdicts.md).

Getting this wrong means later phases can corrupt production code to satisfy
a broken test, or "fix" a real regression by patching the test.

Emit exactly one verdict per failure:

- `test-bug` — production code correct; test drifted. Continue to Phase 3.
- `prod-bug` — production code regressed; test caught it. **Escalate.** Do not touch the test.
- `unsure` — confidence < 80%. **Escalate.** Surface the evidence and stop.

## Phase 3 — Draft the minimal fix

For each `test-bug` failure, draft the smallest edit that addresses the
diagnosed root cause.

Hard refusals — full list and detection patterns in [`rules/anti-patterns.md`](./rules/anti-patterns.md):

- Deleting any test, `describe`, `it`, or story export.
- Adding `.skip`, `.only`, `xit`, `xdescribe`, `fit`, `fdescribe`, `it.todo`, `test.todo`.
- Replacing strict matchers with loose ones.
- Deleting `expect(...)` / `assert*()` calls.
- Mocking the System Under Test (the module being tested) instead of its deps.
- Wrapping the failing assertion in `try`/`catch` to swallow it.

## Phase 3.5 — Confidence gate (before any edit)

Invoke the `confidence` skill in analysis mode for each proposed fix:

```text
Skill("confidence", "analysis proposed fix: <one-line summary>; verdict: <test-bug>; surface: <surface-name>; risk: <test-only|prod-touch>")
```

Record the score in the plan artifact.

Full decision matrix: [`rules/confidence-gate.md`](./rules/confidence-gate.md).

At a glance:

| Score | Action |
| ----- | ------ |
| ≥ 90 | Auto-apply. Continue to Phase 4. |
| 80–89 | Show the diff, ask once, apply on approval. |
| < 80 | Escalate. Do not write. |

The gate is non-negotiable. Auto mode does not override it.

## Phase 4 — Apply + verify (per fix)

1. Apply the edit with `Edit` — never `Bash sed/awk`.

2. Re-run only the single failing test using the `single-test-command` from
   the surface file, substituting `{file}` and `{name}`:
   ```bash
   <single-test-command>
   ```

3. If still failing: do not patch over. Revert with:
   ```bash
   git restore <file>
   ```
   Re-classify at Phase 2.

4. If green, and `test-provenance-guard` is installed: invoke
   `Skill("test-provenance-guard")` on the file. If it reports
   tests-by-construction, revert and escalate.

5. Only after both checks pass, mark the failure resolved in the plan.

## Phase 5 — test-provenance-guard (optional)

If `Skill("test-provenance-guard")` is not installed, log:
`companion: test-provenance-guard — not available, continuing`

## Phase 6 — Outer loop

After a batch of fixes:

1. Re-run the full surface using the detect command:
   ```bash
   <detect-command>
   ```
   Regressions hide in untouched files — always re-run the full surface.

2. Compare against the previous failure set per
   [`rules/regression-detection.md`](./rules/regression-detection.md):
   - Same failures → back to Phase 2 (re-classify; do not repeat same fix).
   - Strict subset → continue with remaining failures.
   - New failure → revert last fix, re-plan or escalate.

3. Cap at `--max-iterations` (default 5).

4. On any exit, write a summary section to the plan file.

## Phase 7 — Report

Always end with the structured exit summary from
[`templates/exit-summary.md`](./templates/exit-summary.md).

```text
test-autofix run
  Outcome: <green | escalated | regression-reverted | max-iterations>
  Resolved: <N> failures
  Escalated: <N> failures (<verdicts>)
  Iterations: <N>/<max>
  Surface: <surface-file-path>
  Plan: .agent/{branch}/test-autofix-plan.md
  Escalation reason: <…>           # if not green
```

## Definition of done

The run is done when ANY of the following is true:

- All surface tests are green AND the structured exit summary has been printed.
- All remaining failures are `prod-bug` or `unsure` (escalated; user owns next step).
- The confidence gate scored < 80 and the fix was not written.
- A regression was detected, reverted, and the user owns the next step.
- `--max-iterations` (default 5) was reached.
