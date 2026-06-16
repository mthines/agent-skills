---
name: fix-bug
description: >
  Resolves a single bug from any starting evidence — Dash0 telemetry (span / log / web event / RUM
  error link), raw stack trace, error message, code pointer (file:line), screen recording, Linear
  ticket URL, or free-text symptom. Classifies the input, **triages complexity** (Phase 0.5) to
  pick between a fast lane and a full holistic-analysis lane, runs a pre-flight sweep, locks a
  failing reproduction (delegating to /tdd, /e2e-testing, or /e2e-testing-mobile by layer),
  delegates root-cause analysis to holistic-analysis on complex bugs (or runs a lightweight
  in-skill analysis on simple ones), gates on confidence(analysis), and on >= 92 % hands off
  **without human confirmation**: simple bugs take the fast lane (/fix-bug → aw-create-plan →
  aw-executor, no aw-planner) and complex bugs take the standard lane (aw-planner → aw-executor),
  both with a CEGIS refinement contract. Fast-lane round-3 CEGIS failure falls back to
  standard-lane via aw-planner. An independent bug-fix-verifier agent grades the PR before
  undrafting; for telemetry-sourced bugs an optional Phase 8 polls the originating signal
  post-deploy. Pass --analyse-only to stop after the proposal regardless of confidence;
  --force-holistic to skip the fast lane and always use holistic-analysis. Triggers on
  "fix this bug", "investigate this error", "this Dash0 span shows a failure", "this stack trace
  looks wrong", "/fix-bug".
argument-hint: '[--analyse-only|--force-holistic] [<bug-description>|<ticket>]'
license: MIT
user-invocable: true
disable-model-invocation: true
metadata:
  author: mthines
  version: '2.2.0'
  workflow_type: orchestrator
  architecture: classify/triage/preflight/reproduce/analyse/gate/handoff(fast|standard)/verify/telemetry
  agents:
    planner: aw-planner
    executor: aw-executor
    verifier: bug-fix-verifier
    investigator: linear-ticket-investigator
  composes:
    - holistic-analysis
    - confidence
    - aw-create-plan
    - tdd
    - e2e-testing
    - e2e-testing-mobile
    - video-analyser
    - autonomous-workflow
  phases:
    - intake
    - complexity_triage
    - evidence_resolution_with_preflight
    - source_mapping_with_reproduction
    - holistic_analysis_or_lightweight
    - confidence_gate
    - branch_decision
    - autonomous_handoff_lane_split
    - independent_verification
    - telemetry_verification
  tags:
    - bug-fix
    - debugging
    - telemetry
    - dash0
    - confidence-gated
    - reproduction-first
    - cegis
    - autonomous-workflow
    - root-cause
    - orchestrator
    - complexity-triage
    - fast-lane
---

# Fix Bug

Take a bug — described in any form the user has at hand — and either ship a verified draft PR
with the fix or hand back a clear, evidence-backed proposal. This skill is a **thin
orchestrator**: heavy reasoning lives in `holistic-analysis`, gating in `confidence`, test
authoring in `/tdd` / `/e2e-testing` / `/e2e-testing-mobile`, plan authoring in `aw-planner`
(standard-lane) or `aw-create-plan` (fast-lane), implementation in `aw-executor`, and independent
grading in `bug-fix-verifier`. This skill owns input classification, **complexity triage**,
evidence assembly, the user-facing decision at the confidence boundary, **lane selection**, and
a durable bug-notes ledger that survives compaction.

> **Source of truth.** This `SKILL.md` is a thin index. Detailed procedures live in `rules/*.md`,
> literal artefacts in `templates/*.md`, and external references in `references/*.md`. Load only
> what the current phase asks for.

## Architecture

```text
Phase 0:   Intake                     → classify input + infer bugClass + detect mode flags
Phase 0.5: Complexity Triage          → simple | complex (signals + decision rule)
Phase 1:   Evidence Resolution        → per-input resolution + pre-flight sweep (may upgrade triage)
Phase 2:   Source Mapping + Repro Lock → Evidence Record + failing repro (via /tdd or /e2e-testing*)
Phase 3:   Analysis                   → Skill("holistic-analysis", "fix") [complex]
                                      OR lightweight in-skill analysis [simple]
Phase 4:   Confidence Gate            → /confidence analysis
Phase 5:   Branch Decision            → >= 92 % auto-implement (no human confirmation);
                                       80–91 % stop with raise-the-score guidance,
                                       force-proceed offered (routes standard-lane);
                                       70–79 % stop, force-proceed flagged NOT recommended;
                                       < 70 % stop, no force-proceed.
                                       --analyse-only always stops here.
Phase 6:   Autonomous Handoff (lane-split)
             ├── Fast-lane (simple + >= 92 %):
             │     /fix-bug → Skill("aw-create-plan", ...) → aw-executor
             │     Round-3 CEGIS failure → fall back to standard-lane via aw-planner.
             └── Standard-lane (complex / downgrade / force-proceed):
                   aw-planner → aw-executor (canonical path).
Phase 7:   Independent Verification   → bug-fix-verifier (fresh context) decides PR undraft
                                       Identical for both lanes.
Phase 8:   Telemetry Verification     → poll originating Dash0 query post-deploy (telemetry inputs)
```

Cross-cutting: a **bug-notes ledger** at `.agent/<branch>/bug-notes.md` is read on entry and
appended on exit by every phase — it survives compaction and prevents re-exploring ruled-out
hypotheses. See [`rules/bug-notes-ledger.md`](./rules/bug-notes-ledger.md).

