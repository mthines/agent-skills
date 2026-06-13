---
name: ci-auto-fix
description: >
  Diagnose a failed CI check, apply a minimal fix, push, and iteratively verify
  until CI passes. Provider-agnostic in scope (currently implements the GitHub
  Actions path via `gh`). Refuses to disable, skip, or weaken checks. Invoke
  with /ci-auto-fix <run-id|pr-url>.
disable-model-invocation: false
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: command
---

# CI Auto-Fix

Diagnose and fix a failed CI check, then verify it passes. Generic across repositories; currently implements the GitHub Actions path via `gh`.

## Input

The user provides one of:
- A GitHub Actions check/run URL (e.g., `https://github.com/owner/repo/actions/runs/12345678`)
- A check run ID or workflow run ID
- A PR URL with failing checks (e.g., `https://github.com/owner/repo/pull/42`)
- **Nothing** — if `$ARGUMENTS` is empty, auto-detect the failing CI for the current branch's PR (see Step 0 below).

The argument is: $ARGUMENTS

## Step 0: Resolve the target when no argument was given

If `$ARGUMENTS` is empty, do not ask the user — resolve the target automatically:

1. Get the current branch:
   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

2. Find the open PR for this branch:
   ```bash
   gh pr list --head "<branch>" --state open --json number,url,headRepositoryOwner --limit 1
   ```
   - If exactly one PR is found, use its URL as the PR input and continue to Step 1.
   - If the PR's `headRepositoryOwner.login` differs from the current repo's owner (i.e., the PR is from a fork), surface that fact to the user before continuing.
   - If no open PR is found, fall back to the most recent failed workflow run on this branch:
     ```bash
     gh run list --branch "<branch>" --limit 10 --json databaseId,conclusion,workflowName \
       | jq '[.[] | select(.conclusion == "failure")] | .[0]'
     ```
     If a failed run is found, treat its `databaseId` as the run ID input.
   - If neither resolves (no PR, no failed run), **then** ask the user for input.

3. Print the resolved target before continuing:
   `Auto-detected target: <PR URL or run ID> on branch <branch>`.

## Step 1: Identify the failure

Based on the input provided:

1. **If a run URL or run ID was given**, fetch the failed job logs:
   ```bash
   gh run view <run-id> --log-failed
   ```

2. **If a PR URL was given**, list the failing checks first:
   ```bash
   gh pr checks <pr-number> --repo <owner/repo>
   ```
   Then fetch logs for each failing check.

3. **If just a check suite or check run ID**, use:
   ```bash
   gh api repos/<owner>/<repo>/check-runs/<check-run-id>
   ```

Extract and summarize:
- Which job(s) failed
- The specific error messages and exit codes
- Which step within the job failed
- The full error context (surrounding log lines)

## Step 2: Understand the workflow holistically

Before making any changes, read and understand ALL workflow files in the repository:

```bash
find .github/workflows -name '*.yml' -o -name '*.yaml'
```

Read each workflow file. Build a mental model of:
- How jobs depend on each other (`needs:`)
- What triggers each workflow (`on:`)
- Shared steps, reusable workflows, or composite actions
- Environment variables and secrets used
- Matrix strategies
- Caching strategies
- Artifact passing between jobs

This holistic understanding prevents fixes that solve one problem but break another job or workflow.

## Step 3: Identify the root cause

Analyze the error in context:
1. Is it a **code error** (lint, type check, test failure, build error)?
2. Is it a **workflow configuration error** (bad YAML, wrong action version, missing secret)?
3. Is it a **dependency issue** (lockfile mismatch, missing package, version conflict)?
4. Is it a **flaky/transient error** (network timeout, rate limit, resource exhaustion)?
5. Is it an **environment issue** (wrong Node/Python/etc version, missing system dependency)?

For code errors, read the relevant source files to understand the issue before fixing.

## Step 4: Fix the error

Apply the minimal, targeted fix:
- **Code errors**: Fix the actual code issue (lint error, type error, failing test, etc.)
- **Workflow errors**: Fix the workflow YAML
- **Dependency issues**: Update lockfile or fix version constraints

### Guard rails — do NOT:
- Disable or skip failing checks/tests just to make CI pass
- Add `continue-on-error: true` to mask failures
- Remove linting rules or type checks
- Skip hooks with `--no-verify`
- Make unrelated changes or refactor surrounding code
- Weaken any validation or safety checks

### Do:
- Make the smallest change that correctly fixes the root cause
- Ensure the fix is consistent with the rest of the codebase
- If fixing a test, make sure the test is actually wrong (not the code it tests)
- Run the relevant checks locally first if possible (build, lint, test)

## Step 5: Verify locally

Before pushing, run the same checks that failed locally to the extent possible:
- If build failed: run the build command
- If lint failed: run the linter
- If tests failed: run the tests
- If typecheck failed: run the type checker

Only proceed to push if local verification passes.

## Step 6: Commit and push

1. Stage only the files relevant to the fix
2. Write a clear commit message describing what was fixed and why:
   ```
   fix(ci): <description of what was fixed>

   <brief explanation of root cause and fix>
   ```
3. Sync with the remote before pushing — another process (e.g. a parallel `/implement-suggestion` worker) may have pushed in the meantime:
   ```bash
   git pull --rebase origin "<branch>"
   ```
   If the rebase conflicts, run `git rebase --abort`, stop, and report the conflicting files to the user — do not auto-resolve.
4. Push to the current branch:
   ```bash
   git push origin "<branch>"
   ```
5. If the push is rejected as non-fast-forward, run `git pull --rebase origin "<branch>"` and retry the push **once**.
   If the retry push also fails, or the rebase conflicts, stop and report to the user instead of force-pushing or looping.

## Step 7: Wait for CI and verify

After pushing, monitor the check:

1. Wait briefly for the workflow to trigger:
   ```bash
   sleep 10
   ```

2. Find the new workflow run:
   ```bash
   gh run list --branch <current-branch> --limit 5
   ```

3. Watch the run until completion, bounded at 30 minutes so a hung or queued-forever run cannot block the loop indefinitely:
   ```bash
   timeout 1800 gh run watch <new-run-id>
   ```
   If `timeout` expires (exit code 124), run `gh run view <new-run-id>` to capture which jobs are still pending, report them to the user, and escalate instead of continuing to block — same pattern as the 10-minute review poll in [`create-pr/rules/review-mode.md`](../create-pr/rules/review-mode.md).

4. Check the result:
   ```bash
   gh run view <new-run-id>
   ```

## Step 8: Iterate if still failing

If the check still fails:

1. Fetch the new failure logs:
   ```bash
   gh run view <new-run-id> --log-failed
   ```
2. Determine if this is the same error or a new/different one
3. Go back to **Step 3** and repeat the fix cycle
4. Maximum 4 iterations — if still failing after 4 attempts, report the situation to the user with:
   - What was tried
   - What errors remain
   - Suggested next steps for manual investigation

## Step 9: Report success

Once all checks pass, report:
- What the original error was
- What fix was applied
- Confirmation that all checks are now passing
- Link to the successful run
