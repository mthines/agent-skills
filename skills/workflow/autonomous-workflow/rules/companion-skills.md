# Companion Skills Registry

Single source of truth for which optional skills the workflow invokes, when, and
how. **All companions skip silently if not installed.** This file is the place
to disable, swap, or add companions.

## Contents

- [How invocation works](#how-invocation-works)
- [Registry](#registry)
- [Agent Companions](#agent-companions)
- [Self-Improvement Loop (persistent-memory)](#self-improvement-loop-persistent-memory)
- [Stuck-Loop Protocol (Phase 4)](#stuck-loop-protocol-phase-4)
- [Parallelization](#parallelization)
- [Adding a New Companion](#adding-a-new-companion)
- [Removing a Companion](#removing-a-companion)
- [Why some skills can't be disabled](#why-some-skills-cant-be-disabled)
- [Companion Output Logging](#companion-output-logging)

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
| `critical`           | 1     | Opt-in only — user passed `--critical` to the workflow. Single adversarial pre-mortem pass between `code-quality(plan)` and `confidence(plan)`; advisory, does not gate. | `plan` | Remove invocation in [`phase-1-planning.md`](./phase-1-planning.md#adversarial-pre-mortem) |
| `confidence`         | 1     | Full Mode (plan gate — MANDATORY there; Lite has no `plan.md` to gate, Micro skips all companions) | `plan`                | **Cannot disable** — required gate (Full Mode)                           |
| `persistent-memory`  | 1     | Always — load accumulated workflow lessons before design (fast tier of the self-improvement loop) | `read aw-lessons --tier project-shared`     | Remove invocation in [`phase-1-planning.md`](./phase-1-planning.md#lessons-read) |
| `aw-create-plan`     | 2     | Full Mode only                                                          | —                     | Switch task to Lite Mode                                                 |
| `persistent-memory`  | 3     | Executor entry — only when `plan.md` has no `## Lessons applied` (no-planner paths: Lite Mode, `fix-bug` fast-lane, direct dispatch) | `read aw-lessons --tier project-shared` | Remove invocation in [`phase-3-implementation.md`](./phase-3-implementation.md#lessons-read) |
| `tdd`                | 3     | Pure logic / business rules / "test-driven" requested                   | —                     | Remove invocation in [`phase-3-implementation.md`](./phase-3-implementation.md#tdd-trigger) |
| `ux`                 | 3     | Files touched include `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, RN screens | —                     | Remove invocation in [`phase-3-implementation.md`](./phase-3-implementation.md#ux-trigger)  |
| `code-quality`       | 3     | Once at end of Phase 3 (not per-file — TDD owns inner loop)             | `code`                | Remove invocation in [`phase-3-implementation.md`](./phase-3-implementation.md#code-quality-trigger) |
| `confidence`         | 4     | At iteration cap on same failing area (3 in Lite Mode, 5 in Full Mode) — automatic | `analysis`        | Adjust cap or threshold in [`phase-4-testing.md`](./phase-4-testing.md#stuck-loop-detection) |
| `holistic-analysis`  | 4     | Auto: when `confidence(analysis) < 90%` (one-shot per area). User-driven: when user picks `try different approach` after escalation | — | Remove invocation in [`phase-4-testing.md`](./phase-4-testing.md#stuck-recovery)            |
| `test-provenance-guard` | 4  | After Step 5 — any new `*.test.*` / `*.unit.*` / `*.spec.*` file written or extended | `--diff --base $(git merge-base HEAD main) --fix` — autofix is **gated by `confidence(code) ≥ 90 %`** before any file is mutated, plus the three post-heal mechanical gates afterwards. Either failure ⇒ no refactor; stuck-loop protocol takes over | Remove invocation in [`phase-4-testing.md`](./phase-4-testing.md#test-provenance-trigger) |
| `persistent-memory`  | 4     | At stuck-loop escalation (cap hit / user escalation) — record the failing area and resolution | `write aw-lessons --tier project-shared --auto` | Remove invocation in [`phase-4-testing.md`](./phase-4-testing.md#lessons-write) |
| `docs`               | 5     | Always (self-improving doc loop — keeps `CLAUDE.md`, `README.md`, `docs/` aligned) | `update --auto`      | Remove invocation in [`phase-5-documentation.md`](./phase-5-documentation.md#documentation-trigger). Skip per-task by user override or skip-condition match (see [`phase-5-documentation.md#when-to-skip`](./phase-5-documentation.md#when-to-skip)). |
| `aw-review-quality-gate` | 6 | After the `reviewer` agent returns findings — false-positive filter on the findings list (advisory) | —    | Remove invocation in [`phase-6-pr-creation.md`](./phase-6-pr-creation.md#findings-quality-gate) |
| `aw-create-walkthrough` | 6  | Full Mode only                                                          | —                     | Switch task to Lite Mode                                                 |
| `create-pr`          | 6     | Always (handles description + push + open + watch)                      | —                     | Remove invocation in [`phase-6-pr-creation.md`](./phase-6-pr-creation.md#pr-creation) (replace with manual `gh pr create`) |
| `ci-auto-fix`        | 7     | CI run completes with status `failure`                                  | `<run-id\|pr-url>`    | Skip Phase 7 entirely — remove invocation in [`phase-7-ci-gate.md`](./phase-7-ci-gate.md#auto-fix) |
| `persistent-memory`  | 7     | End-of-run (CI green / user stop / post-merge bug) — record durable run lessons; check promotion | `write aw-lessons --tier project-shared --auto` | Remove invocation in [`phase-7-ci-gate.md`](./phase-7-ci-gate.md#lessons-write) |

---

## Agent Companions

A second class of optional companions exists: **agents** (definitions in `agents/<name>.md`) rather than skills. They are dispatched as sub-agents (`subagent_type: <name>`) and detected by file presence in `.claude/agents/`, `~/.agents/agents/`, or `~/.claude/agents/`. The graceful-skip contract is the same — log one line, continue — but the invocation mechanism differs from `Skill()`.

| Agent      | Phase | Trigger condition                                            | Args                                          | Detection paths                                                                                  | Disable by                                                                                       |
| ---------- | ----- | ------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `reviewer` | 6     | Always before push — pre-push review on the own branch (Fix Mode); replaces the now-removed `Skill("review-changes")` invocation (which is `disable-model-invocation: true` and cannot be model-invoked) | `--critical` + auto-fix-all prompt (every severity, Simple findings only) | `.claude/agents/reviewer.md`, `~/.agents/agents/reviewer.md`, `~/.claude/agents/reviewer.md` | Remove invocation in [`phase-6-pr-creation.md`](./phase-6-pr-creation.md#pre-push-review) |
| `reviewer` | 7     | CI green (after Step 4 Report Success — runs in PR Mode / Self-Review sub-mode for self-authored PRs) | `<pr-url> --critical` + auto-fix-all prompt (every severity, Simple findings only) | `.claude/agents/reviewer.md`, `~/.agents/agents/reviewer.md`, `~/.claude/agents/reviewer.md`     | Remove invocation in [`phase-7-ci-gate.md`](./phase-7-ci-gate.md#auto-review)                    |
| `feature-pr-verifier` | 7 | Full Mode AND CI green AND `plan.md` exists (independent green/red verdict before optional undraft) | — | `.claude/agents/feature-pr-verifier.md`, `~/.agents/agents/feature-pr-verifier.md`, `~/.claude/agents/feature-pr-verifier.md` | Remove invocation in [`phase-7-ci-gate.md`](./phase-7-ci-gate.md#auto-verify) |

The `reviewer` agent is dispatched twice in a full workflow: once in **Phase 6** before push (Fix Mode on the own branch — auto-fix simple findings inline) and once in **Phase 7** after CI green (PR Mode → Self-Review sub-mode because Phase 7 PRs are always self-authored by `aw-executor`; auto-fix runs, findings emit as an inline terminal report via Step 5.8; **no pending GitHub comments**). Both passes are invoked with `--critical` and an auto-fix-all prompt that names every severity bucket (Critical / High / Medium / Low / Nitpick / Nice-to-have) — the safety floor is the auto-fix-policy's Simple-vs-Complex split, not the severity. On a cross-author PR the reviewer redirects to the `pr-reviewer` agent (which is the only agent allowed to author pending GitHub reviews); the autonomous-workflow never hits that path because it always opens its own PRs.

The `feature-pr-verifier` agent runs in fresh context with no access to the planner's or executor's reasoning — only `plan.md`, `walkthrough.md`, the PR diff, and the project test command. It returns a green / red verdict against the four checks (Acceptance-Criteria match, PASS_TO_PASS, diff sanity, walkthrough integrity). The verdict is advisory: only the user undrafts the PR. This is the feature-PR counterpart to `bug-fix-verifier` (which is owned by `/fix-bug`), and serves the same purpose — closing the self-grading loophole Anthropic's harness research warns about.

---

## Self-Improvement Loop (persistent-memory)

`persistent-memory` is wired in at three points to give the workflow a
**fast tier** of self-improvement: it reads accumulated lessons before planning
(Phase 1) and writes new lessons when something goes wrong (Phase 4 stuck-loop)
or a run completes (Phase 7). Lessons are **advisory** — they bias the plan,
never silently change a gate. A lesson that recurs (`seen_count >= 3`) or is
tagged `structural` becomes promotion-eligible: the workflow suggests
`/create-skill diagnose autonomous-workflow`, which turns the lesson into a
permanent skill-source change behind the existing `confidence(analysis) ≥ 90 %`
gate (the **slow tier**).

The full contract — lesson schema, read / write triggers, promotion gate, and
the entrenchment guards that stop self-reinforcing error — lives in
[`self-improvement-loop.md`](./self-improvement-loop.md). Like every companion,
`persistent-memory` **skips silently if not installed**: the fast tier degrades
to nothing and the slow tier (`diagnose`) is unaffected.

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
        score = Skill("confidence", "analysis")

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
`analysis → holistic → replan → fail` cycles could loop indefinitely.

**Why mode-aware caps (3 vs 5)?** Lite Mode tasks are simpler and should
converge fast — a tight cap is correct. Full Mode tasks are more complex and
may benefit from one extra attempt before mandatory escalation. Either way,
"more than the cap" almost always means the mental model is wrong, which is
why the auto-replan fires before more iterations are spent.

---

## Parallelization

| Phase | Pattern                                         | Cap                          |
| ----- | ----------------------------------------------- | ---------------------------- |
| 1     | Parallel `Explore` sub-agents for research      | One per package/concern      |
| 3     | Controlled fan-out — file-disjoint slices only  | 3 concurrent sub-agents      |
| 7     | Parallel `ci-auto-fix` per independent failure  | 2 handoffs per PR            |

Phase 3 allows controlled fan-out when slices are file-disjoint (cap 3 concurrent sub-agents).
Each sub-agent MUST receive the Sub-Agent Resource Discipline embedding.
If the task does not decompose cleanly into file-disjoint slices, keep Phase 3 sequential.
See [`rules/parallel-coordination.md#sub-agent-resource-discipline`](./parallel-coordination.md#sub-agent-resource-discipline).

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
