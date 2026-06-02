---
title: Diagnostic Surface — Contract for Diagnosable Skills
impact: HIGH
tags:
  - diagnose
  - contract
  - skill-quality
  - meta
---

# Diagnostic Surface

## Contents

- [Required sections](#required-sections)
- [Where to put the file](#where-to-put-the-file)
- [How to add a diagnostic surface to an existing skill](#how-to-add-a-diagnostic-surface-to-an-existing-skill)
- [How to evolve a diagnostic surface](#how-to-evolve-a-diagnostic-surface)
- [Common mistakes](#common-mistakes)

---

A skill becomes diagnosable by `/create-skill diagnose <name>` when it declares a `rules/diagnostic-surface.md` file in its own directory.
The surface tells the diagnoser five things it cannot reliably infer from `SKILL.md` alone: the **phase model**, the **failure taxonomy**, the **existing-guards-per-phase table**, the **source root**, and the **hard invariants** the diagnoser must not propose to weaken.

This rule is the contract spec.
The literal scaffolding template lives at [`templates/diagnostic-surface.template.md`](../templates/diagnostic-surface.template.md).

---

## Required sections

A valid `rules/diagnostic-surface.md` contains the eight sections below in order.
Missing any section ⇒ `create-skill diagnose` falls back to inferred mode and warns the user.

### 1. Frontmatter

```yaml
---
title: <Skill> — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - <skill-name>
---
```

### 2. Source root

The repo-relative path that `git apply` is executed from when `--apply` runs.
For multi-file skills it is `skills/<skill-name>/`.
For single-file agents under `agents/` it is `agents/` (the agent body `agents/<name>.md` and any sibling files under `agents/<name>/` share the same root so a diff can touch both).

```markdown
## Source root

`skills/<skill-name>/`
```

For an agent target:

```markdown
## Source root

`agents/`
```

### 3. Phase model

The ordered list of phases / steps / stages the skill executes.
Each row gives the diagnoser a place to slot per-phase findings.

```markdown
## Phase model

| Phase | Name | Rule file | Gate |
| ----- | ---- | --------- | ---- |
| 0     | <Validation>          | [phase-0-validation.md](./phase-0-validation.md)      | <user confirmed understanding>            |
| 1     | <Planning>            | [phase-1-planning.md](./phase-1-planning.md)          | <`confidence(plan) ≥ 90%`>                |
| ...   | ...                   | ...                                                   | ...                                       |
```

Skills that are not phase-based (e.g. a single-mode advisory skill) declare a single row with `name: full skill body` and the gate the skill exits on.

### 4. Existing-guards-per-phase table

For every phase, list the checks / companions / gates that already run.
The diagnoser uses this table to spot **gaps**: a failure that bypasses every listed guard is the failure mode worth proposing a new check for.

```markdown
## Existing guards per phase

| Phase | Existing guards                                                     | Typical gaps                                                           |
| ----- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0     | <Mode detection; user confirms understanding>                       | <Mode set to Lite for a task that should have been Full>               |
| 1     | <`code-quality(plan)`; `confidence(plan)` ≥ 90 % gate>              | <Plan missed a hidden constraint>                                      |
| ...   | ...                                                                 | ...                                                                    |
```

The "typical gaps" column is **append-only** — every confidence-gated, user-approved diagnosis adds new entries; nothing is ever removed.

### 5. Failure taxonomy

The known failure classes for this skill.
Seed with `F-novel` as a catch-all and add classes only as real diagnoses produce them.

```markdown
## Failure taxonomy

| ID      | Class       | Symptom                          | Primary phase | Primary gate / companion                     |
| ------- | ----------- | -------------------------------- | ------------- | -------------------------------------------- |
| F-novel | Novel mode  | Does not match any existing row  | —             | Diagnosis proposes a new row inline (added on user approval only) |
```

The taxonomy is **append-only** — every novel failure mode adds a new row, the row is justified by a diagnosis that cleared `confidence(analysis) ≥ 90 %` AND was user-approved at apply time.
Speculative categories are not pre-populated — they push the diagnoser toward forcing a match where none exists.

### 6. Hard invariants

Gates and behaviors the diagnoser **must not** propose to relax.
A proposal that touches one of these requires the user to type the change manually.

```markdown
## Hard invariants

- <`confidence` at Phase 1 is non-removable.>
- <Phase 0 and Phase 2 are mandatory.>
- <Companions degrade silently — never block on a missing companion (except the load-bearing one above).>
- ...
```

If your skill has no hard invariants, write `(none)` — but think hard before doing so.
Most non-trivial skills have at least one load-bearing gate.

### 7. Artifacts

Files the skill produces that carry diagnostic evidence.
The diagnoser reads these in Step 2 of its procedure.

```markdown
## Artifacts

| File pattern                          | Produced by                | When                                |
| ------------------------------------- | -------------------------- | ----------------------------------- |
| `.agent/{branch}/plan.md`             | <`aw-create-plan`>         | <after Phase 2>                     |
| `.agent/{branch}/walkthrough.md`      | <`aw-create-walkthrough`>  | <Phase 6>                           |
| ...                                   | ...                        | ...                                 |
```

If your skill produces no artifacts, write `(none — diagnosis relies on transcript only)`.
Be honest — a skill with no artifact trail is harder to diagnose, and the report should call that out.

### 8. Validators (optional)

Local commands the diagnoser can run after `--apply` to confirm the change did not break the skill.

```markdown
## Validators

- `claude plugin validate skills/<skill-name>` — frontmatter + structure check.
- `<any test command the skill ships>` — regression check.
```

---

## Where to put the file

For a skill:

```
skills/<skill-name>/
└── rules/
    └── diagnostic-surface.md
```

For an agent (the agent body stays as the single file `agents/<name>.md`; rules live in a sibling directory):

```
agents/
├── <name>.md
└── <name>/
    └── rules/
        └── diagnostic-surface.md
```

Always inside `rules/`, always named `diagnostic-surface.md`.
The diagnoser resolves it by exact path — do not rename or relocate.

---

## How to add a diagnostic surface to an existing skill

1. Copy [`templates/diagnostic-surface.template.md`](../templates/diagnostic-surface.template.md) into `skills/<skill-name>/rules/diagnostic-surface.md`.
2. Fill in the eight sections from the skill's `SKILL.md` and `CLAUDE.md` (if present).
3. Add a one-line link to it from the skill's `SKILL.md` so a reader of the skill can find it.
4. Run `/create-skill diagnose <skill-name>` against a known historical failure (or a synthesised one) and confirm the report cites the correct phase and proposes a sensible fix.

The investment is small — a typical surface file is under 100 lines — and pays off the first time a real failure makes it into the field.

---

## How to evolve a diagnostic surface

The surface is a living document.
Two events drive updates:

- **A novel failure mode is diagnosed.** The diagnoser proposes appending a new row to the failure taxonomy. The user approves. The new row is committed.
- **A new gate is added or an old one is removed.** Update the existing-guards table in the same PR — otherwise the diagnoser walks a stale matrix and either misses gaps or proposes redundant checks.

Both events are append-only: the taxonomy grows, the existing-guards table grows.
Removals happen only when the underlying gate or companion is itself removed from the skill.

---

## Common mistakes

- **Treating the surface as static.** Update it whenever a real diagnosis runs. **Fix:** include a check in the skill's PR template.
- **Pre-populating the failure taxonomy.** Speculation pushes the diagnoser to force-match. **Fix:** seed only with `F-novel`, grow from real diagnoses.
- **Hiding the source root.** A wrong source root makes `--apply` fail silently or write to the wrong place. **Fix:** state the path explicitly.
- **Omitting hard invariants.** Without them, the diagnoser may propose relaxing a load-bearing gate. **Fix:** list every gate the skill considers non-negotiable.
- **Storing the surface outside `rules/`.** The diagnoser looks for an exact path. **Fix:** use `skills/<name>/rules/diagnostic-surface.md` for skills or `agents/<name>/rules/diagnostic-surface.md` for agents.
