---
title: <Skill> — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - <skill-name>
---

# <Skill> — Diagnostic Surface

This file declares the contract `/create-skill diagnose <skill-name>` reads to parameterize the generic Diagnose Mode procedure for this skill.
Edit each section to match the skill.
The full contract spec lives at [`skills/authoring/create-skill/rules/diagnostic-surface.md`](../../create-skill/rules/diagnostic-surface.md).

---

## Source root

`skills/<skill-name>/`

---

## Phase model

| Phase | Name | Rule file | Gate |
| ----- | ---- | --------- | ---- |
| 0     | <name>          | [<file>.md](./<file>.md)            | <gate description>                                  |
| 1     | <name>          | [<file>.md](./<file>.md)            | <gate description>                                  |
| 2     | <name>          | [<file>.md](./<file>.md)            | <gate description>                                  |

---

## Existing guards per phase

| Phase | Existing guards                         | Typical gaps                                       |
| ----- | --------------------------------------- | -------------------------------------------------- |
| 0     | <list of checks / companions / gates>   | <known classes of failure that bypass the guards>  |
| 1     | <list>                                  | <list>                                             |
| 2     | <list>                                  | <list>                                             |

---

## Failure taxonomy

| ID      | Class       | Symptom                          | Primary phase | Primary gate / companion                                          |
| ------- | ----------- | -------------------------------- | ------------- | ----------------------------------------------------------------- |
| F-novel | Novel mode  | Does not match any existing row  | —             | Diagnosis proposes a new row inline (added on user approval only) |

Taxonomy is append-only.
Every new row must come from a real, confidence-gated, user-approved diagnosis.

---

## Hard invariants

- <gate-or-behavior the diagnoser must never propose to relax>
- <gate-or-behavior the diagnoser must never propose to relax>

---

## Artifacts

| File pattern                          | Produced by               | When                          |
| ------------------------------------- | ------------------------- | ----------------------------- |
| <pattern>                             | <skill / companion>       | <phase or trigger>            |

---

## Lessons scope

<!-- Omit this whole section if the skill has no self-improvement loop. -->

- Scope: `<skill-name>-lessons`
- Tier: `project-shared` (`<repo>/memory/<skill-name>-lessons/`)
- Read for evidence with: `Skill("persistent-memory", "read <skill-name>-lessons --tier project-shared")`

---

## Validators

- <local command — e.g. `claude plugin validate skills/<name>`>
- <local command — e.g. `<test command>`>
