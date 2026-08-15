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
argument-hint: '[<pr-url>|<run-id>]'
license: MIT
metadata:
  author: mthines
  version: '3.3.0'
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
| 3 | Classify the failure with an explicit verdict | [`rules/verdicts.md`](./rules/verdicts.md) + [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md) (read lessons) |
| 3.5 | Write the plan artifact + run the confidence gate | [`rules/confidence-gate.md`](./rules/confidence-gate.md) + [`templates/plan-artifact.md`](./templates/plan-artifact.md) |
| 4 | Apply the minimal, targeted fix | this file + [`rules/anti-patterns.md`](./rules/anti-patterns.md) |
| 5 | Verify locally before pushing | this file |
| 6 | Commit and push (rebase-safe) | this file |
| 7 | Wait for CI and capture the new result | this file |
| 8 | Iterate — with regression detection | [`rules/regression-detection.md`](./rules/regression-detection.md) + [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md) (write on revert) |
| 9 | Report (structured exit summary) | this file + [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md) (write on outcome) |

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

## Step 0: Resolve your GitHub access path

Before any GitHub step, resolve which path you have — `gh` CLI, `mcp__github__*` tools, or neither — per **[`agents/shared/rules/github-access.md`](../../../agents/shared/rules/github-access.md)**. Resolve once, state the path you took, and use it for the whole run.

`gh` is **absent in Claude Code cloud sessions**, so the commands written below are the `gh`-path form; on the MCP path use the verb mapping in that file rather than attempting them. With **neither** path, GitHub steps cannot be performed: say so precisely, do the `git` work you can, and hand the rest back — never report a step you could not perform as blocked-by-something-else.

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

1. Find the new workflow run — **select on the head SHA, do not sleep and hope.**
   A bare `sleep` is blocked in some harnesses, and a fixed 10 s is a race: if
   registration takes longer, the listing returns the *previous* commit's runs and
   you watch a stale run to green. Filtering by SHA removes the race instead of
   timing it (the same fix [`e2e-pr-stabilizer`](../../testing/e2e-pr-stabilizer/rules/verification-loop.md) already uses):

   ```bash
   # Issue this Bash call with the tool parameter timeout: 600000.
   # Bounded loop with a real interval — registration takes seconds, so six
   # back-to-back calls would exhaust the retries before it could happen.
   # The sleep is inside a capped loop, so it is not a bare sleep.
   timeout 90 bash -c '
     SHA=$(git rev-parse HEAD); TMP=$(mktemp)
     # TERM must be listed: bash runs the EXIT trap on a signal only when that
     # signal is trapped, and `timeout` sends TERM on the 124 path.
     trap "rm -f \"$TMP\"" EXIT INT TERM
     while :; do
       # stderr -> variable, stdout -> file. `head -1` is deliberately on its own
       # line below: folding it back into this call would make $? head`s status,
       # which is 0 even when gh dies.
       err=$(gh run list --branch <current-branch> --limit 5 \
         --json databaseId,headSha,status \
         --jq ".[] | select(.headSha == \"$SHA\") | .databaseId" 2>&1 >"$TMP")
       # gh spoke = gh failed. An empty result with NO stderr is "not registered
       # yet"; an empty result WITH stderr is a broken gh, and looping on it
       # would burn the whole budget and then escalate the wrong cause.
       [ -n "$err" ] && { echo "$err" >&2; exit 3; }
       NEW_RUN_ID=$(head -1 "$TMP")
       [ -n "$NEW_RUN_ID" ] && { echo "$NEW_RUN_ID"; exit 0; }
       sleep 5
     done'
   ```

   | Exit | Outcome | Next |
   | ---- | ------- | ---- |
   | 0 | `registered` | `NEW_RUN_ID` is on stdout — watch it |
   | 3 | `tooling-failure` | `gh` itself failed. Report **that** and escalate — do not retry, and do not report it as "no run found" |
   | 124 | `no-run-yet` | No run for this SHA after 90 s. Retry the whole block at most twice more, then report and escalate |

   Same **classifier** as [`registration-poll.md`](../create-pr/rules/registration-poll.md#the-poll) — an unrecognised `gh` error is never benign, and empty output alone cannot tell "nothing yet" from "nothing works". **Different outcome set**: this block renders its own 124 as `no-run-yet` because the retry policy lives here, whereas the shared rule keeps its 124 internal. Do not reuse that rule's outcome names.

2. For reference, the unfiltered listing:
   ```bash
   gh run list --branch <current-branch> --limit 5
   ```

3. Watch the run until completion, bounded per attempt:
   ```bash
   # Issue this Bash call with the tool parameter timeout: 600000.
   # The tool default is 120000; a `timeout` larger than the tool cap never
   # fires its own exit 124 — the harness kills the call first and the expiry
   # handling below becomes dead code.
   timeout 540 gh run watch <new-run-id>
   ```
   If `timeout` expires (exit code 124), watch again — **at most 2 attempts per fix-push cycle, and at most 6 across the whole invocation**. Then run `gh run view <new-run-id>` to capture pending jobs, report them, and escalate.

   **Print each attempt** as `ci-watch attempt N/2 (cycle) · M/6 (invocation)` and carry those lines into your report. The invocation cap spans multiple Phase 8 iterations — a longer span than any single reasoning step — so it must be written down at the moment it changes, not remembered.

   **State the scope, because two are in play.** Each Phase 8 iteration pushes a new commit and therefore watches a *new* run — a new wait, not a continuation — so a purely per-invocation cap would starve iterations 2–4 of any watch at all. A purely per-cycle cap of 4 would allow 4 × 4 = 16 watches (≈ 2.4 h). The pair above bounds both: per-cycle so each fix gets a fair look, and an invocation ceiling so the total cannot run away.

   **Your cap is your own.** You watch a run for a commit *you* just pushed, so you never inherit or spend a caller's budget, and you write no shared state. Report your outcome and let the caller act on it.

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

## Self-Improvement

`/ci-auto-fix` gets better across runs through a two-tier lessons loop (fast
episodic tier + gated promotion), like `autonomous-workflow` and `fix-bug`. It
**reads** `ci-auto-fix-lessons` at Phase 3 (biasing the verdict and the Phase 8
regression call) and **writes** at Phase 8 (on a revert — the strongest negative
signal) and Phase 9 (on the CI outcome). Lessons are **advisory** — they never
relax the confidence gate, the revert-on-new-failure rule, or any refusal in
[`rules/anti-patterns.md`](./rules/anti-patterns.md).

This loop is deliberately **more conservative** than the others because the
verdict is inferred from CI logs alone: **verdict lessons default to the
`repo::{owner}/{repo}` scope** (repo-specific failure shapes are far more
reliable than cross-repo generalizations) with a **raised promotion bar
(`seen_count >= 5`)**, and **regression lessons are `volatile` with a 30-day
expiry** since error signatures churn. A lesson can never authorize a
check-weakening or soft-refusal action — those still re-gate on this run. Full
contract and the two ci-auto-fix-specific entrenchment guards:
[`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md). LoreKit
(the `lorekit-memory` skill's `memory.*` tools) is optional; the loop is a silent
no-op if not connected.

## Definition of done

The run is done when ANY of the following is true:

- All checks are green AND the structured exit summary has been printed.
- The verdict was `flaky` or `unsure` and the failure was escalated to the user.
- The confidence gate scored < 80 and the fix was not written.
- A regression was detected and reverted, and the user owns the next step.
- `--max-iterations` (default 4) was reached.
