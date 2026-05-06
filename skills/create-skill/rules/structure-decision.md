---
title: Structure Decision — Single-File vs Multi-File Layouts
impact: HIGH
tags:
  - structure
  - layout
  - decision
  - architecture
---

# Structure Decision

Pick the layout **before** writing the skill. Restructuring later is
cheap, but starting with the wrong shape leaks tokens and confuses the
agent loading the skill.

## Decision flow

Walk these in order. The first match wins.

| # | Question                                                                                | Pick                                                |
| - | --------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1 | Will the body exceed 500 lines? (Hard cap.)                                              | **Multi-file** — split now, not after the fact.     |
| 2 | Does the skill have **3+ orthogonal concerns** (e.g. naming + architecture + tests)?     | **Multi-file** — one rule per concern.              |
| 3 | Are there worked examples > 100 lines you want to keep?                                  | **Multi-file** — push examples to `references/`.    |
| 4 | Does the skill emit literal boilerplate (commit messages, plan templates, …)?            | Add `templates/` regardless of single/multi-file.   |
| 5 | Is this a slash command for a single, sequential workflow?                               | **Single-file** — keep it tight.                    |
| 6 | Is the body under 200 lines and the topic single-concern?                                | **Single-file** — splitting would add ceremony.     |

## Layouts by shape

### A — Single-file slash command

```text
my-skill/
└── SKILL.md
```

Used by: `init-claude`, `update-claude`, `create-pr`, `holistic-analysis`,
`confidence`. Best for sequential workflows the user invokes by slash.

### B — Single-file with templates

```text
my-skill/
├── SKILL.md
└── templates/
    ├── plan.md
    └── walkthrough.md
```

When the skill emits structured artefacts. `aw-create-plan` and
`aw-create-walkthrough` follow this pattern.

### C — Multi-file with rules

```text
my-skill/
├── SKILL.md
└── rules/
    ├── concern-a.md
    ├── concern-b.md
    └── concern-c.md
```

Used by: `code-quality`, `tdd`, `dx`, `ux`. Best for advisory skills with
multiple orthogonal concerns. Each rule loads only when relevant.

### D — Full progressive disclosure

```text
my-skill/
├── SKILL.md
├── rules/
│   └── ...
├── references/
│   └── ...
└── templates/
    └── ...
```

Used by: `autonomous-workflow`, `create-skill` (this skill). Reserved for
orchestrators and meta-skills with worked examples and emitted artefacts.

### E — Skill with developer docs

```text
my-skill/
├── SKILL.md          # Runtime instructions
├── README.md         # End-user install / customise
├── CLAUDE.md         # Developer / contributor docs
├── rules/
└── references/
```

Used by `autonomous-workflow`. Add this layer **only** when contributors
need design intent that should not pollute the runtime context.

## Splitting an oversized SKILL.md

If you discover your `SKILL.md` is creeping past 400 lines:

1. List its H2 sections.
2. For each, ask: *would this be useful to load on its own, without the
   rest?* Yes → candidate rule. No → keep in `SKILL.md`.
3. Group examples > 30 lines into `references/<topic>.md`.
4. Replace each moved section in `SKILL.md` with a one-liner pointer:
   ```markdown
   ## Naming

   See [`rules/naming.md`](./rules/naming.md).
   ```

The pointer pattern keeps the navigation map in `SKILL.md` while moving
the cost into tier 3.

## When **not** to split

- The skill has fewer than 200 lines and one mode. Splitting just adds
  navigation overhead.
- The "rules" you would split out are < 30 lines each. They will trigger
  more file reads than they save in tokens.
- The skill is a single sequential script (slash command). Keep it linear.

## Multi-mode skills

A skill with 2–3 modes can stay single-file if each mode is short:

```markdown
## Mode Detection

Parse `$ARGUMENTS`...

## Mode A — scaffold
...

## Mode B — review
...
```

If any one mode exceeds 150 lines, split that mode into
`rules/mode-<name>.md`. `holistic-analysis` is a good example of mode-aware
single-file design.

## Companion skills (a separate decision)

A skill that calls out to another via `Skill()` is **always** multi-file
in spirit, even if each individual skill is single-file. Decide separately
for each:

- The orchestrator (always single-file unless it gets large).
- Each companion (apply this rubric independently).

See `autonomous-workflow` for a real-world orchestrator with multiple
small companions.
