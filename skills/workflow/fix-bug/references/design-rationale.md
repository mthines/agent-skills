# fix-bug design rationale

Why the pipeline is shaped the way it is.
The rules live in [`SKILL.md`](../SKILL.md) and `rules/`; this file is read on demand.

## Contents

- [Principles](#principles)
- [Why the auto-implement bar is 92 %](#why-the-auto-implement-bar-is-92-)
- [Why Phase 3 runs isolated](#why-phase-3-runs-isolated)
- [Why the repro-fidelity check reads only the local run](#why-the-repro-fidelity-check-reads-only-the-local-run)
- [Why Phase 7 uses a fresh-context verifier](#why-phase-7-uses-a-fresh-context-verifier)
- [Why deferred-watch exists](#why-deferred-watch-exists)
- [Risks and mitigations](#risks-and-mitigations)

## Principles

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
6. **Auto-implement at ≥ 92 % is fully autonomous.** The threshold is the substitute for the
   bypassed planner gate on the fast-lane and applies symmetrically on the standard-lane to keep
   the user-facing model simple.
7. **Counterexample-driven refinement.** When a patch fails the repro, the failing input is the
   evidence — capture it, refine, cap at 3 rounds.
8. **Durable ledger over re-derived state.** The bug-notes ledger survives compaction;
   re-derivation is the failure mode the ledger prevents.
9. **Telemetry sources close their own loop.** A Dash0-sourced bug is not done until the
   originating query stops firing.
10. **Linear is one input adapter among several.** A Linear URL routes through
    `linear-ticket-investigator` to produce an Evidence Record, then continues like any other input.
11. **Learn across bugs, but only advisory.** Lessons bias triage / repro / analysis; they never
    relax a gate. Implementation-phase learning lives in `aw-lessons` via `aw-executor`.

## Why the auto-implement bar is 92 %

The 92 % threshold is the substitute for aw-planner's `confidence(plan) ≥ 90 %` that the fast-lane
bypasses.
It is stricter on purpose: bypassing the planner means one fewer independent gate, and the higher
bar on the gate that remains restores the three-gate invariant.
Force-proceed at 70–91 % routes to the standard-lane because the planner's `confidence(plan)` gate
is the extra safety net when analysis confidence is marginal.

## Why Phase 3 runs isolated

`rca-investigator` keeps the verbose 8-phase holistic walkthrough in its own context and returns
only the distilled Root-Cause Record, so the orchestrator's window is not polluted.
It is a single dispatch (one bug, nothing to parallelize); the win is isolation, not parallelism.

## Why the repro-fidelity check reads only the local run

`observe-run` reads only the telemetry emitted by the run it just executed, scoped to that run's
`dev.run.id`, so it can never fetch the production span.
An expectation phrased as "matches production" would therefore answer `null` every time — which is
why `/fix-bug` reads the originating span's shape out of its own Evidence Record and passes it in
as literal expectations.

## Why Phase 7 uses a fresh-context verifier

"Agents reliably skew positive when grading their own work" —
[Effective harnesses for long-running agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
The verifier sees no planner / executor reasoning.

## Why deferred-watch exists

Deferred-watch is the honest answer for app crashes that fired once with no cohort information.
The skill does not pretend to verify in that mode — it registers the watch on the Linear ticket and
PR, closes the bug as "deployed; watching for recurrence", and reopens if the originating query
produces a match on the new release tag.

## Risks and mitigations

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
