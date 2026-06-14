---
name: ci-auto-fix
description: >
  Diagnoses a failed CI check, classifies it with an explicit verdict
  (code-bug | workflow-bug | dep-bug | env-bug | flaky | unsure),
  confidence-gates the fix (>=90 auto, 80-89 ask, <80 escalate),
  applies it, pushes, and iteratively verifies until CI passes — reverting
  the last commit if a brand-new failure appears. Provider-agnostic in
  scope; currently implements the GitHub Actions path via `gh`. Hard-
  refuses to disable, skip, or weaken checks. Triggers on "CI is failing",
  "fix the CI", "the build is red", "auto-fix this PR's checks",
  "GitHub Actions failed", "/ci-auto-fix".
disable-model-invocation: false
license: MIT
metadata:
  author: mthines
  version: '3.0.0'
  workflow_type: command
  tags:
    - ci
    - github-actions
    - auto-fix
    - confidence-gate
    - regression-detection
    - guardrails
    - gh
---

# CI Auto-Fix

Diagnose and fix a failed CI check, then verify it passes.
Generic across repositories; currently implements the GitHub Actions path via `gh`.

This `SKILL.md` is the **orchestration index**.
Load the matching rule file when you need detail — do not preload them.

| Phase | Goal | Required rule |
| ----- | ---- | ------------- |
| 0 | Resolve the target (run ID / PR URL / auto-detect) | this file |
| 1 | Identify the failure (fetch logs) | this file |
| 2 | Read every workflow file before editing one | this file |
| 3 | Classify the failure with an explicit verdict | [`rules/verdicts.md`](./rules/verdicts.md) |
| 3.5 | Write the plan artifact + run the confidence gate | [`rules/confidence-gate.md`](./rules/confidence-gate.md) + [`templates/plan-artifact.md`](./templates/plan-artifact.md) |
| 4 | Apply the minimal, targeted fix | this file + [`rules/anti-patterns.md`](./rules/anti-patterns.md) |
| 5 | Verify locally before pushing | this file |
| 6 | Commit and push (rebase-safe) | this file |
| 7 | Wait for CI and capture the new result | this file |
| 8 | Iterate — with regression detection | [`rules/regression-detection.md`](./rules/regression-detection.md) |
| 9 | Report (structured exit summary) | this file |

Always read [`rules/anti-patterns.md`](./rules/anti-patterns.md) first.
The refusals apply to every phase.

## Input

The user provides one of:

- A GitHub Actions check/run URL (e.g. `https://github.com/owner/repo/actions/runs/12345678`)
- A check run ID or workflow run ID
- A PR URL with failing checks (e.g. `https://github.com/owner/repo/pull/42`)
- **Nothing** — if `$ARGUMENTS` is empty, auto-detect the failing CI for the current branch's PR (see Phase 0).

The argument is: `$ARGUMENTS`.

## Phase 0 — Resolve the target

If `$ARGUMENTS` is empty, do not ask the user — resolve automatically:

1. Get the current branch:
   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

2. Find the open PR for this branch:
   ```bash
   gh pr list --head "<branch>" --state open --json number,url,headRepositoryOwner --limit 1
   ```
   - If exactly one PR is found, use its URL as the PR input and continue to Phase 1.
   - If `headRepositoryOwner.login` differs from the current repo's owner (fork PR), surface that fact to the user before continuing.
   - If no open PR is found, fall back to the most recent failed workflow run on this branch:
     ```bash
     gh run list --branch "<branch>" --limit 10 --json databaseId,conclusion,workflowName \
       | jq '[.[] | select(.conclusion == "failure")] | .[0]'
     ```
     If a failed run is found, treat its `databaseId` as the run ID input.
   - If neither resolves (no PR, no failed run), **then** ask the user.

3. Print the resolved target before continuing:
   `Auto-detected target: <PR URL or run ID> on branch <branch>`.

## Phase 1 — Identify the failure

Based on the input:

1. **Run URL or run ID** — fetch the failed job logs:
   ```bash
   gh run view <run-id> --log-failed
   ```

2. **PR URL** — list the failing checks first:
   ```bash
   gh pr checks <pr-number> --repo <owner/repo>
   ```
   Then fetch logs for each failing check.

3. **Check suite / check run ID**:
   ```bash
   gh api repos/<owner>/<repo>/check-runs/<check-run-id>
   ```

Extract and summarize:

- Which job(s) failed.
- The specific error messages and exit codes.
- Which step within the job failed.
- The full error context (surrounding log lines).

## Phase 2 — Understand the workflow holistically

Before making any changes, read every workflow file in the repository:

```bash
find .github/workflows -name '*.yml' -o -name '*.yaml'
```

Build a mental model of:

- How jobs depend on each other (`needs:`).
- What triggers each workflow (`on:`).
- Shared steps, reusable workflows, composite actions.
- Environment variables and secrets used.
- Matrix strategies.
- Caching strategies.
- Artifact passing between jobs.

This holistic understanding prevents fixes that solve one problem but break another job or workflow.

