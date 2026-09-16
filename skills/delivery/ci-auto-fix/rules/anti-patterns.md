---
title: Anti-Patterns
impact: HIGH
tags: [ci, guardrails]
---

# Anti-patterns

These constraints apply to both paths and to recalled lessons:

- Never disable, skip, delete, or weaken checks/tests to obtain green CI; do not
  add `continue-on-error`, `.skip`, focused tests, or compiler/lint suppressions
  that hide the defect. Preserve the assertion or invariant being checked.
- Never bypass hooks (`--no-verify`) or force-push.
- Never change dependency/action versions speculatively or use an unpinned moving
  branch such as `@main` as a troubleshooting experiment.
- Never rerun unexplained failures until lucky. Only the evidence-backed,
  single-attempt [infrastructure exception](./verdicts.md#bounded-infrastructure-rerun)
  permits an automatic rerun.
- Never stack fixes on a demonstrated regression; follow
  [regression detection](./regression-detection.md) first.
- Never refactor unrelated code or claim all checks passed from one green job.

Runner images, major runtimes, reusable workflows, composite actions, and dependency
constraints require the diagnostic path and affected-consumer validation. They do
not automatically require a new permission question when the user's existing scope
already authorizes the fix. Ask for unresolved product/security choices or actions
outside that scope, with the proposed diff and impact ready for review.
