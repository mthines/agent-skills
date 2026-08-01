---
title: Idea Scoring — Independent Axes, Independent Judges, Protected Novelty
impact: HIGH
tags:
  - scoring
  - evaluation
  - llm-as-judge
  - selection
  - confidence
---

# Idea Scoring

How to score the pool (Phase 3), select finalists, and validate them (Phase 5).
The governing findings: people (and default heuristics) select ideas barely better than random, systematically trading originality for feasibility (§3.2); and a lone LLM judge can be *less* consistent than human reviewers, with documented self-preference, position, and verbosity biases (§4.1, §4.7).
Evidence references (§): [`../references/ideation-research.md`](../references/ideation-research.md).

## Contents

- [The four axes](#the-four-axes)
- [Judge independence](#judge-independence)
- [Ranking procedure](#ranking-procedure)
- [Selection rules](#selection-rules)
- [Finalist validation (Phase 5)](#finalist-validation-phase-5)
- [Common mistakes](#common-mistakes)

## The four axes

Score every idea 1–10 on each axis **independently** — never produce one holistic number first:

| Axis            | Question                                                                      |
| --------------- | ------------------------------------------------------------------------------ |
| **Novelty**     | How far is this from the obvious first answer and from the rest of the pool?   |
| **Feasibility** | Could it actually be built/done with plausible effort and known technology?    |
| **Impact**      | If it works, how much does it move the stated success criterion?               |
| **Fit**         | How directly does it answer the selected framing (not a different problem)?    |

Composite for *ranking only*: `0.30·Novelty + 0.25·Feasibility + 0.30·Impact + 0.15·Fit`.
The composite orders the pool; it does not select finalists on its own (see Selection rules).

## Judge independence

| Mode  | Judge                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------- |
| deep  | A fresh judge subagent that receives only the framing, the success criterion, the rubric, and the anonymized pool. |
| quick | A separate in-context judging pass that begins by restating the rubric; it must not be the same pass that generated. |

Non-negotiable either way:

- The generation context never scores its own output — self-scoring inflates perceived quality without real improvement (§5.1).
- Ideas are judged **anonymized and order-shuffled**: no persona labels, no "user's seed idea" markers, no generation order.
- Normalize length before judging — trim every idea to its title + mechanism; verbose ideas otherwise win unearned points (§4.7).
- Rewrite user seed ideas into the standard idea format and house style before pooling — anonymization removes labels but not style, and a same-model judge favors own-style output (§4.7); unrestated seeds lose unfairly.

**Same-model caveat:** all judges here are fresh contexts of the same model — this approximates, but does not achieve, the different-model mitigation §4.7 prefers.
Surface uncertainty accordingly; the confidence gate, not the scores, is the reliability statement.

**Acknowledged deviation (quick mode):** an in-context judging pass is still the model and session that generated — the one-model generator+judge risk §5.1 warns about is accepted as a speed/cost trade-off, mitigated by the rubric restatement, anonymization, and order swap.
When the stakes justify better judging, escalate to deep mode.

Judge prompt shape:

```text
You are an independent judge. You did not write these ideas. Success
criterion: <criterion>. Score the whole pool one axis at a time — all
ideas on Novelty (1–10), then all on Feasibility, then Impact, then Fit —
using the rubric definitions provided. Use the full 1–10 range per axis;
on large pools scores compress toward the middle, so anchor the pool's
best idea per axis near 9–10 and its weakest near 1–2 before scoring the
rest. Ideas are anonymized and shuffled, each trimmed to title +
mechanism. Do not reward length or style. Return only the score table.
```

## Ranking procedure

| Pool size | Procedure                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| ≤ 10      | Direct rubric scoring, one pass per axis (score all ideas on Novelty, then all on Feasibility, …).               |
| > 10      | Rubric scores first, then refine the top half with **pairwise comparisons, each pair judged twice in swapped order** — an adaptation of the Stanford agent's pairwise Swiss tournament, the best-performing judging setup in that study, and even it was only modestly reliable (53.3% consistency, §4.1) — which is why the confidence gate, not score precision, is the reliability statement. The swap cancels position bias (§4.7). |

Disagreement between the two orderings of a pair = a tie; do not silently pick one.

## Selection rules

The finalist list is **gated on quality, not truncated to a fixed count** — its size is emergent from the pool.
Selecting a fixed top-`k` re-imposes the arbitrary cutoff §3.2 warns against: a rich pool has deserving ideas silently dropped to hit the number, and a thin pool gets padded with mediocre ones to reach it.
Instead, admit every idea that clears an explicit bar and let the count fall out.

### Admission bar

An idea from the ranked pool is a **finalist** when it clears **all** of:

1. **On-target floor** — `Fit ≥ 6` **and** `Impact ≥ 6`.
   It must answer the selected framing and move the success criterion; this stops a novel idea that solves a *different* problem from being promoted.
2. **Leading-tier quality** — `Composite ≥ C* − 1.0` (where `C*` is the pool's top composite) **and** `Composite ≥ 7.0` absolute.
   The relative band keeps the set to ideas genuinely competitive with the best; the absolute floor stops a weak pool from promoting its own mediocre top.
3. **Survives Phase 5** — produces a concrete executability probe and is not downgraded by the confidence gate (see [Finalist validation](#finalist-validation-phase-5)).

Then apply, in order:

4. Instruct the selector verbatim: **"select the most creative ideas that satisfy the success criterion"** — the explicit "creative" instruction partially corrects the feasibility bias (§3.2).
5. **Novelty protection (always):** the pool's highest-Novelty idea with `Feasibility ≥ 4` is always carried, even when it misses the admission bar.
   Ties on Novelty break by composite.
   Label it the **wildcard** in the report.
   It never consumes a "slot" — there are no slots — so it appears in the report's Wildcard section additionally, and is *also* flagged a finalist if it cleared the bar on its own.
6. **Niche diversity:** at most 2 admitted finalists per niche appear in the **Lead finalists** list (see [`evolution-loop.md`](./evolution-loop.md) for niche construction).
   A 3rd+ from the same niche is **not discarded and not demoted to the bench** — it *cleared the bar*, so it is still a finalist and appears under **Also cleared the bar** (a Finalists sub-section), so a productive niche is shown, not hidden.
   Only ideas that missed the bar go to "Ideas worth revisiting".
7. Deep mode: the admitted finalist set is confirmed by a panel of 3 fresh judge subagents voting independently; majority keeps a finalist, and any panel member may promote one bar-missing idea back for a revote (§4.7 proposes diverse judge panels as a bias mitigation; three independent fresh contexts approximate this within a single-model setup — see the same-model caveat above).

### Count bounds

The bar sets the count; these bounds only handle the extremes.

- **Floor — always at least 1.**
  If the bar admits nothing (thin or off-target pool), carry the single top-composite idea plus the wildcard, and state plainly in the report that no idea cleared the quality bar.
  An honest "nothing strong yet — here is the closest" beats padding the list to look productive.
- **No fixed ceiling; a readability tier instead.**
  When more than 5 ideas clear the bar, the pool is genuinely rich — keep them **all**, but present the highest-composite ~5 as **Lead finalists** and the remainder as **Also cleared the bar**, both inside the report's Finalists section.
  This split is presentation only: nothing that cleared the bar is demoted to "revisit".
- **`--n` is an optional user cap, never the default count.**
  With `--n k`, the Lead-finalists list is truncated to the `k` highest-composite admitted finalists (the wildcard still always appears); everything else that cleared the bar moves to "Also cleared the bar".
  Without `--n`, the count is fully emergent.
  `--n` can only *narrow* the lead list — it never manufactures finalists the bar did not admit.

## Finalist validation (Phase 5)

Pre-execution novelty scores are systematically inflated — idea rankings can flip once someone actually builds them (§4.2).
Before recommending, run each finalist through:

1. **Executability probe.** Write one concrete paragraph: the first real step, the core mechanism, and the riskiest assumption.
   A finalist that cannot produce a concrete first step fails admission clause 3 and simply **drops out of the finalist set** — there is no fixed count to backfill, so nothing is promoted in its place (it may still surface under "Ideas worth revisiting" if notable).
2. **Confidence gate.** Run `Skill("confidence", "analysis")` on the recommendation package (finalists + scores + probes).
   Apply the confidence skill's thresholds:

   | Score  | Action                                                                                   |
   | ------ | ----------------------------------------------------------------------------------------- |
   | ≥ 90   | Recommend as validated.                                                                    |
   | 70–89  | Recommend with the named concerns listed per finalist.                                     |
   | < 70   | Do not recommend — return to Phase 4 (one more evolution round if budget remains) or rerun divergence with the gap named in the burst prompt. |

3. **Optional lenses.** Deep mode: `Skill("critical", "analysis")` on the top finalist (adversarial pre-mortem).
   UI/product-surface finalists: offer `Skill("ux")` as a review lens.
4. **Incubation offer (interactive sessions only).** When presenting the report, note that the verdict can wait — returning to selection after a break measurably helps (incubation, d = 0.29, §1.6).
   Autonomous runs skip this.

## Common mistakes

- Selecting the top-3 composite scores. **Fix:** apply the selection rules — composite ranking alone re-creates the feasibility bias the rubric exists to counter (§3.2).
- Truncating the finalist list to a fixed count (3–4) when more ideas clear the bar, or padding it to that count when fewer do. **Fix:** the count is emergent from the admission bar; report every idea that clears it, and be honest when few (or none) do.
- Letting judges see persona or seed-idea labels. **Fix:** anonymize and shuffle before judging; self-preference and social signals bias verdicts (§4.7).
- Reporting axis scores as precise truth. **Fix:** treat scores as ordering devices; surface the confidence gate result as the reliability statement (§4.1).
- Judging each idea once, in pool order. **Fix:** per-axis passes plus order-swapped pairs for the top half.
