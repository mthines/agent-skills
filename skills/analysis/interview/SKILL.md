---
name: interview
description: >
  Aligns on the scope of a request before any plan or implementation begins — the
  requirements-elicitation interview a senior engineer runs before touching code.
  Restates the request and diffs it against the user's words, researches the codebase
  so questions are specific, surfaces unknowns, non-goals, edge cases, and success
  criteria, then runs a batched clarifying-question interview only when research
  cannot resolve the ambiguity (adaptive — stays silent when the request is already
  crisp). Produces a confirmed brief.md artifact that downstream planning consumes,
  plus a readiness verdict (ready / ready-with-assumptions / blocked). Convergent and
  pre-plan: hands option-generation to /ideate, plan review to /critical, and scoring
  to /confidence. Use before autonomous work, before planning, or when a request feels
  underspecified. Triggers on "align on scope", "interview me", "clarify the request",
  "scope this", "scope alignment", "before we plan", "/interview".
disable-model-invocation: false
argument-hint: '[<request>] [--non-interactive]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags:
    - requirements
    - scope-alignment
    - elicitation
    - clarifying-questions
    - interview
    - discovery
    - pre-planning
    - non-goals
    - readiness-gate
    - brief-artifact
---

# Interview

Turns an underspecified request into a confirmed, thought-through scope before a single line is planned or written.
It restates and diffs the request, researches the code so its questions are specific, surfaces the unknowns and non-goals, interviews the user only where research falls short, and emits a `brief.md` that planning consumes.

> **This `SKILL.md` is a thin index.** Phase procedures live in `rules/*.md` and load on demand.
> A full worked run lives in [`references/interview-example.md`](./references/interview-example.md).

## Contents

