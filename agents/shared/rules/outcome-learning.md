---
title: Outcome learning — resolution-rate feedback loop
impact: HIGH
tags:
  - pr-reviewer
  - implement-suggestion
  - self-improvement
  - lessons
  - resolution-rate
  - review-outcomes
---

# Outcome learning

The goal of an automated reviewer is not to generate findings — it is to generate findings that authors **act on**.
The difference matters: a tool that correctly flags 10 issues but the author ignores 8 of them is not 80 % accurate, it is 20 % useful.

Bugbot's core insight (DOCUMENTED): they hill-climb on **resolution rate** measured at MERGE time — "did the author actually fix the flagged issue" — not on a self-graded "is-this-a-bug" label.
That outcome loop is what lets them turn generation aggression up while keeping perceived noise down.

This rule governs the **promotion decision** that consumes the shared candidate/outcome bus.
The bus schema, fingerprint reuse, TTL, consolidation cadence, and provenance rules are owned by
[`review-outcomes.md`](./review-outcomes.md) — read that file for bus internals.
This file owns what to do with accumulated signals once they cross the promotion threshold.

---

## Primary input: the `review-outcomes` bus

The primary signal source for promotion decisions is the `review-outcomes` LoreKit bus (tag `loop::review-outcomes`).
`implement-suggestion` appends a fingerprinted outcome record to this bus for each comment it processes (verdict, source, reason, PR, timestamp).
See [`review-outcomes.md`](./review-outcomes.md) for the full record schema and fingerprint formula.

The gh-api resolution signals (signals a/b/c below) are a **secondary/fallback** source:
they apply when `implement-suggestion` is not installed or when a PR was reviewed but `implement-suggestion`
did not process it (e.g. a pure `pr-reviewer` run without any suggestion-apply pass).

**Read discipline:** the `review-outcomes` bus is NEVER loaded into the per-review lesson read (Step 0.7).
It is consumed only at promotion/consolidation time.
This keeps per-review context lean and promotion-quality high.

---

## The three gh-api resolution signals (secondary/fallback)

After a PR is merged (or on-demand via `/review-outcomes <pr>`), measure the following for each comment the agent posted:

| Signal | Meaning | How to detect |
| --- | --- | --- |
| **(a) Dismissed / 👎-reacted** | Author found the comment unhelpful or wrong | `gh api .../reactions` returns 👎 from PR author |
| **(b) Author reply correcting the finding** | Finding was wrong for a stated reason | Thread contains an author reply that is **not** an acknowledgement (§ What counts as an acknowledgement), and no follow-up commit touching the line |
| **(c) Author pushed a fix touching the commented line** | Finding was acted on | A commit after the review comment touches `(path, line ± 5)` **and** the thread is resolved. A region touch alone is not this signal — see *Signal (c) requires corroboration*. |

Signal (c) is the primary gh-api resolution signal — it is the Bugbot metric.
Signals (a) and (b) are the noise signals — they teach the agent where it over-flags.

A fourth implicit signal, absent from the above three: a **human reviewer independently caught something the bot missed**.
Detect this by checking review comments from other human reviewers on lines the bot did NOT flag.
These become new **detection candidates** — patterns to watch for in future runs.

---

## Measurement mechanism

Use `gh api` (read-only).
Run after merge, or on-demand.

**This sequence is REST plus one paginated GraphQL query.** Steps 1–5 are REST, but signal (c)'s primary
corroboration is thread resolution, and `isResolved` is a GraphQL `reviewThreads` field that no REST
endpoint exposes. Step 3b acquires it, in as many pages as the PR has threads — one call is the minimum, not the
budget. Without that step an agent following this sequence literally
cannot evaluate the corroboration signal (c) requires, so signal (c) would never fire — a far larger
behaviour change than "requires corroboration", and a silent one.

### Step 1 — Resolve the comment list

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
BOT_LOGIN=$(gh api user --jq .login)

# All review comments by the current user on this PR
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq ".[] | select(.user.login == \"$BOT_LOGIN\") | {id, path, line, body, created_at}"
```

### Step 2 — Signal (a): 👎 reactions

```bash
# For each comment_id from Step 1:
gh api repos/$REPO/pulls/comments/$COMMENT_ID/reactions \
  --jq ".[] | select(.content == \"-1\") | .user.login"
