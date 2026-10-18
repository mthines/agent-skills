---
title: pr-reviewer — memory body resolution and application (Steps 1.2d, 1.2e, 2.7b)
impact: HIGH
tags:
  - pr-reviewer
  - memory
  - lorekit
---

# pr-reviewer — memory body resolution and application (Steps 1.2d, 1.2e, 2.7b)

**Read at Step 1.2d (all three sections) by every run whose Step 1.0 read connected.** Steps 1.2d and 1.2e run before Step 1.3; Step 2.7b runs after Step 2.7. The memory contract itself is [`memory.md`](./memory.md).

## Contents

  - [1.2d Resolve the bodies that matter](#12d-resolve-the-bodies-that-matter)
  - [1.2e Apply `reviewer-lessons`](#12e-apply-reviewer-lessons)
  - [2.7b Memory suppression (after verification)](#27b-memory-suppression-after-verification)

---

### 1.2d Resolve the bodies that matter

**Skip entirely when `SUMMARY_VIEW` is `false`** — Step 1.0 already returned full bodies. Otherwise
Step 1.0 loaded only the memory **index** (`key`, `tags`, `updated_at`, `value_bytes`, a 200-char
`preview`), and this step fetches the bodies worth having — **here, not at Step 1.0**, because every
key the shortlist matches on (changed files/symbols, detected integrations, `INTENT_PHRASE`) is
produced by the steps between them (Step 1.1/1.2/1.2c); fetched at Step 1.0 the shortlist would have
nothing to match against.

**Shortlist:** an entry is a candidate when its `key` slug, `tags`, or `preview` mentions a changed
top-level directory, a changed file basename, a changed symbol name, a detected integration, or
`INTENT_PHRASE` — plus every hit the Step 1.2c search surfaced (already relevance-ranked). Be
generous: this filter drops the obviously-unrelated, not the final call — a candidate that doesn't
match once its body is read falls out at Step 1.2e.

```text
# ONE call for the whole shortlist (a refs batch, ≤ 32). Issue as a real mcp__lorekit__memory_read call.
mcp__lorekit__memory_read: refs=["<scope>::<key>", "<scope>::<key>", …]
```

A server that rejects `refs` gets one `scope` + `key` call per entry instead.

**Budget:** at most **half of `MEMORY_READ_BUDGET`, rounded down** — 2 records on a ≤ 10-file diff, 5
on 11–30, 7 on > 30 (records, not calls: one batch spends several) — decremented from the shared pool, leaving the remainder to Step 2.7b's
relevance bodies (which decide what actually gets posted, and must never be starved by a
lesson-heavy shortlist). Over budget, fill it in order — Step 1.2c hits first (in their
relevance-ranked order), then everything else by most-recently-updated — and bind
`MEMORY_BODIES_UNREAD` to the leftover count (0 when the budget wasn't binding), rendered in the
Step 3 Quality Gate block so a truncated shortlist is visible rather than silent. An entry whose
`preview` is already the whole body (`value_bytes` ≤ 200) needs no fetch and never consumes budget.

**This step fetches `reviewer-lessons` only.** `reviewer-comment-relevance` bodies (`relevance`,
`seen_count`, `resolution_method`, `status`) can't be selected here — the fingerprint match is
against this run's **raw findings**, which don't exist until Step 2 — so that fetch belongs to Step
2.7b (`comment-relevance-memory.md § Read`), once there is something verified to match; fetching it
here would mean fetching everything blind. A failed `memory_read` is a non-blocking miss (drop the
entry, do not flip `LOREKIT_CONNECTED`, carry on). `mcp__lorekit__memory_read` has exactly **three**
call sites in this agent — Step 1.2a (≤ 5 knowledge expansions), this step, and Step 2.7b — all from the one pool.

### 1.2e Apply `reviewer-lessons`

Match each loaded lesson's **Applies when** line (the shared lesson-scope schema — file globs, task type, integration/tech names) against this run's changed paths, synthesized intent, and detected integrations.

Match against **bodies**, never previews. Which bodies you have depends on `SUMMARY_VIEW`:
- `SUMMARY_VIEW` **true** — the bodies fetched at Step 1.2d. An entry left unread by the shortlist
  or the read budget is not a match and must not be guessed at from its preview.
- `SUMMARY_VIEW` **false** — Step 1.0 already returned every body and Step 1.2d was skipped, so
  match against the full loaded pool. Nothing is excluded.
A matched lesson's *Do this instead* line is a **consideration, not a command**: it biases rubric emphasis (Step 2), finder focus (Phase D), and scoring calibration (Step 2.7) — it may never silently disable a gate, skip a step, or move a threshold.
On a `repo::` vs. `global` collision the `repo::` lesson wins; on any conflict with the PR author's stated intent or a review-config constraint, that constraint wins and the conflict is surfaced.
The pool matched here already includes the diff-keyed `memory.search` hits from Step 1.2c and the bodies resolved at Step 1.2d.
`reviewer-comment-relevance` memories are applied separately at Step 2.7b, per `comment-relevance-memory.md § Read`.

Announce the outcome now that it exists: `Memory scope: repo::<owner>/<repo> + global — <L> reviewer-lessons matched.`

### 2.7b Memory suppression (after verification)

See [`agents/pr-reviewer/rules/memory.md § Suppression`](./memory.md) and
`agents/shared/rules/comment-relevance-memory.md § Read`. This step used to run at 2.2, before
anything was verified.

**First, resolve the relevance bodies.** The findings now exist *and have been verified*, so the
fingerprint match is both possible and worth paying for — this is the step that owns that fetch,
and Step 1.2d deliberately did not do it. For each loaded `reviewer-comment-relevance` entry whose
fingerprint matches a confirmed finding, fetch its body with `mcp__lorekit__memory_read` — one
`refs` batch for every match — because `relevance`, `seen_count`, `resolution_method` and `status` all live
there and none of them is in the key.

- **Skip the fetch** when `SUMMARY_VIEW` is `false` (Step 1.0 already returned full bodies) or when
  `value_bytes` ≤ 200 (the `preview` was the whole record). Neither case consumes budget.
- **Budget:** spend what remains of the shared `MEMORY_READ_BUDGET` after Step 1.2d — the whole
  remainder is available here, including anything 1.2d left unused.
- An entry whose body was not fetched — a failed read, or the pool exhausted — has no verdict.
  Treat it as absent: it must not drop, downgrade, or promote anything, and it must never be
  guessed at from its preview. Add each such entry to `MEMORY_BODIES_UNREAD`.
- A failed read is non-blocking and never flips `LOREKIT_CONNECTED`.

**Then apply the verdicts:**

- `not-relevant` with `seen_count >= 3` → **SUPPRESS** the finding.
- `not-relevant` with `seen_count 1–2` → **DOWNGRADE** to `nitpick`.
- `relevant` with `seen_count >= 2` → **PROMOTE** (terminal output only).

**Two classes are never suppressible, whatever the memory says:**

1. A **standards** finding — the repo asked for it in its own governing docs, and a suppression
   would have the reviewer overrule a committed instruction on the strength of past click
   behaviour.
2. Anything decorated **`(blocking)`** — broken behaviour, security, data loss, misimplemented
   intent. A verified blocker is not a reporting preference.

Suppression is a **reporting** decision applied to a finding that has already been confirmed
against the code, which is why it belongs here and not at 2.2: before verification it drops the
fourth instance of a pattern — the one that is actually a bug — on the strength of the first three
being won't-fixed.

Announce, now that the figures exist: `Relevance memories active: <D> suppressions, <P> promotions (repo:<owner>/<repo>).`

For every memory that fires (suppress / downgrade / promote), append a record —
`{ id, fingerprint, action, seen_count, scope, key }` — to `APPLIED_MEMORIES[]` per
`comment-relevance-memory.md § Linking applied memories in the report`. Its `scope` + `key`
build the pressable deep link in the Step 4 review-body diagnostics (`MEMORIES_SECTION`).

Report the count as `Memory suppressions: <N>` in the Quality Gate summary
([`rubric-composition.md § Memory suppression`](../../shared/rules/rubric-composition.md#memory-suppression-pr-reviewer)).
Because these findings **cleared** the pipeline before being suppressed, they must be accounted for
in the `<CL> − <DEF> == <F>` identity rather than silently vanishing from it.
