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
| `aw-create-plan`     | 2     | Full Mode only                                                          | —                     | Switch task to Lite Mode                                                 |
| `tdd`                | 3     | Pure logic / business rules / "test-driven" requested                   | —                     | Remove invocation in [`phase-3-implementation.md`](./phase-3-implementation.md#tdd-trigger) |
| `ux`                 | 3     | Files touched include `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, RN screens | —                     | Remove invocation in [`phase-3-implementation.md`](./phase-3-implementation.md#ux-trigger)  |
| `code-quality`       | 3     | Once at end of Phase 3 (not per-file — TDD owns inner loop)             | `code`                | Remove invocation in [`phase-3-implementation.md`](./phase-3-implementation.md#code-quality-trigger) |
| `confidence`         | 4     | At iteration cap on same failing area (3 in Lite Mode, 5 in Full Mode) — automatic | `bug-analysis`        | Adjust cap or threshold in [`phase-4-testing.md`](./phase-4-testing.md#stuck-loop-detection) |
| `holistic-analysis`  | 4     | Auto: when `confidence(bug-analysis) < 90%` (one-shot per area). User-driven: when user picks `try different approach` after escalation | — | Remove invocation in [`phase-4-testing.md`](./phase-4-testing.md#stuck-recovery)            |
| `update-claude`      | 5     | Always (self-improving doc loop — keeps CLAUDE.md aligned)              | —                     | Remove invocation in [`phase-5-documentation.md`](./phase-5-documentation.md#claude-md-trigger). Skip per-task by user override or skip-condition match (see [`phase-5-documentation.md#when-to-skip-update-claude`](./phase-5-documentation.md#when-to-skip-update-claude)). |
| `review-changes`     | 6     | Always before push                                                      | —                     | Remove invocation in [`phase-6-pr-creation.md`](./phase-6-pr-creation.md#pre-push-review)   |
| `aw-create-walkthrough` | 6  | Full Mode only                                                          | —                     | Switch task to Lite Mode                                                 |
| `create-pr`          | 6     | Always (handles description + push + open + watch)                      | —                     | Remove invocation in [`phase-6-pr-creation.md`](./phase-6-pr-creation.md#pr-creation) (replace with manual `gh pr create`) |
| `ci-auto-fix`        | 7     | CI run completes with status `failure`                                  | `<run-id\|pr-url>`    | Skip Phase 7 entirely — remove invocation in [`phase-7-ci-gate.md`](./phase-7-ci-gate.md#auto-fix) |

---

## Stuck-Loop Protocol (Phase 4)

The single biggest cost-saver in the workflow — prevents the agent from
burning tokens on hallucinated fixes when root-cause analysis is wrong.

The cap is **mode-aware**: 3 iterations for Lite Mode, 5 for Full Mode. When the
cap is hit, an **auto-replan protocol** fires — confidence gate first, then
conditional holistic-analysis + plan.md regeneration, with a one-shot guard
that prevents infinite recovery loops. User escalation is the final, mandatory
step if recovery fails.

```
iteration_cap = 3 if Lite Mode else 5
iterations_on_same_area = 0
auto_replan_used = False

# Per-iteration lightweight self-check (NOT a full confidence call — too token-expensive)
before each iteration N >= 2:
    self-check: "Is this attempt meaningfully different from N-1?"
    self-check: "Have I considered why the previous fix didn't work?"
    if either answer is "no":
        bias toward replanning — skip ahead to cap-hit branch below

while not all_tests_pass:
    iterations_on_same_area += 1

    if iterations_on_same_area == iteration_cap:
        score = Skill("confidence", "bug-analysis")

        if score < 90% and not auto_replan_used:
            Skill("holistic-analysis")
            Update affected sections of plan.md.
            iterations_on_same_area = 0
            auto_replan_used = True
            continue   # resume Phase 4 ONCE more

        # Either score >= 90%, or auto-replan already used — escalate.
        Present findings + summary of attempts to user.
        Ask: continue / try different approach / stop.
        Exit loop based on user response.

    fix → run tests → if pass: break
```

`holistic-analysis` runs **automatically** when confidence is below 90% at the
cap. It also runs again **on user request** if the user picks
`try different approach` from the mandatory escalation menu. The
`auto_replan_used` flag is the one-shot guard — without it, repeated
`bug-analysis → holistic → replan → fail` cycles could loop indefinitely.

**Why mode-aware caps (3 vs 5)?** Lite Mode tasks are simpler and should
converge fast — a tight cap is correct. Full Mode tasks are more complex and
may benefit from one extra attempt before mandatory escalation. Either way,
"more than the cap" almost always means the mental model is wrong, which is
why the auto-replan fires before more iterations are spent.

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
