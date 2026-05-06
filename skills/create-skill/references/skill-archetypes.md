---
title: Skill Archetypes — Worked Examples by Shape
impact: MEDIUM
tags:
  - archetypes
  - examples
  - reference
---

# Skill Archetypes

Worked examples of the common skill shapes. Each archetype shows the
frontmatter, the layout, and what makes the shape worth using.

## Contents

- A1 — Advisory skill (review-style)
- A2 — Applied skill (writes code)
- A3 — Slash command (sequential workflow)
- A4 — Workflow companion (called by another skill)
- A5 — Orchestrator (multi-phase, calls companions)
- A6 — Scaffolder (generates new artefacts)
- A7 — Multi-mode skill (modes share a body)
- A8 — Forked subagent skill (`context: fork`)
- A9 — Background-knowledge skill (`user-invocable: false`)

---

## A1 — Advisory skill (review-style)

**Examples in this repo:** `code-quality`, `dx`, `ux`,
`holistic-analysis`.

**Shape:**

```text
my-advisory/
├── SKILL.md
└── rules/
    ├── concern-a.md
    ├── concern-b.md
    └── concern-c.md
```

**Frontmatter:**

```yaml
---
name: code-quality
description: >
  Reviews code for cognitive complexity, readability, and maintainability.
  Use during PR review, after writing code, or when asked to "clean this up".
  Triggers on "review code", "audit complexity", "/code-quality".
metadata:
  workflow_type: advisory
---
```

**What makes it advisory:** read-only by default. The skill produces a
report; it does not write code. Every rule is loaded only when its
concern applies (file-extension match or keyword).

---

## A2 — Applied skill (writes code)

**Examples in this repo:** `tdd`, `implement-suggestion`.

**Shape:**

```text
my-applied/
├── SKILL.md
└── rules/
    └── ...
```

**Frontmatter:**

```yaml
---
name: tdd
description: >
  Drives implementation through RED-GREEN-REFACTOR cycles, writing one
  failing test, then minimal code, then refactoring. Triggers on "tdd",
  "test driven", "/tdd".
metadata:
  workflow_type: applied
---
```

**What makes it applied:** the skill calls Edit/Write to produce code. The
description makes it clear.

---

## A3 — Slash command (sequential workflow)

**Examples in this repo:** `create-pr`, `init-claude`, `update-claude`,
`resolve-conflicts`, `ci-auto-fix`.

**Shape:**

```text
my-slash/
└── SKILL.md
```

**Frontmatter:**

```yaml
---
name: create-pr
description: >
  Generates a narrative PR description, pushes the branch, and watches CI.
  Triggers on "open a PR", "create pull request", "/create-pr".
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *) Read
metadata:
  workflow_type: slash-command
---
```

**Why slash-only:** side-effectful actions (push, open PR). The user
controls timing.

---

## A4 — Workflow companion

**Examples in this repo:** `aw-create-plan`, `aw-create-walkthrough`,
`aw-review-quality-gate`.

**Shape:**

```text
my-companion/
├── SKILL.md
└── templates/
    └── artefact.md
```

**Frontmatter:**

```yaml
---
name: aw-create-plan
description: >
  Generates `.agent/{branch}/plan.md` for autonomous-workflow Full Mode.
  Called by the autonomous-workflow orchestrator via Skill().
disable-model-invocation: true
user-invocable: false
metadata:
  workflow_type: companion
---
```

**Why both flags:** the companion is not user-invocable (no point typing
`/aw-create-plan` directly), and the orchestrator dispatches it
explicitly.

---

## A5 — Orchestrator (multi-phase)

**Examples in this repo:** `autonomous-workflow`, `batch-linear-tickets`.

**Shape:**

```text
my-orchestrator/
├── SKILL.md          # Phase table + companion table
├── README.md         # User-facing install / customise
├── CLAUDE.md         # Developer / contributor docs
├── install.sh        # Symlinks templates
├── rules/
│   ├── phase-0-validation.md
│   ├── phase-1-planning.md
│   ├── ...
│   └── companion-skills.md
├── references/
│   └── worked-examples.md
└── templates/
    └── agent.template.md
```

**Frontmatter:**

