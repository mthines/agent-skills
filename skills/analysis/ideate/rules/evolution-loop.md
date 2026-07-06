---
title: Evolution Loop — Recombination Across Niches, Bounded Rounds
impact: HIGH
tags:
  - evolution
  - recombination
  - iteration
  - stopping-criteria
  - quality-diversity
---

# Evolution Loop

How to improve the top ideas (Phase 4).
The governing findings: self-refinement gains plateau by round 3 and self-bias amplifies per round without external feedback (§5.1); iterating on ideas inside one context homogenizes them (§5.3); the literature's remedy is recombination across independent lineages with niche-preserving selection (§5.2).
Evidence references (§): [`../references/ideation-research.md`](../references/ideation-research.md).

## When to run

| Condition                                                             | Action                        |
| ---------------------------------------------------------------------- | ------------------------------ |
| Deep mode.                                                              | Run — up to 3 rounds.          |
| Quick mode.                                                             | Run — at most 1 round.         |
| Pool ≤ 6 unique ideas or the top composite already ≥ 8.5.               | Skip; note the skip in the report. |
| Phase 5 confidence gate returned < 70 with budget remaining.            | Run one additional round targeted at the named gaps. |

## Niche construction

Before breeding, bucket the pool into **niches** — clusters of ideas sharing the same fundamental approach (same mechanism family, same lever, same user behavior change).
Keep the highest-composite idea per niche as the niche **elite**.

This is a lightweight quality-diversity archive (§5.2): diversity is maintained *structurally* by per-niche elitism, not by hoping the generator stays diverse.
A niche is never deleted because its elite scores low — a weak niche is a recombination ingredient, not noise.

## Round procedure

Each round:

1. **Select parents.** All niche elites, plus the wildcard (per the selection rules in [`idea-scoring.md`](./idea-scoring.md): the highest-Novelty idea with Feasibility ≥ 4) even if it is not an elite.
2. **Breed variants** — in fresh contexts (deep: parallel subagents; quick: a clearly delimited new pass), 2–3 variants per operator:

   | Operator             | Instruction                                                                                     |
   | -------------------- | ------------------------------------------------------------------------------------------------ |
   | Crossover            | "Combine the mechanisms of <elite A> and <elite B> (the two most *dissimilar* parents) into one coherent idea." |
   | Dimension mutation   | "Keep the mechanism of <elite>, change exactly one dimension: audience, scale, business model, medium, or constraint." |
   | Analogical transplant| "Re-implement <elite> the way <distant domain> would."                                            |

3. **Re-score externally.** Variants join the pool and are scored by a judge per [`idea-scoring.md`](./idea-scoring.md) — the breeding context never scores its own variants (§5.1).
4. **Update the archive.** A variant replaces a niche elite when its composite beats the elite's, **or** when its Novelty beats the elite's and its composite is within 0.5 — a composite-only rule would let the feasibility weight silently discard high-novelty variants, re-creating the §3.2 bias inside the archive.
   A variant with a genuinely new mechanism founds a new niche.
5. **Log the round**: round number, variants bred, variants that displaced an elite, top composite before → after.

## Stopping criteria

Stop the loop at the **first** of:

| # | Signal                                                                                    | Rationale                                          |
| - | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 1 | 3 rounds completed (1 in quick mode).                                                       | Self-Refine plateau: the gains live in rounds 1–2 (§5.1). |
| 2 | Top composite improved < 5% over the previous round (judged externally).                    | Flat external scores end the loop — self-assessed improvement keeps rising even when quality does not (§5.1). |
| 3 | A round's variants were ≥ 80% duplicates of existing pool ideas.                            | The lineage has converged (§4.1, §5.3).              |

The 3-round cap is a hard invariant.
No lesson, score trend, or user enthusiasm raises it within a run — if 3 rounds were not enough, the correct move is new divergence with a changed framing, not a 4th polish.

## Common mistakes

- Polishing the top idea repeatedly in one context. **Fix:** breed across niches in fresh contexts; polishing converges to the context centroid (§5.3).
- Letting the breeding pass score its variants "to save a step". **Fix:** external judge every round — reward hacking emerges exactly here (§5.1).
- Deleting low-scoring niches to focus the pool. **Fix:** keep every niche's elite; weak niches are crossover material (§5.2).
- Continuing because round 3 self-reported a breakthrough. **Fix:** only the external judge's flat-score signal and the round cap decide.
