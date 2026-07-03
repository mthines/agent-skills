---
title: 'Phase 0: Validation & Questions'
impact: CRITICAL
tags:
  - validation
  - questions
  - mandatory
  - phase-0
---

# Phase 0: Validation & Questions (MANDATORY)

## Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [Procedure](#procedure)
- [Example](#example)
- [Validation Checklist](#validation-checklist)
- [References](#references)

## Overview

This phase is MANDATORY. Never skip directly to implementation. Understand the
requirement completely, output **MODE SELECTION**, and get explicit user
confirmation before any other work begins.

> **`confidence` is NOT invoked at Phase 0.** The plan-confidence gate runs at
> [Phase 1](./phase-1-planning.md#confidence-gate). Phase 0 ends with the user
> typing "proceed" (or equivalent), not with a confidence score.

## Core Principles

- **No assumptions** — ask about anything unclear.
- **Surface edge cases early** — identify potential issues upfront.
- **Get explicit confirmation** — user must approve understanding before Phase 1.
- **Define "done"** — clear acceptance criteria before starting.
- **Capture everything** — every detail discussed here MUST be transferred to
  `plan.md` in Phase 1. A new Claude session must be able to execute from
  `plan.md` alone with no access to the original conversation.

## Procedure

### Step 1: Parse User Request

Read the request carefully. Identify:

| Element              | Look for                                          |
| -------------------- | ------------------------------------------------- |
| Primary feature/fix  | The verb + noun core of the ask                   |
| Mentioned files/tech | Specific paths, frameworks, libraries called out  |
| Implied requirements | What's assumed but not stated                     |
| Missing information  | What's unclear or under-specified                 |

### Step 2: Analyze Codebase Context

Before asking questions, understand the project. Tools: `nx_workspace`,
`nx_project_details`, `Read`, `Glob`, `Grep`.

| Aspect                | Question to answer                                  |
| --------------------- | --------------------------------------------------- |
| Project structure     | Monorepo or single app? Which packages are involved?|
| Technology stack      | Framework, language, runtime, build tools           |
| Testing setup         | Unit, integration, e2e? Which runner?               |
| Documentation pattern | Where do docs live? README, CLAUDE.md, skills?      |
| Similar features      | Existing patterns to follow                         |

### Step 3: Formulate Clarifying Questions

Cover four buckets:

**Requirements clarity**

- "Should X feature also handle Y scenario?"
- "What should happen when Z edge case occurs?"

**Scope boundaries**

- "Should this include tests / docs / migrations?"
- "Are we updating an existing feature or adding new?"

**Technical decisions**

- "Prefer approach A (simpler) or B (more flexible)?"
- "Follow pattern X from `file.ts` or pattern Y from `other.ts`?"

**Acceptance criteria**

- "How will we know this is complete?"
- "What tests must pass?"

### Step 3b: Restate and Diff the Requirements

**Anchor:** `restate-and-diff`

Before presenting understanding, restate every requirement **in your own
words** and diff the restatement against the user's words. The gap between
what a spec says and what the model perceives is a measured failure mode
(specification misalignment — see
[`references/planning-quality-research.md#42-specification-fidelity-requirement-coverage`](../references/planning-quality-research.md#42-specification-fidelity-requirement-coverage));
surfacing the diff *before* planning is the cheapest place to close it.

Classify every delta and carry it into Step 4:

| Delta kind          | Example                                                        | Treat as                   |
| ------------------- | -------------------------------------------------------------- | -------------------------- |
| Added assumption    | User said "save the preference"; restatement says "…to localStorage" | Question (or tagged `[inferred]` requirement) |
| Dropped clause      | User said "toggle in header and settings"; restatement covers header only | Fix the restatement        |
| Reinterpreted term  | User said "fast"; restatement says "under 200ms"               | Question — do not pin numbers the user never gave |

A restatement with zero deltas on a non-trivial task is a red flag that the
diff was skipped — re-walk the user's words clause by clause.

### Step 3c: Missing-Information Gate

**Anchor:** `missing-information-gate`

Enumerate the information you **need but do not have**, and classify each item.
This is the guess-vs-ask gate: agents measurably hallucinate missing
requirements instead of asking, and self-reported confidence is a poor trigger
for asking — an explicit enumeration is the plan-time substitute.

| Class                 | Criterion                                                                                                   | Action                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `blocking`            | Absence changes the **observable behavior** of the result — data handling, security, error semantics, integration contracts, anything irreversible | **Halt and ask.** Never guess.  |
| `assume-and-proceed`  | Absence affects polish, not behavior — naming, placement, cosmetic defaults                                  | State the assumption explicitly in Step 4 and proceed |

Detection prompts: Is any behavior unspecified for an input that can occur? Is
error handling undefined? Is an external system named without its contract? Do
two requirements conflict? Does a term have 2+ materially different readings
(if the Step 3b restatement diverged on it, it does)?

**A `blocking` item halts even under pre-authorized autonomy** (`--no-confirm` /
"proceed without confirmation") — the grant waives the confirmation *wait*, not
the safety of load-bearing unknowns. Calibrate honestly: over-asking is a real
cost. `blocking` is reserved for information whose absence changes behavior,
not polish.

### Step 4: Present Understanding

Summarize using this exact shape:

```markdown
Based on your request, I understand:

1. **Goal**: [primary objective]
2. **Scope**: [what's included / excluded]
3. **Approach**: [technical approach]
4. **Tests**: [validation strategy]
5. **Docs**: [documentation updates]

Restatement deltas (Step 3b):

- [delta + how it is handled — or "none (clause-by-clause walk done)"]

Missing information (Step 3c):

- blocking: [item — must be answered before proceeding | "none"]
- assuming: [item — stated default | "none"]

Questions before proceeding:

- [Question 1]
- [Question 2]

Does this match your intent?
```

### Step 5: Get Explicit Confirmation

Wait for user response. Do NOT proceed until:

- All questions are answered
- Understanding is validated
- Scope is confirmed
- User explicitly types "proceed" or equivalent

**Pre-authorized autonomy (escape hatch).**
If the user's invocation contains an explicit autonomy grant — the phrase "proceed without confirmation" (or an equivalently explicit grant) or the `--no-confirm` flag — do NOT wait: post the Step 4 understanding summary (including any open questions, answered with your stated best-guess assumptions), emit the MODE SELECTION block, and proceed immediately to Phase 1.
The grant must be explicit in the invocation — never infer it from tone, urgency, or task simplicity.
Default behavior without a grant is unchanged: wait for the user's explicit "proceed".
**Exception — the grant does not cover `blocking` gaps.** If Step 3c classified any missing-information item as `blocking`, halt and ask regardless of the grant: the grant waives the confirmation wait, never a load-bearing unknown. Only `assume-and-proceed` items may be answered with stated assumptions under the grant.

If the user clarifies or corrects:

1. Update your understanding.
2. Re-validate if the change is significant.
3. Re-confirm before proceeding.

### Step 6: Output MODE SELECTION

After confirmation, before Phase 1, emit the mandatory mode-selection block.

**Mode detection: complexity primary, file count tie-breaker.**

Walk the questions in order. The first two probe complexity (the primary
signal — file count alone is easy to game; one large monolithic change can
exceed four trivial edits in scope). The third is the file-count tie-breaker
that only fires when complexity is low.

| # | Question                                                                                  | If yes →     | If no →     |
| - | ----------------------------------------------------------------------------------------- | ------------ | ----------- |
| 1 | Is this task architectural / cross-cutting / does it require significant design decisions? | **Full**     | go to next  |
| 2 | Does the task involve unfamiliar code or domains the agent hasn't worked in before?       | **Full**     | go to next  |
| 3 | Is the change touching 4+ files OR 2+ packages?                                           | **Full**     | go to next  |
| 4 | Is the change 2–3 files, OR any non-trivial logic change?                                 | **Lite**     | **Micro**   |

| Tier     | Artifacts | Planning             |
| -------- | --------- | -------------------- |
| **Full** | Required  | planner → `plan.md`  |
| **Lite** | None      | brief mental plan    |
| **Micro**| None      | none (1-file mechanical: typo / copy / version-or-config bump) |

**Micro** runs the Lite phase path with planning and quality companions skipped.
**Phase 0 and Phase 2 stay mandatory in every tier.** When in doubt, choose the
heavier tier. Output exactly:

```
MODE SELECTION:
- Tier: [Micro | Lite | Full]
- Reasoning: [why]
- Estimated files: [number]
- Complexity: [trivial | simple | moderate | architectural]
- Lessons applied: [N matched, or none]
```

> **Do NOT create artifact files in Phase 0.** Artifacts (`plan.md`,
> `walkthrough.md`) are written inside the worktree after Phase 2. Phase 1
> planning is in-conversation only.

**DO NOT proceed to Phase 1 until Step 6 is complete.**

## Example

```markdown
User: "Add dark mode toggle to the app"

Agent (Phase 0):
"Let me confirm before implementing.

Current analysis:
- Project: Next.js app with Tailwind CSS
- Existing: Light theme only
- Location: No theme infrastructure found

Clarifying questions:
1. **Scope**: Apply globally or per-page?
2. **Persistence**: Save preference (localStorage / cookie)?
3. **Default**: System preference or manual toggle?
4. **Toggle UI**: Where should the toggle live (navbar / settings)?

Proposed approach:
- Theme context provider
- Tailwind `dark:` classes
- Persist to localStorage
- Toggle in navbar

Does this match your vision?"

[Wait for "proceed"]

MODE SELECTION:
- Tier: Full
- Reasoning: Touches provider, layout, navbar, persistence; requires tests
- Estimated files: 6
- Complexity: moderate
- Lessons applied: none
```

## Validation Checklist

Before leaving Phase 0:

- [ ] User request fully understood
- [ ] Requirements restated in own words and diffed against the user's words; every delta surfaced (anchor: `restate-and-diff`)
- [ ] Missing information enumerated and classified `blocking` / `assume-and-proceed`; no unresolved `blocking` item — even under `--no-confirm` (anchor: `missing-information-gate`)
- [ ] All ambiguities clarified
- [ ] Scope explicitly confirmed
- [ ] Acceptance criteria defined
- [ ] Technical approach validated
- [ ] User gave explicit "proceed" signal
- [ ] **MODE SELECTION block emitted (Micro, Lite, or Full)**
- [ ] Branch name decided (artifact creation deferred to Phase 2)

**If any checkbox is unchecked, DO NOT proceed to Phase 1.**

## References

- Next phase: [phase-1-planning](./phase-1-planning.md)
- Mode reasoning: [decision-framework](./decision-framework.md)
- Companion registry: [companion-skills](./companion-skills.md)
