---
mode: existing-pr
pr: <owner>/<repo>#<n>
prUrl: https://github.com/<owner>/<repo>/pull/<n>
branch: <branch-name>
headSha: <head-sha>
worktree: <absolute-path-to-worktree>
lane: <fast | standard>
generatedAt: <ISO-8601-timestamp>
generatedBy: implement-suggestion v2.3.0
---

# Suggestion Pack — <owner>/<repo>#<n>

This pack is the contract handed to the worker subagent (fast-lane) or to
`aw-planner` (standard-lane). The worker commits and pushes to the existing
PR branch — it does **not** open a new PR.

## Summary

| Metric | Value |
|--------|-------|
| Total comments fetched | <n> |
| Resolved (filtered at fetch) | <n> |
| Bot-authored (filtered at fetch) | <n> |
| Praise (dropped) | <n> |
| Discussion / question (surfaced) | <n> |
| Actionable / nit | <n> |
| Decision `apply` | <n> |
| Decision `surface` | <n> |
| Decision `skip` | <n> |
| Files affected by `apply` | <n> |
| Lane | <fast \| standard> |

## Acceptance Criteria

One criterion per `apply` decision. The worker / planner uses these as the
gate for "done":

- [ ] Comment <#1234567890> by @<author>: <one-line summary of expected outcome, in testable terms>
- [ ] Comment <#…>: …

## Applied Changes

For each `apply` decision, one block:

### Comment <#1234567890> — @<author>

- **Source**: <reviews | pulls | issues>
- **URL**: <permalink>
- **Thread ID**: `<PRRT_… | null>` (null = no resolvable thread; worker skips resolve)
- **Path:Line**: `<path>:<line>` (side: <LEFT|RIGHT>)
- **Body**:
  > <verbatim comment body>
- **`/critical` findings**: <none | severity + one-line title each>
- **`/confidence` score**: <X%> (evidence <Y%> / root cause <Y%> / fix <Y%>)
- **Proposed edit**:

  ```diff
  --- a/<path>
  +++ b/<path>
  @@ -<line>,<n> +<line>,<n> @@
  <before>
  +<after>
  ```

  Or, if not a literal diff (multi-line rewrite):

  - **Before** (`<path>:<line-range>`):
    ```<lang>
    <verbatim before>
    ```
  - **After**:
    ```<lang>
    <verbatim after>
    ```

## Surfaced (needs user)

Comments that did not auto-apply. The worker ignores these; the Phase 7
report surfaces them to the user.

- Comment <#…> by @<author> — `/confidence` <X%>; <reason: critical-high / score-in-band / classification-ambiguous>
- …

## Skipped

Comments dropped with one-line reason.

- Comment <#…> by @<author> — <reason: confidence < 70% / not actionable / resolved>
- …

## File Changes

Aggregate file list across every `apply` decision. The worker should not
touch files outside this list.

| File | Line range | Comment ID(s) | Operation |
|------|------------|----------------|-----------|
| `<path>` | `<lines>` | `<id>` | edit / replace / extract |
| … | … | … | … |

## Commit Messages

**One commit per applied comment** — the worker commits each comment's fix
separately so `git log` and the resolved threads line up one-to-one. Per
`apply` comment the worker uses:

```
address review comment: <one-line summary of this comment's fix>

Addresses @<author>'s comment: <comment-url>

Refs: <pr-url>
```

After all per-comment commits are pushed, the worker resolves each addressed
thread (reply with the commit SHA, then `resolveReviewThread`) so the PR is
left with every addressed comment resolved and only `surface` / `skip`
comments still open.

## Risk and Rollback

- **Risk**: <one paragraph — what could break, what was considered>
- **Rollback**: `git revert <commit-sha>` on the PR branch. Each applied
  comment is its own commit, so a single comment's fix can be reverted in
  isolation without unwinding the others.

## Test Plan

- **Fast checks the worker will run**: <project-detected: lint, typecheck, scoped tests>
- **Acceptance verification**: each Acceptance Criterion above maps to a
  specific check or test the worker confirms before pushing.
