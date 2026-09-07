# BOOTSTRAP SEED — NOT A REAL BASELINE

This golden set is a **placeholder seed** for the `code-review-retrieval-relevance` L2 suite.
It is **NOT a statistically valid baseline**.
The real corpus is hosted-only (requires LoreKit history with real `origin_pr` + `seen_count` data).
Do not raise the `EVAL_GATE` floor for this suite until the golden set reaches ≥ 50 cases with real outcome-signal labels.

## Ground truth definition

Ground truth for this suite is **defined by the outcome signal**, never by hand-authored relevance labels.
**The read filters on exactly four dimensions**, and every label in this set is decided by one of
them alone.
Naming all four matters: an earlier version of this file defined `skip` by the `tag` dimension
only, so the three other ways a record fails the read had no ground-truth definition here and the
set had no case testing any of them.

| Dimension | What the read does | Stated at |
| --- | --- | --- |
| **tag** | Step 1.0's four calls pass `tags=["loop::reviewer-lessons"]` or `tags=["loop::reviewer-comment-relevance"]`; Step 1.2c keeps only hits carrying one of those two | both paths |
| **scope** | Both paths read exactly two scopes — `repo::{owner}/{repo}` (from `RESOLVED_REPO`, lowercased) and `global` — and the parameter matches **exactly**, so no `branch::` or other-repo record is reachable | both paths |
| **expiry** | "Skip expired entries" | Step 1.0's fenced comment and merge rules; Step 1.2c's merge line |
| **source attribution** | `source.agent == "pr-reviewer" ∨ source.explicit == true`, applied to what the calls returned | Step 1.0 rule 1, binding on "every read this step and Step 1.2c issue" |

A candidate memory is `surface` when it is in range on **all four**, whether or not its gist has
anything to do with the diff. Diff-relevance is not a fifth dimension: Step 1.0 carries no diff
parameter, and Step 1.2c's diff-built search is an **additional** path merged into Step 1.0's pool
(an OR), never a filter that can remove a record Step 1.0 already returned. `seen_count` is not a
dimension either — it is not even available at Step 1.0, which loads the index (`view="summary"`)
and not record bodies; it governs promotion and the Step 2.7b suppress / downgrade / promote
decision.

A candidate memory is `skip` when **any one** of the four puts it out of range. One is sufficient:
a record with the right tag, the right scope and the highest `seen_count` in the set is still
`skip` if it has expired.

The outcome signal is: `loop::reviewer-lessons` / `loop::reviewer-comment-relevance` tags + `origin_pr` + `seen_count >= 3` marks a promotion-grade should-fire lesson.
Labels are derived from this signal, NOT from re-running the Step 1.0 / Step 1.2c read being measured.

## Label balance is a correctness property, not a statistic

The set must not be answerable by a single-label responder.
At 4 `surface` / 1 `skip` the majority-class baseline was 80% and cleared the 70% `EVAL_GATE`
floor, so a green run meant only "the model stopped answering `skip`" — it was not evidence that
anything reasoned about retrieval.
The set is now **8 `surface` / 6 `skip` across 14 cases**, a 57.1% baseline, so neither degenerate
strategy passes the unchanged floor.
This is asserted by L1 `G21n`, which derives the baseline from this JSONL and the floor from
`.github/workflows/evals-l2.yml` — re-degenerating the split reds L1 rather than only a paid L2
run.
Grow the set by adding decoys, never by moving the floor.

## What this suite measures

Given a PR diff + a candidate memory (with its `tag`, `scope`, `source`, expiry, and gist), does the model — reading the live `### 1.0` + `### 1.2c` subsections of `agents/pr-reviewer.md` — correctly classify whether the documented Step 1.0 (`mcp__lorekit__memory_list`) + Step 1.2c (`mcp__lorekit__memory_search`) read **returns** that memory?

Deliberately **not** "surfaces it to the finders". That phrasing named a different question — one that includes Step 1.2d's diff-keyed shortlist, which is out of this rubric and answers the opposite way for a diff-unrelated lesson. It sat in this sentence and in the `instruction` string simultaneously; see "Measured runs, and the instruction fix" below for what it cost.

The rubric is those **two subsections**, deliberately not their `## Step 1` parent: `extractSection` is heading-level-aware, so the parent fed all ten `### 1.x` subsections (67,630 chars vs. 27,568) — including `### 1.2d`, whose diff-keyed shortlist answers *what reaches the finders* rather than *what the documented read returns*. With `1.2d` in scope, a list-reachable lesson unrelated to the diff is legitimately `skip` and the suite contradicts its own `instruction` string. L1 `G21a` reds on a re-widening.

The question is a **procedure-application** question, not a relevance question, and the `instruction` is worded to keep it that way. The earlier wording — "would be surfaced by the documented read *for the given PR diff*" — put the diff in the framing of the question, which reads as an invitation to judge whether the record is relevant to the change; two cases turn on exactly that distinction and both were answered `skip` on a run where the rubric already said in as many words that narrowing this read by apparent relevance is a defect. The diff stays in the input because Step 1.2c builds its query from it, and the instruction says only that.

This is the agent-skills half of the LoreKit retrieval-relevance evals roadmap (PR6 code-review domain).

