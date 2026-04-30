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

### Step 4: Present Understanding

Summarize using this exact shape:

```markdown
Based on your request, I understand:

1. **Goal**: [primary objective]
2. **Scope**: [what's included / excluded]
3. **Approach**: [technical approach]
4. **Tests**: [validation strategy]
5. **Docs**: [documentation updates]

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
| 1 | Is this task architectural / cross-cutting / does it require significant design decisions? | **Full Mode** | go to next  |
| 2 | Does the task involve unfamiliar code or domains the agent hasn't worked in before?       | **Full Mode** | go to next  |
| 3 | Is the change touching 4+ files OR 2+ packages?                                           | **Full Mode** | **Lite Mode** |

| Mode     | Artifacts |
| -------- | --------- |
| **Full** | Required  |
| **Lite** | None      |

**When in doubt, choose Full.** Output exactly:

```
MODE SELECTION:
- Mode: [Full | Lite]
- Reasoning: [why]
- Estimated files: [number]
- Complexity: [simple | moderate | architectural]
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
- Mode: Full
- Reasoning: Touches provider, layout, navbar, persistence; requires tests
- Estimated files: 6
- Complexity: moderate
```

## Validation Checklist

Before leaving Phase 0:

- [ ] User request fully understood
- [ ] All ambiguities clarified
- [ ] Scope explicitly confirmed
- [ ] Acceptance criteria defined
- [ ] Technical approach validated
- [ ] User gave explicit "proceed" signal
- [ ] **MODE SELECTION block emitted (Full or Lite)**
- [ ] Branch name decided (artifact creation deferred to Phase 2)

**If any checkbox is unchecked, DO NOT proceed to Phase 1.**

## References

- Next phase: [phase-1-planning](./phase-1-planning.md)
- Mode reasoning: [decision-framework](./decision-framework.md)
- Companion registry: [companion-skills](./companion-skills.md)
