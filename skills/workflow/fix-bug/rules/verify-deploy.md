# Verify-deploy short-circuit

Load when step 0a set `VERIFY_DEPLOY_MODE=true` (`/fix-bug --verify-deploy <PR>`).
The PR is already merged and (presumably) deployed; run Phase 8 against the shipped fix.
Skip Phases 1–7 entirely.

1. **Resolve the PR's head branch and merge commit:**

   ```bash
   gh pr view <PR> --json headRefName,mergeCommit,labels
   ```

2. **Locate the bug-notes ledger** at `.agent/<headRefName>/bug-notes.md` in the current checkout.
   The ledger survives worktree cleanup because the autonomous-workflow Phase 7 cleanup copies
   `.agent/<branch>/` into the main checkout before removing a worktree with a pending deferred
   verification — see the [deferred-verification guard](../../autonomous-workflow/rules/phase-7-ci-gate.md#optional-post-merge-cleanup).
   If missing, fail:

   ```text
   No bug-notes ledger found for PR #<N> at .agent/<branch>/bug-notes.md.
   /fix-bug --verify-deploy can only verify PRs originally produced by /fix-bug —
   the ledger is the recovery handle for post-deploy verification.
   ```

3. **Read the ledger.** Recover the originating telemetry source from the Evidence Record's
   `Sources` section, the pre-fix baseline from the Phase 8 shape (or recompute via the
   originating query), and the deploy ID from PR labels or the merge commit's `service.version`
   annotation.

4. **Validate input was telemetry-sourced.** If the Evidence Record's `Sources` field does not
   contain a Dash0 / telemetry URL, fail:

   ```text
   PR #<N> was not opened from a telemetry-sourced bug. /fix-bug --verify-deploy
   only applies to bugs whose original input was a Dash0 / telemetry URL.
   ```

5. **Jump to Phase 8 step 8a** ([classify shape](./telemetry-verification.md#step-8a--classify-observability-shape))
   with the recovered Evidence Record.
   Phase 8 then proceeds normally — classify, pick a verification mode, and run the chosen mode.

6. **After Phase 8 completes**, append the result to the ledger under `Phase log` and post a
   comment on the PR (and the originating Linear ticket if the input carried one).
   Exit.
