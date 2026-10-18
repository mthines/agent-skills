---
name: fix-bug
description: >
  Resolves one bug from any evidence (Dash0 link, stack trace, error, file:line,
  screen recording, Linear ticket, or symptom): triages complexity, locks a
  failing repro, runs root-cause analysis, and at confidence >= 92 % hands off
  to a verified draft PR via the fast or standard lane. Flags --analyse-only,
  --force-holistic, --verify-deploy <PR>; triggers on "/fix-bug".
argument-hint: '[--analyse-only|--force-holistic] [<bug-description>|<ticket>]'
license: MIT
user-invocable: true
disable-model-invocation: false
metadata:
  author: mthines
  version: '2.3.0'
  workflow_type: orchestrator
  architecture: classify/triage/preflight/reproduce/analyse/gate/handoff(fast|standard)/verify/telemetry
  agents:
    rca: rca-investigator
    planner: aw-planner
    executor: aw-executor
    verifier: bug-fix-verifier
    investigator: linear-ticket-investigator
  composes: [holistic-analysis, confidence, aw-create-plan, tdd, e2e-testing, e2e-testing-mobile, video-analyser, autonomous-workflow]
  phases: [intake, complexity_triage, evidence_resolution_with_preflight, source_mapping_with_reproduction, holistic_analysis_or_lightweight, confidence_gate, branch_decision, autonomous_handoff_lane_split, independent_verification, telemetry_verification]
  tags: [bug-fix, debugging, telemetry, dash0, confidence-gated, reproduction-first, cegis, autonomous-workflow, root-cause, orchestrator, complexity-triage, fast-lane]
---

# Fix Bug

Take a bug in any form and either ship a verified draft PR or hand back an evidence-backed proposal.
This skill orchestrates; analysis, gating, repro authoring, planning, implementation, and grading run in the skills and agents each phase names.

## Contents

