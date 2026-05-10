---
name: fix-bug
description: >
  Resolves a single bug from any starting evidence — Dash0 telemetry (span / log / web event / RUM
  error link), raw stack trace, error message, code pointer (file:line), screen recording, Linear
  ticket URL, or free-text symptom. Classifies the input, runs a pre-flight sweep, locks a failing
  reproduction (delegating to /tdd, /e2e-testing, or /e2e-testing-mobile by layer), delegates
  root-cause analysis to holistic-analysis, gates on confidence(bug-analysis), and on >= 90%
  hands off to aw-planner + aw-executor with a CEGIS refinement contract. An independent
  bug-fix-verifier agent grades the PR before undrafting; for telemetry-sourced bugs an optional
  Phase 8 polls the originating signal post-deploy. Pass --analyse-only to stop after the
  proposal regardless of confidence. Triggers on "fix this bug", "investigate this error",
  "this Dash0 span shows a failure", "this stack trace looks wrong", "/fix-bug".
license: MIT
user-invocable: true
disable-model-invocation: true
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: orchestrator
  architecture: classify/preflight/reproduce/analyse/gate/handoff/verify/telemetry
  agents:
    planner: aw-planner
    executor: aw-executor
    verifier: bug-fix-verifier
    investigator: linear-ticket-investigator
  composes:
    - holistic-analysis
    - confidence
    - tdd
    - e2e-testing
    - e2e-testing-mobile
    - video-analyser
    - autonomous-workflow
  phases:
    - intake
    - evidence_resolution_with_preflight
    - source_mapping_with_reproduction
    - holistic_analysis
    - confidence_gate
    - branch_decision
    - autonomous_handoff
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
---

# Fix Bug

Take a bug — described in any form the user has at hand — and either ship a verified draft PR
with the fix or hand back a clear, evidence-backed proposal. This skill is a **thin
orchestrator**: heavy reasoning lives in `holistic-analysis`, gating in `confidence`, test
authoring in `/tdd` / `/e2e-testing` / `/e2e-testing-mobile`, implementation in `aw-planner` +
`aw-executor`, and independent grading in `bug-fix-verifier`. This skill owns input
classification, evidence assembly, the user-facing decision at the confidence boundary, and a
durable bug-notes ledger that survives compaction.

> **Source of truth.** This `SKILL.md` is a thin index. Detailed procedures live in `rules/*.md`,
> literal artefacts in `templates/*.md`, and external references in `references/*.md`. Load only
> what the current phase asks for.

## Architecture

```text
Phase 0: Intake                     → classify input + infer bugClass
Phase 1: Evidence Resolution        → per-input resolution + pre-flight sweep
Phase 2: Source Mapping + Repro Lock → Evidence Record + failing repro (via /tdd or /e2e-testing*)
Phase 3: Holistic Analysis          → Skill("holistic-analysis", "fix")
Phase 4: Confidence Gate            → /confidence bug-analysis
Phase 5: Branch Decision            → >= 90% auto-implement; --analyse-only always stops
Phase 6: Autonomous Handoff         → aw-planner + aw-executor with CEGIS refinement contract
Phase 7: Independent Verification   → bug-fix-verifier (fresh context) decides PR undraft
Phase 8: Telemetry Verification     → poll originating Dash0 query post-deploy (telemetry inputs)
```

Cross-cutting: a **bug-notes ledger** at `.agent/<branch>/bug-notes.md` is read on entry and
appended on exit by every phase — it survives compaction and prevents re-exploring ruled-out
hypotheses. See [`rules/bug-notes-ledger.md`](./rules/bug-notes-ledger.md).

---

## Modes

