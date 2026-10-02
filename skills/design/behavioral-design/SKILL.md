---
name: behavioral-design
description: >
  Applies behavioral science to make a desired behavior the easy default — for team adoption
  of tools, practices, and process changes as much as for product flows. Diagnoses why a
  behavior is not happening (COM-B, Fogg B=MAP), designs ethical interventions (EAST,
  choice architecture, defaults, friction, System 1 / System 2 fit), audits rollout plans,
  and builds behavior-change workshops and presentations. Never recommends a dark pattern
  or sludge. Use when the question is "why don't people do X" or "how do we get people to
  adopt X", not "is this component usable". Triggers on "behavioral design",
  "behavior change", "nudge", "drive adoption", "why aren't people using", "make it easy
  to adopt", "system 1 / system 2", "thinking fast and slow", "/behavioral-design".
disable-model-invocation: false
argument-hint: '[diagnose|design|workshop|review] <target behavior or context>'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags: [behavioral-design, behavior-change, nudge, choice-architecture, com-b, fogg, dual-process, adoption, change-management, workshop]
---

# Behavioral Design

Make the target behavior the path of least resistance, then prove it moved.
Advisory only: this skill writes plans, outlines, and reports, never product code.

## Mode Detection

Parse the first token of `$ARGUMENTS`.

| Mode | Trigger | Output |
| --- | --- | --- |
| `diagnose` | "why don't / aren't people…", "what's blocking adoption", first token `diagnose` | Barrier diagnosis ([`templates/intervention-plan.md`](./templates/intervention-plan.md) § Diagnosis only) |
| `design` | "how do we get people to…", "how do we fix this", "nudge", "drive adoption", the user proposes specific levers to apply ("can we auto-enroll…"), first token `design` | Full intervention plan ([`templates/intervention-plan.md`](./templates/intervention-plan.md)) |
| `workshop` | "workshop", "presentation", "talk", "session for the team", first token `workshop` | Workshop plan ([`templates/workshop.md`](./templates/workshop.md)) |
| `review` | "review this rollout / plan / flow" for an existing written plan or shipped flow, first token `review` | Findings against the rules, ranked |

No mode token and no matching phrase → `design` (it includes the diagnosis).
State the detected mode and the target behavior in one line before continuing:

```text
Mode: design
Target behavior: engineers run `pnpm test` locally before pushing
```

## Required Reading by Mode

Load on demand — never all up-front.

| Mode | Load |
| --- | --- |
| `diagnose` | [`rules/diagnosis.md`](./rules/diagnosis.md), [`rules/dual-process.md`](./rules/dual-process.md) |
| `design` | [`rules/diagnosis.md`](./rules/diagnosis.md), [`rules/interventions.md`](./rules/interventions.md), [`rules/dual-process.md`](./rules/dual-process.md), [`rules/ethics.md`](./rules/ethics.md), [`references/frameworks.md`](./references/frameworks.md) § Evidence grading |
| `workshop` | [`rules/workshop.md`](./rules/workshop.md), [`rules/dual-process.md`](./rules/dual-process.md), [`rules/ethics.md`](./rules/ethics.md) |
| `review` | [`rules/dual-process.md`](./rules/dual-process.md), [`rules/interventions.md`](./rules/interventions.md), [`rules/ethics.md`](./rules/ethics.md), [`references/frameworks.md`](./references/frameworks.md) § Evidence grading |

[`references/frameworks.md`](./references/frameworks.md) holds the sources and the evidence grading behind every lever.
`design` and `review` always load its Evidence grading section; other modes load it when the user asks "is this backed by research", when a claim needs a citation in a presentation, or before quoting an effect size.

## Workflow

### Step 1 — Pin the target behavior

Rewrite the request as one observable behavior: **who** does **what**, **when / where**, measured **how**.

```text
✗ "Get people to care about observability."
✓ "Every engineer opening a PR that adds an API endpoint adds an OTel span to it — measured as % of such PRs with a span, from the PR diff."
```

If the request names an attitude ("care about", "embrace", "be aligned") instead of an action, ask for the action once.
Never design against an attitude: attitudes are not observable, so nothing can prove the intervention worked.

### Step 2 — Gather context

Collect, or ask for in one batched message:

1. The current baseline (how often the behavior happens now), or "unknown".
2. Who the actors are (role, count, seniority spread).
3. The moment the behavior should happen (the trigger event in their day).
4. What has already been tried and how it went.

Unknown values are allowed; record them as `unknown` and make measuring them the first action.
When the user does not answer (or the run is non-interactive), proceed with `unknown`s and list every assumption in the output — never stall.

### Step 3 — Run the mode

Follow the loaded rule files for the detected mode.
`design` always runs [`rules/diagnosis.md`](./rules/diagnosis.md) first — an intervention chosen before the barrier is known is a guess.

### Step 4 — Ethics gate

Before emitting any intervention, run the three-question test in [`rules/ethics.md`](./rules/ethics.md).
Any intervention that fails is dropped from the output and replaced by its honest alternative.

### Step 5 — Emit

Fill the mode's template.
Every intervention carries its lever, the barrier it targets, the evidence grade from [`references/frameworks.md`](./references/frameworks.md), and a metric that would show it worked.

## Hard Rules

1. **Behavior, not attitude.** Every output names one observable target behavior (Step 1).
2. **Diagnose before prescribing.** No intervention without a named COM-B barrier.
3. **Ease beats persuasion.** Rank ability and environment levers (defaults, fewer steps, better timing) above motivation levers (explaining why, incentives) — see [`rules/interventions.md`](./rules/interventions.md).
4. **Measure or it did not happen.** Every intervention has a metric and a baseline-or-`unknown`.
5. **Never a dark pattern, never sludge.** Refuse manipulation requests and propose the honest alternative — see [`rules/ethics.md`](./rules/ethics.md). This overrides default helpfulness.
6. **Grade the evidence honestly.** Do not cite priming, ego depletion, or a headline nudge effect size as settled — see [`references/frameworks.md`](./references/frameworks.md) § Evidence grading.

## Composition

| Situation | Hand off to |
| --- | --- |
| The intervention is a UI change and needs a usability / WCAG review | `Skill("ux")` |
| The intervention needs telemetry to measure the behavior | `Skill("measurable")` |
| The plan is high-stakes and needs a pre-mortem | `Skill("critical")` |
| The user wants many intervention ideas before converging | `Skill("ideate")` |

A missing skill never blocks; report it in one line (`<name> — skipped (not installed)`) and continue.
