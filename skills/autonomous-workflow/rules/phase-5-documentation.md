---
title: 'Phase 5: Documentation'
impact: MEDIUM
tags:
  - documentation
  - phase-5
  - auto-update
---

# Phase 5: Documentation

## Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [Procedure](#procedure)
- [Documentation Trigger](#documentation-trigger)
- [When to Skip](#when-to-skip)
- [Documentation Checklist](#documentation-checklist)
- [References](#references)

## Overview

Bring every documentation surface in sync with the changes made in
Phase 3 — `CLAUDE.md`, `.claude/rules/`, `AGENTS.md`, `README.md`, the
`docs/` tree, and `CHANGELOG.md`. The phase ends with a mandatory
`Skill("documentation", "update")` invocation passing `--auto`, which
runs the **six-target auto-update loop** governed by
[`documentation/rules/auto-update-loop.md`](../../documentation/rules/auto-update-loop.md):

- Hot-path budget (root `CLAUDE.md` ≤ 200 lines).
- Recurrence threshold (a new rule must have been observed ≥ 2 times).
- Removed-rules ledger (no re-asserting deleted rules).
- Optional ablation (skip rules Claude already obeys without them).
- Per-write `confidence(analysis) ≥ 90 %` gate.
- Post-write verification via `/memory` / `InstructionsLoaded` hook and `lychee` link check.

Gate: `Skill("documentation", "update --auto")` returns `outcome: "applied"` or `outcome: "skipped"` with a logged reason.
Any other outcome blocks Phase 6.

## Core Principles

- **Six surfaces, not one.** Every Phase 5 run considers `CLAUDE.md`,
  `.claude/rules/`, `AGENTS.md`, `README.md`, `docs/`, and `CHANGELOG.md`.
  The skill silently no-ops when a surface needs no update.
- **Innermost-wins routing.** Subtree-scoped rules go to
  `<dir>/CLAUDE.md`; pattern-scoped rules go to `.claude/rules/<topic>.md`
  with `paths:` globs; **never** root.
- **Recurrence over reaction.** A single correction in one PR is not a
  rule. Two occurrences across this run and history are.
- **Never re-add what was deleted.** Consult
  `.agent/docs/removed-rules.jsonl` before proposing any new rule.
- **Hot path stays lean.** Root `CLAUDE.md` is capped at 200 lines.
- **Always close the doc loop.** The skill runs in both Full and Lite Mode.

## Procedure

### Step 1: Hand off to the documentation skill in auto mode

```
Skill("documentation", "update --auto")
```

The skill performs the full procedure end-to-end:

1. Diffs the branch against base; classifies changes by area.
2. Reads every doc surface; builds a map of what's documented today.
3. Runs deterministic drift checks (dead paths, removed commands,
   broken `@imports`, link rot, hot-path leakage).
4. For each new pattern, walks the gate chain:
   recurrence ≥ 2 → removed-rules check → optional ablation →
   content-routing.md → placement-resolver.md → `confidence(analysis) ≥ 90 %`.
5. Applies P0 drift fixes (always-on).
6. Applies P1 rules that passed every gate.
7. Skips P2 polish (never auto-applied).
8. Verifies post-write: `/memory` for new `.claude/rules/`, `lychee`
   for link checks across all six surfaces.
9. Stages and commits the doc changes.
10. Emits a JSON run-summary to stdout.

The autonomous workflow does not author the procedure — it delegates to
the skill, which owns the rules.

### Step 2: Read the run summary

The skill emits a JSON summary the caller should log:

```json
{
  "phase": "documentation-update",
  "outcome": "applied",
  "p0_fixes": 2,
  "p1_rules_applied": 1,
  "p1_rules_logged": 3,
  "ablation_no_divergence": 1,
  "removed_rules_skipped": 0,
  "files_changed": [
    "CLAUDE.md",
    ".claude/rules/api.md",
    "docs/explanation/architecture.md"
  ],
  "post_write_verification": "ok"
}
```

Outcomes:

| Outcome     | Meaning                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `applied`   | One or more changes applied. Proceed to Phase 6.                                                              |
| `skipped`   | Skip condition matched (e.g., test-only change). Proceed to Phase 6. Logged reason in `.agent/docs/run-log.jsonl`. |
| `error`     | A gate failed (`HOT_PATH_OVERFLOW`, `VERIFICATION_FAILED`, `CONFIDENCE_LOW`). **Block Phase 6.** Escalate.   |

### Step 3: Commit and proceed

If `files_changed` is non-empty, the skill has already committed under a
message like `docs(claude): sync agent guidance with feature changes`.
Verify with `git log -1` before moving on.

If the workflow is still in the same commit boundary as Phase 3
(`autonomous-workflow` Full Mode coalesces some commits), let the skill
stage but defer the commit until the PR's final commit boundary.

## Documentation Trigger

ALWAYS invoke `documentation update` at the end of Phase 5. This is the
always-on self-improving doc loop — it keeps every doc surface aligned
with what the code now does so future autonomous runs (and other agents
working in this repo) start with better context instead of stale
guidance.

```
Skill("documentation", "update --auto")
```

| Property                   | Value                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| Runs in Full Mode          | Yes                                                                  |
| Runs in Lite Mode          | **Yes** — small changes still drift docs; the loop must stay closed  |
| Skips silently if missing  | Yes — if the skill is not installed, log and continue                |
| Disable                    | Remove this section (not recommended; breaks the self-improving loop) |

After invocation, log to the `plan.md` Progress Log (Full Mode) or
in-conversation (Lite Mode):

```markdown
- [TIMESTAMP] Phase 5: documentation(update --auto) — outcome=applied (3 files)
```

If the skill is not available:

```markdown
- [TIMESTAMP] Phase 5: documentation skill not installed, continuing
```

## When to Skip

**Default: always run.** This subsection is an opt-out escape hatch, not
a default change. The self-improving doc loop runs unless one of the
conditions below applies. The skill itself enforces these via
[`auto-update-loop.md`](../../documentation/rules/auto-update-loop.md) §4
— Phase 5 only needs to know that the skill returns `outcome: "skipped"`
in those cases.

| # | Skip condition                                                                                              | Concrete example                                                                                  |
| - | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1 | User explicitly says "skip docs" or "no doc update" during Phase 0 or Phase 5                               | User in Phase 0: "Skip the docs step, I'll handle CLAUDE.md myself."                              |
| 2 | Task touched 0 files outside of `package.json` / lockfile changes (pure dependency bump)                    | Bump `zod` from 3.22 to 3.23. Only `package.json` and `package-lock.json` changed.                |
| 3 | Task touched only test files (no production code or docs change)                                            | Added missing unit tests for an existing function. Only `*.test.ts` files changed.                |
| 4 | Task is config-only (e.g., `tsconfig.json`, `.gitignore`, CI config) AND no behavior changes                 | Tightened `tsconfig.json` `strict` flag without modifying any source file behavior.               |
| 5 | Pure refactor with identical exports and identical behaviour, no new patterns                                | Renamed a private helper. No public API touched.                                                  |

If none of the conditions above apply, run the skill as normal.

**Logging the skip.** Skips are emitted by the skill as `outcome:
"skipped"` with a `reason` field. Append to `plan.md` Progress Log
(Full Mode) or note in-conversation (Lite Mode):

```markdown
- [TIMESTAMP] Phase 5: documentation(update) — skipped (reason: <reason>)
```

Examples:

```markdown
- [2026-05-14T15:42:00Z] Phase 5: documentation(update) — skipped (reason: user override during Phase 0)
- [2026-05-14T15:42:00Z] Phase 5: documentation(update) — skipped (reason: pure dependency bump, package.json + lockfile only)
- [2026-05-14T15:42:00Z] Phase 5: documentation(update) — skipped (reason: test-only change)
- [2026-05-14T15:42:00Z] Phase 5: documentation(update) — skipped (reason: config-only change, no behavior delta)
- [2026-05-14T15:42:00Z] Phase 5: documentation(update) — skipped (reason: pure refactor, identical behaviour)
```

## Documentation Checklist

- [ ] `Skill("documentation", "update --auto")` invoked (or logged as not installed).
- [ ] Run summary outcome is `applied` or `skipped` (not `error`).
- [ ] If `applied`, `files_changed` reviewed in `git log`.
- [ ] If `skipped`, reason is one of the five conditions above.
- [ ] If `error`, escalate — do not proceed to Phase 6.
- [ ] Any committed doc changes pass `lychee` link check.
- [ ] Progress Log updated.

**Update Progress Log (Full Mode):**

```markdown
- [TIMESTAMP] Phase 5: documentation update applied (CLAUDE.md, README.md, 1 rule file)
```

## References

- Related rule: [phase-4-testing](./phase-4-testing.md)
- Related rule: [phase-6-pr-creation](./phase-6-pr-creation.md)
- Companion registry: [companion-skills.md](./companion-skills.md)
- Related skill: [`documentation`](../../documentation/SKILL.md)
- Auto-update governance: [`documentation/rules/auto-update-loop.md`](../../documentation/rules/auto-update-loop.md)
- Placement Resolver: [`documentation/rules/placement-resolver.md`](../../documentation/rules/placement-resolver.md)
- Drift detection: [`documentation/rules/drift-detection.md`](../../documentation/rules/drift-detection.md)