```yaml
---
name: autonomous-workflow
description: >
  Executes feature development cycles autonomously through a phase-based
  pipeline (0–7). Triggers on "implement autonomously", "end-to-end",
  "/autonomous-workflow".
metadata:
  workflow_type: orchestrator
---
```

**What makes it an orchestrator:** the skill *sequences* other skills via
`Skill()` calls. Domain knowledge (how to actually write code, fix bugs,
review PRs) lives in companion skills. The orchestrator decides *when*.

---

## A6 — Scaffolder (generates new artefacts)

**Examples in this repo:** `init-claude`, `create-skill` (this skill).

**Shape:**

```text
my-scaffolder/
├── SKILL.md
├── rules/
│   └── decision-rules.md
├── references/
│   └── archetypes.md
└── templates/
    ├── output-A.md
    └── output-B.md
```

**Frontmatter:**

```yaml
---
name: create-skill
description: >
  Scaffolds new agent skills with best-practice frontmatter, progressive
  disclosure, and token-aware structure. Triggers on "create a skill",
  "scaffold a skill", "/create-skill".
disable-model-invocation: true
metadata:
  workflow_type: scaffolder
---
```

**What makes it a scaffolder:** the output is a directory of files for the
user. `templates/` carries literal boilerplate; `references/` carries
worked examples.

---

## A7 — Multi-mode skill

**Examples in this repo:** `holistic-analysis` (`fix` / `refactor` modes),
`confidence` (`plan` / `code` / `bug-analysis` modes).

**Shape:** usually single-file with a `## Mode Detection` section near the
top.

```yaml
---
name: holistic-analysis
description: >
  Forces a holistic re-analysis when a fix or refactor isn't working.
  Modes: "fix" (default — bug analysis), "refactor" (restructuring).
  Triggers on "step back", "rethink this", "/holistic".
---
```

```markdown
# Holistic Analysis

## Mode Detection

Check `$ARGUMENTS` for mode:

| Mode       | Default | Use case                                |
| ---------- | ------- | --------------------------------------- |
| `fix`      | yes     | Bug, broken behavior, failing test      |
| `refactor` |         | Restructuring, cleanup, improvement     |
```

**When to split modes into rule files:** if any one mode exceeds 150
lines, move it to `rules/mode-<name>.md` and keep the dispatch in
`SKILL.md`.

---

## A8 — Forked subagent skill

**Examples in this repo:** none current. Bundled skills like `Explore` and
`Plan` are similar in spirit.

**Shape:**

```text
my-forked/
└── SKILL.md
```

**Frontmatter:**

```yaml
---
name: deep-research
description: >
  Researches a topic thoroughly in an isolated context. Triggers on
  "deep research", "/deep-research".
context: fork
agent: Explore
---
```

**Body:** the entire `SKILL.md` is the prompt the forked subagent
receives. Write it as **actionable instructions**, not as advisory
background. A skill that just says "use these conventions" returns
nothing useful from a forked context.

---

## A9 — Background-knowledge skill

**Examples in this repo:** none currently — but a `legacy-system-context`
or `domain-glossary` would fit.

**Frontmatter:**

```yaml
---
name: legacy-system-context
description: >
  Background context on the legacy session-token storage subsystem,
  applied automatically when modifying auth code.
user-invocable: false
paths: ['apps/auth/**', 'libs/session/**']
---
```

**Why both fields:** `user-invocable: false` because `/legacy-system-
context` isn't a useful command. `paths:` because the skill should
auto-load only when the agent is working in the relevant directories.

---

## Choosing an archetype

| If you are...                                              | Use            |
| ---------------------------------------------------------- | -------------- |
| Reviewing or analysing code/text and producing a report    | A1 (advisory)  |
| Writing code as the primary output                         | A2 (applied)   |
| Building a one-shot user command (`/foo`)                  | A3 (slash)     |
| A piece a bigger orchestrator dispatches                   | A4 (companion) |
| Sequencing several skills end-to-end                       | A5 (orchestrator) |
| Generating a new project / file / scaffold                 | A6 (scaffolder) |
| Doing several similar things based on an argument          | A7 (multi-mode) |
| Researching without polluting the main thread              | A8 (forked)     |
| Adding domain knowledge the model should silently apply    | A9 (background) |
