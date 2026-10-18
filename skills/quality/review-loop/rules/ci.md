---
title: Sub-step D — read CI and delegate a red check to ci-auto-fix
impact: HIGH
tags:
  - review-loop
  - ci
  - convergence
---

# Sub-step D — CI

Read this file when `NO_CI == 0`, before the first sub-step D of the run.
Under `--no-ci` it does not apply and `ci_is_settled()` is always true.
Why it is shaped this way: [`references/design-rationale.md` § Sub-step D](../references/design-rationale.md#sub-step-d--ci).

After the iteration's push, read the check state **once** — a stateless query at the current remote head, never a watch:

```bash
gh pr checks "$PR_NUMBER" --repo "$RESOLVED_REPO"
```

A bare `gh pr checks` exits non-zero while merely pending, printing to stdout, so non-zero with empty stderr means "registered and running", not an error:

| Check state | `CI_STATE` | This loop does |
| --- | --- | --- |
| All terminal and passing | `green` | Nothing. Convergence may proceed |
| Any still pending | `pending` | Nothing this iteration — never wait. A continuing loop re-reads it next iteration; a loop that exits here can converge on `pending` |
| Any check failing | `red` | Dispatch `ci-auto-fix` as a subagent (its output is loud and belongs out of this context), unless `CI_HANDOFFS` is already 2 |
| Query errored (exit 127, or stderr naming auth / network / rate limit / not-logged-in) | `error` | **Tooling failure, not "no CI".** Report and escalate. Never route to `ci-auto-fix` |
| Nothing reported, query succeeded, and this iteration just pushed | — | Not registered yet. Run the shared [registration poll](../../../delivery/create-pr/rules/registration-poll.md#the-poll) and re-classify from its outcome; `no-ci` means this repo genuinely has no CI, and counts as `green` for convergence |

`ci_is_settled()` in `SKILL.md` is the convergence predicate over this state.
Exactly **one** `pending` re-read, and only at that predicate.
A `ci-auto-fix` handoff resets `CI_STATE` to `"unread"`, so the next `ci_is_settled()` re-reads at head; the cap check reads the same way, so the loop never reports a CI state it has not read at the current head.

**Cap: 2 `ci-auto-fix` handoffs per `review-loop` run** (`CI_HANDOFFS`).
Never wrap a handoff in another loop. At the cap with CI still red, stop and surface the failing checks — never extend it, and never converge a red PR.

**This loop never fixes CI itself.** It classifies and delegates.
Every refusal in [`ci-auto-fix`'s anti-patterns](../../../delivery/ci-auto-fix/rules/anti-patterns.md) holds transitively: no `--no-verify`, no `continue-on-error`, no skipped suites, no weakened assertions to reach green.