## Phase 3 — Classify the failure (verdict required)

Pick exactly one verdict per failure.
The verdict binds behavior; do not skip this step.

Full decision table and per-verdict notes: [`rules/verdicts.md`](./rules/verdicts.md).

Verdicts at a glance:

- `code-bug` / `workflow-bug` / `dep-bug` / `env-bug` → continue to Phase 3.5.
- `flaky` / `unsure` → **escalate.** Stop.

## Phase 3.5 — Plan artifact + confidence gate

1. Write or update the plan at `.agent/{branch}/ci-auto-fix-plan.md` using [`templates/plan-artifact.md`](./templates/plan-artifact.md).
   The plan is read-only documentation of intent — the user can pre-empt before any code is written.

2. Run the confidence gate per [`rules/confidence-gate.md`](./rules/confidence-gate.md):

   | Score | Action |
   | ----- | ------ |
   | ≥ 90 | Auto-apply. Continue to Phase 4. |
   | 80–89 | Show the diff, ask once, apply on approval. |
   | < 80 | Escalate. Do not write. |

   The gate is non-negotiable.

## Phase 4 — Fix the error

Apply the minimal, targeted fix per the verdict:

- `code-bug` — fix the actual code issue.
- `workflow-bug` — fix the workflow YAML.
- `dep-bug` — update the lockfile or correct the version constraint.
- `env-bug` — pin or bump the runner-side version.

Hard refusals (full list in [`rules/anti-patterns.md`](./rules/anti-patterns.md)):

- Do not disable, skip, or weaken any check.
- Do not add `continue-on-error: true`.
- Do not add `.skip` / `it.only` to silence a test.
- Do not skip hooks with `--no-verify`.
- Do not refactor surrounding code.

Do:

- Make the smallest change that fixes the root cause.
- Stay consistent with the rest of the codebase.
- If fixing a test, verify the test is the one that's wrong (not the code it tests).

## Phase 5 — Verify locally

Before pushing, run the same checks that failed:

- If build failed: run the build command.
- If lint failed: run the linter.
- If tests failed: run the tests.
- If typecheck failed: run the type checker.

Only proceed to push if local verification passes.

## Phase 6 — Commit and push

1. Stage only the files relevant to the fix.

2. Write a clear commit message:

   ```text
   fix(ci): <description of what was fixed>

   <brief explanation of root cause and fix>
   ```

3. Sync with the remote before pushing — a parallel worker may have pushed:

   ```bash
   git pull --rebase origin "<branch>"
   ```

   If the rebase conflicts, run `git rebase --abort`, stop, and report the conflicting files to the user. Do not auto-resolve.

4. Push:

   ```bash
   git push origin "<branch>"
   ```

5. If the push is rejected as non-fast-forward, rebase and retry the push **once**.
   If the retry also fails, or the rebase conflicts, stop and report. Never `--force` push from this skill.

## Phase 7 — Wait for CI

After pushing, monitor the check:

1. Wait briefly for the workflow to trigger:
   ```bash
   sleep 10
   ```

2. Find the new workflow run:
   ```bash
   gh run list --branch <current-branch> --limit 5
   ```

3. Watch the run until completion, bounded at 30 minutes:
   ```bash
   timeout 1800 gh run watch <new-run-id>
   ```
   If `timeout` expires (exit code 124), run `gh run view <new-run-id>` to capture pending jobs, report them, and escalate. Same pattern as the 10-minute review poll in [`../create-pr/rules/review-mode.md`](../create-pr/rules/review-mode.md).

4. Check the result:
   ```bash
   gh run view <new-run-id>
   ```

## Phase 8 — Iterate with regression detection

Full decision table: [`rules/regression-detection.md`](./rules/regression-detection.md).

At a glance:

- Same failure → re-classify in Phase 3.
- Strict subset → continue with the remaining failures.
- New failure that did not exist before → **revert the last commit** (`git revert HEAD && git push`) and re-plan or escalate.

Maximum 4 iterations.
After 4, escalate with the structured exit summary.

## Phase 9 — Report

Always end with a structured summary block, regardless of outcome:

```text
ci-auto-fix run
  Outcome: <green | escalated | regression-reverted | max-iterations>
  Original failure: <workflow / job / step + one-line cause>
  Verdict: <code-bug | workflow-bug | dep-bug | env-bug | flaky | unsure>
  Iterations: <N>/4
  Plan: .agent/{branch}/ci-auto-fix-plan.md
  Successful run: <URL>           # if green
  Escalation reason: <…>           # if not green
```

On success, include the original error, the fix applied, confirmation that all checks pass, and a link to the successful run.

On escalation, include what was tried (one line per iteration), what remains, and suggested next steps for manual investigation.

## Definition of done

The run is done when ANY of the following is true:

- All checks are green AND the structured exit summary has been printed.
- The verdict was `flaky` or `unsure` and the failure was escalated to the user.
- The confidence gate scored < 80 and the fix was not written.
- A regression was detected and reverted, and the user owns the next step.
- `--max-iterations` (default 4) was reached.
