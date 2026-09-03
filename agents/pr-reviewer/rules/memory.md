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

## Contents

- [The four records](#the-four-records)
- [One fingerprint, and where it comes from](#one-fingerprint-and-where-it-comes-from)
- [Read — two calls, keyed by the impact graph](#read--two-calls-keyed-by-the-impact-graph)
- [Every read filters on `source.agent`](#every-read-filters-on-sourceagent)
- [A knowledge fact is re-verified or dropped, never trusted](#a-knowledge-fact-is-re-verified-or-dropped-never-trusted)
- [Suppression happens after verification, never before](#suppression-happens-after-verification-never-before)
- [Two findings memory may never suppress](#two-findings-memory-may-never-suppress)
- [Lifecycle is computed at read time](#lifecycle-is-computed-at-read-time)
- [In-run signals](#in-run-signals)
- [`/pr-review remember` — an explicit instruction needs no corroboration](#pr-review-remember--an-explicit-instruction-needs-no-corroboration)
- [Lessons ∩ rules cross-check](#lessons--rules-cross-check)
- [Write budget](#write-budget)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## The four records

| Record | Tag / key | Scope | TTL | Holds | Can it suppress? |
| --- | --- | --- | --- | --- | --- |
| **Symbol knowledge** | `ci::review-knowledge` / `knowledge::<symbol>@<path>` | `repo::{owner}/{repo}` | 90 d | verified facts about one symbol — contracts, invariants callers rely on, consumer count at last trace, covering tests — each with `verified_at_sha`; plus `history[]` of findings raised on it (`{pr, sha, fp, verdict, outcome}`, capped at 20) | No |
| **Hotspot** | `ci::review-knowledge` / `hotspot::<path>` | `repo::{owner}/{repo}` | 90 d | per-file counters: `confirmed`, `missed` (a human caught something here that this agent did not flag), `regressed`, `last_touched_by[]` | No |
| **Relevance rule** | `loop::reviewer-comment-relevance` / `rule::<fp>` | `repo::{owner}/{repo}` | 60 d | `direction: suppress \| amplify`, `status`, `evidence[]`, optional `scope_globs[]` | Yes — and only this one |
| **PR state** | `ci::pr-review-state` / `ci-state::pr-review-<n>` | `branch::{owner}/{repo}::{head}` | 7 d | this agent's own run history for one PR | No |

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

```bash
# 1. The knowledge + hotspot records for this repo, kind/host filtered.
mcp__lorekit__memory_list  scope="repo::{owner}/{repo}"  kind=signal  host=reviewer  limit=50

# 2. A targeted search on the symbols the impact graph says changed.
mcp__lorekit__memory_search  scope="repo::{owner}/{repo}"  query="<symbol> <symbol> <symbol>"
```

Two calls, matching the two the agent already makes for lessons — pointed at better data, not added on top.
On a repo whose `repo::` scope exceeds the `memory_list` page, the search is what finds the record for a symbol that is not in the top 50; neither call alone is sufficient.

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

// Read for hotspot counters, but NEVER as a relevance rule
{ "source": { "login": "some-other-bot", "type": "bot", "agent": "other" } }
{ "source": { "login": "a-human",        "type": "human", "agent": "other" } }
```

Another bot's declined finding says nothing about which of **this** agent's findings a repo accepts: it has its own bar, its own noise, and its own false-positive profile.
A human's own review comment is not a verdict on this agent's output either.
Both are still valuable as hotspot signal — someone found something here — so they are stored and counted; they simply never train this agent's suppressor.

The one exception is [`/pr-review remember`](#pr-review-remember--an-explicit-instruction-needs-no-corroboration), where a human is deliberately writing a rule rather than incidentally leaving a comment.

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

A maintainer commenting `/pr-review remember <fact>` on a PR writes a `repo::` rule immediately, `status: active`, `source.type: human`.

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

## Write budget

| Write | When | Cap |
| --- | --- | --- |
| knowledge | per traced symbol, **deep tier only** | 10 per run |
| hotspot | per file with a confirmed finding | one per file |
| relevance rule | per in-run signal observed | one per signal |
| PR state | Step 4c | one per run |

Reads: the two Phase B calls, plus at most `MEMORY_READ_BUDGET` body reads, prioritised **knowledge → rules → hotspots → lessons**.

Every write is idempotent by key and carries `origin_pr` / `origin_commit`, so a re-run does not double-count.
Report the read count and the unread remainder in the `Memory` block — a budget that silently truncates is indistinguishable from a memory that is empty.

## What this rule does not do

- **It does not lower a severity tier.** Amplify lowers a *verifier threshold*, which decides whether a finding survives; it never changes what the finding is. Severity comes from the `severity` skill, on the code.
- **It does not write lessons.** All `reviewer-lessons` writes flow through [`outcome-learning.md`](../../shared/rules/outcome-learning.md) after the PR closes.
- **It does not delete anything.** `mcp__lorekit__memory_delete` is deliberately absent from this agent's `tools:` grant. Records lapse at TTL; a rule that should stop firing goes `disabled`, which is a write, not a delete.
- **It does not treat an empty record as evidence of safety.** No knowledge record for a symbol means nobody has traced it yet. No hotspot counter means no defect has been *recorded* there. Neither is a reason to look less hard.
