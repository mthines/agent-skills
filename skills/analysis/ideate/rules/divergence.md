---
title: Divergence — Nominal-Group Generation with Persona Fan-Out
impact: HIGH
tags:
  - divergence
  - generation
  - personas
  - nominal-group
---

# Divergence

How to generate the idea pool (Phase 2).
The governing constraint: interactive, single-context brainstorming produces roughly half the ideas of the same minds working independently, and LLM contexts have the same failure (within-context fixation) — so this phase simulates a *nominal group*: independent generation, pooled afterwards.
Evidence for every default: [`../references/ideation-research.md`](../references/ideation-research.md) (§ references below).

## Contents

- [Burst structure](#burst-structure)
- [Generators](#generators)
- [Operator catalog](#operator-catalog)
- [Generation prompt contract](#generation-prompt-contract)
- [Pooling and dedupe](#pooling-and-dedupe)
- [Common mistakes](#common-mistakes)

## Burst structure

A burst is one round of generation across all generators.

| Step | Action                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| 1    | Burst 1 — broad: each generator gets the selected framing, its persona, and one operator. No other context.     |
| 2    | Pool and dedupe (below). Log the unique count.                                                                  |
| 3    | Burst 2 — reseed: same structure, plus the pooled idea *titles only* and the instruction "propose only what has NOT been said yet". Originality rises with extended effort — the obvious ideas came first (§1.5). |
| 4    | Further bursts only while the previous burst's non-duplicate yield ≥ 20%. Below that, the pool has plateaued (§4.1) — stop generating and move to scoring. |

Burst 2 is mandatory in both modes.
Never skip it because burst 1 "looks sufficient" — burst 1 is where the obvious ideas live.

## Generators

### Deep mode — parallel persona subagents

Dispatch 5 generator subagents per burst — via the agent-dispatch tool (default subagent type), all in one parallel batch, each prompt fully self-contained — each returning 6 ideas.
The 5 comes from the multi-persona prompting study (§4.4, its design parameter); the 6 is an operationalization doubling 6-3-5's per-round count of 3 (§1.4).

- **One persona per subagent, never all personas in one prompt** — parallel beats collective prompting on measured concept diversity (§4.4).
- **Personas are diverse *ordinary* professionals** adjacent to the problem domain (e.g. for a devtool: a support engineer, an accessibility consultant, a hardware hacker, a teacher, a finance controller) — ordinary-persona partitioning beats "creative genius" personas (§4.3).
- **Each generator reasons step-by-step before proposing** — CoT reduces within-context fixation (§4.3).
- Generators receive the framing and their operator — never the conversation history, other generators' output (except burst-2 titles), or lessons.

### Quick mode — in-context bursts

No subagents.
Emulate independence as far as one context allows:

- 2 bursts × 8 ideas.
- Switch the operator and persona voice between bursts.
- Burst 2 uses the "not yet said" reseed — this is the primary fixation guard available in-context.

## Operator catalog

Rotate operators across generators and bursts — they are diversity mechanisms, not rituals.
Ranked by strength of evidence (§2):

| Operator                | Prompt idiom                                                                                             | Note                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Far-domain analogy      | "Abstract this problem to its underlying schema, then solve it the way <distant domain> would."            | Best-evidenced stimulus (§2.4). Expect novelty ↑, feasibility ↓ — label such ideas. |
| TRIZ contradiction      | "Name the core contradiction (improving X worsens Y), then resolve it without compromise."                 | Beat SCAMPER on novelty in the one head-to-head (§2.1).   |
| Assumption reversal     | "List the 5 assumptions everyone makes here; propose ideas that violate one each."                         | Mechanism-plausible operator (§2.6).                      |
| SCAMPER verb            | Assign one verb per generator: substitute / combine / adapt / magnify / put-to-other-use / eliminate / rearrange. | Weakest of the set; use for coverage, not novelty (§2.3). |
| Constraint injection    | "Same problem, but it must cost nothing / work offline / ship this week."                                  | Forces off the centroid.                                  |

## Generation prompt contract

Every generator prompt MUST include:

1. The selected framing (verbatim), the persona, and exactly one operator.
2. The idea format: **title + 2–3 sentence mechanism + one line on what makes it non-obvious**.
3. The separation rule: "Do NOT evaluate, rank, or discuss feasibility. Generation only."

### Good

```text
You are a pediatric nurse reviewing this problem. Reason step-by-step about
what you uniquely notice, then propose 6 ideas. Operator: assumption
reversal — list the assumptions everyone makes, violate one per idea.
Format each as: title, 2–3 sentence mechanism, one line on why it is
non-obvious. Do not evaluate or rank.
```

### Bad — evaluation leaked into generation

```text
Propose 6 ideas and rate each for feasibility so we can pick the best one.
```

Evaluation during generation suppresses output — the brainstorming rule with the most unambiguous empirical support (§3.1).

## Pooling and dedupe

1. Merge all generator outputs.
2. Two ideas are duplicates when their *mechanisms* are interchangeable — differing titles or surface framing do not make ideas distinct.
   Cluster duplicates, keep the strongest phrasing, and record the merge.
3. Log per burst: raw count, unique count, non-duplicate yield %.
   These feed the burst-4 stopping rule and the report's run stats.

Expect heavy duplication — at scale only ~5% of LLM-generated seed ideas survive dedup (§4.1); a shrinking yield is the signal to stop, not a failure.

## Common mistakes

- Asking one context for 30 ideas. **Fix:** 5 independent generators × 6 ideas — same count, far more diversity (§1.2, §4.4).
- Raising temperature to "be more creative". **Fix:** vary persona, operator, and framing; keep sampling defaults (§4.6).
- Passing the full conversation to generators. **Fix:** framing + persona + operator only; shared context reintroduces fixation.
- Skipping burst 2 when burst 1 looks rich. **Fix:** burst 2 is mandatory — originality peaks late (§1.5).
