---
title: autonomous-workflow — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - autonomous-workflow
  - meta
---

# autonomous-workflow — Diagnostic Surface

This file declares the contract `/create-skill diagnose autonomous-workflow` reads to parameterize the generic Diagnose Mode procedure for this skill.
The contract spec lives at [`skills/authoring/create-skill/rules/diagnostic-surface.md`](../../../authoring/create-skill/rules/diagnostic-surface.md).

---

## Source root

`skills/workflow/autonomous-workflow/`

---

## Phase model

| Phase | Name                       | Rule file                                                      | Gate                                          |
| ----- | -------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| 0     | Validation                 | [phase-0-validation.md](./phase-0-validation.md)               | User confirmed understanding                  |
| 1     | Planning                   | [phase-1-planning.md](./phase-1-planning.md)                   | `confidence(plan)` ≥ 90 % or user-approved    |
| 2     | Worktree Setup             | [phase-2-worktree.md](./phase-2-worktree.md)                   | Worktree created, `plan.md` written           |
| 3     | Implementation             | [phase-3-implementation.md](./phase-3-implementation.md)       | Code complete, fast checks pass               |
| 4     | Testing                    | [phase-4-testing.md](./phase-4-testing.md)                     | All tests pass OR user-approved stop          |
| 5     | Documentation              | [phase-5-documentation.md](./phase-5-documentation.md)         | Docs reflect changes (incl. `CLAUDE.md`)      |
| 6     | PR Creation                | [phase-6-pr-creation.md](./phase-6-pr-creation.md)             | Walkthrough shown, draft PR opened            |
| 7     | CI Gate + Optional Cleanup | [phase-7-ci-gate.md](./phase-7-ci-gate.md)                     | CI green OR user-approved stop                |

---

## Existing guards per phase

