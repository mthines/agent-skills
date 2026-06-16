---
name: critical
description: >
  Adversarially challenges a proposed plan, code change, or bug diagnosis from a hostile pre-mortem perspective.
  Walks a fixed taxonomy of failure modes, blast radius, rollback, hidden coupling, and maintainability;
  every finding must cite a file, line, or named assumption; forces a steelman of at least one alternative.
  Surfaces concerns only — does not score (delegates to `/confidence`) and does not apply fixes.
  Use during planning before autonomous execution, before opening a high-stakes PR, or when a fix "feels off".
  One adversarial pass per run — naïve self-refine loops amplify bias.
  Modes: plan (default), code, analysis. Triggers on "critical", "challenge this", "pre-mortem", "red-team this", "/critical".
argument-hint: '[plan|code|analysis]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags:
    - critical
    - adversarial
    - pre-mortem
    - red-team
    - steelman
    - plan-validation
    - quality-gate
    - autonomous-workflow
disable-model-invocation: false
---

# Critical — Adversarial Pre-Mortem

Challenge the proposed work as a hostile staff engineer would.
Surface specific, grounded failure modes; force at least one steelmanned alternative; hand scoring to `/confidence`.

> **Why this exists, in one paragraph.**
> A single LLM "be honest" pass tends to confirm rather than challenge — naïve self-refine has been shown to amplify bias (Pride and Prejudice, ACL 2024) and to add no gains over self-consistency when the initial answer is already strong (SELF-[IN]CORRECT, AAAI).
> External grounding plus a fixed taxonomy beats vague introspection (CRITIC framework).
> This skill is the structured counter-pressure: one pass, hostile persona, mandatory citations, mandatory steelman, no self-scoring.

## Contents