- [When it runs](#when-it-runs)
- [Workflow](#workflow)
- [Required reading by phase](#required-reading-by-phase)
- [Core principles](#core-principles)
- [Anti-patterns](#anti-patterns)
- [Definition of done](#definition-of-done)

---

## When it runs

`$ARGUMENTS` is the request to align on (free text).
If `$ARGUMENTS` is empty, use the current conversation's active request; if there is none, ask what to scope — never interview against a guessed request.

| Flag                | Default | Meaning                                                                                                                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `--non-interactive` | off     | Do not prompt the user. Surface the questions inside `brief.md` under `Open questions`, proceed on stated assumptions, and set the readiness verdict. For headless callers that cannot prompt. |

This skill is **adaptive**.
When the request is already crisp and research answers the open questions, it asks nothing, writes a one-line pass note plus the brief, and returns `ready`.
It interrupts only for a genuine, load-bearing unknown — see [`rules/readiness-gate.md`](./rules/readiness-gate.md).

### Relation to `aw` and `ideate` (precedence)

- **Autonomous-implementation asks** ("implement X autonomously", "ship this", `@aw`) are owned by `aw`, which runs this interview *inside* its Phase 0 (default-on for Full tier — see [`rules/aw-integration.md`](./rules/aw-integration.md)) — do not also fire standalone; let `aw` drive.
- **Standalone `/interview`** is for the explicit "help me scope this first" moment on non-`aw` or ambiguous work.
- **For solution *options*, not scope**, use `/ideate` — it diverges and scores; this skill converges on the one scope.

## Workflow

Five phases, each with a gate. Do not advance until the gate passes.

| Phase | Name                    | Rule file                                                                     | Gate                                                                        |
| ----- | ----------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 0     | Restate & diff          | [`rules/research-grounding.md`](./rules/research-grounding.md)                 | Request restated in own words; every delta from the user's words surfaced.  |
| 1     | Research the ground     | [`rules/research-grounding.md`](./rules/research-grounding.md)                 | Affected areas, prior art, patterns, and constraints located in the code.   |
| 2     | Surface unknowns (gate) | [`rules/readiness-gate.md`](./rules/readiness-gate.md), [`rules/consultative-completeness.md`](./rules/consultative-completeness.md) | Every unknown enumerated and classified `blocking` vs `advisory`; interview-or-pass decided. |
| 3     | Interview               | [`rules/question-design.md`](./rules/question-design.md)                       | Blocking + high-value unknowns asked in ≤ 2 batched rounds, or skipped (adaptive pass). |
| 4     | Confirm & brief         | [`rules/brief-artifact.md`](./rules/brief-artifact.md)                         | Understanding confirmed; `brief.md` written; readiness verdict set.         |

## Required reading by phase

Load on demand — do not preload.

| Phase | Files                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------- |
| 0–1   | [`rules/research-grounding.md`](./rules/research-grounding.md)                                                 |
| 2     | [`rules/readiness-gate.md`](./rules/readiness-gate.md), [`rules/consultative-completeness.md`](./rules/consultative-completeness.md) |
| 3     | [`rules/question-design.md`](./rules/question-design.md)                                                       |
| 4     | [`rules/brief-artifact.md`](./rules/brief-artifact.md)                                                         |
| aw    | [`rules/aw-integration.md`](./rules/aw-integration.md) — how `aw` / `aw-planner` delegate to this skill.       |

## Core principles

1. **Research before asking.** A question the codebase already answers is noise. Ground every question in what the code shows so it is specific ("reuse `PrStatusCache` or add a cache?"), not generic ("what do you want?"). See [`rules/research-grounding.md`](./rules/research-grounding.md).
2. **Interrupt only for load-bearing unknowns.** Classify each unknown `blocking` vs `advisory`. Ask about blocking ones; proceed on advisory ones and record the assumption. Silence is the correct output for a crisp request. See [`rules/readiness-gate.md`](./rules/readiness-gate.md).
3. **Batch the questions.** One prioritized round via `AskUserQuestion`, two at most. Never drip questions one at a time. See [`rules/question-design.md`](./rules/question-design.md).
4. **Consultative, not stenographic.** Capture intent *and* pressure-test completeness: non-goals, edge cases, success criteria, constraints. This is the "is it thought-through" half. See [`rules/consultative-completeness.md`](./rules/consultative-completeness.md).
5. **Converge, don't diverge.** This skill pins down the *one* thing to build. It hands divergent option-generation to `/ideate`, adversarial plan review to `/critical`, and readiness scoring to `/confidence`. Do not duplicate them.
6. **The brief is the deliverable.** A confirmed, self-contained `brief.md` plus a readiness verdict — nothing more. It writes no product code. See [`rules/brief-artifact.md`](./rules/brief-artifact.md).

## Anti-patterns

- Asking a question the code answers. **Fix:** research first (Phase 1).
- Dripping questions one at a time across turns. **Fix:** batch into one `AskUserQuestion` round.
- Interviewing a request that is already crisp. **Fix:** honor the adaptive pass — write the brief, return `ready`, ask nothing.
- Generating solution options. **Fix:** that is `/ideate`; this skill converges on scope.
- Adversarially red-teaming an implementation plan. **Fix:** that is `/critical`; run it after a plan exists.
- Producing a scored gate verdict. **Fix:** that is `/confidence`; this skill elicits the inputs a score needs.
- Writing product code or a plan. **Fix:** stop at `brief.md`; hand off to planning.

## Definition of done

- [ ] Request restated in own words; every delta from the user's words surfaced (Phase 0).
- [ ] Affected code areas, prior art, and constraints located (Phase 1).
- [ ] Every unknown enumerated and classified `blocking` vs `advisory` (Phase 2).
- [ ] Blocking + high-value unknowns resolved via ≤ 2 batched rounds, or a clean adaptive pass logged (Phase 3).
- [ ] `brief.md` written to `.agent/{branch}/brief.md` (re-run updates it in place).
- [ ] Readiness verdict set: `ready` | `ready-with-assumptions` | `blocked`.
- [ ] One-line summary delivered naming the verdict and pointing at the brief.