| Phase | Existing guards                                                                                                  | Typical gaps                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0     | Tier detection (Micro/Lite/Full) via the `aw` dispatcher; user confirms understanding; scope alignment delegated to the `interview` companion when installed (SSOT for restate-and-diff + missing-information gate; writes `brief.md`), inline restate-and-diff + missing-information gate as the fallback; `blocking` halts even under `--no-confirm` | Tier under-selected (a Full task routed as Micro/Lite) → planner `confidence(plan)` gate + quality companions skipped; Micro chosen for a change that carried hidden logic; a load-bearing unknown classified `advisory` instead of `blocking` (hallucinated requirement); `interview` and inline gate drift apart so behavior differs by whether the companion is installed; brief.md written but Phase 1 re-derived scope instead of reading it |
| 1     | `lorekit(memory.list loop::aw-lessons)` (fast-tier lessons applied as constraints); dependency-graph-first localization; Existing Code Survey per planned `create` (rule #10); AC traceability `AC-{n}` + `(covers: R{m})` (rule #9); `code-quality(plan)`; `optimize-approach(plan)` (default-on approach-optimality pass, advisory, bounded re-plan); `confidence(plan)` ≥ 90 % gate (LLM + deterministic rule checks) | Plan missed a hidden constraint; rule checks didn't cover the failure shape; a recorded lesson existed but its `trigger-context` didn't match the task so it wasn't applied; reuse search ran by name not responsibility so a semantic duplicate shipped anyway; `optimize-approach(plan)` re-surfaced Survey/`critical` output as noise, or its adopted re-plan looped |
| 2     | Worktree isolation; `aw-create-plan` writes `plan.md` (Core sections always; Extended sections per `Include when` trigger) + `checks.yaml` (one check per `AC-{n}`, rule #11 sync) | `plan.md` missing a Core section the executor / gate rely on, OR an Extended section omitted when its trigger actually applied; `checks.yaml` drifted from the plan's ACs |
| 3     | `tdd` (RED-GREEN-REFACTOR + mutation); `ux`; `code-quality(code)` at end; Sub-Agent Resource Discipline (resource-discipline language embedded in each fan-out dispatch prompt) | Companion not triggered because trigger condition was too narrow; mutation step skipped in non-TDD path; fan-out dispatch block missing the discipline language (F2) |
| 4     | Stuck-loop cap (3 Lite / 5 Full); `confidence(analysis)`; auto-replan via `holistic-analysis`; Executable Checks Loop (checks.yaml as termination condition; definitions executor-immutable; abort affordance); `lorekit(memory.write loop::aw-lessons)` at escalation | Tests passed first try → no RED phase → no mutation check; cap miscounted; lesson not written so the same stuck-loop recurs next run; a check greened by gaming (special-cased inputs) instead of a real fix |
| 5     | `docs update`                                                                                                    | Skip condition matched wrongly; `CLAUDE.md` / `README.md` / `docs/` drift                                     |
| 6     | `review-changes`; `aw-create-walkthrough`; `create-pr`                                                           | Reviewer didn't compare diff against `plan.md`; walkthrough hid the issue                                     |
| 7     | CI watcher (**bounded**: stateless `gh pr checks` query first, then `timeout 540` per attempt at tool timeout `600000`, 4 attempts counted in-phase); `ci-auto-fix`; optional `pr-reviewer` (self mode, via `review-loop`); `lorekit(memory.write loop::aw-lessons)` end-of-run + promotion check | CI passed because tests were narrow; `pr-reviewer` not installed; recurring lesson (`seen_count >= 3`) not promoted to a permanent guard; **watch issued at the default tool timeout so its expiry handler never ran (silent hang)**; **a remembered verdict reported an unobserved commit as green** |
| post-completion | User-requested changes are never scope creep ([`safety-guardrails.md#user-requested-changes-are-never-scope-creep`](./safety-guardrails.md#user-requested-changes-are-never-scope-creep)); dispatcher "Follow-ups after completion" re-detects the tier for the delta and routes | A user-proposed improvement after the PR is open is refused or accepted-then-deferred as "scope creep"; the delta's tier is not re-detected (a one-line tweak re-planned as Full, or a Full delta squeezed in as a Micro drift edit); the follow-up opens a second branch/PR instead of reusing the existing one |

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID      | Class                  | Symptom                                                                                       | Primary phase | Primary companion / gate                                          |
| ------- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| F1      | Test-by-construction   | New test imports a private copy of the SUT or duplicates its body — passes regardless of prod | 4             | `test-provenance-guard` (static + mutation) — should have run     |
| F2      | Sub-agent resource contention | Phase 3 fan-out dispatches sub-agents with whole-project `tsc`/`lint`/`test`/`build` commands; N concurrent processes saturate developer host RAM (OOM). Root cause: sub-agent prompt inherits whole-project validation commands without scoping. | 3 | Sub-Agent Resource Discipline rule — the discipline language should have been embedded in the dispatch prompt |
| F3      | Plan artifact lacks human-review surface | `plan.md` has no fast-read TL;DR optimized for direction agreement; the user cannot evaluate the planner's direction in under 60 seconds, so the handoff "review" path requires reading the full plan | 2 | `aw-create-plan` template — TL;DR section + validation checklist |
| F4      | Planner edit-driven iteration gap | After `plan.md` is written and the handoff message is emitted, the user has no way to edit `plan.md` directly and have the planner consume those edits as new constraints. Today the only options are accept-as-is, `refine` (planner-driven only), or abandon. Compounded by `plan.md` lacking a `version:` frontmatter field that would survive iterations. | 2 → 3 handoff | `rules/planner-executor-handoff.md` — Edit-driven iteration loop + `iterate` reply option in both handoff messages; `skills/workflow/aw-create-plan/SKILL.md` — `version:` frontmatter field |
| F5      | PR-delivery polish/review collapse | Phase 6 opens the draft PR without create-pr's default post-draft quality loop (`pr-reviewer` auto-fix + `polish simplify`) and/or the Phase 6 critical self-review actually running or running observably — often an over-correction that misapplies a repo's parallel/cascading-verify (lint/tsc/test execution) prohibition to the *allowed* sequential quality pass. Tell-tales: missing `walkthrough.md` in Full Mode; create-pr report carries the CI block but no polish summary and no reviewer-feedback block. | 6 | `rules/phase-6-pr-creation.md` — Phase 6 Delivery Receipt gate (bare-create-pr requirement + deterministic `walkthrough.md` check + per-sub-step receipt) |
| F-novel | Novel mode             | Does not match any existing row                                                               | —             | Diagnosis proposes a new row inline (added on user approval only) |

The taxonomy is **append-only** — every novel failure mode adds a new row, the row is justified by a diagnosis that cleared `confidence(analysis) ≥ 90 %` AND was user-approved at apply time.
Speculative categories were intentionally not pre-populated — they push the diagnoser toward forcing a match where none exists.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **Phase 0 and Phase 2 are mandatory.** Validation and worktree isolation are not optional.
- **`confidence` at Phase 1 is non-removable.** It is the only companion that must always run.
- **Companions degrade silently.** Never make the workflow block on a missing companion (except `confidence` above).
- **Artifact paths are `.agent/{branch}/`, never `.gw/{branch}/`.**
- **`gh` is hard-required; `gw` is optional with a native fallback.**
- **The system-prompt for the agent template stays lean.** It references `SKILL.md` rather than duplicating procedures.
- **Stuck-loop caps (3 Lite / 5 Full) are load-bearing.** Changing them requires updating every coupled surface listed in [`CLAUDE.md`](../CLAUDE.md#the-mode-aware-stuck-loop-cap-3--5-and-auto-replan).
- **Sub-Agent Resource Discipline is non-relaxable.** Sub-agents MUST run scoped/path-narrowed validation commands only. Whole-project `tsc`, `lint`, `build`, and `test` commands are reserved for the orchestrator at Phase 4 Step 6 and Phase 6 pre-PR. A diagnoser must never propose removing this constraint or widening it to allow whole-project commands in sub-agents.
- **Episodic lessons are advisory-only.** A LoreKit `loop::aw-lessons` lesson biases the plan; it must never silently change a gate, skip a phase, or alter a cap. The only path from a lesson to changed workflow behavior is a confidence-gated, user-approved `diagnose` apply. A diagnoser must never propose auto-applying lessons to behavior or promoting them on fewer than `seen_count >= 3` (without an explicit `structural` tag). See [`self-improvement-loop.md`](./self-improvement-loop.md#entrenchment-guards-load-bearing).
- **`checks.yaml` definitions are executor-immutable and check-gaming is forbidden.** The executor flips `status:` (and amends `run:`/`setup:` only with a logged `check-run-amended` entry); `id:`/`requirement:`/`ears:`/`expect:` are never executor-edited, and the four gaming strategies (modify checks/tests, overload comparisons, record/replay state, special-case inputs) are never a valid path to green. A diagnoser must never propose relaxing these or removing the `unsatisfiable` abort affordance. See [`phase-4-testing.md#executable-checks-loop`](./phase-4-testing.md#executable-checks-loop).
- **All-green checks are necessary, not sufficient.** `checks.yaml` never replaces or weakens the test suite, `confidence` gates, `pr-reviewer` dispatch, or Phase 7 verification. A diagnoser must never propose gating any of those on "checks already passed".
- **Every wait on an external system is bounded, at both levels.** The enumerated set is: `gh ... --watch` / `gh run watch`, any poll loop that sleeps, and any command that blocks on CI, a deploy, or a remote queue. (`Task()` dispatch and `WebFetch` are **out of scope for this invariant** — a scoping decision, not a claim that they are bounded.) Both levels must hold, and checking only the first is the trap: (a) the **in-command** bound — a `--watch` with no `timeout`, or a `timeout` larger than the harness cap, never fires its own expiry; (b) the **per-call tool timeout** — Claude Code's Bash tool defaults to 120 000 ms and maxes at 600 000 ms, so a correct `timeout 540` issued at the default is still killed at 2 minutes and its expiry handling is still dead code. A grep that checks only (a) passes a run that still hangs. Retries are bounded by a cap counted **within one skill invocation**; a diagnoser must never propose an unbounded retry, a per-attempt timeout above the harness cap, or omitting the explicit tool-timeout argument.
- **A tool failure is never classified as a benign empty result.** A remote call that fails prints to stderr and nothing to stdout, so `$(cmd)` yields `""` exactly as a legitimately empty result does. Any loop that cannot tell them apart will burn its budget and escalate the wrong cause, or report "nothing to do" when it is simply blind. Every polling block must carry a non-benign default — a `case` whose `*)` arm exits non-zero, or an explicit stderr arm. Enforced by L1 `G23`. A diagnoser must never propose relaxing a poll's default to "continue on anything unrecognised".
- **Watch state is queried, never carried.** A phase that needs to know CI's state runs `gh pr checks <pr>` (no `--watch`) and reads the answer for the current head. It must not inherit a recorded verdict or a spent budget from another phase or subagent: several things in Phase 6/7 push in parallel, so a remembered verdict describes a commit that may no longer be head, and a shared counter across contexts produces racing writers. Re-watching costs time; reporting an unobserved commit as green costs correctness. A diagnoser must never propose reintroducing a cross-phase watch-state file.
- **A run reports what it actually did, including what it skipped.** The universe of skippable things is the registry in [`companion-skills.md`](./companion-skills.md) plus the agent companions listed there. `aw`'s terminal block carries a non-empty `Degraded:` line naming each one that did not run and why — in every form, including the Micro/Lite one-line collapse; the Progress Log carries the same in **Full tier**, where it exists. A diagnoser must never propose suppressing a skip line to make a run read as clean — an unreviewed PR reported as reviewed is worse than a reported deviation.
- **A `blocking` missing-information gap halts even under `--no-confirm`.** The pre-authorization grant waives the Phase 0 confirmation wait, never the missing-information gate. A diagnoser must never propose letting the grant cover `blocking` gaps. See [`phase-0-validation.md#step-3c-missing-information-gate`](./phase-0-validation.md#step-3c-missing-information-gate).

---

## Artifacts

| File pattern                                  | Produced by                       | When                                |
| --------------------------------------------- | --------------------------------- | ----------------------------------- |
| `.agent/{branch}/plan.md`                     | `aw-create-plan`                  | After Phase 2 (Full Mode); handoff document |
| `.agent/{branch}/plan.v{N}.md`                | `aw-create-plan` (`snapshot` arg) | **Opt-in only** — immutable audit trail; not written by default |
| `.agent/{branch}/checks.yaml`                 | `aw-create-plan` (Step 2b)        | With the plan; the living contract — statuses updated by the executor in Phase 4 |
| `.agent/{branch}/walkthrough.md`              | `aw-create-walkthrough`           | Phase 6 (Full Mode)                 |
| Progress Log inside `plan.md`                 | Workflow itself                   | Per companion invocation            |
| Draft PR + commit history                     | `create-pr`                       | Phase 6                             |

Lite Mode runs produce no `plan.md` / `walkthrough.md` — diagnoses against Lite runs have a thinner evidence trail and the report should call that out as a contributing factor.

---

## Lessons scope

- Bucket: `aw-lessons` (LoreKit tag `loop::aw-lessons`, key `aw-lessons::<slug>`)
- Scope: `global` (universal) + `repo::{owner}/{repo}` (project-bound)
- Read for evidence with: `memory.list { scope: "global", tags: ["loop::aw-lessons"] }` (and `repo::{owner}/{repo}`)

Diagnose Step 2 loads promotion-eligible lessons (`seen_count >= 3` or `status: structural`) as evidence — they are the strongest signal that a failure recurs. See [`self-improvement-loop.md`](./self-improvement-loop.md).

---

## Validators

- `claude plugin validate skills/workflow/autonomous-workflow` — frontmatter + structure check.
- Manual end-to-end pattern in [`CLAUDE.md`](../CLAUDE.md#testing-changes-end-to-end): symlink locally, run a small Lite Mode task, run a larger Full Mode task. There is no automated test suite for this skill.