---

## Modes

| Flag | Default | Behaviour |
|------|---------|-----------|
| (none) | **yes** | Full pipeline (Phases 0–8). Phase 0.5 triages complexity; Phase 5 dispatches via the fast-lane (simple) or standard-lane (complex) when confidence >= 92 % — no human confirmation required. |
| `--analyse-only` | | Read-only analysis. Phases 0–4 (including Phase 0.5 triage) run as normal; Phase 5 **always** returns the proposal regardless of confidence; Phases 6–8 are skipped. The read-only analysis primitive for any caller that wants a proposal without a PR. (`/batch-linear-tickets` does **not** call this — its Phase 1 dispatches `linear-ticket-investigator` + `holistic-analysis` directly.) |
| `--force-holistic` | | Skip Phase 0.5's `simple` classification — always treat the bug as `complex`. Forces holistic-analysis (Phase 3) and the standard-lane in Phase 6, regardless of triage signals. Use when triage's conservative-by-default behaviour is not conservative enough for the user's taste. Mutually exclusive with `--analyse-only` and `--verify-deploy`. |
| `--verify-deploy <PR>` | | Re-entry path for deferred Phase 8 verification. Skips Phases 1–7 entirely; recovers the Evidence Record from `.agent/<branch>/bug-notes.md` for the PR's head branch and runs Phase 8 against the already-shipped fix. See [Verify-deploy short-circuit](#verify-deploy-short-circuit) below. |

Flags are mutually exclusive. They are detected in Phase 0 step 0a and stripped from
`$ARGUMENTS` before any further processing.

---

## Prerequisites

| Dependency | Purpose | Required? |
|-----------|---------|-----------|
| `holistic-analysis` skill | Phase 3 root-cause analysis | **Yes** |
| `confidence` skill | Phase 4 gate (also used inside holistic-analysis) | **Yes** |
| `/tdd` skill | Phase 2.5 reproduction at unit / component layer | **Yes** for non-best-effort repros |
| `/e2e-testing` skill | Phase 2.5 reproduction at user-flow layer (web) | If web E2E repro |
| `/e2e-testing-mobile` skill | Phase 2.5 reproduction at user-flow layer (Expo / React Native) | If mobile E2E repro |
| `aw-planner` + `aw-executor` agents (from [`autonomous-workflow`](../autonomous-workflow/SKILL.md)) | Phase 6 standard-lane implementation; aw-planner also handles fast-lane round-3 fallback | **Yes** for auto-fix path |
| [`aw-create-plan`](../aw-create-plan/SKILL.md) skill | Phase 6 fast-lane plan.md authoring (substitutes for aw-planner when triage = `simple` AND confidence ≥ 92 %) | **Yes** for fast-lane |
| `bug-fix-verifier` agent ([`agents/bug-fix-verifier.md`](../../../agents/bug-fix-verifier.md)) | Phase 7 independent verification | **Yes** for auto-fix path |
| `gh` CLI | Draft PR creation by `aw-executor`; `gh pr ready` by Phase 7 | **Yes** for auto-fix path |
| `gw` CLI | Worktree management (planner) | Recommended |
| `persistent-memory` skill | `fix-bug-lessons` self-improvement loop (read Phase 0.5, write Phase 5/7/8) | Optional — loop skips silently if absent |
| `video-analyser` skill | Resolve video / screen-recording inputs | If video input |
| Dash0 MCP server (`mcp__dash0__*` or equivalent) | Resolve span / log / web event URLs; Phase 8 polling | If Dash0 input |
| Linear MCP (`mcp__claude_ai_Linear__*`) | Linear-ticket input route via `linear-ticket-investigator` | If Linear input |

---

## Rules

| Rule | When it loads |
|------|---------------|
| [complexity-triage](./rules/complexity-triage.md) | Phase 0.5 — signal table + decision rule + `simple` / `complex` outcome |
| [evidence-resolution](./rules/evidence-resolution.md) | Phase 1 step 1a — per-input procedures |
| [preflight](./rules/preflight.md) | Phase 1.5 — cheap localisation probes; may upgrade triage to `simple` |
| [reproduction](./rules/reproduction.md) | Phase 2.5 — layer routing + delegation to /tdd / /e2e-testing* |
| [autonomous-handoff](./rules/autonomous-handoff.md) | Phase 6 — lane selection + fast-lane / standard-lane dispatch + CEGIS contract |
| [fast-lane-plan-contract](./rules/fast-lane-plan-contract.md) | Phase 6 fast-lane only — required plan.md sections when `/fix-bug` authors plan.md directly via `aw-create-plan` |
| [independent-verification](./rules/independent-verification.md) | Phase 7 — verifier checks (FAIL_TO_PASS, PASS_TO_PASS, diff sanity, repro integrity) |
| [telemetry-verification](./rules/telemetry-verification.md) | Phase 8 — post-deploy polling of the originating telemetry query |
| [bug-notes-ledger](./rules/bug-notes-ledger.md) | Cross-cutting — durable artefact written by every phase |
| [self-improvement-loop](./rules/self-improvement-loop.md) | Cross-cutting — `fix-bug-lessons` fast tier (read Phase 0.5 / write Phase 5·7·8) + promotion to `diagnose` |
| [diagnostic-surface](./rules/diagnostic-surface.md) | Consumed by `/create-skill diagnose fix-bug` — phase model, failure taxonomy, existing-guards table, hard invariants |

