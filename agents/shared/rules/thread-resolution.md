---
title: Thread resolution — auto-resolve addressed threads and record the outcome on re-review
impact: HIGH
tags:
  - pr-reviewer
  - incremental
  - thread-resolution
  - comment-relevance
  - self-improvement
  - lorekit
---

# Thread resolution

On a re-review — the commit-triggered second (third, …) pass over a PR the agent
already reviewed — the agent reconciles its **own** prior inline comments against
the current state of the code, then does two things for each one:

1. **Resolves the GitHub review thread** when the comment has been addressed,
   explicitly declined, or has stopped applying, so a re-run cleans up after itself
   instead of leaving a growing pile of stale open threads (the behaviour a human
   reviewer — and Cursor's reviewer — is expected to have).

   **The open set must mean "pending".** A thread stays open if and only if it is
   still live work. Anything else — fixed, declined, acknowledged, or obsolete —
   gets closed on the next pass. A reader who cannot trust that invariant has to
   re-read every open thread to find the ones that matter, which is the same cost
   as having no thread state at all.
2. **Writes the resolution outcome to LoreKit** (`reviewer-comment-relevance`,
   the per-repo Signal bucket), so the fixed / declined / ignored signal
   accumulates and future reviews on this repo get progressively less noisy.

This is the in-run, proactive counterpart to the post-merge write path in
[`comment-relevance-memory.md`](./comment-relevance-memory.md): it fires on every
commit, not only at merge, so the cleanup and the learning happen while the PR is
still open.

---

**Read this by section, not start to finish.** `pr-reviewer` Step 2.9c needs *Classify each prior
own-comment* and *Resolve the thread*; *Write the outcome to LoreKit* and *Ordering* matter once
the classification is done. The Contents below is the index.

It stays one file because the classification table and the resolve/write steps are one procedure —
splitting them would put the status a thread was assigned in a different file from what is done
about it — and because other rules cite its sections as `thread-resolution.md § <section>`.

## Contents

- [When this step runs](#when-this-step-runs)
- [Classify each prior own-comment](#classify-each-prior-own-comment)
- [Resolve the thread](#resolve-the-thread)
- [Write the outcome to LoreKit](#write-the-outcome-to-lorekit)
- [Ordering](#ordering)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## When this step runs

This rule is **`pr-reviewer`-only.** Resolving a GitHub thread is a write to
GitHub, and `pr-reviewer` is the review agent that writes to GitHub.
In both relations it rewrites the sticky report and, when Step 4b's condition is
met, posts a single visible `COMMENT` review (`REVIEW_RELATION` only adjusts the
framing tone), so thread resolution applies to both relations on a re-review pass. The relevance signal from threads that were not resolved here
comes from the post-merge path (`outcome-learning.md`) and the GitHub Action instead.

| Agent | When | Gate |
| --- | --- | --- |
| `pr-reviewer` | Step 2.9c, on every re-review (`IS_RE_REVIEW == true` in Step 0.7 — a PR-state record **or** a sticky found on the fallback rung; not the narrower "something was carried forward", which is empty on that rung) | Resolution + write always run; a failure here never blocks the review |

It **never** runs on a first-pass review (no prior threads to reconcile).

It consumes the `BOT_COMMENTS` set and the resolved/accepted detection already
built by [`prior-comment-awareness.md`](./prior-comment-awareness.md) — it does
not re-fetch or re-derive them.

It also consumes two `pr-reviewer` variables for the re-scan predicate below:
`REVIEW_DIFF` (bound at Step 1.2b from the run mode — full PR diff in `full`, the
delta in the incremental modes, empty on zero-delta) and `SCANNED_FILES` (bound at
Step 2 as the walk proceeds; excludes Step 1.4 triage skips and everything past a
budget-exhausted stop).

---

## Classify each prior own-comment

For every comment in `BOT_COMMENTS` (this agent's own prior inline comments) that
sits on an **unresolved** GitHub thread, assign exactly one status. Reuse the
`prior-comment-awareness.md § What "accepted / resolved" includes` table for the
signals; this rule only adds what to DO with each — with one **override**: that
table's *"Author pushed a commit touching `(path, line ± 5)` after comment ⇒ Yes"*
row carries no re-scan clause, and the re-scan predicate below narrows it. Where
the two differ, the predicate wins.

| Status | Condition | Thread action | Memory write |
| --- | --- | --- | --- |
| **fixed** | The commented region changed after the comment was posted (a commit touched `(path, line ± 5)`) AND the current run does **not** re-produce a finding with the same fingerprint at/near that location. **Requires that this run re-scanned the region, and that no 2.5b dedup drop matches the thread** — see the two sections below. | **Resolve** | `relevant` / `fixed` |
| **declined** | The author replied with decline language — the model-readable list is in [`outcome-learning.md § What counts as an acknowledgement`](./outcome-learning.md) (`WONT_FIX_RE` is its deterministic counterpart, authoritative for the script), and a decline outranks an acknowledgement; do not restate the list here — or 👎-reacted the comment | **Resolve** | `not-relevant` / `wont-fix` |
| **acknowledged** | The author replied with an acknowledgement — judge it per [`outcome-learning.md § What counts as an acknowledgement`](./outcome-learning.md), which is authoritative; do not restate its criteria here — and the thread is on a line the delta touched | **Resolve** | `relevant` / `fixed` |
| **obsolete** | GitHub reports the thread `isOutdated` — the diff hunk it anchors to no longer exists — **and** the current run does not re-produce the finding anywhere. **Carries the same re-scan predicate and pre-dedup read as `fixed`** — see the sections below; without them this status is `fixed`'s vacuous-clause-2 bug with a different name. The subject went away; the finding was neither fixed nor declined, it stopped applying. | **Resolve** | none — see below |
| **persisting** | The current run re-produces the same finding (the issue is still there) — read **before** Step 2.5b's prior-comment dedup, or off a matching dedup drop; see *`persisting` must be read before prior-comment dedup* | **Leave open** | none (the finding carries forward and stays posted) |
| **unaddressed** | None of the above — the line is untouched, no reply, and the delta did not cover it (so the current pass could not re-confirm it); **also** every `fixed` candidate downgraded by the re-scan predicate, whose line *was* touched | **Leave open** | none — absence of a re-scan is not evidence of resolution |

Both rows defer rather than restate, and **decline outranks acknowledgement** on this path as on the
post-merge one — that precedence is the one thing the deterministic and judgement paths are required
to share (`outcome-learning.md § What counts as an acknowledgement`). The two may otherwise differ at
the margin: they classify different evidence at different times, and neither is a specification of
the other.

Precedence is what must not drift. A reply this path treats as a decline and the other treats as an
acknowledgement produces two opposite records on one fingerprint; a reply neither recognises simply
falls to `unaddressed`, which is the safe direction.

**Status precedence.** Evaluate in this order and take the first that matches:
`declined` → `acknowledged` → `persisting` → `obsolete` → `fixed` → `unaddressed`.
`persisting` outranks `obsolete` so a re-produced finding can never be closed as
"the subject went away"; `unaddressed` is last and absorbs everything the predicates
reject.

Four hard rules:

- **Only ever touch threads this agent authored.** Never resolve a human's or a
  different bot's thread. Match on `user.login == BOT_LOGIN`.
- **Never resolve a `persisting` or `unaddressed` thread.** Resolving a thread
  whose issue is still live would hide a real finding — the exact failure this
  feature must not cause. When in doubt, leave it open.
- **No re-scan, no `fixed`; a deduped re-production is `persisting`.** See the sections below.
- **Never resolve as `obsolete` a finding this run re-produced.** The anchor going away is
  not the finding going away.

### `obsolete` — the finding stopped applying

`fixed`, `declined` and `acknowledged` all assert something about how the finding was
*dealt with*. A fourth case has none of those and is not `unaddressed` either: the code
the finding was about no longer exists, so the finding has no subject. Deleting a whole
section, dropping a feature, or reverting a file all produce it.

GitHub already computes this. A review thread carries `isOutdated` — true when the diff
hunk it anchors to is gone from the current head. Add it to the Step 1.0 thread query
(`prior-comment-awareness.md § fetch existing PR comment state`) alongside `isResolved`:

```text
nodes{ id isResolved isOutdated comments(first:100){ nodes{ databaseId } } }
```

**Both conjuncts are required.** `isOutdated` alone is not enough — a hunk can move
because the author edited *around* a still-live finding, and GitHub marks that outdated
too. So also require that the current run does not re-produce the finding **anywhere in
the diff**, not merely at the old anchor. A finding that reappears at a new location is
`persisting`; the code moved, the problem did not.

**And conjunct 2 needs exactly the protections `fixed`'s does — it is the same clause.**
*"The current run does not re-produce the finding"* is evidence only if the run looked,
and only if the finding was not deleted from the set before it was read. Without both,
`obsolete` reintroduces the bug the two sections below exist to close:

- **Re-scan predicate.** Require `(path, line ± 5)` inside `REVIEW_DIFF` **and**
  `path ∈ SCANNED_FILES`. On a zero-delta run Step 2 never executes, so **zero findings
  are produced and conjunct 2 is satisfied by every thread** — every `isOutdated` thread
  would resolve. That is the modal re-review, the shape `review-loop` produces on
  convergence. The same hole exists for an out-of-delta region on an incremental run,
  which is precisely the "author edited around a live finding" case this status was
  written to exclude.
- **Pre-dedup read.** Read conjunct 2 against the finding set **before** Step 2.5b's
  prior-comment dedup, exactly as `persisting` is. Against the final set a deduped
  re-production reads as "not re-produced anywhere", so a still-live finding whose
  comment was deduped away resolves as `obsolete` on a full, fully-scanning run.

When the predicate fails, classify `unaddressed` and leave the thread open — the same
disposition `fixed` takes, for the same reason. A genuinely deleted subject almost always
sits in `REVIEW_DIFF` on a full pass, so the strict form costs nearly nothing on the case
this status is actually for.

`obsolete` writes **no relevance record**. That is the point of the status: the outcome
carries no signal about whether the finding was any good. It was never accepted and never
declined — the question was withdrawn. Recording it as `fixed` would reward a detection
nobody acted on; recording it as `not-relevant` would punish one nobody rejected.

**Closed — the Action now consults `isOutdated`.** `scripts/record-comment-relevance.mjs`
fires on `pull_request_review_thread: resolved` and still has no way to know *why* a thread
was resolved, so the inference it used to make was wrong in exactly this case: its
region-touch branch matched (a deletion always touches the line) and its terminal branch
read "resolved with none of the above ⇒ `relevant / fixed`". Resolving a thread as
`obsolete` therefore produced the record this paragraph forbids, in every repo running the
`pr-relevance-memory` caller — and it was live, not latent, because the claim that the
reusable workflow was uncommitted was false for as long as it stood.

The fix does not require the resolver to signal intent. GitHub already knows: a thread whose
anchor is gone is `isOutdated`, which the recorder reads over GraphQL and treats as
**undecidable**, ordered ABOVE both inference branches. An outdated anchor writes nothing.
The author's own words still outrank it — a 👎 or a decline reply on an obsolete thread is a
real decline and is recorded — because those are evidence, and `isOutdated` only says the
inference has none. Two named cases in the recorder's `--self-test`, executed by L1, hold
this shut.

Log it distinctly so a growing count is visible: `[thread] OBSOLETE <path>:<line> — anchor
gone at <sha>, finding not re-produced`.

### `fixed` requires that this run re-scanned the region

`fixed` is a two-clause test, and clause 2 — *the current run does not re-produce
the finding* — is evidence **only if this run looked at that region**. Where it did
not, clause 2 is vacuously true and every candidate whose line was touched
classifies as `fixed`, gets resolved, and writes a false `relevant` / `fixed`
record into the durable relevance signal. That is the "hide a real finding"
failure the hard rule above forbids.

Clause 1 does not save it: it is *"a commit touched `(path, line ± 5)` **after the
comment was posted**"* (`prior-comment-awareness.md § What "accepted / resolved"
includes`), which can be satisfied by a commit from several runs ago. It says
nothing about what **this** run examined.

**Rule — the re-scan predicate.** For each candidate, `fixed` additionally requires
**both**:

- `(path, line ± 5)` falls inside `REVIEW_DIFF` — the diff this run had in scope,
  per the run mode; **and**
- `path ∈ SCANNED_FILES` — the set of files the inline pipeline actually read,
  accumulated as the Step 2 walk proceeds (`pr-reviewer.md § Step 2`).

When either fails, classify the thread `unaddressed` and leave it open.

Both conjuncts are needed, because *in scope* and *read* are different sets.
`REVIEW_DIFF` is bound once from the run mode and is never narrowed afterwards, so
on its own it reports a file as scanned when nobody opened it.

This is deliberately about *scanning*, not about *findings existing*. An empty
finding set on a clean `full` scan is the normal terminal state of a converging PR
(Gate 6 ✅, "no inline finding survived the pipeline") — that run **did** re-scan,
so `fixed` fires there exactly as it should. Reading the predicate as "no findings
⇒ no `fixed`" would disable the primary resolve path on precisely the runs where
it is most correct.

Four paths fail the predicate, and it covers all four without enumerating them:

| Path | Conjunct that fails | Effect |
| --- | --- | --- |
| Zero-delta short-circuit | Both — `REVIEW_DIFF == ""` and `SCANNED_FILES` is empty | Every `fixed` candidate → `unaddressed` |
| `incremental` / `incremental-quick`, region outside the delta | `REVIEW_DIFF` — the delta only, so that region was never in scope, while clause 1 can still be true from an earlier commit | That candidate → `unaddressed`; in-delta candidates unaffected |
| Budget-exhausted partial run (`<M>` of `<T>` files scanned) | `SCANNED_FILES` — the file is in `REVIEW_DIFF` but the walk stopped before reaching it | That candidate → `unaddressed`; the `M` reached files are unaffected |
| Step 1.4 triage skip on a > 30-file PR (auto-generated / lock / vendored) | `SCANNED_FILES` — the file stays in `REVIEW_DIFF` but is deliberately never read | That candidate → `unaddressed` |

`unaddressed` is the right target in each: its own rationale is *absence of a
re-scan is not evidence of resolution*, which is literally this condition.

The last two rows are why the predicate cannot be a `REVIEW_DIFF` test alone.
Budget exhaustion and triage both leave a file in `REVIEW_DIFF` while guaranteeing
nobody read it, and a long-running PR — the kind the deep-lens refresh forces back
to `full`, and the kind with the most prior threads to reconcile — is exactly where
both are most likely.

**The reply-driven statuses are unaffected**, because their evidence is the
author's own words rather than a scan:

| Status | Evidence | Under a failed re-scan predicate |
| --- | --- | --- |
| `fixed` | This run's re-scan | → `unaddressed`; leave open |
| `obsolete` | This run's re-scan (conjunct 2) | → `unaddressed`; leave open |
| `persisting` | This run's re-scan (see below) | Cannot fire; the candidates it would have caught are now `unaddressed` |
| `declined` | Author replied won't-fix / 👎-reacted | Resolve as normal |
| `acknowledged` | Author replied "done" — **but see the delta conjunct below** | Resolve when its own condition holds |
| `unaddressed` | — | Leave open as normal |

`acknowledged`'s condition also requires *"the thread is on a line the delta
touched"*, so on a zero-delta run it cannot fire either. That fails **closed** —
no thread is wrongly resolved — but it means `declined` is in practice the only
resolver on a zero-delta re-run, and an author who replies "done" without pushing
will see the thread stay open until a code push arrives. That is the intended
conservative behaviour, not an oversight.

The cost of that conservatism is bounded by Gate 3's grading (`pr-reviewer.md § Gate
states`): the "done" reply makes the thread `answered`, so it holds the gate at ⚠️
rather than ❌. The thread stays open and stays on the checklist — the reply is not
treated as proof of a fix — but an unverified claim of doneness no longer fails the
PR on its own.

The cost of this rule is a genuinely-fixed thread staying open until a run that
re-reads its region — one extra checklist line. The cost of not having it is a live
finding silently resolved and mislabelled in a durable signal. Those are not close.

### `persisting` must be read before prior-comment dedup

`persisting` is defined as *"the current run re-produces the same finding"*, and
`pr-reviewer.md` Step 2.9c anchors on findings being final as of 2.9b. Taken
literally that is unfirable, and the failure is silent.

Step 2.5b applies `prior-comment-awareness.md § Dedup against prior bot comments`,
whose first row is: *same `(path, line ± 2)` and same Conventional-Comments prefix
⇒ **DROP** the new finding — it was already said*. A still-live finding
re-produced at the same place is therefore removed **before** the 2.9b set exists.
So on a full, fully-scanning re-review: the finding is re-produced, deduped away,
`persisting` cannot fire, clause 1 is true (the author touched the line), clause 2
is vacuously true against a set the finding was deleted from — and the thread is
resolved as `fixed` while the issue is still there. No zero-delta involved.

That the `persisting` row's own Memory-write cell reads *"none (the finding carries
forward and stays posted)"* shows the design expects the dedup drop; the two
statements cannot both be read off the final set.

**Rule.** Evaluate `persisting` against the finding set **as it stands before
Step 2.5b's prior-comment dedup**. Equivalently, and more cheaply: a 2.5b dedup
drop whose fingerprint matches a candidate thread's own root comment **is** a
positive `persisting` signal for that thread. The dedup log line already records
exactly this — `[prior-comment] DROP src/foo.ts:42 — suggestion: already posted in
prior review (comment #12345)` — so no new computation is needed, only that the
drop is not thrown away.

A thread with a matching dedup drop is `persisting`: leave it open, write nothing.
It must never reach the `fixed` branch, whatever clause 1 says.

The fingerprint is the same `category:claim-gist` used by
`comment-relevance-memory.md` — derived from the prior comment's Conventional
Comments prefix and its one-line claim, never from `file:line`.

---

## Resolve the thread

GitHub review threads are resolved through the GraphQL `resolveReviewThread`
mutation; the thread's node id is not on the REST comment object, so map from the
comment to its thread first.

**Resolve your GitHub path first**, per
[`github-access.md`](./github-access.md) — it owns the `gh` / MCP / neither decision and maps
resolving a thread to `resolve_review_thread`. Do not restate that mapping here; the snippet below is
the `gh` form.

**What is specific to this step is what Gate 3 does when there is no path at all.** Posting and
resolving do not fail together: a run can add threads through an app token while having no way to
close them, so it accumulates threads on every pass and closes none. Observed on
`mthines/agent-skills#116` — six passes, open-thread count 5 → 9 → 12 → 17 → 20, every report saying
"this run does not resolve threads" and every listed finding already addressed by the diff.

So when `github-access.md` resolves to **No path**, set `RESOLUTION_UNAVAILABLE = true`, log
`[thread] resolution unavailable — <N> thread(s) classified resolvable but not closed`, and
**exclude those threads from `OPEN_BOT_COMMENTS[]`** for the Gate 3 re-evaluation at Step 2.9c. The
run has classified them `fixed` / `declined` / `acknowledged` / `obsolete`; failing the gate on
threads it has itself certified as done makes the gate unclearable by any author action, which is
strictly worse than not running it.

This does **not** loosen `github-access.md § No path` rule 3 — never claim a thread was resolved when
the call did not happen. The threads stay open on GitHub, the report says so, and the next run with a
working path closes them. What changes is only that they stop blocking a gate they cannot clear.

**Reuse the Step 1.0 fetch.** `prior-comment-awareness.md § Thread state` already wrote
`/tmp/review-threads.json` at the start of the run, with the same query and a completed
pagination walk. Read that file instead of re-querying.
Re-run step 1 below in exactly two cases: the file is absent (the Step 1.0 fetch never ran),
or its `complete` field is `false` (the Step 1.0 walk stopped early).
Running at Step 2.9c, this run's own review has not been posted yet, so the snapshot cannot be
missing anything relevant: step 2 below reconciles only threads whose root comment is a **prior**
comment.
That is what makes this a call moved earlier rather than a call added.
Re-resolving a thread this run already resolved is a safe no-op either way.

```bash
# 1. List the PR's review threads with their resolved state and member comment ids.
#    This is character-for-character the query and pagination walk in
#    `prior-comment-awareness.md § fetch existing PR comment state`, so the two
#    produce the same `/tmp/review-threads.json`. Edit them together.
# Derive both halves from RESOLVED_REPO (`owner/repo`, set in `pr-reviewer` Step 0) rather
# than from REPO: Step 0 binds REPO to the bare repository name, so `${REPO%%/*}` would
# yield the repo name as the owner unless some earlier rule happened to rebind it.
OWNER="${RESOLVED_REPO%%/*}"
REPO_NAME="${RESOLVED_REPO##*/}"
THREADS_QUERY='
  query($owner:String!,$repo:String!,$pr:Int!,$cursor:String){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$pr){
        reviewThreads(first:100, after:$cursor){
          pageInfo{ hasNextPage endCursor }
          nodes{ id isResolved isOutdated comments(first:100){ nodes{ databaseId } } }
        }
      }
    }
  }'

: > /tmp/review-thread-pages.json
CURSOR=""
THREADS_COMPLETE=true
while :; do
  # Capture the page, then append it with an explicit newline: `gh api graphql`
  # emits no trailing newline, so appending its stdout directly would run page 2
  # onto page 1's line.
  if ! PAGE=$(gh api graphql -f query="$THREADS_QUERY" \
       -F owner="$OWNER" -F repo="$REPO_NAME" -F pr="$PR_NUMBER" \
       -F cursor="${CURSOR:-null}"); then
    THREADS_COMPLETE=false
    break
  fi
  printf '%s\n' "$PAGE" >> /tmp/review-thread-pages.json
  HAS_NEXT=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<< "$PAGE")
  CURSOR=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' <<< "$PAGE")
  [ "$HAS_NEXT" = "true" ] || break
done

# One merged document with every page's nodes, in the shape the checks below read.
# `complete` persists THREADS_COMPLETE into the file. An aborted walk leaves the pages
# file empty, so without this flag the merged result `{nodes: []}` is indistinguishable
# from a PR that genuinely has no threads — and THREADS_COMPLETE is a shell variable that
# does not survive to Step 2.9c, which reads only the file.
jq -s --argjson complete "$THREADS_COMPLETE" \
  '{complete: $complete, nodes: [.[].data.repository.pullRequest.reviewThreads.nodes[]]}' \
  /tmp/review-thread-pages.json > /tmp/review-threads.json

# complete == false means the walk stopped early — treat the thread map as
# incomplete and resolve nothing on the strength of it, never as "no more threads".
# This is the same flag the reuse check above reads off /tmp/review-threads.json.

# 2. For a prior comment classified fixed/declined/acknowledged, find its thread
#    id where isResolved == false and the thread's root comment databaseId matches
#    the comment id, then resolve it. Skip already-resolved threads (idempotent).
gh api graphql -f query='
  mutation($threadId:ID!){
    resolveReviewThread(input:{threadId:$threadId}){ thread{ id isResolved } }
  }' -F threadId="$THREAD_ID"
```

Resolution is **idempotent and non-fatal**: a thread already resolved is skipped,
and a mutation error (permissions, a thread that vanished) is logged and never
fails the review. Report resolutions in the **Step 5** report (not the Step 3 Quality Gate block, which is a
fixed enumeration with no slot) as `Threads resolved: <F> fixed, <D> declined, <A> acknowledged,
<O> obsolete`.

---

## Write the outcome to LoreKit

For each `fixed` / `declined` / `acknowledged` comment, emit one
`reviewer-comment-relevance` memory — the same record shape, key format, scope
rule, and `seen_count` UPDATE contract defined in
[`comment-relevance-memory.md`](./comment-relevance-memory.md); this rule only
adds the trigger. Writes are append-only, non-blocking, and a silent no-op when
`memory.*` is not connected.

```
memory.write {
  scope: "repo::{owner}/{repo}",            # or "global" for a universal pattern
  key:   "reviewer-comment-relevance::<category>:<claim-gist>",   # NO pr#/comment-id/sha — see below
  value: "<record body: relevance, resolution_method, reason, examples, seen_count, expires>",
  tags:  ["loop::reviewer-comment-relevance", "source::<resolution_method>"],
  source_agent: "pr-reviewer",
  trigger: "re-review-reconcile"
}
```

The key's fingerprint segment is `<category>:<claim-gist>` and **nothing else** —
never a `pr{N}-{commentId}` or any other coordinate. Encoding coordinates makes the key
unique per occurrence, so `seen_count` never accumulates and the signal is inert
(this is the drift that produced duplicate rows on `dash0hq/dash0`). Put the PR
and comment id in the record's `examples` field. See the ✅/❌ examples and
self-check in [`comment-relevance-memory.md` § Key format](./comment-relevance-memory.md#key-format).

The `loop::reviewer-comment-relevance` tag conveys the bucket's kind (`signal`)
and host (`reviewer`): LoreKit records both from the tag automatically (migration
`00056`), so the tag-only call above is sufficient. You may also set them
explicitly (`kind: "signal", host: "reviewer"`) now that they are first-class
properties (lorekit #372) — it is optional and equivalent to the inferred form
(see [`memory-buckets.md`](./memory-buckets.md)).

`persisting` and `unaddressed` comments are **not** written — a still-open
finding has no resolution outcome yet, and writing one would poison the signal.

Deduplicate before writing exactly as `comment-relevance-memory.md § Write`
prescribes (`memory.search` on the fingerprint, UPDATE-in-place on a re-sighting
so `seen_count` increments). A prior write from the GitHub Action or
`implement-suggestion` for the same fingerprint is additive — LoreKit increments
`seen_count`; a conflicting direction is surfaced, never silently overwritten.

---

## Ordering

Run this at **`pr-reviewer` Step 2.9c** — after 2.9b (the current run's findings are
final, which is what `persisting` vs `fixed` needs) and **before** Step 3's verdict
and Step 4's posting.

The sequence per re-review is: fetch prior comments (`prior-comment-awareness.md`) →
produce findings → **reconcile prior threads (this rule)** → verdict → post.

**Why before posting, not after.** Gate 3 and the unblock checklist
(`pr-reviewer.md § The Gate 3 open threads`) are rendered from `OPEN_BOT_COMMENTS[]`.
Resolving threads after that rendering publishes a checklist naming threads the same run
closed moments later, so the author reads a worklist that was already stale when it was
written and only sees the truth one review later. Reconciling first removes the lag.

**Failure is never fatal, and never blocks.** The property that made "run it last" attractive
is preserved explicitly instead of positionally: any error here — a GraphQL failure, an
incomplete thread map, LoreKit unavailable — is logged, and the run continues with the
**pre-reconciliation** `OPEN_BOT_COMMENTS[]` and Gate 3 status. This step may make a review
more accurate; it may never stop one.

**Only successful resolutions count.** Remove a comment from `OPEN_BOT_COMMENTS[]` only when its
`resolveReviewThread` mutation actually succeeded. A mutation that errored leaves the thread open
on GitHub, and the checklist must describe GitHub's state rather than this agent's intent.

**Re-evaluating Gate 3 is not a laxer gate.** Gate 3's own rule is that *a resolved thread never
fails this gate* (`pr-reviewer.md § Gate 3`). These threads are now resolved, so re-reading the
gate against the updated set applies the existing rule to fresher input — it does not introduce a
second, weaker standard. A `persisting` or `unaddressed` thread is never resolved, so it can never
be removed from the gate this way.

Re-evaluate the **full tri-state**, not just the empty/non-empty split: removing the last
blocking-and-unanswered entry downgrades ❌ to ⚠️ even when other threads remain open. A thread
classified `declined` or `acknowledged` whose mutation **failed** stays in the open set, but is
marked `answered` for the grading — GitHub still shows it open so it must still be listed, yet the
ask has demonstrably been engaged with, and a failed mutation is this agent's problem rather than
the author's.

**Except under `--skip-gates`**, where Step 1.8 never ran and Gate 3 is `⏭️`: update the open set
and the `resolved since` counter as usual, but leave the gate `⏭️`. Re-evaluating it there would
resurrect a gate the invocation explicitly turned off. The carve-out is owned by
`pr-reviewer.md § Step 2.9c`; it is restated here so this rule does not read as complete without it.

---

## What this rule does not do

- Resolve a thread whose finding still reproduces — `persisting` always stays open.
- Touch a thread the agent did not author.
- Post any new comment or reply — it only resolves threads and writes memory.
- Change the posting contract — the sticky is still rewritten and the review still
  posts under Step 4's normal rules; thread resolution is a separate, self-authored action.
- Block, delay, or fail a review. It runs before posting to keep Gate 3 honest, not to
  gate it: on any error the run continues with the pre-reconciliation state.
- Decide the verdict. It updates Gate 3's **input**; Step 1.8's rule and Step 3's verdict
  logic are unchanged.
- Replace the post-merge outcome sweep (`outcome-learning.md`) or the GitHub
  Action write path — it is an additional, earlier producer of the same signal.
