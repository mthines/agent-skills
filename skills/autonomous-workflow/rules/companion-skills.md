# Companion Skills Registry

Single source of truth for which optional skills the workflow invokes, when, and
how. **All companions skip silently if not installed.** This file is the place
to disable, swap, or add companions.

---

## How invocation works

Each phase rule contains lines like:

```
Skill("ux")     # if companion installed and trigger matches
```

If the skill isn't installed, Claude returns an error message; the workflow
catches that and continues without the skill. **Never block the workflow on a
missing companion.**

When invoking, log one line in the conversation and the `plan.md` Progress Log:

> `companion: <name> — invoked` or `companion: <name> — not available, continuing`

---

## Registry

| Skill                | Phase | Trigger condition                                                       | Args                  | Disable by                                                               |
| -------------------- | ----- | ----------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------ |
| `holistic-analysis`  | 1     | Task touches 5+ files, 2+ packages, OR user calls it complex/unfamiliar | —                     | Remove invocation in [`phase-1-planning.md`](./phase-1-planning.md#complex-task-detection) |
| `code-quality`       | 1     | Always (informs design — favors low-complexity structures upfront)      | `plan`                | Remove invocation in [`phase-1-planning.md`](./phase-1-planning.md#design-quality)         |
| `confidence`         | 1     | Always (plan gate — MANDATORY)                                          | `plan`                | **Cannot disable** — required gate                                       |
| `create-plan`        | 2     | Full Mode only                                                          | —                     | Switch task to Lite Mode                                                 |
| `tdd`                | 3     | Pure logic / business rules / "test-driven" requested                   | —                     | Remove invocation in [`phase-3-implementation.md`](./phase-3-implementation.md#tdd-trigger) |
| `ux`                 | 3     | Files touched include `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, RN screens | —                     | Remove invocation in [`phase-3-implementation.md`](./phase-3-implementation.md#ux-trigger)  |
| `code-quality`       | 3     | Once at end of Phase 3 (not per-file — TDD owns inner loop)             | `code`                | Remove invocation in [`phase-3-implementation.md`](./phase-3-implementation.md#code-quality-trigger) |
| `confidence`         | 4     | After 3 iterations on same failing test/area                            | `bug-analysis`        | Adjust threshold in [`phase-4-testing.md`](./phase-4-testing.md#stuck-loop-detection)       |
| `holistic-analysis`  | 4     | After Phase 4 confidence runs and user asks for retry                   | —                     | Remove invocation in [`phase-4-testing.md`](./phase-4-testing.md#stuck-recovery)            |
| `update-claude`      | 5     | Always (self-improving doc loop — keeps CLAUDE.md aligned)              | —                     | Remove invocation in [`phase-5-documentation.md`](./phase-5-documentation.md#claude-md-trigger) |
| `review-changes`     | 6     | Always before push                                                      | —                     | Remove invocation in [`phase-6-pr-creation.md`](./phase-6-pr-creation.md#pre-push-review)   |
| `create-walkthrough` | 6     | Full Mode only                                                          | —                     | Switch task to Lite Mode                                                 |
| `create-pr`          | 6     | Always (handles description + push + open + watch)                      | —                     | Remove invocation in [`phase-6-pr-creation.md`](./phase-6-pr-creation.md#pr-creation) (replace with manual `gh pr create`) |
| `ci-auto-fix`        | 7     | CI run completes with status `failure`                                  | `<run-id\|pr-url>`    | Skip Phase 7 entirely — remove invocation in [`phase-7-ci-gate.md`](./phase-7-ci-gate.md#auto-fix) |

---

## Stuck-Loop Protocol (Phase 4)

The single biggest cost-saver in the workflow — prevents the agent from
burning tokens on hallucinated fixes when root-cause analysis is wrong.

```
iterations_on_same_area = 0

while not all_tests_pass:
    iterations_on_same_area += 1

    if iterations_on_same_area == 3:
        Skill("confidence", "bug-analysis")
        Present findings + summary of attempts to user.
        Ask: continue / try different approach / stop.
        Exit loop based on user response.

    fix → run tests → if pass: break
```

After confidence runs, if the user asks to retry with a fresh analysis, invoke
`Skill("holistic-analysis")` to step back and re-trace the execution path
end-to-end before attempting again.

**Why 3 iterations?** Three attempts on the same failing area is enough to
distinguish "I'm close, one more fix" from "my mental model is wrong." More
than three almost always means the latter — and continuing burns tokens
without converging.

---

## Parallelization

| Phase | Pattern                                      | Cap                          |
| ----- | -------------------------------------------- | ---------------------------- |
| 1     | Parallel `Explore` sub-agents for research   | One per package/concern      |
| 7     | Parallel `ci-auto-fix` per independent failure | 2 handoffs per PR            |

Phase 3 implementation is **sequential** (file changes share state).

---

## Adding a New Companion

1. Confirm the companion skill exists in `agent-skills.git/skills/<name>/`.
2. Add a row to the Registry table above.
3. Add the invocation in the relevant `phase-N-*.md` rule. The rule must
   include an `## Anchor` heading matching the "Disable by" link target.
4. Document the trigger condition concretely (file globs, keyword match,
   counts) — avoid subjective conditions.
5. Verify the workflow still skips gracefully when the new companion is missing.

## Removing a Companion

1. Delete the row from the Registry table.
2. Delete the invocation block in the relevant phase rule.
3. (Optional) Note the removal in the project's `CHANGELOG.md` so users know.

---

## Why some skills can't be disabled

`confidence` at Phase 1 is the only non-removable companion. Without it, the
plan gate is gone and the workflow loses its primary safety mechanism. If you
want to remove the gate entirely, fork the skill and adjust
`phase-1-planning.md` directly — but understand the autonomous safety guarantee
changes meaningfully.

---

## Companion Output Logging

When a companion is invoked, append a one-liner to the `plan.md` Progress Log
(Full Mode only):

```markdown
- [2026-04-29T15:30:00Z] Phase 1: code-quality(plan) — applied (3 design suggestions integrated)
- [2026-04-29T15:32:00Z] Phase 1: confidence(plan) — 92% (passed gate)
```

This makes the companion footprint visible across phases and helps tune which
companions are worth running for which task types.
