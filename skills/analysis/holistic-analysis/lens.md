---
for: reviewer
lens-version: 1
applies-to: always
---

# Holistic Analysis — Review Lens

## Trigger

Always-on. The lens checks whether a fix or refactor addresses the full execution path — not just the visible block. It's most valuable on bug-fix PRs and refactor PRs that touch contract boundaries. On feature PRs that add new code, most checklist items are vacuously satisfied — the lens is cheap to apply either way.

## Checklist

- [ ] The fix targets the block where the contract violation actually occurs — not a downstream symptom or a defensive catch-all that hides the original failure.
- [ ] Contract boundaries between blocks are preserved: caller's expectations (input shape, preconditions) match callee's guarantees (output shape, postconditions, error mode) after the change.
- [ ] All call sites of any function whose signature, return shape, or error contract changed are updated in the same PR — no orphaned callers left to discover the drift at runtime.
- [ ] Side-effect ordering is preserved: DB writes, cache mutations, emitted events, and external API calls still occur in the order downstream blocks assume.
- [ ] The error/unhappy path is exercised by a test, not just the happy path — empty inputs, null/undefined, timeouts, and concurrent requests are covered or explicitly out of scope.
- [ ] Null / undefined propagation is checked: no callee returns `null | undefined` where its caller dereferences unconditionally; no `!` non-null assertion added without a guard above it.
- [ ] Concurrency gaps between blocks N and N+1 are considered: if blocks share state (DB row, cache key, in-memory map), the change does not introduce a TOCTOU window or lost-update race.
- [ ] Recent commits to the affected files were checked for related drift (`git log -10 -- <path>`) — the fix is not undoing a prior fix or contradicting a recent design decision.
- [ ] No "patch in isolation" smell: one-line fix inside a 200-line function with no comment, no test, and no explanation — that pattern hides the symptom and re-emerges elsewhere.
- [ ] If the PR is a refactor, behaviour is preserved end-to-end across the execution path — entry-point inputs map to identical exit-point outputs and side effects (provable via test or explicit invariant).

## Severity hints

- **Must-fix**: contract-boundary mismatch left in place; orphaned caller of a changed function; introduced TOCTOU / lost-update race; defensive catch-all that hides the original failure.
- **Should-fix**: unhappy path not exercised by a test; null/undefined propagation gap with `!` assertion as the "fix"; ordering of side effects not preserved.
- **Nice-to-have**: missing reference to recent commit context; one-line fix without comment in a long function (suggest extracting and naming the invariant).
