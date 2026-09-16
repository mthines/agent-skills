---
title: CI Verification
impact: HIGH
tags: [ci, verification, polling]
---

# CI verification

## Scope and identity

Record the pushed SHA and expected check scope before watching. For a PR, include
required checks and the relevant workflows identified during diagnosis, including
all originally failing jobs/matrix members. For run-only input, follow that workflow
and its relevant dependents; report that scope without claiming all PR checks pass.

Discover runs by repository, branch, event/workflow, and revision, not the first
item from a five-run listing. Paginate where needed. For example, `gh run list
--commit <sha> --json databaseId,workflowName,headSha,event,status,conclusion` narrows
the candidate set; inspect all relevant results and attempts. For PR merge-ref
checks, verify their association with the current PR head/base rather than rejecting
them solely because a synthetic merge SHA differs from the head SHA.

Use `gh pr checks <pr> --repo <repo>` plus run/job details for PR scope, or the MCP
mapping in the shared GitHub access rule. Record run attempt as well as run ID:
reruns retain an ID and invalidate cached results/logs for that attempt.

## Bounded waiting

- Registration: poll every 5 seconds for up to 90 seconds per attempt, maximum
  three attempts per pushed revision. No registration is an explicit unresolved
  outcome, not success or proof that the repository has no CI.
- Completion: poll every 30 seconds, with a maximum of two 9-minute windows per
  revision and six windows across the invocation. Count reruns and revert revisions
  against the same invocation limit. Record each window before starting it.
- Use the available asynchronous process/wait mechanism so progress updates remain
  possible. Do not rely on a platform-specific `timeout` command being installed.
- Keep full snapshots locally; emit only changed status summaries. Reuse the same
  monitoring process/state across waits rather than regenerating shell loops.

Check the tool's exit code and structured status. Authentication, rate-limit, and
network/API errors are tooling failures, not empty check sets; surface them without
spending the remaining budget on blind retries. `gh pr checks` exit 8 means pending,
1 means checks failed, and 0 still requires validating the expected scope. With MCP,
inspect returned states/errors instead of applying CLI exit-code conventions.

If a relevant job fails while others run, fetch its completed failure once and
start diagnosis while the remaining jobs settle. Preserve their results for the
baseline; do not launch duplicate runs or concurrent conflicting fixes.

## Completion gate

Before reporting green, refresh check state and current remote/PR head:

1. The checked revision is still the target revision. If it changed, inspect the
   intervening commits, invalidate affected evidence, and monitor the current revision.
2. Every expected required/relevant check is accounted for and successful. Pending,
   missing, cancelled, timed-out, action-required, or inaccessible checks are not green.
3. A neutral/skipped check is acceptable only when repository conditions show it is
   legitimately inapplicable and it is not a required success. An originally failing
   check must execute successfully; its disappearance or skip is not a fix.

If required-check configuration is inaccessible, report the observed scope and gap;
do not claim complete PR success. At budget expiry, list pending/missing checks and
links, preserve counters and evidence, and escalate without starting a fresh budget.
