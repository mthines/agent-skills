---
title: Self-improvement evidence — a worked case from the detection eval
impact: MEDIUM
tags:
  - lorekit
  - memory
  - lessons
  - self-improvement
  - evidence
  - references
---

# Self-improvement evidence

[`memory-buckets.md`](../rules/memory-buckets.md) says *what* the LoreKit buckets are.
This file is the evidence for *why they are worth the wiring*, taken from one fully-recorded episode: ten runs of the `bug-detection` eval across September 2026, written up run by run in [`scripts/eval/README.md`](../../../scripts/eval/README.md).

It exists because the loop's value is otherwise argued rather than measured.
Every skill in this repo declares a lessons bucket and a promotion gate; none of them could previously point at a case where the absence of a carried lesson cost something specific and countable.
This episode can, and it contains an internal control.

## What this is, and what it is not

**This episode did not run on LoreKit.** The lessons below were derived in-session and hand-written into `scripts/eval/README.md` and `CLAUDE.md` — the *slow* tier of the two-tier loop, reached by a human writing prose. No `loop::` record was read or written.

So this is **not** a demonstration that LoreKit delivered self-improvement here.
It is a demonstration that the loop LoreKit models is real, has a measurable cost when it is absent, and produces lessons of exactly the shape and scope the buckets are designed to hold.
That distinction matters, and stating it is not modesty: the same episode is a sustained lesson in not over-reading a small sample, and a document claiming *proof* from one un-instrumented case would be the failure it describes.

