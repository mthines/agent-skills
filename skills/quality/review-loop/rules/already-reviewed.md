---
title: Already reviewed — stop on a head the last review judged
impact: HIGH
tags:
  - review-loop
  - guard
  - force
---

# Already reviewed — stop on a head the last review judged

Read this file at iteration 1, before sub-step A, on every run that has a PR reference and `FORCE == 0` and `MERGE == 0`.
Why the guard is shaped this way: [`references/design-rationale.md` § Already-reviewed guard](../references/design-rationale.md#already-reviewed-guard).

A re-run on a head `pr-reviewer` already judged spends a prepare, a dispatch, and gate checks to return what the last report said.
The guard stops that run before the dispatch.

## Stop condition

Stop only when **all** of these hold; continue otherwise:

| Condition | Read from |
| --- | --- |
| `ITERATION == 1` | the loop counter |
| `FORCE == 0` and `MERGE == 0` | Step 0 flags — `--force` overrides the guard; `--merge` needs a review pass before it may merge |
| `.mode == "zero-delta"` | `context.json` from the one `prepare-review.mjs` run the [apply-first check](./apply-first.md) also reads |
| `OPEN == 0` | unresolved review threads — nothing left for sub-step B to apply |
| `REPLIED == 0` | unresolved threads holding more than one comment |

The unresolved-thread rows keep the cases the guard must not break: `OPEN >= 1` with `REPLIED == 0` is the [apply-first](./apply-first.md) path, and `REPLIED >= 1` needs the reviewer's zero-delta pass to adjudicate the reply.
Any failed read — no `context.json`, no `.mode`, a failed thread query — continues; never stop on a state you could not read.

Reuse the apply-first block's `MODE`, `PRIOR_SHA`, `OPEN`, and `REPLIED` values.
Under `NO_FEEDBACK == 1` the apply-first file is not read, so run its one Bash call for these four values and ignore its `APPLY_FIRST` line.

## `--merge` on a reviewed head

`--merge` never takes the stop: the loop applies the open findings (the [apply-first](./apply-first.md) path), re-reviews the pushed head, and merges on a `PASS` or `WARN` per [`merge.md`](./merge.md).

```text
# correct: head reviewed as WARN, 2 open threads, --merge → fix, re-review, merge
Iteration 1: review skipped → B applies 2 → push
Iteration 2: WARN, 0 new → all-threads-resolved → CI green → merged (squash)

# incorrect: stopping as already-reviewed — the PR never merges
Iteration 0: skipped (head 4fedd19 already reviewed)
```

## When the guard stops the run

1. Run `prepare-review.mjs --cleanup <dir>/context.json` when this context ran the prepare.
2. Set `STOP_REASON = "already-reviewed"`, leave `ITERATION` at `0`, and dispatch nothing: no review, no sub-steps B, C, D, no Step 1.6, no Step 2, no Step 2.5.
3. Report with Step 3's block; `Iterations` is `0 of <CAP>`, `Final pr-reviewer verdict` is `n/a (already reviewed at <PRIOR_SHA>)`, and the run's last line is:

```text
review-loop — skipped (head <sha7> already reviewed). Pass --force to run it again.
```

An already-reviewed stop is not convergence and not `report-only`: say plainly that nothing ran.

## `--force`

`--force` skips the guard and the [apply-first](./apply-first.md) skip, and forwards `--full` to the **iteration 1** reviewer so the head is reviewed whole instead of gate-checked.
Later iterations run as usual: a push has moved the head, so they are not repeats.

```text
# correct: unmoved head, no open threads, no flag → stop
Iteration 0: zero-delta · 0 open · 0 replied → skipped (head 4fedd19 already reviewed)

# correct: the same state with --force → a full review of that head
Iteration 1: pr-reviewer --full → <verdict>

# incorrect: stopping with two open threads nobody replied to — apply-first applies them
Iteration 0: zero-delta · 2 open → skipped

# incorrect: dropping --full under --force — the reviewer returns the zero-delta gate check the guard existed to avoid
Iteration 1: pr-reviewer (zero-delta) → gate check only
```