| Flag | Default | Behaviour |
|------|---------|-----------|
| (none) | **yes** | Full pipeline (Phases 0–8). Phase 5 dispatches `aw-planner` + `aw-executor` when confidence >= 90%. |
| `--analyse-only` | | Read-only analysis. Phases 0–4 run as normal; Phase 5 **always** returns the proposal regardless of confidence; Phases 6–8 are skipped. The analysis primitive `/batch-linear-tickets` calls per ticket. |
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
| `aw-planner` + `aw-executor` agents (from [`autonomous-workflow`](../autonomous-workflow/SKILL.md)) | Phase 6 implementation | **Yes** for auto-fix path |
| `bug-fix-verifier` agent ([`agents/bug-fix-verifier.md`](../../agents/bug-fix-verifier.md)) | Phase 7 independent verification | **Yes** for auto-fix path |
| `gh` CLI | Draft PR creation by `aw-executor`; `gh pr ready` by Phase 7 | **Yes** for auto-fix path |
| `gw` CLI | Worktree management (planner) | Recommended |
| `video-analyser` skill | Resolve video / screen-recording inputs | If video input |
| Dash0 MCP server (`mcp__dash0__*` or equivalent) | Resolve span / log / web event URLs; Phase 8 polling | If Dash0 input |
| Linear MCP (`mcp__claude_ai_Linear__*`) | Linear-ticket input route via `linear-ticket-investigator` | If Linear input |

---

## Rules

| Rule | When it loads |
|------|---------------|
| [evidence-resolution](./rules/evidence-resolution.md) | Phase 1 step 1a — per-input procedures |
| [preflight](./rules/preflight.md) | Phase 1 step 1b — cheap localisation probes |
| [reproduction](./rules/reproduction.md) | Phase 2 step 2b — layer routing + delegation to /tdd / /e2e-testing* |
| [autonomous-handoff](./rules/autonomous-handoff.md) | Phase 6 — `aw-planner` + `aw-executor` dispatch + CEGIS contract |
| [independent-verification](./rules/independent-verification.md) | Phase 7 — verifier checks (FAIL_TO_PASS, PASS_TO_PASS, diff sanity, repro integrity) |
| [telemetry-verification](./rules/telemetry-verification.md) | Phase 8 — post-deploy polling of the originating telemetry query |
| [bug-notes-ledger](./rules/bug-notes-ledger.md) | Cross-cutting — durable artefact written by every phase |
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

### Step 0a — Detect mode flag

Scan `$ARGUMENTS` for one of the two mutually-exclusive mode flags:

