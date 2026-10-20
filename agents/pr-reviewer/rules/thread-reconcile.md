---
title: pr-reviewer — reconcile prior threads (Step 2.9c)
impact: HIGH
tags:
  - pr-reviewer
  - thread-resolution
  - re-review
---

# pr-reviewer — reconcile prior threads (Step 2.9c)

**Read at Step 2.9c only when `IS_RE_REVIEW == true`** (Step 0.7). Runs after Step 2 whether or not Step 2 ran, before Step 3.

## Contents

- [Step 2.9c: Reconcile prior threads (re-review only)](#step-29c-reconcile-prior-threads-re-review-only)

---

## Step 2.9c: Reconcile prior threads (re-review only)

**Under `--dry-run`, classify every thread exactly as below and write the classification to
`$(scratchRoot())/<run-id>/thread-plan.json`, but issue no `resolve_review_thread` mutation and no
reply.** The Gate 3 re-evaluation still runs against the *would-be* resolutions — a dry-run report
must show what the run WOULD do, not a report computed as if nothing had changed.

See `agents/shared/rules/thread-resolution.md`. Skip entirely on a first-pass review — that is
`IS_RE_REVIEW == false` in Step 0.7, **not** an empty `CARRIED_FINDINGS` or `PRIOR_DIAGNOSTICS`.
The two differ on the fallback rung, where the state record was unusable so nothing is carried but
the PR has certainly been reviewed before; keying off the carried state there would leave the run
reconciling nothing and `RESOLVED_SINCE_PRIOR` unbound.

**This is a top-level step, deliberately not a subsection of Step 2.** Step 2 is skipped wholesale
when the zero-delta short-circuit fires (Step 0.8's fast path, or Step 1.2b's later check on the
rebase/amend shape 0.8 cannot see), and a zero-delta run happens **only** on a re-review —
precisely the population this step exists for. The commonest shape is an author who
resolves threads and re-runs the reviewer without pushing code, which is exactly what `review-loop`
produces on convergence. Nesting this under Step 2 would silently exempt those runs from
reconciliation, from the Gate 3 refresh, and from the `reviewer-comment-relevance` write, while
`diagnostic-surface.md` still promised them "every re-review". It therefore runs after Step 2
**whether or not Step 2 itself ran**, including on the zero-delta path.

Findings are final as of 2.9b, which is the precondition this step needs to tell `persisting` from
`fixed`.

**Two corrections to that precondition, both mandatory** (`thread-resolution.md § fixed requires
that this run re-scanned the region` and `§ persisting must be read before prior-comment dedup`):
`fixed`'s clause 2 — *the current run does not re-produce the finding* — is evidence only where this
run looked, so it requires **both** `(path, line ± 5)` inside `REVIEW_DIFF` **and** `path ∈
SCANNED_FILES` (never "no findings ⇒ `fixed`"); otherwise classify `unaddressed`. And a 2.5b dedup
drop matching a candidate thread is `persisting`, read against the **pre-dedup** set or the dedup log
line, because 2.5b drops the re-produced finding *before* the 2.9b set exists — reading `persisting`
off the final set can never fire, and the candidate falls through to `fixed` while the issue is still
live.

`declined` and `acknowledged` are unaffected by the first correction: their evidence is the author's
own words. Note that `acknowledged` additionally requires a delta-touched line, and `obsolete`
carries the same re-scan predicate as `fixed`, so on a zero-delta run `declined` is in practice the
only status that resolves. It runs **here — before the verdict (Step 3) and before posting (Step 4)**
— rather than
after posting, because Gate 3 and the unblock checklist are rendered from `OPEN_BOT_COMMENTS[]`,
and resolving threads after that rendering publishes a checklist naming threads this very run
closed seconds later. The author then reads a stale worklist and only sees the truth on the next
review. Reconciling first removes that lag entirely.

For each of **this agent's own** prior inline comments (`BOT_COMMENTS` from Step 1.0), classify it
**fixed** / **declined** / **acknowledged** / **obsolete** / **persisting** / **unaddressed**,
resolve the threads for the first four, and write the relevance outcome — all per
`thread-resolution.md`.

**The open set must mean "pending".** A thread survives this step only if it is still live work.
`obsolete` exists because a finding whose subject was deleted is none of fixed, declined or
persisting — it stopped applying — and without it those threads accumulate forever.

**Resolution uses whichever GitHub write path this run has** — `gh api graphql`, or a GitHub MCP
resolve-thread tool if that is what is in the grant. When neither exists, set
`RESOLUTION_UNAVAILABLE = true` and **still remove the resolvable threads from
`OPEN_BOT_COMMENTS[]`** before the Gate 3 re-evaluation below. Posting and resolving do not fail
together: a run can add threads through an app token while having no way to close them, and Gate 3
then fails on a set no author action can shrink. Report the count.

Then update Gate 3's input:

- Remove from `OPEN_BOT_COMMENTS[]` every entry whose resolve call **actually succeeded** — an
  errored call leaves the thread open on GitHub, so the checklist must describe GitHub's state, not
  this agent's intent. **Except under `RESOLUTION_UNAVAILABLE`** (no call was possible): remove every
  entry classified `fixed` / `declined` / `acknowledged` / `obsolete` anyway — those threads stay
  open on GitHub and the report says so, but a gate no author action can clear is worse than a gate
  that does not run.
- Re-evaluate Gate 3 from the updated set, exactly as Step 1.8 does, including the ⚠️ / ❌ grading —
  removing the last *blocking unanswered* entry can downgrade ❌ to ⚠️ without emptying the set. This
  is not a laxer gate: Gate 3's own rule is that a resolved thread never fails it. A thread classified
  `declined` / `acknowledged` whose resolve mutation **failed** stays in the set (GitHub still shows
  it open) but Step 1.0's `answered` field is set true for it — the ask was engaged with, and a
  failed mutation is this agent's problem, not the author's. **Except under `--skip-gates`**, where
  Gate 3 is `⏭️`: update the set and `RESOLVED_SINCE_PRIOR` as usual, but leave the gate `⏭️` —
  re-evaluating it here would resurrect a gate the invocation explicitly turned off.
- Recompute `RESOLVED_SINCE_PRIOR` = the count of `PRIOR_OPEN_THREAD_IDS` **actually closed on
  GitHub** (a successful resolve this run, or an `isResolved` observed at Step 1.0) — every thread
  closed since the prior report, by this step, the author, or another fixer, not only the ones this
  step resolved. **Threads removed by the `RESOLUTION_UNAVAILABLE` carve-out are excluded**: they are
  still open, and counting them turns "could not close" into "closed". Never compute it as a set
  difference against `OPEN_BOT_COMMENTS`, which cannot tell a resolution from a removal.

**Never blocking.** Any failure in this step — a GraphQL error, an incomplete thread map, LoreKit
unavailable — is logged and the run continues with the **pre-reconciliation** `OPEN_BOT_COMMENTS[]`
and Gate 3 status. Moving this step earlier must not give it the power to stop a review; the review
is what the author is waiting for.

Log `Threads resolved: <F> fixed, <D> declined, <O> obsolete` — plus `<U> resolvable but not closed (no resolve path)` when `RESOLUTION_UNAVAILABLE` — and `Relevance memories written: <N>` in the Step 5
report — its `Include:` list is free-form and has room for them. Step 3's Quality Gate block is a
fixed enumeration with no slot for either counter; do not wedge them in there.
