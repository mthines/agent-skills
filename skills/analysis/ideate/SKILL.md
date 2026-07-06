---
name: ideate
description: >
  Generates, stress-tests, and iteratively evolves ideas for a stated problem —
  product concepts, features, solution options, strategies — using
  research-grounded divergent/convergent agent loops: parallel persona
  generators (nominal-group simulation), independent judges scoring novelty,
  feasibility, impact, and fit on separate axes, and bounded recombination
  rounds gated by /confidence. Auto-triages run depth (quick in-context vs
  deep multi-agent; override with quick|deep). Use when brainstorming,
  exploring solution options, or pressure-testing a concept. Triggers on
  "brainstorm", "give me ideas", "help me come up with", "ideate on",
  "what could we build", "/ideate".
disable-model-invocation: false
argument-hint: '[quick|deep] [--n <count>] [--no-framing] [<problem statement>]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: orchestrator
  tags:
    - ideation
    - brainstorming
    - divergent-thinking
    - idea-evaluation
    - creativity
    - agent-loops
    - confidence-gate
    - innovation
---

# Ideate

Turns a problem statement into a small set of validated, evolved ideas by simulating a nominal group of independent generators, scoring with independent judges, and breeding the winners — instead of asking one context for a list and polishing it.

> **This `SKILL.md` is a thin index.** Phase procedures live in `rules/*.md` and load on demand.
> The evidence behind every numerical default lives in [`references/ideation-research.md`](./references/ideation-research.md) — section references below (§) point there, and its defaults tables flag which numbers are study values vs the skill's own operationalizations.

## Contents