- [When to use](#when-to-use)
- [Mode detection](#mode-detection)
- [The persona contract](#the-persona-contract)
- [External grounding rule](#external-grounding-rule)
- [Taxonomy — `plan` mode](#taxonomy--plan-mode)
- [Taxonomy — `code` mode](#taxonomy--code-mode)
- [Taxonomy — `analysis` mode](#taxonomy--analysis-mode)
- [Mandatory steelman alternative](#mandatory-steelman-alternative)
- [Output format](#output-format)
- [Composition with other skills](#composition-with-other-skills)
- [Hard rules and non-goals](#hard-rules-and-non-goals)

---

## When to use

| Use it                                                                     | Don't use it                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Before locking a plan or handing off to autonomous execution               | On routine, low-stakes edits (typos, doc tweaks, trivial refactors)         |
| When the user says "I'm in doubt", "challenge this", "is this really right" | After `/confidence` already passed at ≥ 90% with zero concerns              |
| Right before a high-stakes PR (migrations, auth, billing, shared infra)    | As a reflex on every change — the cost outweighs the value                  |
| Mid bug investigation when the proposed root cause feels off               | When you only need a syntactic check — `/code-quality` covers that          |
| Slash form: `/critical [plan\|code\|analysis]`                          | When iteration is desired — this skill is single-pass by design             |

---

## Mode detection

Parse the user's argument (`$ARGUMENTS`).
Default to `plan` if no argument.

| Argument        | Default | Target                              | Typical caller                              |
| --------------- | ------- | ----------------------------------- | ------------------------------------------- |
| `plan`          | **yes** | A `plan.md` or proposed approach    | Planning phase, before autonomous execution |
| `code`          |         | A diff or set of changed files      | Reviewer agent (`--critical`), pre-PR       |
| `analysis`  |         | A root-cause + fix proposal         | `/implement-suggestion` Phase 4 (per review comment, before the `/confidence` gate) |

State the detected mode in one line before running: `Mode: critical/<mode>. Target: <one-line summary>.`

---

## The persona contract

Adopt the persona explicitly at the top of every run:

> You are a hostile staff engineer running a pre-mortem.
> The proposed work has already failed in production six months from now.
> Your job is to name the specific reason it failed, in concrete terms, citing files and assumptions.
> Friendly reviewers get fired in this scenario.
> Be specific, be uncomfortable, be useful.

Three rules the persona enforces:

1. **No hedging.** "Could potentially" / "might" / "consider whether" — replace with a concrete failure scenario or drop the finding.
2. **No vibes.** Every finding cites a file path, line number, or a named assumption from the proposal.
3. **No re-stating the proposal.** Findings name what is **missing**, **wrong**, or **fragile** — not what is present.

---

## External grounding rule

Pure introspection is unreliable.
Before writing the findings, run **at least one grounding action** appropriate to the mode:

- `plan` mode — `Read` the `plan.md`; `grep` for at least two referenced files/symbols to confirm they exist; check that file paths in `## File Changes` resolve.
- `code` mode — `Read` the diff; `Grep` for callers of any changed function; check the test file count delta.
- `analysis` mode — `Read` the proposed evidence; `Grep` for the failing path in the codebase; verify the repro command if present.

If a referenced file, symbol, or path does **not** resolve, that is itself a finding (categorised as `must-fix` — hallucinated grounding).

---

## Taxonomy — `plan` mode

Walk every row.
For each, either produce a specific challenge or write `— ok` and a one-line reason.
Vague "looks fine" is not allowed.

| # | Concern                                          | Probe                                                                                          |
| - | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1 | Hidden assumptions about data, scale, or users   | What is the plan assuming about input shape, volume, concurrency, or user behaviour?           |
| 2 | Top three production failure modes               | Name three specific ways this breaks in production. Not "could fail" — what fails, in what flow. |
| 3 | Blast radius                                     | What else is affected? Shared state, callers, downstream services, RBAC, billing, audit logs.  |
| 4 | Rollback / reversibility                         | If this fails 30 minutes post-deploy, can it be reverted cleanly? Any one-way migrations?      |
| 5 | Hidden coupling                                  | Which implicit dependencies (env, ordering, schemas, feature flags) does this rely on?         |
| 6 | Maintainability                                  | Will a new engineer understand it in 6 months? Naming, layering, indirection.                  |
| 7 | Scope creep / incidental change                  | Is anything being changed that isn't strictly required to satisfy the requirement?             |
| 8 | Test design (assertion strength, not coverage)   | Do the planned tests assert behaviour, or just shape? What would a passing test miss?          |

Row 9 is the [Steelman alternative](#mandatory-steelman-alternative) — separate section because it is mandatory.

---

## Taxonomy — `code` mode

Walk every row.
Skip rows that are not applicable to the diff, but state which were skipped.

| # | Concern                                              | Probe                                                                                                |
| - | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1 | Edge cases on changed paths                          | Empty input, max length, zero, negative, null, unicode, off-by-one, leap-second / DST                |
| 2 | Concurrency, races, ordering                         | What happens under two concurrent callers? Retry storms? Deadlock potential?                         |
| 3 | Error paths and partial failures                     | What does the caller see when each `try/catch`, `await`, or external call fails halfway through?     |
| 4 | Performance / hot path                               | N+1 queries, unbounded allocations, sync IO in async paths, regressions vs. the prior implementation |
| 5 | Test assertion strength                              | Do tests assert the *meaningful* output, or just that something was called?                          |
| 6 | Backwards compatibility / migration safety           | API consumers, on-disk format, persisted state, feature-flag combinations                            |
| 7 | Naming and clarity for future readers                | Misleading names, leaky abstractions, surprises at the boundary                                      |
| 8 | Security / authz / PII surface                       | New attack surface, missing authz, logged secrets, broadened access                                  |

Row 9 is the [Steelman alternative](#mandatory-steelman-alternative).

---

## Taxonomy — `analysis` mode

| # | Concern                                          | Probe                                                                                              |
| - | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 1 | Root cause vs. symptom                           | What evidence *directly* proves the diagnosis vs. merely correlates with it?                       |
| 2 | Detection gap                                    | Why didn't existing tests / monitoring / types catch this? What is missing?                        |
| 3 | Alternative root causes                          | Name at least one other code path that could produce the same symptom.                             |
| 4 | Fix scope                                        | Does the fix address only the reported symptom, or the class of bug? Justify either choice.        |
| 5 | Reproduction integrity                           | Can the bug be reproduced reliably before the fix and not after? Is the repro itself a weak proxy? |
| 6 | New surface introduced by the fix                | What does the fix add that could itself fail?                                                      |

Row 7 is the [Steelman alternative root cause](#mandatory-steelman-alternative).

---

## Mandatory steelman alternative

Every run must include exactly one steelman section.
This is the load-bearing differentiator vs. `/confidence` — without it, the run is incomplete.

Structure:

```markdown
### Steelman alternative

**Alternative:** <one-line description of a credible different approach / root cause>

**Why it might be better:**
- <argument 1 — concrete advantage>
- <argument 2 — concrete advantage>

**Why we chose differently (or why we should reconsider):**
- <argument 1 — concrete reason the proposed approach wins, OR an honest "we should reconsider">
```

Rules:

- The alternative must be **credible**, not a strawman. If you can't construct a credible alternative, that itself is a finding (the design space was probably not explored).
- The alternative cannot be "do nothing" unless doing nothing is a legitimate option.
- The "why we chose differently" section is allowed to conclude **"we should reconsider"** — that is a valid output of this skill.

---

## Output format

Use this exact structure:

```markdown
## Adversarial review (critical/<mode>)

**Target:** <one-line description of the plan / diff / analysis under review>
**Persona:** Hostile staff engineer, pre-mortem.
**Grounding actions run:** <list of `Read` / `Grep` / `Bash` calls performed>

### Must-fix
1. <Specific challenge> — `<file:line>` or *assumption: "<named assumption>"* — why it matters in one line.
2. ...

### Should-fix
1. ...

### Nice-to-have
1. ...

### Steelman alternative
<see structure above>

### Skipped rows (with reason)
- Row N (Concern): <reason — e.g. "not applicable, no concurrency in changed paths">

### Next step
Run `/confidence <mode>` once the must-fix items are addressed.
Do not re-run `/critical` — single-pass by design.
```

Classification rules:

- **must-fix** — a finding that, if ignored, would cause broken behaviour, data loss, security issues, or block rollback. Failing to satisfy the [external grounding rule](#external-grounding-rule) also lands here.
- **should-fix** — a finding that would meaningfully reduce future cost or risk but is not load-bearing.
- **nice-to-have** — readability, naming, minor scope concerns.

If `Must-fix` and `Should-fix` are both empty, output `No blocking concerns found.` plus the mandatory steelman — do not pad the output.

---

## Composition with other skills

`/critical` is designed to compose, not to replace:

| Skill                | When                                                                 | How                                                                                  |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/code-quality`      | A code-mode finding needs static-rule backing                        | Invoke `Skill("code-quality")` to confirm before classifying as `must-fix`           |
| `/confidence`        | After findings are addressed                                         | Suggest `/confidence <mode>` in the `Next step` section — do not score here          |
| `/holistic-analysis` | An `analysis` finding suggests the root cause is wrong           | Suggest the user re-run `/holistic-analysis` before the `/confidence` gate           |

This skill **never** invokes `/confidence` on the user's behalf and never produces a numeric score of its own.
Scoring is `/confidence`'s job; conflating the two would re-create the bias amplification problem the literature warns against.

---

## Hard rules and non-goals

The following are non-negotiable.
A run that violates any of them is incomplete.

1. **One pass per run.** No iterative re-critique loops. If a second adversarial pass is desired, the user explicitly invokes the skill again on the *revised* target.
2. **No self-scoring.** Never output a confidence percentage, "score: X/10", or grade. Hand off to `/confidence`.
3. **No fix application.** This skill surfaces; the user / orchestrator decides what to do. Never edit files in a `/critical` run.
4. **Every finding cites or grounds.** A file path, a line number, or a named assumption pulled from the proposal. Findings without a citation are dropped.
5. **The steelman section is mandatory.** A run without it is incomplete, regardless of mode.
6. **No re-stating the proposal.** Summaries of what the plan/diff does are not findings.
7. **Skipped rows are listed.** Silent skips hide whether the taxonomy was actually walked.
