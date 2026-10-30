---
name: autonomous-workflow
description: >
  The phase machinery (0–7) behind the `aw` dispatcher: task intake through a tested draft PR in an
  isolated worktree, gated by the plan.md brief and the run-checks.mjs sentinel, with companions that
  never block. Not the entry point — natural-language requests for autonomous work go to the `aw`
  skill; invoke /autonomous-workflow only to run the phases directly.
disable-model-invocation: false
argument-hint: '<task-description> [--no-confirm] [--critical] [--interview|--no-interview]'
license: MIT
metadata:
  author: mthines
  version: '4.0.0'
  workflow_type: orchestrator
  tags:
    - autonomous
    - workflow
    - worktree
    - feature-development
    - pr
---

# Autonomous Workflow

Phase-based autonomous feature development: each phase has a gate that must pass before the next.
This file is an index; procedures live in `rules/*.md` and load on demand.

## Contents

- [Before Starting Any Work](#before-starting-any-work) — Step 1 tier detection, Step 2 prerequisites
- [Workflow Phases](#workflow-phases)
- [Core Principles](#core-principles)
- [Artifacts](#artifacts)
- [Lite and Micro path](#lite-and-micro-path)
- [Companions and parallelization](#companions-and-parallelization)
- [Units and install](#units-and-install)

## Before Starting Any Work

### Step 1: Detect Workflow Mode (MANDATORY)

**Complexity is the primary signal. File count is the tie-breaker.** Walk these
questions in order — the first `yes` selects Full Mode:

| # | Question                                                                                  | If yes →     | If no →     |
| - | ----------------------------------------------------------------------------------------- | ------------ | ----------- |
| 1 | Is this task architectural / cross-cutting / does it require significant design decisions? | **Full**     | go to next  |
| 2 | Does the task involve unfamiliar code or domains the agent hasn't worked in before, **or is the cause or location not yet known** — an investigation rather than a known edit? | **Full**     | go to next  |
| 3 | Is the change touching 4+ files OR 2+ packages?                                           | **Full**     | go to next  |
| 4 | Is the change 2–3 files, OR any non-trivial logic change?                                 | **Lite**     | **Micro**   |

| Tier      | Files / shape                                                        | Artifacts | Planning            | Companions      |
| --------- | -------------------------------------------------------------------- | --------- | ------------------- | --------------- |
| **Full**  | complex / 4+ files / unfamiliar / cause or location unknown          | Required  | `aw` writes a short `plan.md` brief, works to its checks, then a fresh-eyes review | required ones; the rest at judgment |
| **Lite**  | 2–3 files, **or 1 file carrying non-trivial logic**                  | None      | in-conversation brief | per signal      |
| **Micro** | 1 file **and** purely mechanical (typo, copy, bump, string change)   | None      | in-conversation brief, no planning | none (docs if drift) |

**The walk decides; the table only describes its outcomes.** Where the two seem to
disagree, the walk wins. Two readings this exists to rule out:

- **Q4's `OR` is load-bearing.** A **one-file** change with non-trivial logic is
  **Lite**, not Micro — Micro needs *both* one file *and* nothing to reason about.
  Adding a prop and forwarding it, adding a CLI flag that changes behaviour, or
  debouncing an input are all Lite at one file, because each has logic to get wrong.
- **Q2 covers not knowing *where*, not only not knowing *the code*.** "Fix the leak
  somewhere in the streaming pipeline, not sure which layer" is Full: the edit may
  turn out to be one line, but the work is an investigation, and its file count is
  unknown until the investigation finishes. Tiering on the *guessed* size of the
  eventual patch is what Q1 and Q2 exist to prevent.

Questions 1–2 ground the decision in complexity rather than raw file count (one large change can exceed four trivial edits in scope); question 3 is the file-count tie-breaker.
**Phase 0 and Phase 2 stay mandatory in every tier**, including Micro.

**When in doubt, choose Full.** Output mode selection in this exact format:

```
MODE SELECTION:
- Tier: [Micro | Lite | Full]
- Reasoning: [why]
- Estimated files: [number]
- Complexity: [trivial | simple | moderate | architectural]
- Lessons applied: [N matched, or none]
```

This block is canonical: the [`aw` dispatcher skill](./aw/SKILL.md) and [`rules/phase-0-validation.md`](./rules/phase-0-validation.md) emit it field-for-field.

### Step 2: Verify Prerequisites

| Capability | Status | Check | If missing |
| ---------- | ------ | ----- | ---------- |
| GitHub access | Required (the capability, not the binary) | Resolve `ACCESS_PATH` per [`github-access.md` § Step 0](../../../agents/shared/rules/github-access.md#step-0--resolve-your-path-once-before-any-github-step) — never `which gh`, never `gh auth status` | Only `ACCESS_PATH = none` degrades Phases 6–7; name it in `Degraded:` and never report a GitHub step you could not perform as done |
| `gw` | Recommended | `which gw` | Fall back to native `git worktree` (warn once) |

`gh` is one of two GitHub paths; in cloud sessions it is absent and the `mcp__github__*` tools both agents carry are the path.
Details: [`rules/prerequisites.md`](./rules/prerequisites.md) — read when a prerequisite is missing.

## Workflow Phases

| Phase | Name | Rule file | Gate |
| ----- | ---- | --------- | ---- |
| 0 | Validation | [phase-0-validation.md](./rules/phase-0-validation.md) | User confirmed understanding |
| 1 | Planning | [phase-1-planning.md](./rules/phase-1-planning.md) | Six Core headings, one check per `AC-{n}`, `checks.lock` sealed — deterministic, no LLM score |
| 2 | Worktree Setup | [phase-2-worktree.md](./rules/phase-2-worktree.md) | Worktree created, brief + `checks.yaml` written, `/goal` line printed |
| 3 | Implementation | [phase-3-implementation.md](./rules/phase-3-implementation.md) | Code complete, fast checks pass, only File Changes touched |
| 4 | Testing | [phase-4-testing.md](./rules/phase-4-testing.md) | Suite green, then `run-checks.mjs` prints `CHECKS M/M PASS` |
| 5 | Documentation | [phase-5-documentation.md](./rules/phase-5-documentation.md) | Docs reflect changes (incl. `CLAUDE.md`) |
| 6 | PR Creation | [phase-6-pr-creation.md](./rules/phase-6-pr-creation.md) | Walkthrough shown, draft PR opened, `AW EVIDENCE` printed |
| 7 | CI Gate + Optional Cleanup | [phase-7-ci-gate.md](./rules/phase-7-ci-gate.md) | CI green or user-approved stop |

**Phase 0 and Phase 2 are MANDATORY.** All others gate progression to the next.
`--no-confirm` (or "proceed without confirmation") makes Phase 0 post its summary and proceed without waiting; it never covers a `blocking` missing-information gap — [phase-0-validation.md](./rules/phase-0-validation.md#step-5-get-explicit-confirmation).

## Core Principles

1. **Detect the tier first** — Micro, Lite, or Full before any other action.
2. **Phase 0 and Phase 2 are mandatory** — no skipping validation or the worktree.
3. **Plan as a brief, review after the fact.** The brief is at most 60 lines of outcomes and sourced limits — Task, Requirements, Guardrails, Acceptance Criteria (Definition of Done), Turn Cap, and starting File Changes — never a design; a fresh-context reviewer and the human's one-page walkthrough check the result.
4. **Done is a command, not a judgment.** In Full Mode, Phase 4 ends only on the `run-checks.mjs` sentinel `CHECKS M/M PASS (<sha>)`; check definitions are sealed and executor-immutable, and all-green is necessary, never sufficient.
5. **Print the goal and the evidence.** At the end of planning print a paste-ready `/goal` line; before the terminal contract print the `AW EVIDENCE` block — [`rules/goal-emission.md`](./rules/goal-emission.md).
6. **Verify after editing** — the brief's After-editing command before continuing.
7. **Stuck-loop cap is mode-aware**: 3 (Lite) / 5 (Full) iterations on the same failing area trigger `Skill("confidence", "analysis")`, then one auto-replan or escalation.
8. **Companions never block, and never skip silently.**
9. **Stop and ask when blocked.** A `blocking` missing-information gap halts even under `--no-confirm`.
10. **User-requested changes are never scope creep** — fold post-completion improvements in as a new iteration — [`rules/safety-guardrails.md`](./rules/safety-guardrails.md#user-requested-changes-are-never-scope-creep).

## Artifacts

Full Mode artifacts live in `.agent/{branch}/` (add `.agent/` to `.gitignore`):

| File | Generated by | When |
| ---- | ------------ | ---- |
| `plan.md` | `Skill("aw-create-plan")` | Phase 2 and every plan iteration — the brief |
| `checks.yaml` + `checks.lock` | `Skill("aw-create-plan")` | With the plan — one check per `AC-{n}`, sealed; Phase 4's termination condition |
| `checks.run.log` | `scripts/run-checks.mjs` (teed by the executor) | Every Phase 4 run — ends with the sentinel line |
| `walkthrough.md` | `Skill("aw-create-walkthrough")` | Phase 6 — the one-page post-hoc review |

Snapshots (`plan.v{N}.md`) are opt-in via `Skill("aw-create-plan", "snapshot")`.
Artifact details: [`rules/artifacts-overview.md`](./rules/artifacts-overview.md) — read when resuming a run or reading artifacts cold.

## Lite and Micro path

Single-pass in the caller's context; no `checks.yaml`, no `confidence(plan)`.
Lite writes its brief to `.agent/{branch}/plan.md` inside the worktree, after Phase 2 creates it, so `aw-verify` and `telemetry-verify` read stated criteria instead of guessing them from the diff; Micro keeps its brief in the conversation.

```markdown
---
tier: Lite
turn_cap: 12
---
## Task
Debounce the search box so typing does not fire a request per keystroke.
## Guardrails
- Keep unchanged: the `?q=` URL contract — docs/search.md
## Acceptance Criteria
- [ ] AC-1 — When the user types "otel" quickly, the system shall send one search request.
- [ ] AC-2 — When the user clears the box, the system shall show the recent-searches list.
- **Before PR**: `pnpm vitest run src/search`
## File Changes
- `src/search/SearchBox.tsx`
```

Keep it at most 20 lines: `tier: Lite` frontmatter, Task, Guardrails, `AC-{n}` outcome criteria (a `telemetry:` prefix where the change adds a signal), the Before-PR command, and the files.
Never write `checks.yaml` or `checks.lock` on Lite: `checks.lock` is what marks a Full brief.

| Phase | Lite | Micro |
| ----- | ---- | ----- |
| Setup | MODE SELECTION | MODE SELECTION |
| 0 | Quick clarification | Quick confirm |
| 1 | Brief (Task, Guardrails, `AC-{n}`, Before-PR command, Turn Cap 12, files), printed, + `/goal` line | In-conversation brief (Task, Guardrails, verify command, files), Turn Cap 5, no companions |
| 2 | `gw add <branch>`, then write the brief to `.agent/{branch}/plan.md` inside the new worktree | `gw add <branch>` |
| 3 | Code, commit; touch only the brief's files | Edit, fast check |
| 4 | Test, fix failures (3-iteration cap); print the verify command with `exit=<code>`. Diff touches UI files → [Lite verify](#lite-verify) | Fast check |
| 5 | `Skill("docs", "update --auto")` | Only on doc drift |
| 6 | `Skill("create-pr", "--no-post-review")` (its Step 5.5 is the local review; see [`aw` § Review](./aw/SKILL.md#review)); when Phase 4 ran `aw-verify`, then `Skill("aw-verify", "report <pr-url>")`; then the `AW EVIDENCE` block | `Skill("create-pr", "--no-post-review")`, then the `AW EVIDENCE` block |
| 7 | Watch CI, `ci-auto-fix` if needed | Watch CI |

### Lite verify

Lite proves a UI change in the browser before the PR, the same way Full Step 4.1 does; Micro never runs it.

1. `.agents/aw/environments.yml` exists → `Skill("aw-verify", "run local --no-push --no-comment --foreign-stack abort")`.
   It copies the `AC-{n}` criteria from the Lite `plan.md`, writes the specs, runs them through `ui-verify`, fixes what it finds as separate commits, and leaves its screenshots and recordings where `create-pr` Step 6.2 picks them up.
2. A failed `ui:` criterion, a `BROKEN` verdict, or a `telemetry:` AC whose receipt is `contradicts` re-enters Phase 3 under the same turn cap.
   Any other `telemetry:` receipt that is not `confirms` goes under `Degraded:`, as Full Step 4.1 leaves it unpassed.
3. No `.agents/aw/environments.yml` → `verify run: not configured` under `Degraded:` and `run /aw-verify setup` under `Needs you:`; never block on setup.
4. Print the `verify run:` line from Full's `AW EVIDENCE` block ([`aw/rules/full-tier.md` § Step 4](./aw/rules/full-tier.md#step-4--verify-walkthrough-pr-evidence)) in Lite's `AW EVIDENCE` block.

```text
✗ Wrong — Lite UI diff, verify configured, PR opened with no browser evidence
✓ Right — aw-verify run local → create-pr attaches its captures → aw-verify report <pr-url> posts the report
```

## Companions and parallelization

The registry — triggers, args, the mandatory `companion: <name> — ran | skipped (<reason>)` report line, and how to disable a companion — is [`rules/companion-skills.md`](./rules/companion-skills.md); each agent template carries the rows for its phases.
Lessons: the fast tier (`loop::aw-lessons` on LoreKit) and the slow tier (`/create-skill diagnose autonomous-workflow`) are in [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md); the diagnoser reads [`rules/diagnostic-surface.md`](./rules/diagnostic-surface.md).

Fan-out points, each read when it applies:

- Phase 1 — at most two `Explore` sub-agents, only for an unfamiliar area: [phase-1-planning.md](./rules/phase-1-planning.md).
- Phase 3 — up to 3 concurrent sub-agents on file-disjoint slices, each embedding the resource-discipline line: [parallel-coordination.md](./rules/parallel-coordination.md#sub-agent-resource-discipline).
- Phase 7 — one `ci-auto-fix` sub-agent per independent failure, cap 2 handoffs per PR: [phase-7-ci-gate.md](./rules/phase-7-ci-gate.md#parallel-ci-fixes).

## Units and install

The skill ships **one dispatcher skill** and **two agents** (`aw-` = autonomous-workflow):

| Unit | Kind | Role | Exit gate |
| ---- | ---- | ---- | --------- |
| [`aw`](./aw/SKILL.md) | skill | Opt-in dispatcher: lessons, tier, routing, `/goal` line; on Full, the brief + sealed `checks.yaml`, then the work in this session per `aw-executor`, then a local `review-loop` pass | Task routed, exit lesson written |
| [`aw-executor`](./templates/aw-executor.agent.md) | procedure (and agent) | Full, Phases 3–7 from the brief, applying [`corrections.md`](./rules/corrections.md) → review, walkthrough, draft PR; `aw` follows it in-session, `/fix-bug` through `aw`'s Full tier, and a background or parallel request dispatches it | `CHECKS M/M PASS`, walkthrough shown, CI gate run |
| [`aw-tester`](./templates/aw-tester.agent.md) | agent | Phase 4 (UI) spec verification, cold pass only | `green` or `inconclusive` before lint/type/test |

Other files: [`routing.rule.md`](./templates/routing.rule.md) (auto-trigger rule), [`specs.md.template`](./templates/specs.md.template), [`intent-spec.md.template`](./templates/intent-spec.md.template), [`scripts/run-checks.mjs`](./scripts/run-checks.mjs) (the check runner; `--self-test` proves it).
Related skills: `aw-verify` (run `/aw-verify setup` once per project; it writes `.agents/aw/`, which `aw-tester` targets come from), [`aw-tester-chrome`](./aw-tester-chrome/SKILL.md) (in-session Chrome runner), [`aw-create-plan`](../aw-create-plan/SKILL.md), [`aw-create-walkthrough`](../aw-create-walkthrough/SKILL.md).
Design rationale: [`CLAUDE.md`](./CLAUDE.md) and [`references/anthropic-architecture-research.md`](./references/anthropic-architecture-research.md).

Install the skill, its companions, and the agents:

```bash
git clone https://github.com/mthines/agent-skills.git
cd agent-skills
bash scripts/sync-symlinks.sh --aw
```

Other install modes and per-companion disabling: [`README.md`](./README.md#installation).