| Flag | Action |
|------|--------|
| `--analyse-only` (or `--analyze-only`) | Set `ANALYSE_ONLY=true`. Continue to step 0b. |
| `--verify-deploy <PR>` | Set `VERIFY_DEPLOY_MODE=true` and `VERIFY_DEPLOY_PR=<PR>`. Skip steps 0b–0c entirely; follow the [Verify-deploy short-circuit](#verify-deploy-short-circuit) below. |

If both flags are present, fail with `--analyse-only and --verify-deploy are mutually exclusive`.
Strip the matched flag (and its argument, for `--verify-deploy`) from `$ARGUMENTS` before
continuing. Print one mode line if any flag was matched:

```text
Mode: analyse-only
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

### Verify-deploy short-circuit

Triggered when `VERIFY_DEPLOY_MODE=true` from step 0a. The PR has already been merged and
(presumably) deployed; the user is asking to run Phase 8 against the already-shipped fix. Skip
Phases 1–7 entirely.

1. **Resolve the PR's head branch and merge commit:**

   ```bash
   gh pr view <PR> --json headRefName,mergeCommit,labels
   ```

2. **Locate the bug-notes ledger** at `.agent/<headRefName>/bug-notes.md`. If missing, fail:

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

### Step 1b — Pre-flight sweep

Run the deterministic localisation probes in [`rules/preflight.md`](./rules/preflight.md) —
recent commits to affected files, last-known-green deploy SHA, lockfile / env diff, CI flips.
Append findings to the Evidence Record.

If pre-flight produces a single-commit short-circuit (commit + diff size + CI flip window all
align), skip Phase 3 and route directly to Phase 5 with a high-confidence proposal. Otherwise
capture the regression window for Phase 2.5 bisect.

---

## Phase 2 — Source Mapping + Reproduction Lock

### Step 2a — Build the Evidence Record

Merge the partial records from Phase 1 into a single Evidence Record. The schema lives in
[`templates/bug-notes.md`](./templates/bug-notes.md) under the `Evidence Record` section. This
is the input to Phase 3 and the seed for the bug-notes ledger.

### Step 2b — Reproduction lock

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

### Step 2d — Initialise the bug-notes ledger

Create `.agent/<branch-or-slug>/bug-notes.md` from [`templates/bug-notes.md`](./templates/bug-notes.md).
Every later phase reads on entry and appends on exit. See
[`rules/bug-notes-ledger.md`](./rules/bug-notes-ledger.md).

---

## Phase 3 — Holistic Analysis

Invoke `holistic-analysis` in `fix` mode with the Evidence Record (including the `bugClass` hint
and any pre-flight short-circuit findings):

```text
Skill("holistic-analysis", "fix\n\n<Evidence Record from Phase 2>")
```

`holistic-analysis` runs its own 8-phase protocol and internally calls `/confidence bug-analysis`
at its Phase 6. Do **not** duplicate that analysis here — Phase 3 is purely a delegation step.

If the bug-notes ledger has any `state = ruled-out` hypotheses, pass them in the prompt so
holistic-analysis does not re-explore them.

---

## Phase 4 — Confidence Gate

Reuse the score holistic-analysis emitted at its Phase 6. Re-run `/confidence bug-analysis` here
**only** if new evidence has arrived between Phase 3 and now, or the proposed fix has materially
changed.

Append the score and breakdown to the bug-notes ledger's `Confidence trajectory` table.

---

## Phase 5 — Branch Decision

If `ANALYSE_ONLY=true`, **always return the proposal** regardless of confidence. Skip Phases
6–8. The output's `Outcome` line indicates `analyse-only (no PR)`.

Otherwise:

| Confidence | Action |
|------------|--------|
| **>= 90%** | Proceed to Phase 6. Inform the user before dispatching: one-line summary of root cause + proposed fix + confidence score. |
| **70–89%** | Stop. Present Evidence Record + proposed fix + confidence breakdown + **what would raise the score**. Offer: collect more evidence, force-proceed (NOT recommended), or abandon. |
| **< 70%** | Stop. Do NOT offer force-proceed. Present holistic-analysis findings as a discussion document. Ask the user for direction. |

---

## Phase 6 — Autonomous Handoff

Runs only when `ANALYSE_ONLY` is unset and Phase 5 cleared at >= 90% (or the user force-proceeded
after 70–89%).

See [`rules/autonomous-handoff.md`](./rules/autonomous-handoff.md) for the full dispatch
procedure and the **CEGIS refinement contract** that the planner writes into `plan.md` (executor
runs the repro after each edit; on failure, captures the failing input as a counterexample,
appends to the bug-notes ledger, and refines — capped at 3 rounds before escalating to
`confidence(bug-analysis fix)`). The literal pack passed to `aw-planner` lives in
[`templates/bug-fix-pack.md`](./templates/bug-fix-pack.md).

---

## Phase 7 — Independent Verification

After the executor opens the draft PR, spawn `bug-fix-verifier` in a **fresh context** with no
access to planner / executor reasoning. The verifier runs four checks: `FAIL_TO_PASS`,
`PASS_TO_PASS`, diff sanity, repro integrity. On green it runs `gh pr ready` to undraft the PR;
on red it leaves the PR draft and surfaces the verifier's evidence to the user.

See [`rules/independent-verification.md`](./rules/independent-verification.md) for the full
procedure. Source: [Effective harnesses for long-running agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
— "agents reliably skew positive when grading their own work."

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

---

## Retrospective Self-Improvement

If a `/fix-bug` run shipped wrong code despite all three confidence gates passing — or a
post-merge regression traces back to a missed check — invoke
[`/create-skill diagnose fix-bug`](../create-skill/SKILL.md#diagnose-workflow) **while the
failing session is still in context**. The diagnoser reads this skill's
[diagnostic surface](./rules/diagnostic-surface.md) and emits a confidence-gated diff
against this skill's source — never against user product code.

---

## Output Format

Use this format for every Phase 5 outcome — auto-fix, proposal-only, or `--analyse-only`. The
shape stays stable; only the tail varies.

```markdown
## Fix-bug summary

### Evidence
<Evidence Record from Phase 2, including bugClass and pre-flight findings>

### Reproduction
<repro path + command + status>

### Root cause
<one paragraph from holistic-analysis>

### Proposed change
<plain-language description + impact + verification plan>

### Confidence (bug-analysis)
- Evidence strength: X%
- Root cause certainty: X%
- Fix confidence: X%
- **Overall: X%**

### Outcome
<one of:>
- Auto-implemented + verified: PR <url> on branch <name>. Verifier green. Telemetry decayed.
- Auto-implemented, verifier red: PR <url> still draft. Concerns: <list>.
- Analyse-only (no PR): proposal returned at X% confidence.
- Below gate (X%): proposal returned for review. To raise the score, collect: <specific evidence>.
- Stopped: <reason>.
```

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Free-text input triggers low-confidence holistic analysis | Medium | Phase 0 refuses to analyse on free text alone — clarifying questions first. |
| Dash0 MCP not configured | Medium | Detection step in `evidence-resolution.md` prints the install / paste-evidence fallback; Phase 8 has its own capability gate. |
| Repro is best-effort only (UI / race / perf) | Medium | Verifier (Phase 7) skips `FAIL_TO_PASS` and relies on broader test suite + diff sanity. Documented in the bug-notes ledger. |
| Holistic analysis returns a confident-but-wrong root cause | Low–Medium | Three independent gates: `confidence(bug-analysis)`, `confidence(plan)` in `aw-planner`, and `bug-fix-verifier` in Phase 7. |
| Executor's first patch fails the repro | Medium | CEGIS refinement contract: capture failing input as counterexample, refine, cap at 3 rounds before escalating. |
| Verifier rubber-stamps the executor's diff | Low | Verifier runs in fresh context with no access to planner / executor reasoning — the canonical separation-of-concerns mitigation. |
| Bug-notes ledger drifts from reality | Low | Schema is strict; phases append rather than rewrite; verifier reads the ledger as evidence. |
| Phase 8 polls the wrong release | Low | Capability gate plus explicit deploy-ID capture; falls back to deferred mode for production deploys. |

---

## Key Principles

1. **Orchestrate, don't analyse.** Holistic analysis lives in `holistic-analysis`, gating in
   `confidence`, test authoring in `/tdd` / `/e2e-testing` / `/e2e-testing-mobile`,
   implementation in `aw-planner` + `aw-executor`, grading in `bug-fix-verifier`.
2. **Reproduce before fixing.** The repro is the executor's `FAIL_TO_PASS` contract and the
   verifier's primary check. Best-effort fallback is allowed but flagged.
3. **Cheap localisation first.** Pre-flight (Phase 1.5) often names the cause in seconds —
   running heavy holistic analysis first wastes tokens. If pre-flight short-circuits, take it.
4. **Three independent confidence gates.** `confidence(bug-analysis)` at Phase 4,
   `confidence(plan)` inside `aw-planner`, and `bug-fix-verifier` at Phase 7. Self-grading is
   not allowed at any of these.
5. **Counterexample-driven refinement.** When a patch fails the repro, the failing input is the
   evidence — capture it, refine, cap at 3 rounds.
6. **Durable ledger over re-derived state.** The bug-notes ledger survives compaction; phases
   read on entry and append on exit. Re-derivation is the failure mode the ledger prevents.
7. **No force-proceed under 70%.** Below 70% the skill stops and hands back to the user. No
   escape hatch.
8. **Telemetry sources close their own loop.** A Dash0-sourced bug is not done until the
   originating query stops firing. Phase 8 enforces this.
9. **Linear is one input adapter among several.** A Linear URL routes through
   `linear-ticket-investigator` to produce an Evidence Record, then continues at Phase 2 like
   any other input. `/batch-linear-tickets` is a thin wrapper that fans out
   `/fix-bug --analyse-only` per ticket.