## Templates

| Template | Used in |
|----------|---------|
| [bug-fix-pack](./templates/bug-fix-pack.md) | Phase 6 — passed to `aw-planner`; carries the CEGIS refinement contract |
| [bug-notes](./templates/bug-notes.md) | Cross-cutting — initial structure for the ledger artefact |

## References

| Reference | Topic |
|-----------|-------|
| [research-sources](./references/research-sources.md) | Curated 2024–2026 sources behind every technique — Anthropic guidance, SWE-bench, RepairAgent, CEGIS, bisection, telemetry verification, taxonomies, practitioner blogs |

---

## Phase 0 — Intake & Classification

### Step 0a — Detect mode flags

Scan `$ARGUMENTS` for any of the three mutually-exclusive mode flags:

| Flag | Action |
|------|--------|
| `--analyse-only` (or `--analyze-only`) | Set `ANALYSE_ONLY=true`. Continue to step 0b. |
| `--force-holistic` | Set `FORCE_HOLISTIC=true`. Continue to step 0b. Phase 0.5 will skip its decision and pick `complex`. |
| `--verify-deploy <PR>` | Set `VERIFY_DEPLOY_MODE=true` and `VERIFY_DEPLOY_PR=<PR>`. Skip steps 0b–0c entirely; follow the [Verify-deploy short-circuit](#verify-deploy-short-circuit) below. |

If two or more flags are present, fail with
`--analyse-only, --force-holistic, and --verify-deploy are mutually exclusive`. Strip the matched
flag (and its argument, for `--verify-deploy`) from `$ARGUMENTS` before continuing. Print one mode
line if any flag was matched:

```text
Mode: analyse-only
Mode: force-holistic
Mode: verify-deploy (PR #<N>)
```

If no flag matched, do not print a mode line and continue to step 0b.

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

If the input is free text or empty, ask up to **3 questions** in one message and wait. Suggested
priority: telemetry/trace availability, when the bug started, expected vs actual behaviour. Do
not run holistic analysis on free text alone.

### Phase 0 → Phase 0.5

After step 0c (bugClass inference), continue directly to **Phase 0.5 — Complexity Triage** below.
Phase 1 does not start until triage commits.

---

## Phase 0.5 — Complexity Triage

Pick between two routing lanes for the rest of the pipeline: **`simple`** (lightweight in-skill
analysis + fast-lane handoff) or **`complex`** (canonical holistic-analysis + standard-lane
handoff). This is a **routing decision, not a quality decision** — confidence (Phase 4) still
owns the auto-implement call.

**Before the decision — read prior lessons.** Load `fix-bug-lessons` so this
skill's own past misfires (triage / repro-layer / analysis) bias the run:

```text
Skill("persistent-memory", "read fix-bug-lessons --tier project-shared")     # skips silently if not installed
```

Match lessons by `bugClass` + input shape; apply matches as **advisory inputs**
to the triage decision (they never override the conservative `complex` default
or relax any gate). Record applied lessons in the bug-notes ledger. Full
contract: [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md#read-lessons-phase-05).

Walk the 14-row signal table in [`rules/complexity-triage.md`](./rules/complexity-triage.md) and
apply the decision rule (conservative default: pick `complex` when in doubt). The outcome:

| Outcome | Phase 3 | Phase 6 lane (provisional) |
|---------|---------|----------------------------|
| `simple` | **skip** — lightweight in-skill analysis | fast-lane (if confidence ≥ 92 % + non-best-effort repro) |
| `complex` | run `Skill("holistic-analysis", "fix")` | standard-lane |

Append the classification, signals, decision, and provisional lane to the bug-notes ledger under
a `Complexity triage` section.
The ledger is **created on first write**: if `.agent/<branch-or-slug>/bug-notes.md` does not yet
exist, create it from [`templates/bug-notes.md`](./templates/bug-notes.md) before appending —
under the normal flow this Phase 0.5 append is the first write and therefore the creation point
(see [`rules/bug-notes-ledger.md`](./rules/bug-notes-ledger.md#lifecycle)).
Pre-flight (Phase 1.5) may upgrade `complex` → `simple` later;
never the reverse direction inside a run. `--force-holistic` short-circuits to `complex`.

---

### Verify-deploy short-circuit

Triggered when `VERIFY_DEPLOY_MODE=true` from step 0a. The PR has already been merged and
(presumably) deployed; the user is asking to run Phase 8 against the already-shipped fix. Skip
Phases 1–7 entirely.

1. **Resolve the PR's head branch and merge commit:**

   ```bash
   gh pr view <PR> --json headRefName,mergeCommit,labels
   ```

2. **Locate the bug-notes ledger** at `.agent/<headRefName>/bug-notes.md` in the current checkout.
   The ledger survives worktree cleanup because the autonomous-workflow Phase 7 cleanup copies
   `.agent/<branch>/` into the main checkout before removing a worktree with a pending deferred
   verification — see the [deferred-verification guard](../autonomous-workflow/rules/phase-7-ci-gate.md#optional-post-merge-cleanup).
   If missing, fail:

   ```text
   No bug-notes ledger found for PR #<N> at .agent/<branch>/bug-notes.md.
   /fix-bug --verify-deploy can only verify PRs originally produced by /fix-bug —
   the ledger is the recovery handle for post-deploy verification.
   ```

3. **Read the ledger.** Recover the originating telemetry source from the Evidence Record's
   `Sources` section, the pre-fix baseline from the Phase 8 shape (or recompute via the
   originating query), and the deploy ID from PR labels or the merge commit's `service.version`
   annotation.

4. **Validate input was telemetry-sourced.** If the Evidence Record's `Sources` field does not
   contain a Dash0 / telemetry URL, fail:

   ```text
   PR #<N> was not opened from a telemetry-sourced bug. /fix-bug --verify-deploy
   only applies to bugs whose original input was a Dash0 / telemetry URL.
   ```

5. **Jump to Phase 8 step 8a** (classify shape) with the recovered Evidence Record. Phase 8
   then proceeds normally — classify, pick a verification mode, and run the chosen mode.

6. **After Phase 8 completes**, append the result to the ledger under
   `Phase log` and post a comment on the PR (and the originating Linear ticket if the input
   carried one). Exit.

---

## Phase 1 — Evidence Resolution

### Step 1a — Per-input resolution

Walk only the procedures in [`rules/evidence-resolution.md`](./rules/evidence-resolution.md) that
match the inputs classified in Phase 0. Each procedure produces a partial evidence record.

### Phase 1.5 — Pre-flight sweep

Run the deterministic localisation probes in [`rules/preflight.md`](./rules/preflight.md) —
recent commits to affected files, last-known-green deploy SHA, lockfile / env diff, CI flips.
Append findings to the Evidence Record.

If pre-flight produces a single-commit short-circuit (commit + diff size + CI flip window all
align), skip Phase 3 and route directly to Phase 5 with a high-confidence proposal. Otherwise
capture the regression window for the step 2c bisect fast-path.

---

## Phase 2 — Source Mapping + Reproduction Lock

### Step 2a — Build the Evidence Record

Merge the partial records from Phase 1 into a single Evidence Record. The schema lives in
[`templates/bug-notes.md`](./templates/bug-notes.md) under the `Evidence Record` section. This
is the input to Phase 3 and the seed for the bug-notes ledger.

### Phase 2.5 — Reproduction lock

Construct a deterministic failing reproduction following [`rules/reproduction.md`](./rules/reproduction.md).
The rule's layer-routing table picks the lowest test layer that can capture the bug, then
delegates:

- Unit / component / hook / integration → `Skill("tdd", ...)`
- Web user flow → `Skill("e2e-testing", ...)`
- Expo / React Native user flow → `Skill("e2e-testing-mobile", ...)`
- Visual-only / pixel-perfect → best-effort markdown checklist

The repro is the executor's `FAIL_TO_PASS` contract (Phase 6) and the verifier's
`FAIL_TO_PASS` check (Phase 7). The path convention is `repro/<short-bug-id>.<ext>`.

### Step 2c — Bisect fast-path (regression class only)

If the pre-flight sweep produced a `last_green_sha` AND a non-best-effort repro exists, run
`git bisect run <repro-command>`. If the offending commit's diff is ≤ 50 lines, route to
Phase 5 with proposal "revert or amend `<sha>`". See
[reproduction.md → Bisect fast-path](./rules/reproduction.md#bisect-fast-path).

### Step 2d — Seed the Evidence Record into the bug-notes ledger

The ledger at `.agent/<branch-or-slug>/bug-notes.md` normally already exists — it is created on
first write, which under the normal flow is the Phase 0.5 triage append.
Create it from [`templates/bug-notes.md`](./templates/bug-notes.md) now only if no earlier phase
wrote it (create-if-missing).
Append the merged Evidence Record from step 2a.
Every later phase reads on entry and appends on exit.
See [`rules/bug-notes-ledger.md`](./rules/bug-notes-ledger.md#lifecycle).

---

## Phase 3 — Analysis

The phase splits by triage outcome (Phase 0.5):

### Phase 3 — `complex` path: Holistic Analysis

Invoke `holistic-analysis` in `fix` mode with the Evidence Record (including the `bugClass` hint
and any pre-flight short-circuit findings):

```text
Skill("holistic-analysis", "fix\n\n<Evidence Record from Phase 2>")
```

`holistic-analysis` runs its own 8-phase protocol and internally calls `/confidence analysis`
at its Phase 6. Do **not** duplicate that analysis here — Phase 3 is purely a delegation step.

If the bug-notes ledger has any `state = ruled-out` hypotheses, pass them in the prompt so
holistic-analysis does not re-explore them.

### Phase 3 — `simple` path: Lightweight in-skill analysis

Skip `holistic-analysis` entirely. Run the lightweight procedure described in
[`rules/complexity-triage.md`](./rules/complexity-triage.md#what-simple-actually-skips):

1. Read the suspect file at the suspect line + 30 lines of context.
2. Identify the minimal change that satisfies the failing repro (Phase 2.5) and does not break
   neighbours.
3. Write a root-cause paragraph to the Evidence Record — same shape `holistic-analysis` produces,
   including a `Falsifiable prediction:` line that the repro confirms.
4. Continue to Phase 4 (confidence gate) — the score is still emitted by the `confidence` skill,
   never self-graded.

If the lightweight analysis cannot propose a fix (suspect file isn't actually in the failing
path, predicate has more than one plausible cause), upgrade triage to `complex` and run
`holistic-analysis` after all. Log the upgrade in the ledger as
`triage upgrade: simple → complex (lightweight analysis under-determined)`.

---

## Phase 4 — Confidence Gate

Reuse the score holistic-analysis emitted at its Phase 6. Re-run `/confidence analysis` here
**only** if new evidence has arrived between Phase 3 and now, or the proposed fix has materially
changed.

Append the score and breakdown to the bug-notes ledger's `Confidence trajectory` table.

---

## Phase 5 — Branch Decision

### Step 5a — Reproduction gate (mechanical)

Before evaluating the confidence-based action below, the skill **must** validate that
Phase 2.5 actually produced a usable reproduction artefact. This is a deterministic
check on the bug-notes ledger; it runs regardless of confidence score and regardless
of `ANALYSE_ONLY`. There is no force-proceed below this gate — the repro is the
executor's `FAIL_TO_PASS` contract (Phase 6) and the verifier's primary check (Phase 7),
and analyse-only consumers need it to be a useful proposal.

Procedure:

1. Read `.agent/<branch-or-slug>/bug-notes.md`.
2. Locate the `## Reproduction (Phase 2.5)` section.
3. Extract the `Path:`, `Status:`, and (when present) `Reason:` fields.
4. Apply the pass conditions:

| # | Pass condition                                                                                                                                                                                                          |
|---|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | `Path:` resolves to an existing file matching the project's test convention (e.g. `repro/*.test.{ts,tsx,js,jsx,mjs}`, `repro/test_*.py`, `repro/*_test.go`, `repro/*.rs`) AND `Status:` contains `failing on HEAD as expected` |
| 2 | `Path:` resolves to an existing `repro/*.md` file AND `Status:` contains `best-effort` AND `Reason:` is one of: `race`, `production-only`, `heisenbug`, `visual`, `performance`                                          |

If **neither** condition holds, fail with this exact structured error and route back
to Phase 2.5:

```text
Phase 5 gate failed: Phase 2.5 did not produce a gate-eligible reproduction.

Bug-notes ledger says:
  Path:   <verbatim from ledger or "missing">
  Status: <verbatim from ledger or "missing">
  Reason: <verbatim from ledger or "missing">

A reproduction must satisfy one of:
  1. Runnable test at repro/<id>.<test-ext> with Status "failing on HEAD as expected"
  2. Best-effort marker at repro/<id>.md with Status "best-effort" AND
     Reason in {race, production-only, heisenbug, visual, performance}

Returning to Phase 2.5. Re-invoke /tdd, /e2e-testing, or /e2e-testing-mobile,
or explicitly document a best-effort reason from the closed list above.
The forbidden self-justifications ("small diff", "pattern exercised elsewhere",
"scaffolding overhead", "would duplicate the fix") are not valid reasons —
see rules/reproduction.md § Forbidden reasons to skip Phase 2.5.

There is no force-proceed below this gate.
```

The closed list of best-effort reasons is taken verbatim from
[`rules/reproduction.md`](./rules/reproduction.md): `race`, `production-only`, and
`heisenbug` from [Best-effort fallback](./rules/reproduction.md#best-effort-fallback);
`visual` and `performance` from rows 7–8 of the
[layer routing table](./rules/reproduction.md#layer-routing). The gate widens only when
the spec widens — never inline.

### Step 5b — Confidence-based action

If `ANALYSE_ONLY=true`, **always return the proposal** regardless of confidence (Step 5a
must have passed first). Skip Phases 6–8. The output's `Outcome` line indicates
`analyse-only (no PR)`. Triage classification is included in the output for reference
but does not affect behaviour in this mode.

Otherwise:

| Confidence | Action |
|------------|--------|
| **>= 92%** | **Fully autonomous — no human confirmation required.** Print a one-line status (lane + root cause + score) and proceed directly to Phase 6. Lane is fast-lane if Phase 0.5 triage = `simple` AND a non-best-effort repro exists; otherwise standard-lane. |
| **80–91%** | Stop. Present Evidence Record + proposed fix + confidence breakdown + **what would raise the score**. Offer: collect more evidence, force-proceed, or abandon. Force-proceed at this tier always routes to the **standard-lane** (planner's `confidence(plan)` gate is the extra safety net when analysis confidence is marginal). |
| **70–79%** | Stop. Force-proceed offered but flagged **NOT recommended**. Same standard-lane routing as 80–91 % when force-proceed is taken. |
| **< 70%** | Stop. Do **NOT** offer force-proceed. Present analysis findings (holistic or lightweight) as a discussion document. Ask the user for direction. Hard invariant — no escape hatch. |

The 92 % threshold is the substitute for aw-planner's `confidence(plan) ≥ 90 %` that the fast-lane
bypasses. It is *stricter* on purpose: bypassing the planner means one fewer independent gate,
and the higher bar on the gate we keep restores the three-gate invariant.

**On a stop (`< 92 %`, or below-70 % hand-back), and on any triage upgrade
(`simple → complex`) or fast-lane → standard-lane CEGIS fallback**, write a
lesson so the next bug of this `bugClass` does better:

```text
Skill("persistent-memory", "write fix-bug-lessons --tier project-shared --auto")     # skips silently if not installed
```

`--auto` skips consent, not the privacy pre-flight. See
[`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md#write-lessons).

---

## Phase 6 — Autonomous Handoff (Lane-Split)

Runs only when `ANALYSE_ONLY` is unset and Phase 5 cleared at >= 92 % (or the user
force-proceeded after 70–91 %, in which case lane is forced to standard).

### Step 6.pre — Branch pre-flight assertion (mechanical)

Before any lane selection or dispatch, validate that the current working branch is **not**
a protected trunk branch. This catches the case where Phase 1–5 happened to run on `main`
and the agent is about to start implementation work without first creating a worktree.

Procedure:

1. Run `git rev-parse --abbrev-ref HEAD`.
2. If the result is in the closed protected-branch list `{main, master, develop, trunk}`,
   fail-closed with the structured error below and refuse to proceed. The agent must run
   `gw checkout fix/<slug>` (see [`rules/autonomous-handoff.md`](./rules/autonomous-handoff.md#step-6a-fast--create-worktree--planmd))
   **before** re-entering Phase 6.
3. If the result is anything else (e.g. `fix/*`, `feat/*`, an existing feature branch),
   continue to lane selection.

Structured error on fail:

```text
Phase 6 gate failed: working on protected branch `<branch>`.

Phase 6 implementation work happens inside an isolated worktree on a fix/* branch,
dispatched via `aw-executor` (which opens a draft PR). Editing files inline on a
protected trunk branch bypasses:
  - worktree isolation
  - draft PR creation
  - bug-fix-verifier (Phase 7) fresh-context grading

Run `gw checkout fix/<slug>` first, then re-enter Phase 6. There is no force-proceed
below this gate — committing implementation work directly to a protected branch is
forbidden by hard invariant in rules/diagnostic-surface.md.
```

The protected-branch list is conservative: it matches industry default trunk conventions
and does not match private feature branches. If a project uses a non-standard trunk name,
extend the closed list in `SKILL.md` Phase 6 — never inline.

### Step 6.main — Lane selection and dispatch

Lane is picked from triage + fast-lane preconditions:

| Lane | Trigger | Plan authored by |
|------|---------|------------------|
| **Fast-lane** | triage = `simple` AND confidence ≥ 92 % AND non-best-effort repro | `/fix-bug` → `Skill("aw-create-plan", ...)` (no aw-planner) |
| **Standard-lane** | `complex` / downgrade / force-proceed | `aw-planner` (canonical) |

On fast-lane, round-3 CEGIS failure falls back to standard-lane via aw-planner with the captured
counterexamples — single-shot safety net.

Full procedure: [`rules/autonomous-handoff.md`](./rules/autonomous-handoff.md). Fast-lane plan.md
shape: [`rules/fast-lane-plan-contract.md`](./rules/fast-lane-plan-contract.md). Standard-lane
pack: [`templates/bug-fix-pack.md`](./templates/bug-fix-pack.md). Phase 7 (verifier) and the
CEGIS 3-round cap are identical for both lanes; only the round-3 escalation path differs.

**The main agent does not execute file edits inline in Phase 6.** All implementation work
runs inside the `aw-executor` subagent via `Task(subagent_type="aw-executor", ...)`. The
[Step 7.pre](#step-7pre--draft-pr-assertion-mechanical) gate fails-closed when no draft PR
exists for the current branch, catching the case where the main agent bypassed dispatch
and edited files directly.

---

## Phase 7 — Independent Verification

### Step 7.pre — Draft PR assertion (mechanical)

Before spawning `bug-fix-verifier`, validate that Phase 6 actually produced a draft PR. This
catches the case where the main agent bypassed Phase 6 dispatch entirely (no
`Task(subagent_type="aw-executor", ...)` invocation, inline edits on a working branch, or
direct commit / push to a protected branch).

Procedure:

1. Run `gh pr view --json url,isDraft,headRefName 2>/dev/null` for the current branch.
2. Pass conditions, **all** must hold:
   - A PR exists (`gh pr view` exits 0 and returns JSON, not the `MISSING` fallback).
   - `isDraft = true`.
   - `headRefName` matches the current branch from `git rev-parse --abbrev-ref HEAD`.
3. On pass, capture the PR URL and proceed to the verifier spawn below.
4. On any failure, fail-closed with the structured error below. There is no force-proceed
   below this gate — the verifier cannot grade a PR that does not exist, and skipping the
   verifier on the grounds of "small diff" is forbidden by hard invariant.

Structured error on fail:

```text
Phase 7 gate failed: no draft PR exists for branch `<branch>`.

`gh pr view` returned: <verbatim output or "MISSING">

Phase 6 dispatch must produce a draft PR via `Task(subagent_type="aw-executor", ...)`.
If you find that:
  - You are still on a protected branch (main / master / develop / trunk)
  - Implementation files were edited inline by the main agent
  - `git log` shows implementation commits already on a protected branch
…then Phase 6 was bypassed. The bug-fix-verifier cannot run in this state.

Recovery:
  1. Revert / cherry-pick the implementation off the protected branch (manual — destructive).
  2. Run `gw checkout fix/<slug>` to create the worktree.
  3. Re-enter Phase 6 via the documented dispatch path (Step 6.main).
  4. Phase 7 will re-run once aw-executor produces the draft PR.

Skipping the verifier on the grounds of "diff is small", "pattern matches existing code",
or "verifier exists for diff-sanity grading only" is forbidden — see
rules/diagnostic-surface.md hard invariants.
```

### Step 7.main — Spawn the verifier

After the executor opens the draft PR, spawn `bug-fix-verifier` in a **fresh context** with no
access to planner / executor reasoning. The verifier runs four checks: `FAIL_TO_PASS`,
`PASS_TO_PASS`, diff sanity, repro integrity. On green it runs `gh pr ready` to undraft the PR;
on red it leaves the PR draft and surfaces the verifier's evidence to the user.

See [`rules/independent-verification.md`](./rules/independent-verification.md) for the full
procedure. Source: [Effective harnesses for long-running agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
— "agents reliably skew positive when grading their own work."

**On a verifier RED verdict**, write a lesson — the fix was wrong despite all
three gates, which is the highest-signal moment to capture *which earlier phase
under-caught it* (triage too `simple`? repro false-green? analysis wrong file?):

```text
Skill("persistent-memory", "write fix-bug-lessons --tier project-shared --auto")     # skips silently if not installed
```

See [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md#write-lessons).

---

## Phase 8 — Telemetry Verification

Runs only when the original input was a Dash0 / telemetry URL and the PR has been merged and
deployed.

The fix is not done at merge — it is done when the originating signal **stops firing in
production**. What "stops firing" means depends on how often the bug fires. Phase 8 classifies
the bug's observability shape (baseline rate, crash-class, cohort, release attribution) and
picks one of five modes:

| Mode | When |
|------|------|
| **Rate-decay** | High-frequency bugs (≥ 10 events / 30 min baseline) — poll for 30 min; pass at ≤ 5% of baseline |
| **Extended watch** | Low-frequency bugs (1–9 events / 30 min, or sparse over hours) — watch for 24 h–7 d; pass on absence |
| **Cohort absence** | One-shot bugs with a known cohort (user / tenant / device) — watch the cohort for 7 d |
| **Build-version absence** | Crash-class bugs with release attribution (Crashlytics-style) — pass at N crash-free sessions or 7 d |
| **Deferred-watch** | One-shot bugs with no cohort and no release attribution, **or** MCP capability gate failed — register a manual watch (default 14 d), close provisionally, reopen on recurrence |

Deferred-watch is the honest answer for app crashes that fired once with no cohort information.
The skill does not pretend to verify in that mode — it registers the watch on the Linear ticket
and PR, closes the bug as "deployed; watching for recurrence", and reopens if the originating
query produces a match on the new release tag.

See [`rules/telemetry-verification.md`](./rules/telemetry-verification.md) for the full
classification procedure and per-mode operations.

Default operating mode is **deferred** — emit a follow-up task to be re-invoked once the deploy
lands (`/fix-bug --verify-deploy <PR>`). The `--inline-verify` flag opts into running
synchronously when the project auto-deploys on merge.

**If the originating signal does not decay (or recurs)**, write a lesson — this
is the strongest evidence that the "fix" did not fix the production symptom, and
almost always points back to a Phase 3 analysis or Phase 2.5 repro-fidelity gap:

```text
Skill("persistent-memory", "write fix-bug-lessons --tier project-shared --auto")     # skips silently if not installed
```

See [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md#write-lessons).

---

## Self-Improvement

`/fix-bug` improves across bugs through a **two-tier loop** (full contract:
[`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md)).

**Fast tier — episodic lessons (`persistent-memory`, optional).** Reads
`fix-bug-lessons` at Phase 0.5 (keyed by `bugClass` + input shape) and writes
lessons at the highest-signal failure moments — verifier RED (Phase 7),
telemetry-still-firing (Phase 8), triage upgrades, and Phase 5 stops — in the
committed `fix-bug-lessons` scope. Lessons cover fix-bug's **own** diagnostic
phases; implementation-phase lessons live in `aw-lessons` (written by
`aw-executor`). Lessons are advisory and skip silently if `persistent-memory`
is absent.

**Slow tier — retrospective diagnosis.** If a run shipped wrong code despite all
three confidence gates — or a post-merge regression traces back to a missed
check, or a lesson recurs `seen_count >= 3` — invoke
[`/create-skill diagnose fix-bug`](../../authoring/create-skill/SKILL.md#diagnose-workflow)
**while the failing session is still in context**. The diagnoser reads this
skill's [diagnostic surface](./rules/diagnostic-surface.md) and the
`fix-bug-lessons` history as evidence, and emits a confidence-gated diff against
this skill's source — never against user product code.

---

## Output Format

Use this format for every Phase 5 outcome — auto-fix, proposal-only, or `--analyse-only`. The
shape stays stable; only the tail varies.

```markdown
## Fix-bug summary

### Evidence
<Evidence Record from Phase 2, including bugClass and pre-flight findings>

### Triage (Phase 0.5)
- Classification: simple | complex
- Phase 6 lane: fast-lane | standard-lane | n/a (analyse-only) | n/a (below gate)
- Decision rule applied: <rule>
- Override: --force-holistic | none

### Reproduction
<repro path + command + status>

### Root cause
<one paragraph from holistic-analysis OR lightweight in-skill analysis — labelled accordingly>

### Proposed change
<plain-language description + impact + verification plan>

### Confidence (analysis)
- Evidence strength: X%
- Root cause certainty: X%
- Fix confidence: X%
- **Overall: X%**

### Outcome
<one of:>
- Auto-implemented (<lane>) + verified: PR <url> on branch <name>. Verifier green. Telemetry decayed.
- Auto-implemented (<lane>), verifier red: PR <url> still draft. Concerns: <list>.
- Auto-implemented (fast-lane → standard-lane fallback): PR <url>. Round-3 CEGIS triggered fallback. Verifier <status>.
- Analyse-only (no PR): proposal returned at X% confidence; triage = <simple | complex>.
- Below gate (X%): proposal returned for review. To raise the score, collect: <specific evidence>.
- Stopped: <reason>.
```

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Free-text input triggers low-confidence holistic analysis | Medium | Phase 0 refuses to analyse on free text alone — clarifying questions first. Phase 0.5 triage also picks `complex` for free-text (signal 11). |
| Dash0 MCP not configured | Medium | Detection step in `evidence-resolution.md` prints the install / paste-evidence fallback; Phase 8 has its own capability gate. |
| Repro is best-effort only (UI / race / perf) | Medium | Verifier (Phase 7) skips `FAIL_TO_PASS` and relies on broader test suite + diff sanity. Best-effort repros are also blocked from the fast-lane — they always route via standard-lane. Documented in the bug-notes ledger. |
| Analysis returns a confident-but-wrong root cause | Low–Medium | Three independent gates on **both lanes**: standard-lane uses `confidence(analysis)` + `confidence(plan)` + verifier; fast-lane uses `confidence(analysis) ≥ 92 %` (stricter substitute for `confidence(plan)`) + plan.md validator + verifier. |
| Triage classified `simple` but the bug was cross-cutting | Low–Medium | Fast-lane round-3 CEGIS failure falls back to standard-lane via aw-planner with the captured counterexamples — single-shot safety net. |
| Triage classified `complex` but the bug was trivial | Medium | Acceptable. Wasted tokens; no correctness loss. Conservative default is intentional. Pre-flight short-circuit can still upgrade `complex` → `simple` later in the run. |
| Fast-lane plan.md missing a required section | Low | `/fix-bug` validates plan.md after `aw-create-plan` returns and before dispatching `aw-executor`. Fails loudly. |
| Executor's first patch fails the repro | Medium | CEGIS refinement contract: capture failing input as counterexample, refine, cap at 3 rounds before escalating (standard-lane → `confidence(analysis fix)`; fast-lane → standard-lane fallback). |
| Verifier rubber-stamps the executor's diff | Low | Verifier runs in fresh context with no access to planner / executor reasoning — the canonical separation-of-concerns mitigation. Identical on both lanes. |
| Bug-notes ledger drifts from reality | Low | Schema is strict; phases append rather than rewrite; verifier reads the ledger as evidence. |
| Phase 8 polls the wrong release | Low | Capability gate plus explicit deploy-ID capture; falls back to deferred mode for production deploys. |

---

## Key Principles

1. **Orchestrate, don't analyse.** Holistic analysis lives in `holistic-analysis`, gating in
   `confidence`, test authoring in `/tdd` / `/e2e-testing` / `/e2e-testing-mobile`, plan
   authoring in `aw-planner` (standard-lane) or `aw-create-plan` (fast-lane), implementation in
   `aw-executor`, grading in `bug-fix-verifier`.
2. **Match the harness to the bug.** A null-check fix in one file does not need an eight-phase
   pipeline. Phase 0.5 triage routes simple bugs to a lightweight in-skill analysis and a fast
   handoff lane; complex bugs get the full holistic-analysis + planner treatment. The conservative
   default is `complex` — when in doubt, run the slower lane.
3. **Reproduce before fixing.** The repro is the executor's `FAIL_TO_PASS` contract and the
   verifier's primary check. Best-effort fallback is allowed but flagged — and blocks the
   fast-lane.
4. **Cheap localisation first.** Pre-flight (Phase 1.5) often names the cause in seconds —
   running heavy holistic analysis first wastes tokens. Pre-flight short-circuits can also
   upgrade `complex` triage to `simple` and unlock the fast-lane.
5. **Three independent confidence gates on both lanes.** Standard-lane: `confidence(analysis)`
   + `confidence(plan)` + verifier. Fast-lane: `confidence(analysis) ≥ 92 %` (stricter
   substitute for the bypassed planner gate) + plan.md validator + verifier. Self-grading is
   not allowed at any of these.
6. **Auto-implement at ≥ 92 % is fully autonomous.** No human confirmation. The skill prints a
   one-line status and dispatches. Below 92 % the skill stops and asks. The threshold is the
   substitute for the bypassed planner gate on the fast-lane and applies symmetrically on the
   standard-lane to keep the user-facing model simple.
7. **Counterexample-driven refinement.** When a patch fails the repro, the failing input is the
   evidence — capture it, refine, cap at 3 rounds. On fast-lane, round-3 failure additionally
   falls back to standard-lane via aw-planner with the counterexamples appended.
8. **Durable ledger over re-derived state.** The bug-notes ledger survives compaction; phases
   read on entry and append on exit. Triage decisions, lane choices, downgrades, and fallback
   triggers are all logged. Re-derivation is the failure mode the ledger prevents.
9. **No force-proceed under 70 %.** Below 70 % the skill stops and hands back to the user. No
   escape hatch. Force-proceed on 70–91 % always routes to standard-lane.
10. **Telemetry sources close their own loop.** A Dash0-sourced bug is not done until the
    originating query stops firing. Phase 8 enforces this. Same for both lanes.
11. **Linear is one input adapter among several.** A Linear URL routes through
    `linear-ticket-investigator` to produce an Evidence Record, then continues at Phase 2 like
    any other input. `/batch-linear-tickets` does not wrap `/fix-bug` — its Phase 1 dispatches
    `linear-ticket-investigator` (and `holistic-analysis` for bug tickets) per ticket directly.
12. **Learn across bugs, but only advisory.** `fix-bug-lessons` (read Phase 0.5,
    write Phase 5/7/8) biases triage / repro / analysis from prior misfires;
    it never relaxes a gate. A lesson recurring `seen_count >= 3` is promoted
    into a permanent guard only through the confidence-gated `diagnose` apply.
    Implementation-phase learning lives in `aw-lessons` via `aw-executor`.
