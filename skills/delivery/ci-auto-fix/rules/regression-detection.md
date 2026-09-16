---
title: Regression Detection
impact: HIGH
tags: [ci, regression, revert]
---

# Regression detection

Compare the new result with the recorded baseline, retaining workflow, job, matrix,
step, command, and normalized error signature. Ignore timestamps, paths containing
run IDs, and shifted line numbers. Signature differences identify investigation
candidates; they do not establish causality.

| Result                | Next action                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same failure          | Revisit the hypothesis with new evidence; do not repeat the same fix                                                                                |
| Strict subset         | Preserve the working fix and diagnose remaining root causes                                                                                         |
| Newly exposed failure | If the step/job was previously blocked or never reached, diagnose it without automatically reverting                                                |
| Unrelated failure     | Establish independence through baseline/history, changed files, or environment evidence; preserve the fix and report/diagnose the remaining failure |
| Introduced regression | If a causal link to the fix is supported, revert the responsible recorded fix commit before replanning                                              |
| Unclear relationship  | Inspect dependencies/diff or reproduce against the parent and fix revisions; stop if causality cannot be resolved                                   |

A passing baseline for the same check plus a reproducible failure caused by the
changed behavior is strong regression evidence. A baseline install failure followed
by the first test execution is not. Changed environments or concurrent commits must
be accounted for before attributing the failure to this fix.

## Reverting

Fetch and reconcile the remote branch first. Verify that the recorded fix SHA is
an ancestor of the target branch and is the commit responsible for the regression.
Use `git revert <fix-sha> --no-edit`, never `git revert HEAD` by assumption. Preserve
other workers' commits; if rebasing or reverting conflicts, abort that operation
and report. Never force-push. A rejected push permits one resync/retry as in Phase 6.

Record the reverted SHA, revert commit, evidence, and resulting baseline. A revert
creates a new commit; its SHA will not equal the original parent. Verify the affected
behavior after reverting and monitor the resulting revision within the remaining
CI budget. Report any unverified rollback explicitly rather than claiming recovery.

Replan using the actual remaining failures, including any newly exposed ones.
Stop after two introduced regressions or four fix-push cycles. Revert pushes do
not grant additional fix cycles or wait budget.