Phases: [0 Intake](#phase-0--intake--classification) → [0.5 Triage](#phase-05--complexity-triage) → [1 Evidence](#phase-1--evidence-resolution) → [2 Repro lock](#phase-2--source-mapping--reproduction-lock) → [3 Analysis](#phase-3--analysis) → [4 Confidence](#phase-4--confidence-gate) → [5 Decision](#phase-5--branch-decision) → [6 Handoff](#phase-6--autonomous-handoff-lane-split) → [7 Verify](#phase-7--independent-verification) → [8 Telemetry](#phase-8--telemetry-verification); then [Lesson writes](#lesson-writes) and [Output Format](#output-format).

The **bug-notes ledger** at `.agent/<branch>/bug-notes.md` is read on entry and appended on exit by every phase — [`rules/bug-notes-ledger.md`](./rules/bug-notes-ledger.md).
Read [`rules/prerequisites.md`](./rules/prerequisites.md) when a dependency (agent, skill, CLI, MCP) is missing or may be optional.
Read [`references/design-rationale.md`](./references/design-rationale.md) or [`references/research-sources.md`](./references/research-sources.md) when you need the why behind a gate or threshold.

## Phase 0 — Intake & Classification

### Step 0a — Detect mode flags

| Flag | Action |
|------|--------|
| `--analyse-only` (or `--analyze-only`) | Set `ANALYSE_ONLY=true`. Continue to step 0b. |
| `--force-holistic` | Set `FORCE_HOLISTIC=true`. Continue to step 0b. Phase 0.5 will skip its decision and pick `complex`. |
| `--verify-deploy <PR>` | Set `VERIFY_DEPLOY_MODE=true` and `VERIFY_DEPLOY_PR=<PR>`. Skip steps 0b–0c; follow [`rules/verify-deploy.md`](./rules/verify-deploy.md). |

If two or more flags are present, fail with
`--analyse-only, --force-holistic, and --verify-deploy are mutually exclusive`.
Strip the matched flag (and its argument, for `--verify-deploy`) from `$ARGUMENTS`.
Print one mode line only if a flag matched:

```text
Mode: analyse-only
Mode: force-holistic
Mode: verify-deploy (PR #<N>)
```

### Step 0b — Classify input shape

Walk the table top-to-bottom. The first matching row wins.

| # | Input shape | Detection rule | Route |
|---|-------------|----------------|-------|
| 1 | Dash0 URL | Matches `https?://[^/]*dash0\.com/` or contains `traceId=` / `spanId=` query parameters | [Dash0 resolution](./rules/evidence-resolution.md#dash0-resolution) |
| 2 | Linear ticket URL | Matches `https?://linear\.app/.+/issue/` | [Linear input](./rules/evidence-resolution.md#linear-input) |
| 3 | Video / screen recording | Path / URL ends in `.mp4`, `.mov`, `.webm`, `.avi`; or text mentions "screen recording", "video of the bug" | `Skill("video-analyser", "<input>")`, then loop back with structured findings |
| 4 | Code pointer | Matches `<path>:<line>` or `<path>#L<line>` | [Code pointer](./rules/evidence-resolution.md#code-pointer) |
| 5 | Stack trace | Multi-line input matching `at .+ \(.+:\d+:\d+\)`, `File ".+", line \d+`, or `\s+at\s+\S+:\d+` | [Stack trace](./rules/evidence-resolution.md#stack-trace) |
| 6 | Error message | Short block matching `Error:`, `Exception:`, `Traceback`, `panic:`, `TypeError`, etc. | [Error message](./rules/evidence-resolution.md#error-message) |
| 7 | Free-text symptom | Anything else | [Clarifying questions](#clarifying-questions) |

### Step 0c — Infer bug class

Infer a `bugClass` tag from the symptom and any stack-trace / error-message text. Pick from:

| Class | Signals |
|-------|---------|
| `null-deref` | "Cannot read property of undefined", "NoneType has no attribute", "nil pointer dereference" |
| `race` | "intermittent", "sometimes works", "depends on order", concurrency keywords |
| `off-by-one` | "wrong count", boundary-condition keywords, "first/last item missing" |
| `contract-mismatch` | type errors, schema validation failures, API shape mismatches |
| `perf` | "slow", "timeout", "TBT", "INP", profile-shaped evidence |
| `config` | env-var / feature-flag / deploy-config keywords |
| `regression` | "worked before", "started failing on <date>", pre-flight produced a `last_green_sha` |
| `logic` | none of the above match — generic logic bug |
| `unknown` | classification not possible from the evidence |

Append to the Evidence Record under `Bug class`. The class is passed as a hint to
holistic-analysis (Phase 3) and informs strategy selection in `aw-planner` (Phase 6). Source:
RepairAgent ([ICSE 2025](https://software-lab.org/publications/icse2025_RepairAgent.pdf)),
[NIST Seven Pernicious Kingdoms](https://samate.nist.gov/SSATTM_Content/papers/Seven%20Pernicious%20Kingdoms%20-%20Taxonomy%20of%20Sw%20Security%20Errors%20-%20Tsipenyuk%20-%20Chess%20-%20McGraw.pdf).

### Clarifying questions

If the input is free text or empty, ask up to **3 questions** in one message and wait.
Priority: telemetry/trace availability, when the bug started, expected vs actual behaviour.
Do not run analysis on free text alone.
After step 0c, continue to Phase 0.5; Phase 1 does not start until triage commits.

## Phase 0.5 — Complexity Triage

Pick between two routing lanes for the rest of the pipeline: **`simple`** (lightweight in-skill
analysis + fast-lane handoff) or **`complex`** (canonical holistic-analysis + standard-lane
handoff). This is a **routing decision, not a quality decision** — confidence (Phase 4) still
owns the auto-implement call.

**Before the decision — read prior lessons.** Load `fix-bug-lessons` from
LoreKit (narrow-to-broad — this repo's scope, then `global`) so this skill's own
past misfires (triage / repro-layer / analysis) bias the run:

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::fix-bug-lessons"], limit: 50 }   # no-op if memory.* not connected
memory.list { scope: "global", tags: ["loop::fix-bug-lessons"], limit: 50 }
```

Match lessons by `bugClass` + input shape; apply matches as **advisory inputs**
to the triage decision (they never override the conservative `complex` default
or relax any gate). Skip lessons whose `expires` has passed. Record applied
lessons in the bug-notes ledger. Full contract:
[`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md#read-lessons-phase-05).

Walk the 14-row signal table in [`rules/complexity-triage.md`](./rules/complexity-triage.md) and
apply the decision rule (conservative default: pick `complex` when in doubt). The outcome:

| Outcome | Phase 3 | Phase 6 lane (provisional) |
|---------|---------|----------------------------|
| `simple` | **skip** — lightweight in-skill analysis | fast-lane (if confidence ≥ 92 % + non-best-effort repro) |
| `complex` | dispatch `Task(rca-investigator)` — isolated holistic-analysis + confidence | standard-lane |

Append the classification, signals, decision, and provisional lane to the bug-notes ledger under
a `Complexity triage` section.
The ledger is **created on first write**: if `.agent/<branch-or-slug>/bug-notes.md` does not yet
exist, create it from [`templates/bug-notes.md`](./templates/bug-notes.md) before appending —
under the normal flow this Phase 0.5 append is the first write and therefore the creation point
(see [`rules/bug-notes-ledger.md`](./rules/bug-notes-ledger.md#lifecycle)).
Pre-flight (Phase 1.5) may upgrade `complex` → `simple` later;
never the reverse direction inside a run. `--force-holistic` short-circuits to `complex`.

## Phase 1 — Evidence Resolution

**Step 1a.** Walk only the procedures in [`rules/evidence-resolution.md`](./rules/evidence-resolution.md) that match the Phase 0 inputs; each produces a partial evidence record.

**Phase 1.5 — Pre-flight sweep.** Run the probes in [`rules/preflight.md`](./rules/preflight.md) (recent commits to affected files, last-known-green deploy SHA, lockfile / env diff, CI flips) and append findings to the Evidence Record.
If pre-flight produces a single-commit short-circuit (commit + diff size + CI flip window all align), skip Phase 3 and route to Phase 5 with a high-confidence proposal.
Otherwise capture the regression window for step 2c.

## Phase 2 — Source Mapping + Reproduction Lock

**Step 2a.** Merge the Phase 1 partial records into one Evidence Record (schema: [`templates/bug-notes.md`](./templates/bug-notes.md) § `Evidence Record`).

**Phase 2.5 — Reproduction lock.** Build a deterministic failing repro per [`rules/reproduction.md`](./rules/reproduction.md).
For a telemetry-sourced input, first run the rule's repro-fidelity check: pass the originating span's shape from the Evidence Record to `Skill("observe-run")` as literal expectations — never as "matches production", since `observe-run` reads only the local run's telemetry (its `dev.run.id`).
The check is advisory and never touches Phase 8.
Then pick the lowest layer that captures the bug and delegate:

- Unit / component / hook / integration → `Skill("tdd", ...)`
- Web user flow → `Skill("e2e-testing", ...)`
- Expo / React Native user flow → `Skill("e2e-testing-mobile", ...)`
- Visual-only / pixel-perfect → best-effort markdown checklist

The repro is the executor's `FAIL_TO_PASS` contract (Phase 6) and the verifier's `FAIL_TO_PASS` check (Phase 7).
Path convention: `repro/<short-bug-id>.<ext>`.

**Step 2c — Bisect fast-path (regression class only).** If pre-flight produced a `last_green_sha` AND a non-best-effort repro exists, run `git bisect run <repro-command>`.
If the offending commit's diff is ≤ 50 lines, route to Phase 5 with proposal "revert or amend `<sha>`" ([details](./rules/reproduction.md#bisect-fast-path)).

**Step 2d.** Append the Evidence Record to the ledger, creating it from the template only if no earlier phase did ([lifecycle](./rules/bug-notes-ledger.md#lifecycle)).

## Phase 3 — Analysis

### `complex` path — isolated holistic analysis

```text
Task(subagent_type="rca-investigator", prompt="<Evidence Record from Phase 2>")
```

Include the `bugClass` hint, any pre-flight short-circuit findings, and every ledger hypothesis with `state = ruled-out`.
The agent runs `holistic-analysis` `fix` + `/confidence analysis` in its own context and returns a Root-Cause Record (root cause, causal chain, evidence, ruled-out alternatives, confidence score, fix direction); do not re-run either here.
If `rca-investigator` is unavailable, run `Skill("holistic-analysis", "fix\n\n<Evidence Record>")` in-context instead (it calls `/confidence analysis` at its Phase 6).

### `simple` path — lightweight in-skill analysis

Skip `holistic-analysis` ([what simple skips](./rules/complexity-triage.md#what-simple-actually-skips)):

1. Read the suspect file at the suspect line + 30 lines of context.
2. Identify the minimal change that satisfies the failing repro (Phase 2.5) and does not break neighbours.
3. Write a root-cause paragraph to the Evidence Record — same shape `holistic-analysis` produces, including a `Falsifiable prediction:` line that the repro confirms.
4. Continue to Phase 4 — the score comes from the `confidence` skill, never self-graded.

If the lightweight analysis cannot propose a fix (suspect file not in the failing path, or more than one plausible cause), upgrade triage to `complex`, run `holistic-analysis`, and log `triage upgrade: simple → complex (lightweight analysis under-determined)`.

## Phase 4 — Confidence Gate

Reuse the Phase 3 score (from the Root-Cause Record, or from holistic-analysis's Phase 6 on the fallback).
Re-run `/confidence analysis` only if new evidence arrived since Phase 3 or the proposed fix materially changed.
Append the score and breakdown to the ledger's `Confidence trajectory` table.

## Phase 5 — Branch Decision

### Step 5a — Reproduction gate (mechanical)

Runs before the confidence action, regardless of score and of `ANALYSE_ONLY`; there is no force-proceed below it.
Read `.agent/<branch-or-slug>/bug-notes.md` § `## Reproduction (Phase 2.5)` and extract `Path:`, `Status:`, and (when present) `Reason:`.

| # | Pass condition |
|---|---|
| 1 | `Path:` resolves to an existing file matching the project's test convention (e.g. `repro/*.test.{ts,tsx,js,jsx,mjs}`, `repro/test_*.py`, `repro/*_test.go`, `repro/*.rs`) AND `Status:` contains `failing on HEAD as expected` |
| 2 | `Path:` resolves to an existing `repro/*.md` file AND `Status:` contains `best-effort` AND `Reason:` is one of: `race`, `production-only`, `heisenbug`, `visual`, `performance` |

If neither holds, emit the [Step 5a error](./rules/gate-errors.md#step-5a--reproduction-gate) verbatim and return to Phase 2.5.

### Step 5b — Confidence-based action

If `ANALYSE_ONLY=true`, always return the proposal (after Step 5a passes), skip Phases 6–8, and set `Outcome` to `analyse-only (no PR)`.

Otherwise:

| Confidence | Action |
|------------|--------|
| **>= 92%** | No human confirmation. Print a one-line status (lane + root cause + score) and go to Phase 6. Lane: fast-lane if triage = `simple` AND a non-best-effort repro exists; otherwise standard-lane. |
| **80–91%** | Stop. Present Evidence Record + proposed fix + confidence breakdown + what would raise the score. Offer: collect more evidence, force-proceed (always standard-lane), or abandon. |
| **70–79%** | Stop. Force-proceed (standard-lane) offered but flagged **NOT recommended**. |
| **< 70%** | Stop. Do not offer force-proceed — no escape hatch. Present the analysis findings as a discussion document and ask the user for direction. |

On a stop (`< 92 %`), a triage upgrade (`simple → complex`), or a fast-lane → standard-lane CEGIS fallback, write a lesson with trigger `phase-5-stop` ([Lesson writes](#lesson-writes)).

## Phase 6 — Autonomous Handoff (Lane-Split)

Runs only when `ANALYSE_ONLY` is unset and Phase 5 cleared at >= 92 % (or the user force-proceeded at 70–91 %, which forces the standard-lane).

### Step 6.pre — Branch pre-flight assertion (mechanical)

Before lane selection, run `git rev-parse --abbrev-ref HEAD`.
If the result is in the closed protected-branch list `{main, master, develop, trunk}`, emit the [Step 6.pre error](./rules/gate-errors.md#step-6pre--branch-pre-flight) and refuse to proceed; the agent must run `gw checkout fix/<slug>` ([step 6a](./rules/autonomous-handoff.md#step-6a-fast--create-worktree--planmd)) before re-entering Phase 6.
Any other branch continues.

### Step 6.main — Lane selection and dispatch

| Lane | Trigger | Plan authored by |
|------|---------|------------------|
| **Fast-lane** | triage = `simple` AND confidence ≥ 92 % AND non-best-effort repro | `/fix-bug` → `Skill("aw-create-plan", ...)` (no aw-planner) |
| **Standard-lane** | `complex` / downgrade / force-proceed | `aw-planner` (canonical) |

Follow [`rules/autonomous-handoff.md`](./rules/autonomous-handoff.md) (fast-lane plan.md: [`rules/fast-lane-plan-contract.md`](./rules/fast-lane-plan-contract.md); standard-lane pack: [`templates/bug-fix-pack.md`](./templates/bug-fix-pack.md)).
Both lanes share the CEGIS 3-round cap; a fast-lane round-3 failure falls back to the standard-lane with the captured counterexamples.

**The main agent does not edit files in Phase 6.** All implementation runs inside `Task(subagent_type="aw-executor", ...)`; Step 7.pre fails closed when no draft PR exists.

## Phase 7 — Independent Verification

### Step 7.pre — Draft PR assertion (mechanical)

Run `gh pr view --json url,isDraft,headRefName 2>/dev/null` for the current branch.
**All** must hold: a PR exists (exit 0 with JSON, not the `MISSING` fallback); `isDraft = true`; `headRefName` equals `git rev-parse --abbrev-ref HEAD`.
On pass, capture the PR URL.
On any failure, emit the [Step 7.pre error](./rules/gate-errors.md#step-7pre--draft-pr-assertion) and stop — there is no force-proceed, and skipping the verifier for a "small diff" is forbidden.

### Step 7.main — Spawn the verifier

Spawn `bug-fix-verifier` in a fresh context with no planner / executor reasoning, per [`rules/independent-verification.md`](./rules/independent-verification.md).
Green → it runs `gh pr ready`; red → the PR stays draft and you surface its evidence.
On a verifier RED, write a lesson with trigger `verifier-red`, naming which earlier phase under-caught it (triage too `simple`? repro false-green? analysis wrong file?).

## Phase 8 — Telemetry Verification

Runs only for a Dash0 / telemetry input once the PR is merged and deployed; the fix is done when the originating signal stops firing.
Classify the bug's observability shape (Step 8a) and pick one of five modes (Step 8b) — rate-decay, extended watch, cohort absence, build-version absence, or deferred-watch — then run it, all per [`rules/telemetry-verification.md`](./rules/telemetry-verification.md).
Default operating mode is **deferred**: emit a follow-up task to re-invoke `/fix-bug --verify-deploy <PR>` once the deploy lands.
`--inline-verify` runs synchronously when the project auto-deploys on merge.
If the originating signal does not decay (or recurs), write a lesson with trigger `telemetry-firing`.

## Lesson writes

Fast tier: LoreKit `fix-bug-lessons` (tag `loop::fix-bug-lessons`), read at Phase 0.5 and written at the triggers below, per [`rules/self-improvement-loop.md` § Write lessons](./rules/self-improvement-loop.md#write-lessons) (scope classification, `memory.search` dedup, then `memory.write` with key `fix-bug-lessons::<slug>`, tags `["loop::fix-bug-lessons", "source::<trigger>"]`, `source_agent: "fix-bug"`, `trigger: "<trigger>"`).
A silent no-op when `memory.*` is not connected; the write skips consent, not the privacy pre-flight.
Implementation-phase lessons live in `aw-lessons`, not here.

| Trigger | When |
|---------|------|
| `phase-5-stop` | Phase 5 stop, triage upgrade, or fast-lane → standard-lane fallback |
| `verifier-red` | Phase 7 verifier RED |
| `telemetry-firing` | Phase 8 signal does not decay or recurs |

Slow tier: if a run shipped wrong code despite all three confidence gates, a post-merge regression traces to a missed check, or a lesson recurs `seen_count >= 3`, invoke [`/create-skill diagnose fix-bug`](../../authoring/create-skill/SKILL.md#diagnose-workflow) while the failing session is still in context; it reads [`rules/diagnostic-surface.md`](./rules/diagnostic-surface.md).

## Output Format

For every Phase 5 outcome, including `--analyse-only`, print the `## Fix-bug summary` block in [`rules/output-format.md`](./rules/output-format.md) (Evidence, Triage, Reproduction, Root cause, Proposed change, Confidence, Outcome).