```

If the PR author's login appears in the output → signal (a) fired: the comment was dismissed.

### Step 3 — Signal (b): author reply correcting the finding

```bash
# Fetch the review thread for this comment
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq ".[] | select(.in_reply_to_id == $COMMENT_ID) | {user_login: .user.login, body}"
```

If a reply exists from the PR author, **is not an acknowledgement** (§ What counts as an acknowledgement),
AND no fix commit touches the commented line (Step 4 returns empty) → signal (b): the finding was
challenged without action.

**The acknowledgement test is what stops this signal inverting.** Without it, any author reply plus
an untouched `± 5` window reads as a dismissal — so an author who replies "fixed" and lands the fix
somewhere the window does not reach records as `not-relevant / wont-fix`, the exact opposite of what
happened, feeding the suppression gate against a finding that was acted on. The same reply text is
corroboration at Step 4 and a decline here; only the content test keeps the two consistent.

An author reply that **is** an acknowledgement, with no fix commit in range, is neither (b) nor (c):
it decides nothing, so no record is written for it either.

### Step 3b — Thread resolution state (needed by signal (c))

The **same** query `prior-comment-awareness.md § fetch existing PR comment state` runs, including its
`endCursor` pagination walk — do not re-derive it, and do not drop the walk (`reviewThreads` caps at
100 and `--paginate` does not work for GraphQL):

```bash
OWNER="${REPO%%/*}"; REPO_NAME="${REPO##*/}"
# Walk reviewThreads(first:100, after:$cursor) until hasNextPage is false, exactly as
# prior-comment-awareness.md § Thread state does, and merge the pages.
# Build COMMENT_TO_THREAD: Map<databaseId, {threadId, isResolved}>.
```

Build `COMMENT_TO_THREAD` from the result, the same map that rule builds.

**If the walk cannot complete** (permissions, API error, unpaged remainder), treat every affected
comment's resolution state as **unknown** — never as unresolved. Detect this from `"complete": false`
in `/tmp/review-threads.json`: the reused block persists its `THREADS_COMPLETE` flag into the file
precisely because an aborted walk otherwise yields `{nodes: []}`, which is indistinguishable from a
PR with no threads (`prior-comment-awareness.md § Thread state`). Every reader of that file must key
on the flag; this step is one of them. An unknown state fails corroboration, so those
comments become indeterminate per § Signal (c) requires corroboration.

**The guard binds both thread-state-dependent writes, not just signal (c).** These two are the
complete set of writes whose *predicate* names thread state; signal (a) is reaction-only and signal
(b) is reply-text-only, so neither is bound. Two further sites — the `reviewer-lessons` resolution
lesson and the `≥ 3 signal (c) confirmations` promotion row — are *downstream* of signal (c) firing
and are therefore transitively protected, not separately guarded. Signal (c) is one direct consumer;
the other is the `ignored-at-merge` bullet in
[`comment-relevance-memory.md § What reviewer / pr-reviewer write`](./comment-relevance-memory.md),
whose condition is "PR merged with thread open" — also an assertion about thread state, and one that
inherits nothing from signal (c)'s rule. With an unknown state, **neither** may be written: not
`relevant / fixed`, and not `ignored-at-merge` either. Guessing "unresolved" would convert a tooling
gap into a stream of false `ignored-at-merge` records — which is the failure this rule exists to
prevent, and it lands through that bullet rather than through signal (c).

Log `[outcome] thread state unavailable — <N> comment(s) indeterminate`, and write no record for them.

### Step 4 — Signal (c): author pushed a fix touching the commented line

```bash
# Commits on the PR branch after the review comment's created_at
gh api repos/$REPO/pulls/$PR_NUMBER/commits \
  --jq ".[] | select(.commit.author.date > \"$COMMENT_CREATED_AT\") | .sha"

# For each sha, check whether (path, line ± 5) was touched
gh api repos/$REPO/commits/$SHA \
  --jq ".files[] | select(.filename == \"$COMMENT_PATH\") | {patch}"