What makes it evidential rather than anecdotal is the control in [§ The control case](#the-control-case): one lesson **was** already persisted, in `CLAUDE.md`, and it is the one lesson that was never re-derived.

## The episode in one paragraph

`bug-detection` measures whether the `pr-reviewer` detection core finds seeded bugs (`recall`) without flagging clean decoys (`fp_rate`), gated at `recall >= 0.7` and `fp <= 0.2`.
Over ten runs the eval was re-instrumented twice, its control set was tripled, five of its fixtures were found defective and repaired, and two published conclusions were retracted.
Neither rubric it measures — [`finders.md`](../../pr-reviewer/rules/finders.md), [`finding-verifier.md`](../rules/finding-verifier.md) — was edited, and the gate was never moved.

## The five lessons, and what each cost

Each row is a lesson that is **general** — it holds for any eval, not just this one — with the number of times it had to be independently derived inside a single episode.

| # | Lesson | Derived | Re-derived | Cost of the gap |
| --- | --- | --- | --- | --- |
| L1 | A metric needs enough cases that **one case is well under the gate's margin**, or it cannot express the change you are making. | Run 6 planning, for `fp_rate` (10 controls → 30). | Run 10, for `recall` (20 seeded records), by the identical argument. | Four runs and a merged PR apart. The second derivation was the *same reasoning* applied to the other half of the same file. |
| L2 | At this sample size, **N runs cannot establish reproducibility** — quote the spread, never the point. | Runs 1–3, retracting a claim about the verifier's lift. | Run 5 (retracting "the precision gap is reproducible"), run 8 → 9 (per-class), run 10 (`consumer-break` 4/4 → 2/4). | Two *published* conclusions had to be publicly retracted. Four derivations total. |
| L3 | **Itemise a rate before tuning a rubric against it.** A bare `fp_rate` cannot distinguish an over-permissive verifier from a defective control set. | Run 7, the first run to print survivors by name. | — | Five prior runs pointed at the wrong culprit. The planned next step was to tune [`finding-verifier.md`](../rules/finding-verifier.md); had it been taken, it would have trained the verifier to reject **true** findings while `fp_rate` fell. |
| L4 | A control asserting *"this diff is clean"* is a claim about the **whole diff**, not about the one thing it probes. | Run 7 (five defective fixtures, two of them original). | Run 9 — a sixth, and one the run-7 write-up had itself cited as evidence *for* the core. | Two original fixtures had been silently defective for the entire recorded baseline, corrupting every `fp_rate` in it. |
| L5 | Never lower a gate, loosen a parser, or skip a case to recover a miss. | *Already written down.* | **Never.** | — |

L1 and L2 are the load-bearing ones. L1 was derived twice in one session, roughly four hours apart, from the same underlying principle applied to two halves of one JSONL file. L2 was derived four times at three different granularities — aggregate, per-suite, and per-class — and produced two retractions before it stuck.

## The control case

L5 is the comparison that turns the table above into evidence.

It is the only lesson in the set that was **already persisted** before the episode began: `CLAUDE.md` states that lowering the detection gate to meet the current core is the fix-to-pass forbidden everywhere else in the repo, and that a record failing on output shape is counted as a miss and never as clean.

It is also the only lesson that was never re-derived, never violated, and never argued about — including at run 10, where recall landed *exactly* on the gate and moving the gate by two points would have bought comfortable margin. The temptation was maximal and the lesson held, because it was in front of the reader rather than in the reader's memory of four hours earlier.

Four lessons that were not written down were each re-derived one to four times.
One lesson that was written down was re-derived zero times.
That is a small sample and it is stated as such — but it is the correct shape of evidence for the claim, and it is the shape the buckets exist to industrialize.

## What a carried lesson would and would not have changed

The honest accounting has two columns, and the second one matters more than advocacy documents usually admit.

**Would have changed.** L1 read at the start of the run that grew the controls would have prompted the obvious question — *does the other half of this file have the same problem?* — and the seeded-record growth would have shipped in the same PR instead of being discovered by a paid run four commits later. L2 read before the run-3 write-up would have stopped a claim being published that run 5 then falsified. L3, held as a `global` lesson, would reach the next author writing *any* eval in *any* repo, which is precisely where it is most valuable and least likely to be rediscovered.

**Would not have changed.** LoreKit carries the lesson, not the fix. It cannot make a 20-record golden set larger, cannot repair a defective fixture, and cannot tell you that `consumer-break` is about to swing by two cases. Every measurement in this episode still had to be paid for. The claim is narrower than "the agent improves itself": it is that the *conclusions* an agent reaches survive the end of its context, so the next run starts from the last run's ceiling instead of its floor.

There is also a real failure mode in the other direction, and it is on display here. Two of these lessons were **wrong when first written** — the verifier-lift claim and the reproducible-precision-gap claim — and both were published before more data arrived. A carried lesson is a carried *belief*, and a wrong one persists exactly as well as a right one. That is why [`outcome-learning.md`](../rules/outcome-learning.md) gates promotion at `seen_count >= 3` with corroboration from distinct sources, why lessons are advisory rather than authoritative, and why `Signal`-kind records are recomputed at read time from their evidence instead of being trusted as stored verdicts.

## Where each lesson belongs

Mapped onto the taxonomy in [`memory-buckets.md`](../rules/memory-buckets.md), so the episode is actionable rather than merely instructive:

| Lesson | Kind | Bucket | Scope | Why that scope |
| --- | --- | --- | --- | --- |
| L1 · metric resolution vs. gate margin | Lessons | `aw-lessons` | `global` | Holds for any eval with a threshold, in any repository. |
| L2 · sample size vs. reproducibility | Lessons | `aw-lessons` | `global` | A property of small stochastic samples, not of this eval. |
| L3 · itemise before tuning | Lessons | `aw-lessons` | `global` | Holds for any rate-gated rubric. |
| L4 · a decoy is a claim about the whole diff | Lessons | `reviewer-lessons` | `global` | Specific to authoring detection fixtures, which is reviewer work. |
| L5 · never move the gate to meet the core | *promoted* | — | source | Already in `CLAUDE.md`, which is where a lesson lands **after** promotion. The bucket is the waiting room, not the destination. |

L5's row is the point of the table. The two-tier design ends with a human moving a repeatedly-confirmed lesson out of the store and into source, where it is unconditional. A lesson that stays in the fast tier forever has not succeeded; it is still a hypothesis.

## Reproducing the reading

Everything above is checkable against committed artefacts, which is the property that makes this file citable:

```bash
# The per-run write-ups, runs 1–10, each with its named survivors and misses.
less scripts/eval/README.md      # § The L2-detection baseline, and § Run 6 … § Run 10

# The two retractions, stated in the summary that consumers actually read.
grep -n "retraction\|not established\|over-confident" CLAUDE.md

# The instrument itself: the gate, the resolution self-test, the diagnostic.
node scripts/eval/l2-detection.mjs --self-test
```

The self-test asserts `floor(controlN × GATES.fp) >= 4` — the executable form of L1, and the reason a future author cannot silently undo the control growth. That assertion is what L1 looks like once it has been promoted out of prose: not advice, but a check that reds the build.

## See also

- [`memory-buckets.md`](../rules/memory-buckets.md) — the canonical bucket taxonomy this file supplies evidence for.
- [`outcome-learning.md`](../rules/outcome-learning.md) — the promotion gate, and the corroboration rules that guard against a wrong lesson entrenching.
- [`write-pipeline.md § Lesson-scope entries`](../../../skills/authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries) — the shared record schema and the `seen_count` UPDATE contract.
- [`scripts/eval/README.md`](../../../scripts/eval/README.md) — the primary source: ten run write-ups, in order.
