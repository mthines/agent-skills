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
- [Two-Artifact Pattern](#two-artifact-pattern)
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

The autonomous workflow uses a two-artifact pattern for documenting decisions,
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

## Two-Artifact Pattern

| Artifact        | File(s)                                              | Created by                       | When                                                 |
| --------------- | ---------------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| **Plan**        | `.agent/{branch}/plan.md` + `plan.v{N}.md` snapshots | `Skill("aw-create-plan")`        | After Phase 2 — and again on every plan iteration    |
| **Walkthrough** | `.agent/{branch}/walkthrough.md`                     | `Skill("aw-create-walkthrough")` | Phase 6                                              |

`plan.md` is the single source of truth — a new Claude session should be able
to execute from it alone. Every invocation of `aw-create-plan` writes a new
immutable `plan.v{N}.md` snapshot **and** overwrites `plan.md` so it always
points at the latest version. See **Plan Versioning** below.

## Caller-supplied context artefacts

Orchestrators that invoke `aw-planner` (e.g., [`/fix-bug`](../../fix-bug/SKILL.md)
and other future task-shaped orchestrators) may attach **additional artefacts**
to the planner pack beyond the two standard ones above. The pattern: the
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

Every call to `Skill("aw-create-plan")` produces:

| File              | Mutability  | Purpose                                                                  |
| ----------------- | ----------- | ------------------------------------------------------------------------ |
| `plan.v{N}.md`    | Immutable   | Snapshot of the plan at iteration `N`. Never edited or deleted.          |
| `plan.md`         | Overwritten | Pointer to the **latest** plan content. Identical body to newest `plan.v{N}.md`. |

`N` is monotonic — the skill computes it by listing existing `plan.v*.md`
files and incrementing the highest number (so the first run writes `plan.v1.md`,
the next `plan.v2.md`, …).

**Iteration triggers — invoke `aw-create-plan` again:**

| Trigger                                      | Result                                  |
| -------------------------------------------- | --------------------------------------- |
| Initial plan creation (Phase 2)              | `plan.v1.md` + `plan.md`                |
| User feedback after the confidence gate      | `plan.v2.md` + `plan.md`                |
| Phase 4 auto-replan (after holistic-analysis) | `plan.v{N+1}.md` + `plan.md`           |
| User explicitly asks to regenerate the plan  | `plan.v{N+1}.md` + `plan.md`            |

**Mid-execution Progress Log appends to `plan.md`** (e.g. logging a phase
transition, a confidence run, or a passed test) **do NOT bump the version** —
those are journaling, not iteration. Only re-running `aw-create-plan` produces
a new snapshot.

> **Why versioned snapshots?** Iterative refinement is normal in autonomous
> work — the plan grows as the user pushes back, as the agent discovers
> hidden constraints, and as Phase 4 auto-replan kicks in. Snapshotting each
> iteration preserves the audit trail (initial → user-iteration → auto-replan)
> without forcing readers to learn the convention: `plan.md` always works,
> and `plan.v*.md` is there for whoever needs the history.

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
├── feat-dark-mode/
│   ├── plan.md           # Always points at the latest plan.v*.md
│   ├── plan.v1.md        # Initial plan snapshot (immutable)
│   ├── plan.v2.md        # User-iteration snapshot (immutable)
│   ├── plan.v3.md        # Phase 4 auto-replan snapshot (immutable)
│   └── walkthrough.md    # Final summary (created at Phase 6)
└── fix-auth-bug/
    ├── plan.md           # ≡ plan.v1.md (only one iteration so far)
    └── plan.v1.md
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