## Methodology: promotion → golden case

When a lesson is promoted via `diagnose`, add a golden case so the fix is locked.
Specifically: when a `loop::reviewer-lessons` or `loop::reviewer-comment-relevance` entry reaches `seen_count >= 3` and is promoted to a permanent guard through the slow tier, record the lesson's trigger context as an input in this JSONL.
Set `expected: "surface"` to lock that the retrieval procedure would fire on the relevant diff.
This makes the behavioral gate self-reinforcing — every promoted lesson grows the golden set.

**Every promotion adds a `surface` case, so promotions drift the balance.** Left alone they walk
the majority-class baseline back up toward the floor, and `G21n` reds once it crosses. That is the
guard working, not a guard to relax: pair a promotion with a `skip` decoy on whichever of the four
dimensions is thinnest, and keep the case that motivated it.

## Suite metadata

- **Rubric read from:** `agents/pr-reviewer.md`, sections `### 1.0 Prior-comment awareness + relevance memory load (default ON)` **and** `### 1.2c Diff-keyed lesson search (all modes)` — never the `## Step 1` parent
- **Choices:** `surface` | `skip`
- **Gate:** **gating** — 14 cases is above `EVAL_GATE_MIN_CASES` (10), so it grades against the 70% floor and is not `[advisory]`. (This line previously read "report-only until ≥ 50 real-corpus cases", which described the 5-case set and stopped being true the moment the decoys landed. The ≥ 50 bar is about **raising** the floor, not about whether the current floor applies.)
- **Real corpus requires:** LoreKit instance with real `reviewer-lessons` + `reviewer-comment-relevance` history

## Measured runs, and the instruction fix

The 14-case set has been measured three times, and the miss set is **stable** — which is what
makes it a rubric/prompt defect rather than sampling noise:

| head | score | misses |
| --- | --- | --- |
| `#183` head | 8/14 (57.1%) | the six below |
| `e65c302` | 9/14 (64.3%) | five — `…seen2-below-threshold-scoped` passed |
| `9e59b36` | 9/14 (64.3%) | same five, identical set |
| `0512499` (the fix) | **10/14 (71.4%)** | four — `…unrelated-diff-scoped` passed |
| `39e9d7d` (docs only) | **11/14 (78.6%)** | three — **exactly the predicted residue** |
| `8389c80` (docs only) | **11/14 (78.6%)** | same three, identical set |

All misses were `surface → skip`, never the reverse: the six `skip` decoys passed 6/6 every time.
A read that under-returns on 5 of 8 positives while never over-returning is not a model that
cannot follow the rubric — it is a model applying a filter the rubric does not contain.

**The question was asking for that filter.** The `instruction` asked whether the read surfaces the
record *"to the finders"*. §1.0 uses that exact phrase for a record dropped by attribution — "such
a record does not reach the finders" — and says diff-keying "enters later and *additively*", with
**Step 1.2d** shortlisting the merged index by changed path and symbol before the finders see
anything. So for a diff-unrelated lesson, `skip` was the *correct* answer to the question as
posed, while the labels encode list-reachability. The prompt and the ground truth disagreed, and
the labels were right.

This is the second time this suite's question drifted off its labels: the verb was already
corrected once (`would be surfaced … for the given PR diff` → `surfaces`) to remove exactly this
relevance reading, and `to the finders` was left in place one clause over, reintroducing it.

**What the fix is expected to close, and what it is not.** Only two of the five misses turn on the
diff — `…unrelated-diff` and its scoped twin. The other three are the model failing to apply rules
§1.0 states in as many words, and they are worth keeping visible:

| miss | the rule it did not apply | stated at |
| --- | --- | --- |
| `seen2-below-threshold` | `seen_count` is the promotion bar, not a surfacing filter | §1.0 "It is not gated on `seen_count`" |
| `global-scope-reachable` | `global` is one of the two scopes both paths read | §1.0 scope list; §1.2c `scopes` |
| `source-explicit-maintainer-rule` | attribution is a **disjunction** — `source.explicit == true` carves in a human-authored record | §1.0 rule 1 |

Those three are a genuine measurement of a real weakness, so the fix is **not** expected to reach
14/14, and nothing here should be tuned until it does. Deliberately NOT done: adding a summary of
the four filters to the `instruction`. Extracting them from the rubric is the thing being measured,
and restating them in the prompt would grade the prompt instead of the read.

**What it closed — both diff cases, on two of the three runs.** Run 1 came back 10/14 with
`…unrelated-diff-scoped` flipped and the un-scoped twin still missing; runs 2 and 3, both on
docs-only commits, came back 11/14 with **both** diff cases passing. So the un-scoped twin sits
near the boundary — missed once, passed twice — rather than firmly on either side.

What does not vary at all is the residue: the three non-diff misses above recurred **identically
in all three runs**, and in runs 2 and 3 they are the *entire* miss set. That is the prediction
holding exactly, and it is what carries the argument — not the 71.4% or the 78.6%. One case is
7.1 points at n=14, larger than the spread between these runs, so quote the miss-set composition
and never a score. Do not tune the remaining three to chase 14/14: they are a real measurement of
the model failing rules the rubric states plainly.
