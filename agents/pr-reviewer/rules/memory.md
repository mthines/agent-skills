---
title: Memory — cross-branch, cross-author review memory
impact: HIGH
tags:
  - pr-reviewer
  - lorekit
  - memory
---

# Memory

The reviewer's memory exists to answer one question on every PR: **what does this repository already know about the code this diff touches?**
Not "what did I say on this branch" — that is the PR-state record, a different thing entirely — but what any PR, on any branch, by any author, taught the reviewer about these symbols and these files.

That framing is what makes the keys structural.
A memory keyed by branch dies with the branch. A memory keyed by comment prose re-keys on every re-phrasing and accumulates nothing.
A memory keyed by `symbol@path` survives both, and is available to the next author who touches that symbol.

The lifecycle below — candidate accumulates signal, promotes to active, auto-disables on consistent
negative signal, with an explicit `remember` for direct teaching — follows Cursor's learned rules
([Bugbot learning](https://cursor.com/blog/bugbot-learning)), and the addressed-between-commits
outcome signal follows Greptile
([memory and learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning)).
The structural key is the deliberate departure: both of those are per-repository and prose-keyed, so
a re-phrased finding starts over. See [`references/detection-research.md`](../references/detection-research.md).

## Contents

- [The four records](#the-four-records)
- [One fingerprint, and where it comes from](#one-fingerprint-and-where-it-comes-from)
- [Read — two calls, keyed by the impact graph](#read--two-calls-keyed-by-the-impact-graph)
  - [The read budget is fixed, and it is these two calls](#the-read-budget-is-fixed-and-it-is-these-two-calls)
- [Every read filters on `source.agent`](#every-read-filters-on-sourceagent)
- [A knowledge fact is re-verified or dropped, never trusted](#a-knowledge-fact-is-re-verified-or-dropped-never-trusted)
- [Suppression happens after verification, never before](#suppression-happens-after-verification-never-before)
- [Two findings memory may never suppress](#two-findings-memory-may-never-suppress)
- [Lifecycle is computed at read time](#lifecycle-is-computed-at-read-time)
- [In-run signals](#in-run-signals)
- [`/pr-review remember` — an explicit instruction needs no corroboration](#pr-review-remember--an-explicit-instruction-needs-no-corroboration)
- [Lessons ∩ rules cross-check](#lessons--rules-cross-check)
- [Write — the two calls this agent makes itself](#write--the-two-calls-this-agent-makes-itself)
- [Write budget](#write-budget)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## The four records

| Record | Tag / key | Scope | TTL | Holds | Can it suppress? |
| --- | --- | --- | --- | --- | --- |
| **Symbol knowledge** | `ci::review-knowledge` / `knowledge::<symbol>@<path>` | `repo::{owner}/{repo}` | 90 d | verified facts about one symbol — contracts, invariants callers rely on, consumer count at last trace, covering tests — each with `verified_at_sha`; plus `history[]` of findings raised on it (`{pr, sha, fp, verdict, outcome}`, capped at 20) | No |
| **Hotspot** | `ci::review-knowledge` / `hotspot::<path>` | `repo::{owner}/{repo}` | 90 d | per-file counters: `confirmed`, `missed` (a human caught something here that this agent did not flag), `regressed`, `last_touched_by[]` | No |
| **Relevance rule** | `loop::reviewer-comment-relevance` / `reviewer-comment-relevance::rule::<fp>` | `repo::{owner}/{repo}` | 60 d | `direction: suppress \| amplify`, `status`, `evidence[]`, optional `scope_globs[]` | Yes — and only this one |
| **PR state** | `ci::pr-review-state` / `ci-state::pr-review-<n>` | `branch::{owner}/{repo}::{head-branch-name}` | 7 d | this agent's own run history for one PR | No |

**The keys are quoted exactly, prefix included.** Only the relevance rule carries a bucket prefix, and the asymmetry is not decoration: its key space is shared with the v1 prose rows (`reviewer-comment-relevance::<gist>`), so `…::rule::` is the segment that separates the promotable half from the legacy half — `scripts/record-comment-relevance.mjs § writeRelevance` is the implementation and this table follows it, never the reverse. Knowledge and hotspot need no prefix because their bucket is identified by the `ci::review-knowledge` tag. A `memory_read` issued against `rule::<fp>` — the prefix dropped — returns nothing, indistinguishably from a repo that has never declined that finding.

**`{head-branch-name}` is the branch name, never a SHA.** `STATE_SCOPE` is bound from `headRefName` at Step 0.5 for that reason. A SHA-keyed scope mints a fresh scope on every push, so the record is written once and never found again: every re-review reads a miss, takes the first-run path, and silently loses its delta baseline, its carry-forward, and `LAST_FULL_SHA`. That failure is not hypothetical — a `branch::…::570ee7e8…` scope holding exactly one row is what it looks like in a store.

The first three are `repo::`-scoped **on purpose**: their entire value is that they outlive the branch.
The fourth is `branch::`-scoped for the opposite reason — per-PR state in `repo::` would displace the lessons a SessionStart injection exists to deliver.
The full taxonomy, with the other thirteen buckets, is [`memory-buckets.md`](../../shared/rules/memory-buckets.md).

Knowledge and hotspot records are **facts, not advice**.
They are parsed and branched on, never weighed. That is why they are not lessons and why the entrenchment guards that govern lessons do not apply to them — the guards that do apply are bounded cardinality, no secrets, an explicit TTL, and re-verification before use.

## One fingerprint, and where it comes from

```text
fp   = <finder>:<defect-class>:<symbol>@<path>
fp_v = 2

# e.g.
consumer-impact:contract-break:retryRequest@src/api/client.ts
correctness:nil-deref:-@src/jobs/sync.ts          # `-` = a whole-file finding
```

- `finder` and `defect-class` come from the candidate record the finder emitted, so both are **enumerable**, not free text.
- `symbol` is the changed export the finding is about, taken from `impact.json`; `-` when the finding is not about one symbol.
- `path` is repo-relative.

**Never compose a fingerprint by hand.**
[`scripts/fingerprint.mjs`](../scripts/fingerprint.mjs) is the single implementation, and it is executable:

```bash
# Build one (validates finder + defect-class against the enums; exits non-zero on an unknown value)
node agents/pr-reviewer/scripts/fingerprint.mjs build \
  --finder consumer-impact --defect-class contract-break \
  --symbol retryRequest --path src/api/client.ts

# The invisible marker that goes at the end of an inline comment body
node agents/pr-reviewer/scripts/fingerprint.mjs marker \
  'consumer-impact:contract-break:retryRequest@src/api/client.ts'
#   → <!-- fp:v2:consumer-impact:contract-break:retryRequest@src/api/client.ts -->

# Recover one from a comment body, whatever version it was written at
node agents/pr-reviewer/scripts/fingerprint.mjs extract --file /tmp/comment.md
```

Two consequences of it being one file, both load-bearing:

- The recorder (`scripts/record-comment-relevance.mjs`) imports it rather than re-deriving, so the write path and the read path cannot fork into two key spaces for the same finding. That fork is not hypothetical — it is exactly what the prose-keyed v1 space suffered.
- A formula change bumps `fp_v` and re-keys **explicitly**. `fp_v: 1` rows are still read for back-compat; they are never written, and they are never promotable (see [Lifecycle](#lifecycle-is-computed-at-read-time)).

Every inline comment this agent posts carries its own fingerprint as an HTML comment.
That marker is also the **attribution**: only this agent writes it, so its presence identifies the author with no login configuration at all — which matters because the bot login is unresolvable on access paths where `/user` returns 401.

## Read — two calls, keyed by the impact graph

Memory is read **after** Phase B, because Phase B is what tells you which symbols and files to ask about.
Reading before it means asking for the whole `repo::` scope and paging through noise.

```text
# 1. The knowledge + hotspot records for this repo. Tag-filtered, not just kind/host.
mcp__lorekit__memory_list    scope="repo::{owner}/{repo}"  tags=["ci::review-knowledge"]  kind=signal  host=reviewer  limit=50

# 2. A targeted search on the symbols the impact graph says changed.
mcp__lorekit__memory_search  q="<symbol> <symbol> <symbol>"  scopes=["repo::{owner}/{repo}"]  limit=25
```

**The parameter names above are the tool's own, and the two tools disagree on purpose.** `memory_list` takes one `scope` (a string); `memory_search` takes `scopes` (an array) and puts the query in `q`. A call written as `memory_search scope=… query=…` — the shape a reader naturally generalises from call 1 — matches nothing in the schema and comes back a validation error, which this pipeline has no rung for: memory is a best-effort read, so the run continues and reports 0 memories applied. That is indistinguishable from an empty store, which is why the names are pinned here and guarded by L1 rather than left to be re-derived per run.

**`tags` on call 1 is what makes its one page selective, and the tag is not redundant with `kind`/`host`.** Relevance rules carry the same `kind: signal, host: reviewer` as knowledge and hotspot, so a `kind`/`host` filter alone returns both buckets mixed — and they grow at wildly different rates: one row per traced symbol versus one row per resolved thread, forever. Measured on `repo::mthines/agent-skills`, an untagged call returned **48 legacy relevance rows and 2 knowledge rows in its 50 slots**, and the knowledge rows only made the page because they were the two most recently written; `order` defaults to `recency`, so a symbol traced last month is simply not in the page. The tag costs nothing, changes no call count, and turns "the top 50 rows in the scope" into "the knowledge bucket".

Relevance rules are **not** read here. They have their own tag-filtered pair of calls at Step 1.0 ([`comment-relevance-memory.md § When to read`](../../shared/rules/comment-relevance-memory.md#when-to-read)), and the untagged call was silently duplicating that read while crowding out the records it was itself for. Do not add a call here to fetch them.

Two calls, matching the two the agent already makes for lessons — pointed at better data, not added on top.
On a repo whose `repo::` scope exceeds the `memory_list` page, the search is what finds the record for a symbol that is not in the top 50; neither call alone is sufficient.

### The read budget is fixed, and it is these two calls

"Keyed by the impact graph, never paging the whole scope" is a **bound**, not an aspiration, so it is written as one:

| Rule | Value |
| --- | --- |
| calls per run | exactly **2** — the `memory_list` above and the `memory_search` above |
| `memory_list` page | `limit=50`, **one page** |
| `memory_search` page | `limit=25`, **one page** |
| symbols in the search query | the **top 10** changed symbols by `blast_radius`, from `impact.json` |
| pagination | **never.** No cursor is followed, on either call |

A third call, a followed cursor, or an unbounded query is the failure this section exists to prevent, and it fails in a way nothing downstream notices: the review still runs, having spent its context on records for code the diff does not touch.
When a symbol the impact graph named is not in either page, it has **no memory this run** — that is a miss, and a miss costs nothing, because [a knowledge fact is re-verified or dropped, never trusted](#a-knowledge-fact-is-re-verified-or-dropped-never-trusted) anyway.
Widening the read to chase it trades a bounded cost for an unbounded one to acquire a hint the pipeline is required to re-derive regardless.

The one permitted extra read is the **per-PR state record** (Step 0.7), which is a different scope (`branch::`), a different question, and already exactly one call.

Then match:

| The impact graph says | Look up | The finders receive |
| --- | --- | --- |
| `retryRequest@src/api/client.ts` changed signature | `knowledge::retryRequest@src/api/client.ts` | the recorded contract to check callers against, plus `history[]` — "#98 raised `contract-break` on `sync.ts:88`, fixed in `a1b2c3d`" |
| `src/api/client.ts` is in the delta | `hotspot::src/api/client.ts` | a checklist line: "history: 6 defects here in 90 d, classes: nil-deref, contract-break" |
| a candidate's `fp` matches an `active suppress` rule | `rule::<fp>` | nothing at find time — suppression is applied later, see below |
| a candidate's `fp` matches an `active amplify` rule | `rule::<fp>` | a focus line, and the verifier's threshold for that `fp` drops one notch |
| a human previously caught something on this file | `hotspot::<path>` `missed[]` | the human's comment text as a checklist line: "a reviewer previously caught: …" |

## Every read filters on `source.agent`

```jsonc
// Keep
{ "source": { "login": "…", "type": "bot", "agent": "pr-reviewer" } }
{ "source": { "login": "a-maintainer", "type": "human", "agent": "other", "explicit": true } }

// Read for hotspot counters, but NEVER as a relevance rule
{ "source": { "login": "some-other-bot", "type": "bot", "agent": "other" } }
{ "source": { "login": "a-human",        "type": "human", "agent": "other" } }
```

Another bot's declined finding says nothing about which of **this** agent's findings a repo accepts: it has its own bar, its own noise, and its own false-positive profile.
A human's own review comment is not a verdict on this agent's output either.
Both are still valuable as hotspot signal — someone found something here — so they are stored and counted; they simply never train this agent's suppressor.

The predicate, stated once so the read path has something to implement:

```text
usable as a relevance rule  ⇔  source.agent == "pr-reviewer"  ∨  source.explicit == true
```

`source.explicit: true` is the **only** carve-out, and it means one thing: a maintainer wrote this
rule by [`/pr-review remember`](#pr-review-remember--an-explicit-instruction-needs-no-corroboration)
— an instruction — rather than leaving a review comment this agent inferred a preference from.
The flag is what makes the two distinguishable at read time.
Without it the two records are byte-identical (`type: human`, `agent: other`), the filter drops
both, and every `remember` rule a maintainer writes is stored where nothing will ever read it —
a silent no-op that looks like a successful write.
Absent or `false` ⇒ not usable; a `remember` write that omits it has failed, whatever the tool
returned.

## A knowledge fact is re-verified or dropped, never trusted

Before a knowledge fact is used in a finding, compare the file's state at `verified_at_sha` to the head:

1. **File unchanged since `verified_at_sha`** → the fact stands. This is the case memory exists to make cheap.
2. **File changed** → re-verify against the code, at Tier 1 or 2 of [`verify-behavior`](../../../skills/quality/verify-behavior/SKILL.md) (one `rg`, or one read). Confirmed → use it and rewrite the record at the new SHA. Contradicted → drop the fact, rewrite the record without it.
3. **Cannot re-verify within the budget** → drop the fact **for this run**. Do not use it, and do not delete it.

```text
✅ RIGHT
   knowledge says `retryRequest` throws `RetryExhausted` after 3 attempts (verified at a1b2c3d)
   → client.ts changed in this PR → re-read the retry block → still 3 attempts
   → finding: "sync.ts:88 catches TimeoutError, not RetryExhausted" with a fresh receipt

❌ WRONG
   knowledge says `retryRequest` throws `RetryExhausted` after 3 attempts (verified at a1b2c3d)
   → client.ts changed in this PR → post the finding citing the record
   → the PR changed the retry contract; the finding describes code that no longer exists
```

This is the whole reason memory is safe to read on every run: **it accelerates verification, it never substitutes for it.**
A memory-grounded finding still needs its own receipt, exactly like an unremembered one.

## Suppression happens after verification, never before

An `active suppress` rule is applied at the verifier's placement step — **after** the candidate has been verified — never at find time.

The difference matters more than the ordering suggests.
Suppressing before verification drops a candidate nobody looked at, on the strength of a fingerprint match, and the run has no idea whether it just dropped a real defect.
Suppressing after verification drops a **verified** finding the repo has repeatedly said it does not want, which is a legitimate maintainer preference and is recorded as one.

Every suppression is logged into the report's `Memory` block with the rule id and its evidence PRs.
A suppression that cannot name its evidence is a bug, not a preference.

## Two findings memory may never suppress

1. **A `standards` finding.** The repo's own written rule outranks its reviewers' fatigue. If a governing doc says "no `any`", repeated dismissals of `no any` findings are a signal to change the doc, not to stop enforcing it — and this agent is not the thing that decides that.
2. **A `(blocking)` finding.** It posts, always. The rule match is surfaced instead of applied: "previously declined on #88, #91 — re-raised because blocking."

```text
❌ WRONG — a suppress rule silences a blocking finding, and the report shows nothing
✅ RIGHT — the finding posts, and the rule match becomes part of its evidence line
```

## Lifecycle is computed at read time

`status` is written as an **advisory snapshot only**. The reader recomputes it:

| Computed status | Condition |
| --- | --- |
| `candidate` | fewer than 3 concordant signals, **or** signals from a single PR |
| `active` | ≥ 3 concordant signals from **≥ 2 distinct PRs** (from `evidence[]`) |
| `disabled` | an otherwise-`active` rule carrying ≥ 2 contradicting signals |
| (gone) | past TTL — LoreKit expires it |

Recomputing rather than trusting the stored field is what makes a failed read-modify-write harmless: LoreKit increments `seen_count` server-side on a re-write of the same key, and `evidence[]` carries the distinct PRs, so a write that lost a race cannot reset a lifecycle or promote a rule early.

Two distinct PRs is the bar because **one author having a bad day is not a repository preference**.
Three dismissals on one PR is one person's afternoon; three across two PRs is a pattern.

A `fp_v: 1` record is never promotable however many signals it accrues — a prose-derived key wobbles, so its `seen_count` is not a count of one thing.

## In-run signals

At Step 1.0, for every inline comment on **this** PR carrying this agent's marker:

| Signal | Reading | Write |
| --- | --- | --- |
| 👎 on the root comment, from anyone with write access | not useful | rule evidence toward `suppress` |
| 👍 or 🎉 on the root comment | useful | rule evidence toward `amplify`; knowledge `history[].outcome = accepted` |
| First non-author reply reading as `disagree` / `not-a-bug` | wrong here | rule evidence toward `suppress`, **with the reply text stored as `reason`** so the next run can show *why* |
| First non-author reply reading as `agree` / `will-fix`, or a later commit touching `(path, line ± 5)` that resolves the thread | right | rule evidence toward `amplify`; knowledge `history[].outcome = fixed` |
| Thread resolved with no reply and no touching commit | **ambiguous** | no directional write — a counter only |
| A human comment on a changed line this agent did not flag | missed | hotspot `missed[]`, plus a `detection::` lesson candidate |

The ambiguous row is the one to hold onto.
A thread resolved with nothing to corroborate it is not evidence of acceptance and not evidence of dismissal, and the earlier `ignored-at-merge` sweep that read it as dismissal was writing a directional signal on no evidence.
Where the evidence cannot decide, **write nothing** — silence costs one signal, a wrong signal trains the suppressor against a class nobody rejected, durably.

The same rule, applied to the webhook write path, is [`comment-relevance-memory.md`](../../shared/rules/comment-relevance-memory.md); the recorder is `scripts/record-comment-relevance.mjs` and its decision tables are self-tested.

## `/pr-review remember` — an explicit instruction needs no corroboration

A maintainer commenting `/pr-review remember <fact>` on a PR writes a `repo::` rule immediately, `status: active`, `source: { type: "human", agent: "other", explicit: true }`.

`explicit: true` is **required**, not decorative: it is the discriminator the
[`source.agent` filter](#every-read-filters-on-sourceagent) keys the carve-out on, and a rule
written without it is dropped on every subsequent read.

| Wording | `direction` | `scope_globs[]` |
| --- | --- | --- |
| "don't flag …", "stop flagging …", "we don't care about …" | `suppress` | the commenting file's directory glob, when the comment is on a file |
| "always check …", "watch for …", "this repo cares about …" | `amplify` | none unless the wording names a path |

No corroboration threshold applies: a maintainer saying "don't flag this" **is** the evidence, and requiring three PRs' worth of it would be requiring them to say it three times.
The two never-suppress exemptions above still hold — a human cannot `remember` away a blocking finding or a standards violation, because those come from the repo's own written rules and the remedy is to change them.

## Lessons ∩ rules cross-check

`reviewer-lessons` stay advisory, read as today, and are **never written in-run** — that contract is unchanged.
Two additions:

- **The cross-check.** A matched lesson whose body names a path, symbol, or `fp` covered by an `active suppress` rule is handed to the finders as background **with the contradiction stated** — never silently dropped, never applied raw. A lesson minted from a finding that was later rejected must not outlive the rejection, and stating the conflict is how the finders get to weigh both.
- **`detection::` trigger-context.** A lesson about a missed or false finding is tagged `detection::<finder>`, so the promotion loop can tell detection lessons from harness plumbing, and so each promoted one becomes a seeded case in the `bug-detection` eval suite.

## Write — the two calls this agent makes itself

A budget without a call site is a bucket with no producer, and a bucket with no producer reads empty forever while every rule about reading it still passes.
That is what happened here: knowledge and hotspot had a documented read, a documented match table, and a documented cap, and the only committed writer in the tree was the webhook recorder — which writes `hotspot::` and never `knowledge::`.
So a repo could accumulate hundreds of relevance rows and still answer *nothing* to "what does this repository know about `retryRequest`", because no run had ever been told to say.

Both writes happen at **Step 4d**, after the state write, and both are subject to the [budget](#write-budget) below.

```text
# A. Symbol knowledge — deep tier only, one call per traced symbol, cap 10.
mcp__lorekit__memory_write:
  scope    = "repo::{owner}/{repo}"
  key      = "knowledge::<symbol>@<path>"        # from impact.json — never hand-composed
  value    = "<the JSON record below, serialised>"
  tags     = ["ci::review-knowledge"]
  kind     = "signal"
  host     = "reviewer"
  ttl_days = 90
  origin_repo = "<RESOLVED_REPO>"   origin_pr = <PR_NUMBER>   origin_commit = "<HEAD_SHA>"

# B. Hotspot — one call per file that carried a confirmed finding this run.
mcp__lorekit__memory_write:
  scope    = "repo::{owner}/{repo}"
  key      = "hotspot::<path>"
  value    = "<{v:1, path, confirmed:1, last_touched_by:[…]}, serialised>"
  tags     = ["ci::review-knowledge", "signal::confirmed"]
  kind     = "signal"
  host     = "reviewer"
  ttl_days = 90
```

`kind` and `host` are passed **explicitly on every write**. LoreKit infers them from a `loop::` tag only, and these records carry `ci::` tags, so omitting them leaves both NULL — at which point [read call 1](#read--two-calls-keyed-by-the-impact-graph), which filters `kind=signal host=reviewer`, cannot see the record the run just wrote. A write nothing can read is worse than no write: it reports success.

The knowledge record's value:

```jsonc
{
  "v": 1,
  "symbol": "retryRequest",
  "path": "src/api/client.ts",
  "kind": "function",
  "verified_at_sha": "26b4c28",
  "facts": [
    { "claim": "throws RetryExhausted after 3 attempts", "tier": 2 },
    { "claim": "callers rely on the thrown error, not a null return", "tier": 1 }
  ],
  "consumer_files": 14,
  "cross_package": true,
  "covering_tests": ["src/api/client.test.ts"],
  "history": [
    { "pr": 164, "sha": "26b4c28", "fp": "consumer-impact:contract-break:retryRequest@src/api/client.ts",
      "verdict": "confirmed", "outcome": "posted" }
  ]
}
```

Four rules on the knowledge write, each closing a way this record could become a liability:

1. **Only what this run verified.** A `facts[]` entry carries the receipt tier that produced it ([`verification-receipt.md`](../../shared/rules/verification-receipt.md)). A claim the run inferred but did not check is not a fact and is not written — the next run would consume it as one, and [re-verification](#a-knowledge-fact-is-re-verified-or-dropped-never-trusted) only compares it against the code, it does not re-derive whether it was ever true.
2. **`verified_at_sha` is this run's `HEAD_SHA`, always.** It is the whole mechanism by which the next run decides between "the fact stands" and "re-verify" — a stale or absent sha makes every fact permanently unverifiable, and rule 3 of that section then drops it on every future run.
3. **Merge, never clobber.** Same scope + key is an UPDATE, so read the existing record first (it is already in hand from call 1) and append to `history[]` — capped at 20, oldest dropped. Overwriting it throws away the cross-author history that is the point of the record.
4. **Facts about code, never about people or telemetry values.** No login, no comment text, no raw span attribute (`telemetry.md § Three rules that hold everywhere`, rule 3). A `traffic_band` and a `sampled_at` are aggregates and may be cached here; a request body may not.

**Neither write is on the critical path.** A failure is logged and the run continues, exactly as the state write's rule 1 has it. Report the count in Step 5 — a run that wrote 0 knowledge records on a deep tier is a fact worth seeing, because it means either nothing was traced or the write is broken, and those look identical from the store.

**The relevance rule is written at Step 2.9c, and its key is recovered rather than composed.** That write belongs to [`thread-resolution.md § Write the outcome to LoreKit`](../../shared/rules/thread-resolution.md#write-the-outcome-to-lorekit) — it fires on a re-review, once per thread this run resolved, and it takes the fingerprint out of the comment's own `<!-- fp:v2:… -->` marker. Nothing here re-derives a key from prose: a run that files its own marker-bearing finding under a prose gist writes into the non-promotable half of the bucket, where `seen_count` cannot accumulate and no suppression can ever arm.

The [in-run signals](#in-run-signals) at Step 1.0 are the *evidence* that write carries, not a second write of their own.

## Write budget

| Write | When | Cap |
| --- | --- | --- |
| knowledge | per traced symbol, **deep tier only** | 10 per run |
| hotspot | per file with a confirmed finding | one per file |
| relevance rule | Step 2.9c, per thread resolved this run | one per thread |
| PR state | Step 4c | one per run |

Reads: the two Phase B calls, plus at most `MEMORY_READ_BUDGET` body reads, prioritised **knowledge → rules → hotspots → lessons**.

Every write is idempotent by key and carries `origin_pr` / `origin_commit`, so a re-run does not double-count.
Report the read count and the unread remainder in the `Memory` block — a budget that silently truncates is indistinguishable from a memory that is empty.

## What this rule does not do

- **It does not lower a severity tier.** Amplify lowers a *verifier threshold*, which decides whether a finding survives; it never changes what the finding is. Severity comes from the `severity` skill, on the code.
- **It does not write lessons.** All `reviewer-lessons` writes flow through [`outcome-learning.md`](../../shared/rules/outcome-learning.md) after the PR closes.
- **It does not delete anything.** `mcp__lorekit__memory_delete` is deliberately absent from this agent's `tools:` grant. Records lapse at TTL; a rule that should stop firing goes `disabled`, which is a write, not a delete.
- **It does not treat an empty record as evidence of safety.** No knowledge record for a symbol means nobody has traced it yet. No hotspot counter means no defect has been *recorded* there. Neither is a reason to look less hard.
