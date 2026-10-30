# fix-bug design rationale

Why the pipeline is shaped the way it is.
The rules live in [`SKILL.md`](../SKILL.md) and `rules/`; this file is read on demand.

## Contents

- [Principles](#principles)
- [Why the auto-implement bar is 92 %](#why-the-auto-implement-bar-is-92-)
- [Why Phase 3 runs in context](#why-phase-3-runs-in-context)
- [In-session implementation](#in-session-implementation)
- [Why the repro-fidelity check reads only the local run](#why-the-repro-fidelity-check-reads-only-the-local-run)
- [Phase 7 verification](#phase-7-verification)
- [Why deferred-watch exists](#why-deferred-watch-exists)
- [Risks and mitigations](#risks-and-mitigations)

## Principles

1. **Orchestrate, don't self-grade.** Root-cause analysis follows `rules/root-cause-analysis.md`,
   gating lives in `confidence`, test authoring in `/tdd` / `/e2e-testing` / `/e2e-testing-mobile`,
   plan authoring in `aw-create-plan` (six-Core brief on the standard-lane, fast-lane plan otherwise), implementation
   in this session (Phase 6 Step 6b), and the final undraft with a human.
2. **Match the harness to the bug.** A null-check fix in one file does not need an eight-phase
   pipeline. Phase 0.5 triage routes simple bugs to a lightweight in-skill analysis and a fast
   handoff lane; complex bugs get the full execution-path trace + a sealed six-Core brief. The conservative
   default is `complex` — when in doubt, run the slower lane.
3. **Reproduce before fixing.** The repro is Phase 6's `FAIL_TO_PASS` contract and the
   Phase 7's primary check. Best-effort fallback is allowed but flagged — and blocks the
   fast-lane.
4. **Cheap localisation first.** Pre-flight (Phase 1.5) often names the cause in seconds —
   running heavy holistic analysis first wastes tokens. Pre-flight short-circuits can also
   upgrade `complex` triage to `simple` and unlock the fast-lane.
5. **Three independent gates on both lanes.** Standard-lane: `confidence(analysis)`
   + deterministic brief validation with sealed checks + Phase 7 checks. Fast-lane:
   `confidence(analysis) ≥ 92 %` (stricter, because the fast-lane plan skips the sealed brief)
   + plan.md validator + Phase 7 checks. A human
   undrafts after reading the Phase 7 evidence. Self-grading is
   not allowed at any of these.
6. **Auto-implement at ≥ 92 % is fully autonomous.** The threshold guards the fast-lane, which
   skips the sealed brief, and applies symmetrically on the standard-lane to keep the
   user-facing model simple.
7. **Counterexample-driven refinement.** When a patch fails the repro, the failing input is the
   evidence — capture it, refine, cap at 3 rounds.
8. **Durable ledger over re-derived state.** The bug-notes ledger survives compaction;
   re-derivation is the failure mode the ledger prevents.
9. **Telemetry sources close their own loop.** A Dash0-sourced bug is not done until the
   originating query stops firing.
10. **Linear is one input adapter among several.** A Linear URL is read in context
    with the Linear MCP tools into an Evidence Record, then continues like any other input.
11. **Learn across bugs, but only advisory.** Lessons bias triage / repro / analysis; they never
    relax a gate. Implementation-phase learning lives in `aw-lessons`, read and written by Phase 6 Step 6b.

## Why the auto-implement bar is 92 %

The fast-lane plan skips the six-Core brief and its sealed checks, so the analysis gate is the
strongest guard that lane has.
It is stricter on purpose: a higher bar on the gate that remains keeps the three-gate invariant.
Force-proceed at 70–91 % routes to the standard-lane because the sealed brief is the extra safety
net when analysis confidence is marginal.

## Why Phase 3 runs in context

The trace is one sequential pass over one bug, so a sub-agent buys no parallelism, only context
isolation.
The hop-by-hop notes go to the bug-notes ledger and only the Root-Cause Record reaches the summary,
which keeps the window lean without a dispatch.

## In-session implementation

Phase 6 works the fix in the session that ran Phases 0–5, for the reason Phase 3 runs in context:
one bug is one sequential pass, so a sub-agent buys no parallelism.
A dispatched executor started cold and re-read the ledger, the repro, and the Root-Cause Record
from files, then returned a summary — the handoff loss a single loop avoids.
`aw`'s Full tier dropped its executor on the same reasoning, so both entry points now share one
work loop.

Independence moved to the two steps that need it: `branch-reviewer` reviews the diff before the
PR, and `feature-pr-verifier` checks it at PR open, each from a context that did not write it.
The executor path ran `branch-reviewer` through its local `review-loop`, but never `feature-pr-verifier`.
The branch and draft-PR assertions (Steps 6.pre and 7.pre) guard against inline edits on a
protected branch, so the F2 bypass stays closed without the dispatch.
`aw-executor` remains for an explicit background request.

## Why the repro-fidelity check reads only the local run

`telemetry-verify` reads only the telemetry inside the local run's own time window, so it can
never fetch the production span.
An expectation phrased as "matches production" would therefore answer `null` every time — which is
why `/fix-bug` reads the originating span's shape out of its own Evidence Record and passes it in
as literal expectations.

## Phase 7 verification

"Agents reliably skew positive when grading their own work" —
[Effective harnesses for long-running agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
Phase 7 runs its four checks in the same session that wrote the fix, so three things counter that skew.
`branch-reviewer` and `feature-pr-verifier` have already read the diff from contexts that did not write it.
The checks are mechanical — exit codes, a test-set diff, a pattern scan of the diff — and are graded
against artefacts (repro, diff, Evidence Record), never against `plan.md`.
And `/fix-bug` never undrafts: the evidence goes into the PR body and a human makes the call.

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
| Repro is best-effort only (UI / race / perf) | Medium | Phase 7 skips `FAIL_TO_PASS` and relies on broader test suite + diff sanity. Best-effort repros are also blocked from the fast-lane — they always route via standard-lane. Documented in the bug-notes ledger. |
| Analysis returns a confident-but-wrong root cause | Low–Medium | Three independent gates on **both lanes**: standard-lane uses `confidence(analysis)` + the sealed six-Core brief + Phase 7 checks; fast-lane uses `confidence(analysis) ≥ 92 %` (stricter, because it skips the sealed brief) + plan.md validator + Phase 7 checks; a human undrafts. |
| Triage classified `simple` but the bug was cross-cutting | Low–Medium | Fast-lane round-3 CEGIS failure falls back to the standard-lane with the captured counterexamples — single-shot safety net. |
| Triage classified `complex` but the bug was trivial | Medium | Acceptable. Wasted tokens; no correctness loss. Conservative default is intentional. Pre-flight short-circuit can still upgrade `complex` → `simple` later in the run. |
| Fast-lane plan.md missing a required section | Low | `/fix-bug` validates plan.md after `aw-create-plan` returns and before Phase 6 work starts. Fails loudly. |
| The first patch fails the repro | Medium | CEGIS refinement contract: capture failing input as counterexample, refine, cap at 3 rounds before escalating (standard-lane → `confidence(analysis fix)`; fast-lane → standard-lane fallback). |
| Phase 7 rubber-stamps the session's own diff | Low–Medium | The checks are mechanical and graded against artefacts, not `plan.md`; `/fix-bug` never undrafts, so a human reviews the `## Verification` evidence before the PR leaves draft; `branch-reviewer` and `feature-pr-verifier` read the diff first. Identical on both lanes. |
| Bug-notes ledger drifts from reality | Low | Schema is strict; phases append rather than rewrite; Phase 7 reads the ledger as evidence. |
| Phase 8 polls the wrong release | Low | Capability gate plus explicit deploy-ID capture; falls back to deferred mode for production deploys. |
