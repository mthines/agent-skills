# pr-reviewer agent body — rationale

Why the rules in [`agents/pr-reviewer.md`](../../pr-reviewer.md) are shaped as they are. A run never
needs this file; read it when changing one of those rules.

## Contents

- [Why the report is a sticky and state is a record (intro)](#why-the-report-is-a-sticky-and-state-is-a-record-intro)
- [Locating the support tree](#locating-the-support-tree)
- [Budgets (Stop conditions)](#budgets-stop-conditions)
- [Deep-lens refresh (Run modes)](#deep-lens-refresh-run-modes)
- [Step 0 flag bindings](#step-0-flag-bindings)
- [Step 0.5 identity](#step-05-identity)
- [Step 3 — one terminal template](#step-3--one-terminal-template)
- [Step 3.5 — anchorless findings](#step-35--anchorless-findings)
- [Step 5 — reporting every write](#step-5--reporting-every-write)
- [What this agent does not do](#what-this-agent-does-not-do)

## Why the report is a sticky and state is a record (intro)

The report is a snapshot of current state, so it is edited rather than re-posted — a PR carrying six
copies of it shows a reader the oldest one first. Inline comments are conversation anchors whose
state lives in resolve/reply, so they accumulate and are never rewritten. The agent's own run
state is neither: it is machine-private, read only by this agent's next run, so it lives in a
per-PR LoreKit record (Step 0.7) rather than in a hidden block at the bottom of the report.

You succeed when you prevent a not-ready PR from consuming reviewer attention.
You fail when a flawed PR passes your checks and lands on a human.
You raise the quality floor; you do not replace human review.

## Locating the support tree

`resolve()` chases symlinks to the end, so under the repo's install convention `AGENT_SUPPORT`
lands on this repo's own `agents/` directory and the whole tree is reachable. Shell state does not
survive between tool calls, so **print the value and reuse the printed string** in every later
`Read` — `Read "$AGENT_SUPPORT/pr-reviewer/rules/workspace.md"` — and re-run the block verbatim in
any later *Bash* call that needs it (Steps 1.2, 2.8/2.9, 4a, 4b all do).

**Never probe the un-resolved install path.** `$HOME/.claude/agents/pr-reviewer/…` is one symlink
hop away from the real tree and typically does not exist as a directory at all; an `ls` or `[ -f ]`
against it is not a test of whether the support tree is present, and **an ENOENT there is not
evidence of anything.** A run that probed it, took the miss at face value, and abandoned the
renderer produced no sticky at all and hand-wrote its report into the terminal instead — the
failure this whole section exists to prevent. `resolve()` is the only admissible test.

**When `AGENT_SUPPORT` genuinely does not resolve** (empty `AGENT_MD`): this is a degraded run and
must be announced as one, never absorbed. Say `Support tree unresolved — <what was tried>.`, name
what is lost (Phases A–F run on their rule files; Step 4a hard-stops per its own contract), and do
**not** substitute improvised prose for any artifact the renderer owns. A caller dispatching this
definition by file path rather than by install convention — e.g. a harness whose `Task` tool has no
named `subagent_type="pr-reviewer"` and so hands a generic sub-agent a "read this file and follow
it" prompt, which is how Dash0 Agent0 automations invoke this agent — is not on the install path
and **MUST** export the anchor before Step 0:


Without it the support tree is unreachable, the report format is no longer deterministic, and every
guarantee in *REPORT_BODY format (the sticky comment)* below is void for that run.

## Budgets (Stop conditions)

The two state calls are fixed cost and never traded against `MEMORY_READ_BUDGET`: the state read
is what makes the run incremental at all, and the state write is what makes the *next* run
incremental. A read budget spent is this run's context, a write skipped is every future run's
memory, so a run that trims Step 4d to stay under a read cap has optimised the wrong side of the
ledger. Step 1.2d takes at most half of the pool so a lesson-heavy shortlist can never starve the
relevance verdicts that decide what gets posted. The reads trade call count for context — the four
lists are summary-only (~15 KB for a typical fan-out instead of ~110 KB), and only shortlisted
entries are ever expanded.

## Deep-lens refresh (Run modes)

**Deep-lens refresh (why the last three `full` triggers exist).** Once a prior review exists, every re-run is incremental by default, and incremental modes skip the holistic passes (2.4 / 2.4b) — the only lenses that trace the whole change for cross-cutting consistency. On a PR that lands as a long series of small commits, that means the deep lenses run exactly once (the first review) and never again, so a defect class spanning several files, or a contradiction introduced by a later commit, surfaces only when a delta happens to brush against it — one instance at a time, review after review. The three refresh triggers stop that: a re-review is promoted back to `full` when enough has accumulated since the last full pass (`FULL_REFRESH_DELTA` cumulative lines or `FULL_REFRESH_RUNS` incremental runs), and always when no prior full review is detectable at all. `FULL_REFRESH_DELTA` and `FULL_REFRESH_RUNS` are the two tunable constants; raise them to spend fewer deep passes, lower them to refresh sooner.

## Step 0 flag bindings

`$FLAG_FULL` is read downstream as an executable variable (Step 0.7's mode rule, Step 0.8's
fast-path gate) rather than left as flag-table prose — an unbound `$FLAG_FULL` would let Step 0.8
downgrade a `--full` run on an unmoved head to `incremental-quick`. `--dry-run` and `--isolated`
bind the same way, for the same reason; `rules/pipeline.md` owns their full semantics.
`prepare-review.mjs`/`finalize.mjs`/`execute-write-plan.mjs` each re-derive and enforce the
`--review-sha` refusal from their own inputs (`rules/pipeline.md#--review-sha`); the Step 0 binding
exists so a run invoked with the wrong flag combination stops at Step 0 rather than mid-pipeline.

Resolving the support tree at Step 0.1, **before** Step 0.5, means a degraded run is known to be
degraded while there is still nothing invested, rather than discovered at Step 4a with a full set of
findings in hand and every incentive to improvise around it.

## Step 0.5 identity

`/user` 401s under an App installation token or a per-call repo-scoped `gh` wrapper; GraphQL
`viewer` answers for both (`github-access.md § Identity`). One `gh pr view` call yields three values:
the author decides the relation, the head branch is the PR-state record's scope (Step 0.7), and
`headRefOid` is folded in at zero extra cost so Step 0.8's fast zero-delta pre-check has a head SHA
before Step 1 spends anything. `EARLY_HEAD_SHA` is deliberately not `HEAD_SHA`, which Step 1.2 binds
from Step 1.1 command A's own response ("never from a second read").

**An empty `ME` is a supported state, not an error.** It costs exactly one thing — the relation
defaults to `cross`, whose only effect is tone (the pipeline, findings, gates and verdict are
identical in both relations), so the degradation is cosmetic. Announce it as
`Identity unavailable (\`/user\` not reachable on this access path) — assuming relation: cross.`
so the tone choice is explained rather than looking arbitrary.

**Nothing else may key off `ME`.** In particular, prior-run detection (Step 0.7) matches the report
**by its marker, never by author login** — `reviewer-report-ingest.md § Identifying a report` says
so, and an `ME` that silently resolved to `""` is precisely how a login-keyed `select` matches
nothing, reports "no prior review", and posts a second report on a PR that already has one.

## Step 3 — one terminal template

All three presentations share **one** template; only the `**Verdict**` line and the allowed Status
glyphs differ, both tabulated in that file. Three near-copies is what drifted into a remembered
average on the posted body before `render-report.mjs` took that over; terminal output has no
renderer, so one copy is the guard.

## Step 3.5 — anchorless findings

**`ANCHORLESS-BY-CONSTRUCTION` is a distinct outcome, never a line-validity casualty.** A finding
whose subject file appears in `/tmp/pr-undiffable-paths.json` (Step 1.2) has no RIGHT-side hunk to
anchor to by construction — a binary asset cannot be diffed — so it is not a retargeting failure
and must not be counted or reported as one. Route it straight to the review body's gate-status
table (the Code-review gate's Details cell), the same channel a dropped-list finding uses, and
never post it as a standalone PR-level comment. Keeping this outcome separate from genuine
line-validity casualties keeps that casualty metric meaningful — it should measure anchoring
failures on diffable files, not the structurally-expected gap on binary assets.

## Step 5 — reporting every write

All three writes are reported, since they fail independently (Step 4) and a reader must be able to
tell which one did. `<N>` is the quality-line `posted inline` count (line-level + finder findings).
A run that posted no review must say so
explicitly and name the reason (currently only `nothing new inline`), so a silent run and a broken
run never read the same. When the sticky was **not** updated (§ *When the sticky cannot be
written*), print `REPORT_BODY` verbatim beneath this line — it is the only surface the report
reached, and the reason must be named, never left to read like a run that succeeded.

  The one place a worsened verdict now surfaces, since Step 4b no longer posts a notification-only
  review for it.

## What this agent does not do

- **Edit an inline comment** — inline comments are append-only. Their thread state is the signal `thread-resolution.md` and `comment-relevance-memory.md` learn from; rewriting one destroys that history. Only the sticky report is rewritten.

## Memory model (Step 1.0)

**The two `global` reads use `order="rank"`, the `repo::` reads recency.** The global buckets have
outgrown 50 entries, and a recency-ordered `limit: 50` silently loses the tail — which is exactly
where the oldest, most mature structural lessons sit (observed: the 51st global entry was a
`seen_count=3` structural lesson a single page never returned). Ranked mode returns a bounded
salience+recency top-N with no cursor to forget, so the window holds the *most useful* 50 rather
than the newest 50. The `repo::` buckets are small enough that recency still covers them; switch a
repo read to `rank` only if it, too, reports `hasMore: true`.

**Why `view: "summary"`.** These four calls return up to **200** entries (50 per tag per scope). At
the observed ~1.9 KB median body a saturated fan-out is ~380 KB of context — and even the ~61
entries a typical run actually returns is ~110 KB — spent before the diff has been read, to answer
a question (*which* memories apply to this change) that the key, tags, and preview already answer.
The summary form costs ~250 bytes per entry: ~50 KB saturated, ~15 KB typical. Bodies are fetched
at Step 1.2d, once the changed files and `INTENT_PHRASE` exist to shortlist against.

**Memory model — entrenchment guards and the no-in-run-write choice.**
The lessons read here are advisory input only, protected by five entrenchment guards (`lorekit-setup § Entrenchment guards`):
(1) a lesson biases a run but can never auto-change behavior — the only path to a rule, gate, or threshold change is a human-reviewed source edit;
(2) promotion is gated on recurrence (`seen_count ≥ 3`) or an explicit `status=structural`, never a single run;
(3) every lesson carries an `expires` and expired entries are skipped above, so stale beliefs decay instead of entrenching;
(4) a contradiction (a pattern that flips relevance direction) is surfaced, never silently overwritten;
(5) the privacy pre-flight is never bypassed — a candidate carrying a secret or PII is dropped, not written.
`pr-reviewer` **never writes lessons during a review**, and this is deliberate rather than an omission: it is a fresh-eyes adversarial reviewer, and biasing it with its own single-run conclusions is exactly the self-reinforcing error the guards exist to prevent (`lorekit-setup § When to add a loop`).
Its write signal is *resolution rate measured at merge time* — captured asynchronously by `outcome-learning.md`, the `reviewer-comment-relevance.yml` GitHub Action, and `implement-suggestion` — never by this agent in-run.

**The PR-state record is not a lesson, and Step 4c is not an exception to the rule above.** The
rule exists because a *lesson* written from one run's conclusions biases the next run's judgment —
that is the entrenchment the guards prevent. A state record carries no judgment: it is this run's
own facts (which sha it reviewed, in which mode, which threads were open, which findings it
deferred), parsed and branched on rather than weighed as advice, in a separate bucket
(`ci::pr-review-state`, never `loop::…`) that the lesson read never touches. Distinguishing them
matters practically: a reader who collapses "never writes lessons in-run" into "never writes
in-run" will delete Step 4c and silently take the delta logic with it. The three writes this agent
makes in-run — the state record (Step 4c), the `reviewer-comment-relevance` outcome at Step 2.9c,
and the knowledge + hotspot records at Step 4d — are all records of what happened, never of what it
concluded about how to review.

**Step 4d is the same distinction, one step further out.** A knowledge record says "`retryRequest`
throws `RetryExhausted` after 3 attempts, verified at `26b4c28`" — a fact about the code, carrying
its receipt, which the next run [re-verifies or drops](../rules/memory.md#a-knowledge-fact-is-re-verified-or-dropped-never-trusted)
rather than trusting. It cannot entrench a judgment because it contains none, and it is the one
record that answers the question memory exists for: what does this repository already know about the
code this diff touches. Without it the read side has a match table pointed at rows nothing writes.

The population is fixed by its partner, not chosen here: `MEMORIES_USED_COUNT` is `|MEMORIES_USED|`,
whose entries carry `kind` ∈ `rule` / `knowledge` / `hotspot`, and the two render as a single
`indexed · used` pair that the renderer **fails closed** on when `used > indexed`. Counting only
relevance rows here is therefore not a conservative choice but a report that cannot be produced: a
run that applies a hotspot and a knowledge fact on a repo with no armed relevance rules yields
`0 indexed · 2 used`, `render-report.mjs` exits non-zero with nothing on stdout, and Step 4a's
contract is then to post no report at all. That is the normal adoption shape for a new bucket, so it
would have been the common case.

It is `indexed`, not `read`, because under `SUMMARY_VIEW` these entries were listed but
their bodies were not fetched — calling that "read" would overstate what the reviewer actually
consulted. When `SUMMARY_VIEW` is false the entries genuinely were read in full, but the label
stays `indexed` so the figure means the same thing in every run.

Read it off
  `user.type` from `/tmp/prior-comments.json`, never from a login-pattern guess: a login match once
  reported a human's thread as a bot's (the exact mislabel Gate 3 no longer makes), and a service
  account posting as a `User` is a human as far as this label is concerned.

Using the thread's own words — never the reviewer's summary of another
  bot — means the author reads here exactly what they'll meet when they click through, and the
  reviewer never puts words in another bot's mouth.

**Self-replies do not count.** The rationale for downgrading an answered thread is that
    someone engaged with the ask and only the Resolve click is missing; a bot replying to its own
    thread to restate that the finding still stands satisfies a naive "any author" test while
    falsifying that rationale, and would downgrade a live blocking ask to ⚠️. The one case this
    might seem to lose — a bot superseding or withdrawing its own finding — is already handled
    upstream and better: a bot that withdraws also **resolves** the thread, which removes it from
    `OPEN_BOT_COMMENTS[]` entirely, so it never reaches this test. A self-reply that leaves the
    thread open is, by the authoring bot's own action, still open.

This deliberately narrows the previous rule, which keyed **every** field on `REVIEW_DIFF`: groups 3 and 5 describe PR-level facts, not delta-level ones — a PR that bumped a dependency manifest is still a dependency-bump PR while the reviewer looks at a delta that touches no manifest, and its intent does not change per push.
Scoping them to the delta would drop the manifest and intent tokens on every incremental pass after the first, which is exactly when the diff-keyed search is the reviewer's only chance to surface a lesson Step 1.0's top-50 window missed.

The `limit` is `15` (raised from `10`): search results are already relevance-ranked, so the marginal entries stay on-topic, and the five-field enriched query widens what *can* match — a modest `+5` captures the paraphrase-only and intent-only lessons the new symbol/intent fields surface without materially growing the merged pool the reviewer must weigh. This is independent of Step 1.0's `list` cap of `50`, which is deliberately left unchanged.