- [Mode Detection](#mode-detection)
- [Workflow](#workflow)
- [Quick vs deep](#quick-vs-deep)
- [Composition](#composition)
- [Core Principles](#core-principles)
- [Self-Improvement](#self-improvement)
- [Anti-patterns](#anti-patterns)
- [Definition of Done](#definition-of-done)

---

## Mode Detection

Parse `$ARGUMENTS`:

| Mode    | Default | Trigger                                              |
| ------- | ------- | ---------------------------------------------------- |
| `quick` |         | `quick` token, or auto-triage says small.            |
| `deep`  |         | `deep` token, or auto-triage says open-ended.        |
| auto    | **yes** | No mode token — run the depth triage table below.    |

| Flag           | Default | Meaning                                                  |
| -------------- | ------- | -------------------------------------------------------- |
| `--n <count>`  | 3       | Number of finalists in the report.                       |
| `--no-framing` | off     | Skip Phase 1 (problem is already well-framed).           |

Everything else in `$ARGUMENTS` is the problem statement.
If it is missing, ask for it — never ideate on a guessed problem.

### Depth triage (auto mode)

First match wins:

| # | Signal                                                                                                | Depth   |
| - | ----------------------------------------------------------------------------------------------------- | ------- |
| 1 | User asks for thorough / extensive / "really new" ideas, or the problem combines ≥ 2 domains ("X meets Y"). | `deep`  |
| 2 | Outcome is a product, business, strategy, or roadmap decision.                                          | `deep`  |
| 3 | Problem is a local decision: naming, small feature shape, workaround, single component.                 | `quick` |
| 4 | User is mid-conversation and wants options fast ("any ideas?", "what do you think?").                   | `quick` |
| 5 | Unsure.                                                                                                 | `quick`, and name the escalation path: "run `/ideate deep <problem>` for the full pipeline". |

Cost expectation: a deep `--n 3` run dispatches ~17 subagents (2 bursts × 5 generators, 1 pool judge, 1 breeder, 1 variant judge, 3 panel judges, 1 pre-mortem) — prefer `quick` for casual or budget-sensitive asks.

---

## Workflow

| Phase | Name             | Rule file                                                              | Gate                                                                                       |
| ----- | ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0     | Intake & triage  | (inline below)                                                          | Problem restated in one sentence; success criterion named; depth chosen; lessons read.      |
| 1     | Frame            | (inline below)                                                          | 3–5 "How Might We" framings at different widths; one selected and logged.                   |
| 2     | Diverge          | [`rules/divergence.md`](./rules/divergence.md)                          | Pool ≥ 12 (quick) / ≥ 25 (deep) unique ideas; zero evaluation happened during generation.   |
| 3     | Score            | [`rules/idea-scoring.md`](./rules/idea-scoring.md)                      | Every pooled idea scored on 4 independent axes by a non-generator judge.                    |
| 4     | Evolve           | [`rules/evolution-loop.md`](./rules/evolution-loop.md)                  | ≤ 3 rounds; stopped on flat external scores, never on self-assessed improvement.           |
| 5     | Validate         | [`rules/idea-scoring.md`](./rules/idea-scoring.md) § Finalist validation | Every finalist has an executability probe; `confidence(analysis)` ≥ 70 on the recommendation. |
| 6     | Report           | [`templates/ideation-report.md`](./templates/ideation-report.md)        | Report emitted; high-novelty wildcard included; verdict question asked.                     |
| 7     | Learn            | [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md)    | Lessons written — mechanics only, never idea content.                                       |

### Phase 0 — Intake & triage

1. Read lessons (advisory input for *mechanics only* — see the hard invariant under Self-Improvement).
   Check the paths first — when neither `~/.agent-memory/ideate-lessons/` nor `memory/ideate-lessons/INDEX.md` exists (first run), skip without invoking `persistent-memory`:

   ```text
   Skill("persistent-memory", "read ideate-lessons --tier home")
   if [ -f memory/ideate-lessons/INDEX.md ]; then
     Skill("persistent-memory", "read ideate-lessons --tier project-shared")
   fi
   ```

2. Restate the problem in one sentence and name the success criterion — what makes an idea "good" here (cheapest, most novel, shippable this week, …).
3. Run the depth triage table unless a mode token was given.
4. If the user supplied seed ideas, add them to the pool unlabeled — judges must not know which ideas are the user's.

### Phase 1 — Frame

Problem framing measurably shapes ideation breadth and direction (§2.5) — skip only with `--no-framing`.

1. Generate 3–5 "How Might We" framings at deliberately different widths, from the literal ask to the underlying job-to-be-done — the width variation is the evidenced part (§2.5); the HMW phrasing is convention.
2. Interactive session → ask the user to pick one (a single batched question).
   Autonomous or backgrounded → pick the framing one step wider than the literal ask, and log the choice in the report.

---

## Quick vs deep

| Aspect          | `quick`                                                          | `deep`                                                                     |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Generation      | In-context, 2 bursts × 8 ideas, operators rotated per burst.     | 5 parallel persona subagents × 6 ideas per burst, ≥ 2 bursts (§1.4, §4.4).  |
| Fixation guard  | Operator switch + "what has NOT been said yet" reseed (§1.5).    | Independent contexts — the structural fix (§4.3).                            |
| Judging         | Separate in-context pass with rubric, order-swapped pairwise.    | Fresh judge subagent; panel of 3 judges for finalists (§4.7).                |
| Evolution       | ≤ 1 round.                                                       | ≤ 3 rounds (§5.1).                                                           |
| Report          | Inline.                                                          | Inline + written to `.agent/ideate/<yyyy-mm-dd>-<slug>.md`.                  |

---

## Composition

| Skill               | When                                                            | Call                                                       |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| `confidence`        | Phase 5, on the finalist recommendation.                        | `Skill("confidence", "analysis")`                           |
| `critical`          | Deep mode, top finalist (automatic); any finalist on request.   | `Skill("critical", "analysis")` — run inside a fresh subagent so the pre-mortem stays adversarial and the main context stays lean. |
| `ux`                | Finalists that are UI/UX or product-surface concepts.           | `Skill("ux")` as a lens on the finalist.                    |
| `persistent-memory` | Phases 0 and 7.                                                 | See [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md). |

`confidence` is required; the others are optional — skip silently if not installed.

---

## Core Principles

1. **Simulate a nominal group, not a meeting.** Independent generation contexts, pooled afterwards — never one long list from one context (§1.2, §4.3).
2. **Strictly separate generation from evaluation.** The one Osborn rule that survives scrutiny; no feasibility talk inside a generation pass (§3.1).
3. **Diversity comes from personas and prompts, not temperature.** Temperature is a weak novelty lever with a coherence cost (§4.6).
4. **The judge is never the generator.** Self-scoring amplifies self-bias per iteration (§4.7, §5.1).
5. **Protect novelty at selection.** Default selection sacrifices originality for feasibility and performs near-randomly; always carry one high-novelty pick (§3.2).
6. **Iterate by recombination across lineages, not polishing.** Cap at 3 rounds; stop on flat external scores (§5.1–§5.3).
7. **The obvious ideas come first.** Always run a second burst seeded with "what has NOT been said yet" (§1.5).
8. **Pre-execution novelty is inflated.** Every finalist needs a concrete first-step probe before it is recommended (§4.2).

---

## Self-Improvement

Two-tier loop, scope `ideate-lessons` — full contract in [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md), diagnostic surface in [`rules/diagnostic-surface.md`](./rules/diagnostic-surface.md).

**Hard invariant: divergence runs lessons-blind.**
Lessons may inform mechanics — depth triage, operator effectiveness, judge calibration, stopping behavior — and must never seed, filter, or steer idea *content*.
"What kinds of ideas the user tends to pick" is on the never-store list: it would entrench homogenization, the exact failure this skill exists to avoid.

---

## Anti-patterns

- One 30-idea list from a single context — within-context fixation makes the last 20 near-duplicates.
- Scoring or feasibility talk during a generation pass.
- Letting the generation context judge its own output.
- Averaging the four axes into one number before selection, then picking the top-n — this silently discards every high-novelty idea.
- A 4th evolution round because it "still feels like it's improving" — self-assessed improvement is the signal that lies.
- Storing user idea-taste as a lesson.

---

## Definition of Done

- [ ] Problem restated and success criterion named before any generation.
- [ ] Generation and evaluation never co-occurred in one pass.
- [ ] Pool met the unique-idea gate for the chosen depth.
- [ ] Every finalist has all four axis scores, an executability probe, and the confidence gate result.
- [ ] Report includes the high-novelty wildcard and the run stats (bursts, non-duplicate yield, evolution rounds, score trajectory).
- [ ] User verdict requested; lessons written per the loop contract.
