---
title: 'Artifacts Overview'
impact: HIGH
tags:
  - artifacts
  - tracking
  - progress
  - antigravity
---

# Artifacts Overview

## Contents

- [CRITICAL: When to Create Artifacts](#critical-when-to-create-artifacts)
- [Overview](#overview)
- [When to Use Artifacts](#when-to-use-artifacts)
- [Artifact Pattern](#artifact-pattern)
- [Caller-supplied context artefacts](#caller-supplied-context-artefacts)
- [Plan Versioning](#plan-versioning)
- [Quality Gate](#quality-gate)
- [File Location](#file-location)
- [Gitignore](#gitignore)
- [Context Recovery](#context-recovery)
- [Key Principles](#key-principles)
- [References](#references)

---

## CRITICAL: When to Create Artifacts

**For Full Mode tasks, artifacts MUST be created AFTER Phase 2 worktree setup
— inside the worktree, not on the main branch.**

Phase 1 planning happens in conversation. Artifact files are written to disk
only after the worktree is created and you have navigated into it:

```bash
# Create AFTER worktree setup (end of Phase 2), inside the worktree
mkdir -p .agent/{branch-name}
# Skill("aw-create-plan") writes .agent/{branch-name}/plan.md
```

**DO NOT create artifact files on the main branch. Always create them inside
the worktree.**

---

## Overview

The autonomous workflow uses a three-artifact pattern for documenting decisions,
tracking progress, and generating summaries. Artifact creation is handled by
dedicated skills that guarantee consistent, complete output.

## When to Use Artifacts

**Create artifacts (Full Mode) when:**

- Task involves 4+ files
- Multiple architectural decisions required
- Long session where context may be compacted
- Handoff to another agent is possible

**Skip artifacts (Lite Mode) when:**

- Task involves 2–3 files (or 1 file with non-trivial logic) AND is simple
- Implementation is straightforward
- Can be completed quickly in one session

**Skip artifacts (Micro Mode) when:**

- Task involves 1 file and is purely mechanical (typo, copy, version or config bump) — Micro also skips planning and all quality companions

See [overview](./overview.md) for the complete decision flow.

## Artifact Pattern

| Artifact        | File(s)                                              | Created by                       | When                                                 |
| --------------- | ---------------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| **Checks**      | `.agent/{branch}/checks.yaml`                        | `Skill("aw-create-plan")` (Step 2b) | With the plan — re-derived (statuses reset) on every plan iteration. **The living contract.** |
| **Plan**        | `.agent/{branch}/plan.md` (+ opt-in `plan.v{N}.md` snapshots) | `Skill("aw-create-plan")` | After Phase 2 — and again on every plan iteration    |
| **Walkthrough** | `.agent/{branch}/walkthrough.md`                     | `Skill("aw-create-walkthrough")` | Phase 6                                              |

`checks.yaml` is the plan's **executable, living contract** — one runnable
check per `AC-{n}` acceptance criterion. The executor's Phase 4
[Executable Checks Loop](./phase-4-testing.md#executable-checks-loop) uses it
as termination condition and progress ledger (`status:` fields). It is the
artifact that **cannot go stale silently**: it passes or fails against reality
on every executor loop, unlike prose. It is not versioned; check definitions
are executor-immutable.

`plan.md` is the planner→executor **handoff document** — a new Claude session
should be able to execute from it alone. It is a handoff artifact, not an
exhaustive knowledge base: keep it lean, and when something is unclear prefer
querying the still-running planner agent (or the user) over bloating the file.
Each invocation of `aw-create-plan` overwrites `plan.md`. By **default no
`plan.v{N}.md` snapshot is written** — the immutable version chain is **opt-in**
(`Skill("aw-create-plan", "snapshot")`). See **Plan Versioning** below.

## Caller-supplied context artefacts

Orchestrators that invoke `aw-planner` (e.g., [`/fix-bug`](../../fix-bug/SKILL.md)
and other future task-shaped orchestrators) may attach **additional artefacts**
to the planner pack beyond the standard ones above. The pattern: the
orchestrator declares a path to a caller-managed artefact under a
`## Context artefacts` section in the planner pack, the planner reads it on
entry and references the path verbatim in `plan.md`, and the executor reads
it on entry and honours any contracts the artefact declares.

Pattern requirements:

| Requirement | Why |
|-------------|-----|
| Artefact lives inside the worktree at `.agent/{branch}/<name>.md` | Same lifetime as `plan.md`; survives compaction; cleaned up by Phase 7 |
| Append-only discipline | Phases append on exit, never overwrite. The artefact is institutional history, not scratch space |
| Schema declared by the caller, not by this skill | The orchestrator owns the artefact's meaning; this skill only owns delivery |
| Path mentioned verbatim in `plan.md` | The executor reads `plan.md` end-to-end at Phase 3 entry — that is how it discovers the artefact |

This skill stays domain-neutral: it does not parse the artefact, gate on its
contents, or change phase behaviour based on it. The artefact is for the
caller's bookkeeping (and any agent the caller later spawns to consume it).

### Canonical example: `/fix-bug` bug-notes ledger

`/fix-bug` Phase 6 attaches `.agent/<branch>/bug-notes.md` — a structured
ledger of the bug's evidence, hypotheses, ruled-out causes, counterexamples
seen during the executor's CEGIS refinement loop, and the confidence
trajectory across phases. The planner appends a one-line plan summary on
exit; the executor appends counterexamples on each refinement round; the
fresh-context `bug-fix-verifier` agent reads the ledger as evidence at
Phase 7 verification time.

Schema and lifecycle live in
[`/fix-bug rules/bug-notes-ledger.md`](../../fix-bug/rules/bug-notes-ledger.md);
template at
[`/fix-bug templates/bug-notes.md`](../../fix-bug/templates/bug-notes.md).

If you write a new orchestrator that needs to carry per-task context across
the planner / executor boundary or beyond, follow the same shape — declare
the artefact path in your pack's `## Context artefacts` section, document the
schema in your skill's rules, and let `aw-planner` and `aw-executor` carry it
through unmodified.

## Plan Versioning

**Default: no snapshots.** Each call to `Skill("aw-create-plan")` overwrites a
single `plan.md`. The `version:` frontmatter field still increments on each
re-write, so the iteration counter is preserved without a separate file.

**Opt-in snapshots** (`Skill("aw-create-plan", "snapshot")`) additionally write
an immutable `plan.v{N}.md` each iteration:

| File              | Mutability  | Purpose                                                                  |
| ----------------- | ----------- | ------------------------------------------------------------------------ |
| `plan.v{N}.md`    | Immutable   | **(snapshot mode)** Snapshot of the plan at iteration `N`. Never edited or deleted. |
| `plan.md`         | Overwritten | The plan content. **(snapshot mode)** Identical body to newest `plan.v{N}.md`. |

In snapshot mode, `N` is monotonic — the skill computes it by listing existing
`plan.v*.md` files and incrementing the highest number (so the first run writes
`plan.v1.md`, the next `plan.v2.md`, …).

**Mid-execution Progress Log appends to `plan.md`** (e.g. logging a phase
transition, a confidence run, or a passed test) **do NOT bump the version** —
those are journaling, not iteration. Only re-running `aw-create-plan` bumps it.

> **Why is snapshotting opt-in?** `.agent/` is gitignored per-developer scratch,
> so an immutable `plan.v{N}.md` chain is a second, weaker version-control system
> for the same file — it adds directory noise and a redundant write on every
> iteration, and the audit trail is rarely re-read. Snapshotting has no measured
> effect on task success ([research §5.4](../references/anthropic-architecture-research.md#54-what-is-not-evidence-backed)),
> so it is off by default and available (`snapshot` arg) when a durable annotated
> record of a plan's evolution is genuinely wanted.

## Quality Gate

Before creating `plan.md`, the plan is validated via:

```
Skill(skill: "confidence", args: "plan")
```

The confidence gate must reach 90%+ (or be user-approved) before proceeding.
This is the **only non-removable companion** in the workflow.

## File Location

**Pattern**: `.agent/{branch-name}/*.md`

```
.agent/
├── feat-dark-mode/       # default mode — single plan.md
│   ├── checks.yaml       # Executable acceptance checks (the living contract)
│   ├── plan.md           # Planner→executor handoff document
│   └── walkthrough.md    # Final summary (created at Phase 6)
└── fix-auth-bug/         # snapshot mode — immutable history kept
    ├── checks.yaml
    ├── plan.md           # ≡ newest plan.v*.md
    ├── plan.v1.md        # Initial plan snapshot (immutable)
    └── plan.v2.md        # User-iteration snapshot (immutable)
```

> **Why `.agent/` (singular)?** It aligns with the `~/.agents/skills/`
> cross-tool discovery convention used by Codex, Cursor, OpenCode, and other
> Agent Skills–compatible clients. The agent identity is implicit in artifact
> frontmatter; the directory itself is a per-project agent workspace.

> **Migration note:** Earlier versions of this workflow used `.gw/{branch}/`.
> Artifacts moved to `.agent/{branch}/` in v3.0.0. Existing projects can
> migrate by `git mv .gw .agent` (or simply ignoring both directories — only
> new artifacts will land in `.agent/`).

## Gitignore

Add `.agent/` to your repo's `.gitignore`:

```gitignore
# Autonomous workflow artifacts (per-developer, not committed)
.agent/
```

The artifacts are intentionally local — they capture an individual agent
session's plan and progress, not team-shared state.

## Context Recovery

When context is compacted or a new session starts, read
`.agent/{branch}/plan.md` to recover:

- Full requirements and decisions
- Technical approach and implementation order
- Progress log showing what's been completed
- Companion-skill invocation history
- Verification commands

**Instruction**: "If context has been compacted, read
`.agent/{branch}/plan.md` to recover full context."

## Key Principles

- **Plan in Phase 1**: Analyze codebase and prepare plan content in
  conversation (no files yet).
- **Validate with confidence gate**: `Skill("confidence", "plan")` must pass
  before artifact creation.
- **Create AFTER Phase 2**: Artifact files go inside the worktree at
  `.agent/{branch}/` (never on main branch).
- **Use dedicated skills**: `Skill("aw-create-plan")` and
  `Skill("aw-create-walkthrough")` guarantee format consistency.
- **Update Progress Log at milestones**: Append entries at phase transitions,
  companion invocations, and key completions.

## References

- Related skill: [confidence](../../../quality/confidence/SKILL.md) — Quality gate for
  plan validation
- Related skill: [aw-create-plan](../../aw-create-plan/SKILL.md) — Plan artifact
  generation
- Related skill: [aw-create-walkthrough](../../aw-create-walkthrough/SKILL.md) —
  Walkthrough artifact generation
- Related rule: [companion-skills](./companion-skills.md) — invocation
  registry
- Related rule: [phase-1-planning](./phase-1-planning.md)
- Research: [Antigravity Artifacts](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/)