# If the patch hunk includes line ± 5 → resolution confirmed
```

Signal (c) requires at least one commit SHA that touches `(path, line ± 5)` after the comment was
posted — **and** corroboration that the finding was actually addressed.

#### Signal (c) requires corroboration

A commit touching the region is evidence that the author *edited near the finding*, not that they
*fixed it*. Treating the touch alone as `relevant / fixed` is the same vacuous inference
``thread-resolution.md § `fixed` requires that this run re-scanned the region`` removes from the
in-run path: clause 1 without clause 2.

It matters more here than it looks, because the in-run fix **deliberately routes threads to this
path**. A candidate the re-scan predicate downgrades is left `unaddressed` and open, precisely so a
human decides. If a bare region touch then writes `relevant / fixed` at merge, the false record the
in-run guard prevented lands anyway, one step later — and the guard buys a thread that stays open
but no protection for the durable signal it was written to protect.

Corroboration is any **one** of:

| Corroborating signal | Why it is evidence |
| --- | --- |
| The thread is **resolved** (`isResolved == true`), from `COMMENT_TO_THREAD` (Step 3b) | Someone — author, reviewer, or fixer — asserted it was dealt with. This is the authority `prior-comment-awareness.md § Thread state` already designates; Step 3b is where this path obtains it. |
| `implement-suggestion` recorded `verdict: applied` for the fingerprint | A gated apply landed the change; the `review-outcomes` bus carries it. |
| The author replied with an acknowledgement — see § What counts as an acknowledgement below | The author's own words. |

#### What counts as an acknowledgement

This rule is read **by a model**, at runtime, on one reply at a time. It is a judgement call with a
conservative default, and deliberately not a matcher: an earlier version tried to pin the decision
down mechanically here, and every clause added to it opened a new gap, because prose is the wrong
medium for an algorithm whose reader is not executing one. Keep this as judgement. The deterministic
half belongs in the script, below.

Ask: **does this reply claim the finding was already handled?**

- **A decline wins.** If the reply declines the finding, it is a decline and not an acknowledgement,
  even when it also reports a partial fix. *"Fixed the lint nit; the null-check is by design"* is a
  decline. Decline language, as a **model-readable list** — this is the agent-facing statement the
  in-run path (`thread-resolution.md`) and the degraded heuristic (`prior-comment-awareness.md`)
  both point at, so it is enumerated here once rather than left as a pointer to a regex those
  readers do not execute:

  > won't fix · wont fix · by design · as designed · working as intended · intentional ·
  > not going to (change) · out of scope · nwf · n/a

  `WONT_FIX_RE` in `scripts/record-comment-relevance.mjs` is the deterministic counterpart of this
  list and stays the authority for the script. Judge the *intent*, not the literal string: a reply
  that plainly declines without using any of these words is still a decline.
- **Negated or hedged-negative is not an acknowledgement.** *"I haven't updated this"*, *"not
  resolved yet"*, *"I don't think this is done"*.
- **Future or conditional is not an acknowledgement.** *"I'll address this in a follow-up"*, *"will
  be fixed separately"*, *"to be done in #123"* — the work was moved out of this PR, not completed.
- **Hedged-positive is an acknowledgement.** *"Looks fixed to me"*, *"believe that's addressed"* —
  the author is claiming it was handled.
- **When you cannot tell, it is not an acknowledgement.** The conservative default is the point: an
  unrecognised reply leaves the thread open for a human, which is the safe direction.

The deterministic counterpart is `scripts/record-comment-relevance.mjs`, which has no model and does
need a real matcher. It is not required to reproduce these judgements exactly, and this section is
not a specification of it — the two paths measure different runs and may legitimately disagree at
the margin. What they must share is the **decline-wins** precedence, because a disagreement there
produces two opposite records on one fingerprint.

**With a region touch but none of the three, write nothing.** Do not fall through to
`weak-not-relevant / ignored-at-merge` either: an open thread whose region was edited is genuinely
*indeterminate*, and guessing in either direction poisons the signal — `relevant / fixed` rewards a
finding that may still be live, `weak-not-relevant` punishes one that may have been fixed. A signal
bucket is allowed to have gaps; it is not allowed to have invented entries.

Log `[outcome] UNCORROBORATED <path>:<line> — region touched, thread read as open, no acknowledgement`
and move on.

**The observation belongs in the run log, not in the bucket.** An earlier draft stored these as a
fourth, non-directional `relevance` value so the gap would be countable. It had four write sites and
no reader, and could not have had one: `lorekit-setup § Wiring checklist` requires every bucket
record to have a read step, a write step, and a promotion gate, and a record that by definition
decides nothing satisfies none of the three. A lessons bucket holds advisory input to a run; "we
could not tell" is telemetry, and telemetry goes to the run output.

This also corrects the `pr-merged` sweep's skip rule in
[`comment-relevance-memory.md`](./comment-relevance-memory.md): it skips threads "that had a fix
commit … (already captured by the first trigger)", but the first trigger is
`pull_request_review_thread: resolved`, which never fired for a thread that was never resolved. Those
threads are indeterminate, not captured — so the sweep must skip them **as indeterminate**, not as
already-recorded.

### Step 5 — Human-missed detection candidates

```bash
# All review comments from reviewers OTHER than the bot on lines the bot did NOT flag
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq ".[] | select(.user.login != \"$BOT_LOGIN\") | {path, line, body}"
```

Cross-reference against the bot's comment list (Step 1).
Lines in the human reviews but NOT in the bot reviews are detection candidates — flag for the lesson-write step.

---

## Entry points

**Primary: `review-outcomes` bus (via `implement-suggestion`).**
`implement-suggestion` emits a fingerprinted outcome record (the outcome-emit step) at Phase 7 and inside `--watch` for each comment it processes.
These records accumulate in the `review-outcomes` scope and are consumed at promotion/consolidation time.
This is the preferred path because the verdict is already computed by the per-comment `/critical` + `/confidence` gate — no additional `gh api` calls needed.

**Secondary automatic (lightweight):** the post-push reviewer-feedback loop that `/create-pr` backgrounds (`/implement-suggestion --watch`) already runs after the PR is open.
When that loop detects a PR merge event (`state: MERGED`), it MAY trigger gh-api outcome measurement as a tail step — this keeps the measurement co-located with the existing feedback path and avoids a separate cron.
The `--watch` loop already uses `gh api` for status polling; outcome measurement adds ~3 extra `gh api` calls.

**On-demand:** `/review-outcomes <pr>` runs the five gh-api steps above against any merged PR and writes the result to the lesson store.
Useful for retrospective audits or when the automatic path was not active.

Both fallback entry points call the same shared `gh api` sequence above and write to:
1. `reviewer-lessons` via LoreKit `memory.write` (tag `loop::reviewer-lessons`) — the existing behavior.
2. `reviewer-comment-relevance` via LoreKit `memory.write` (tag `loop::reviewer-comment-relevance`) — the new per-repo relevance signal that directly informs suppression and reinforcement in future review runs. See `agents/shared/rules/comment-relevance-memory.md § Write — What reviewer / pr-reviewer write`.

---

## Promotion decisions

Promotion reads from the `review-outcomes` bus as its primary input.
The full promotion threshold and directionality are defined in [`review-outcomes.md § Promotion rule`](./review-outcomes.md#promotion-rule):
≥ 3 concordant verdicts for the same fingerprint class promote to an active lesson.

When promoting:

**Lesson record shape.**
Every `reviewer-lessons` write conforms to the shared lesson-scope schema owned by [`write-pipeline.md § Lesson-scope entries`](../../../skills/authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries), via the [`lesson-entry.md`](../../../skills/authoring/persistent-memory/templates/lesson-entry.md) template.
The `value` MUST carry `trigger-context` (a concrete matching signal — a file glob, task type, or integration/tech name, never a subjective condition), `expires` (ISO 8601, default now + 90 days, refreshed on each re-sighting), `seen_count`, and `status`.
`trigger-context` is what lets the `pr-reviewer` read step match a lesson mechanically against a run (`pr-reviewer.md` Step 0.7 / Step 1.0); `expires` is entrenchment guard #3 — without it a stale lesson never decays.
A write missing either field is malformed.

### From `applied` verdicts (positive lesson)

Write to `reviewer-lessons` via LoreKit:

```
memory.write { scope: "global", key: "reviewer-lessons::<slug>", value: "<body>", tags: ["loop::reviewer-lessons", "source::outcome-applied"] }
```

Lesson body: "Pattern [fingerprint class] reliably gets resolved — [short description]. Reinforce detection."

### From `rejected-at-validation` or `reverted-after-ci` verdicts (noise/negative lesson)

```
memory.write { scope: "<global | repo::{owner}/{repo}>", key: "reviewer-lessons::<slug>", value: "<body>", tags: ["loop::reviewer-lessons", "source::outcome-rejected"] }
```

Lesson body: "Pattern [fingerprint class] was rejected/reverted [N] times — over-flagging pattern: [short description]. Add to `filters:` in `.github/review.yaml` or lower confidence threshold."

Classify the scope: if the pattern is universal (e.g. "null-check assertions in safe-context `!` non-null assertions"), write to `global`; if repo-specific (e.g. "this repo's `EnsureMcpIntegrationId` is always guaranteed non-null by construction"), write to `repo::{owner}/{repo}`.

### From gh-api signals (fallback write path)

When gh-api signals are used instead of the bus:

**Noise lesson (signals a or b):** lesson body: "Last run's [category] comment on [path]:[line] was dismissed/challenged — over-flagging pattern: [short description of what was flagged]. Consider lowering confidence or using `question:` framing in [context]."

**Resolution lesson (signal c):** UPDATE the existing lesson entry (if one exists for this pattern) with `seen_count` incremented.
See the existing promotion contract in `skills/authoring/persistent-memory/rules/write-pipeline.md` for the `seen_count` UPDATE sentence — do not restate it here; follow the contract as documented there.
Resolution signal (c) is an **additional trigger** for promotion alongside `seen_count`: a lesson that accumulates ≥ 3 resolution confirmations is promoted even if `seen_count` has not reached the standard threshold.

**Detection candidate lesson (Step 5):** lesson body: "Human reviewer caught [pattern] on [path]:[line] that was not flagged — detection candidate: [short description]. Add to rubric or lower confidence threshold for this class."

---

## Outcome-driven promotion

The standard promotion gate (`seen_count ≥ 3`) remains unchanged for pattern-based lessons.
Outcome signals add a parallel gate:

| Condition | Promotion action |
| --- | --- |
| ≥ 3 `applied` verdicts from `review-outcomes` (same fingerprint) | Promote to `reviewer-lessons` — this pattern reliably gets fixed |
| ≥ 3 `rejected-at-validation` or `reverted-after-ci` verdicts (same fingerprint) | Promote as a **noise pattern** — consider adding to a `filters:` entry in `.github/review.yaml` |
| ≥ 3 gh-api signal (c) resolution confirmations (fallback path) — each **corroborated** per *Signal (c) requires corroboration*; indeterminate touches never count | Promote to `diagnose` slow tier — pattern reliably gets fixed |
| ≥ 3 dismissals via gh-api signal (a) (same pattern, fallback path) | Promote as a **noise pattern** — consider `filters:` suppression |
| ≥ 2 human-catch candidates of the same class | Surface as a detection candidate to the user; suggest rubric expansion |

---

## What this does not change

- The existing `reviewer-lessons` fast-tier read/write contract in `pr-reviewer.md` Step 0.7.
- The `seen_count` UPDATE contract (schema owned by `persistent-memory/rules/write-pipeline.md`; the loops persist it on LoreKit).
- The two-scope lesson storage model (`global` vs repo-specific `repo::{owner}/{repo}`).
- The per-comment confidence threshold (still 80 — outcome signals inform lessons, not the per-run gate).

Outcome learning is an **async improvement loop**, not an in-run gate.
It runs after the PR closes, not during the review.

---

## What this rule does not do

- Own the bus schema, fingerprint formula, TTL, or consolidation cadence — those live in `review-outcomes.md`.
- Re-run or re-score in-flight comments based on outcomes.
- Change how the review is posted — `pr-reviewer` posts one visible `COMMENT` review at Step 4, and this rule runs post-merge, never at posting time.
- Access private PR data beyond what the `gh` CLI exposes to the authenticated user.
- Load `review-outcomes` into the per-review context (Step 0.7) — that is explicitly forbidden.
