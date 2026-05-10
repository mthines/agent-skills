---
title: fix-bug — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - fix-bug
  - meta
---

# fix-bug — Diagnostic Surface

## Contents

- [Source root](#source-root)
- [Phase model](#phase-model)
- [Existing guards per phase](#existing-guards-per-phase)
- [Failure taxonomy](#failure-taxonomy)
- [Hard invariants](#hard-invariants)
- [Artifacts](#artifacts)
- [Validators](#validators)

---

This file declares the contract `/create-skill diagnose fix-bug` reads to parameterize the generic Diagnose Mode procedure for this skill.
The contract spec lives at [`skills/create-skill/rules/diagnostic-surface.md`](../../create-skill/rules/diagnostic-surface.md).

---

## Source root

`skills/fix-bug/`

---

## Phase model

`fix-bug` is a 9-phase pipeline (Phases 0–8) plus three sub-phases (1.5 pre-flight, 2.5 reproduction-lock, 2c bisect) and the cross-cutting bug-notes ledger.
The diagnoser walks every row.

| Phase | Name                                  | Rule / template                                                                         | Gate                                                                                  |
| ----- | ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0     | Intake & Classification               | [SKILL.md § Phase 0](../SKILL.md#phase-0--intake--classification)                        | Input classified; `bugClass` inferred; free-text refused without clarifying questions |
| 1a    | Per-input evidence resolution         | [evidence-resolution.md](./evidence-resolution.md)                                       | Partial Evidence Record produced for every classified input                            |
| 1b    | Pre-flight sweep                      | [preflight.md](./preflight.md)                                                           | Probes appended; optional single-commit short-circuit identified                       |
| 2a    | Build the Evidence Record             | [bug-notes template](../templates/bug-notes.md)                                          | Single Evidence Record assembled                                                       |
| 2b    | Reproduction lock                     | [reproduction.md](./reproduction.md)                                                     | Failing repro at lowest viable layer (or best-effort markdown checklist + flagged)     |
| 2c    | Bisect fast-path (regression class)   | [reproduction.md § bisect-fast-path](./reproduction.md#bisect-fast-path)                 | If `last_green_sha` + non-best-effort repro: `git bisect run`; ≤ 50 LOC ⇒ short-circuit |
| 2d    | Initialise bug-notes ledger           | [bug-notes-ledger.md](./bug-notes-ledger.md)                                             | `.agent/{branch}/bug-notes.md` written                                                 |
| 3     | Holistic analysis                     | `Skill("holistic-analysis", "fix")`                                                     | Holistic analysis emits root cause + score                                             |
| 4     | Confidence gate                       | `Skill("confidence", "bug-analysis")`                                                   | Score appended to ledger's confidence trajectory                                        |
| 5     | Branch decision                       | [SKILL.md § Phase 5](../SKILL.md#phase-5--branch-decision)                               | ≥ 90 % auto-implement; 70–89 % stop with raise-the-score guidance; < 70 % stop, no force-proceed |
| 6     | Autonomous handoff                    | [autonomous-handoff.md](./autonomous-handoff.md), [bug-fix-pack template](../templates/bug-fix-pack.md) | `aw-planner` writes plan.md gated on `confidence(plan)`; `aw-executor` runs CEGIS (3-round cap) |
| 7     | Independent verification              | [independent-verification.md](./independent-verification.md)                             | `bug-fix-verifier` (fresh context) green ⇒ undraft; red ⇒ leave draft + surface evidence |
| 8     | Telemetry verification                | [telemetry-verification.md](./telemetry-verification.md)                                 | Originating Dash0 query stops firing per chosen mode (rate-decay / extended-watch / cohort-absence / build-version-absence / deferred-watch) |

The bug-notes ledger ([`bug-notes-ledger.md`](./bug-notes-ledger.md)) is read on entry and appended on exit by every phase — it is not a phase, it is a cross-cutting durability mechanism.

---

## Existing guards per phase

| Phase | Existing guards                                                                                                                                          | Typical gaps                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 0     | First-match input-classification table; mode-flag detection (`--analyse-only`, `--verify-deploy`); `bugClass` inference; refuse-on-free-text             | Input shape misclassified (e.g. URL-only stack trace); `bugClass` set to `unknown` and downstream gates didn't compensate    |
| 1a    | Per-input resolution procedures; capability gates for Dash0 / Linear / video MCPs                                                                        | MCP missing ⇒ silent fallback that produced a thin Evidence Record                                                           |
| 1b    | Recent-commits probe; lockfile / env diff; last-known-green deploy SHA; CI flip detection                                                                | Pre-flight short-circuit fired on coincidence (commit aligned but wasn't the cause)                                           |
| 2a    | Evidence Record schema in [`templates/bug-notes.md`](../templates/bug-notes.md)                                                                          | Required field left blank ⇒ holistic-analysis ran on incomplete evidence                                                     |
| 2b    | Layer routing table delegates to `/tdd` / `/e2e-testing` / `/e2e-testing-mobile`; best-effort flag when no test layer captures the bug                    | Repro passed when the bug was present (false-green); layer chosen too high (E2E for what should have been a unit test)        |
| 2c    | `git bisect run` on the repro; 50-LOC threshold for revert-or-amend short-circuit                                                                        | Bisect identified a refactor commit, not the real cause; threshold tripped on a coincidental small commit                     |
| 3     | Holistic-analysis delegation; ruled-out hypotheses passed in to prevent re-exploration                                                                   | Analysis blamed wrong file/line; ruled-out hypothesis re-explored despite ledger entry                                       |
| 4     | `confidence(bug-analysis)` ≥ 90 % gate; ledger trajectory captured                                                                                       | Score inflated by overconfident root-cause certainty; gap between LLM score and reality                                     |
| 5     | Three-tier branch decision (≥ 90 / 70–89 / < 70); no force-proceed under 70 %                                                                           | Force-proceed taken at 70–89 % when the proposal was wrong; user pressured into auto-implement                               |
| 6     | `aw-planner` + `aw-executor` dispatch; CEGIS counterexample loop capped at 3 rounds; `confidence(plan)` inside planner; bug-fix-pack carries the contract | CEGIS refined the wrong hypothesis 3 rounds running; planner missed a constraint surfaced in Evidence Record                  |
| 7     | `bug-fix-verifier` in **fresh context**; FAIL_TO_PASS / PASS_TO_PASS / diff sanity / repro integrity; only the verifier may undraft                       | Verifier accepted a weakened repro (PASS_TO_PASS narrow); diff sanity missed a `.skip` / `.only` introduced elsewhere          |
| 8     | Five verification modes; capability gate for Dash0 MCP; deferred-watch fallback for one-shot bugs with no cohort                                          | Mode mis-classified (rate-decay used for a low-frequency bug); deploy ID resolution wrong ⇒ polled the wrong release          |

Cross-cutting guards (apply to every phase):

- **Bug-notes ledger** — survives compaction; phases append on exit so the next phase reads the full record on entry. Failure mode: ledger written but not read (phase ran with stale Evidence Record).
- **Three independent confidence gates** — `confidence(bug-analysis)` at 4, `confidence(plan)` inside `aw-planner` at 6, `bug-fix-verifier` at 7. Self-grading is not allowed at any of these.

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID      | Class       | Symptom                                                                                              | Primary phase | Primary gate / companion                                          |
| ------- | ----------- | ---------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| F-novel | Novel mode  | Does not match any existing row                                                                      | —             | Diagnosis proposes a new row inline (added on user approval only) |

The taxonomy is **append-only** and intentionally seeded with `F-novel` only.
Speculative categories were not pre-populated — they push the diagnoser toward forcing a match where none exists.
Real-world failure classes (e.g. "false-green repro", "verifier accepted weakened test", "mode mis-classified at Phase 8", "pre-flight short-circuit on coincidence") will be added as confidence-gated, user-approved diagnoses produce them.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **Only the verifier may undraft the PR.** Phase 7's `bug-fix-verifier` runs `gh pr ready`; nothing else does. Source: Anthropic's "agents reliably skew positive when grading their own work."
- **The verifier runs in fresh context with no access to planner / executor reasoning.** Receives only the Evidence Record, repro path/command, bug-notes ledger (read-only), and the PR diff — not `plan.md` or any executor state.
- **The bug-notes ledger is append-only.** Phases never rewrite prior entries. The ledger is the durability mechanism that survives compaction; rewriting breaks the recovery handle for `--verify-deploy`.
- **Three independent confidence gates.** `confidence(bug-analysis)` at Phase 4, `confidence(plan)` inside `aw-planner`, and `bug-fix-verifier` at Phase 7. None of these may be merged or replaced by a single gate — they are independent on purpose.
- **No force-proceed under 70 %.** Below 70 % the skill stops and hands back to the user. There is no escape hatch.
- **CEGIS refinement is capped at 3 rounds.** After 3 failing-counterexample rounds, escalate to `confidence(bug-analysis fix)` and the existing branch-decision tiers — do not loop further.
- **Telemetry-sourced bugs are not done until Phase 8 closes the signal.** A Dash0-sourced bug is not "fixed" at merge — it is fixed when the originating query stops firing per the chosen mode (or deferred-watch closes provisionally).
- **Phase 0 refuses to analyse free text alone.** Clarifying questions first — never run holistic-analysis on under-specified input.
- **Verifier `FAIL_TO_PASS` may not be weakened.** If the repro is best-effort, the verifier explicitly skips the check rather than redefining "pass" — this is logged in the ledger.
- **`--verify-deploy` requires a bug-notes ledger.** Without the ledger, the recovery handle is gone; the skill refuses rather than guessing.

---

## Artifacts

| File pattern                                  | Produced by                          | When                                       |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| `.agent/{branch}/bug-notes.md`                | Phase 2d (init), every phase (append) | Cross-cutting; survives compaction         |
| `repro/{short-bug-id}.{ext}`                  | Phase 2b (delegated to /tdd / e2e)   | Reproduction lock                          |
| Evidence Record (section in bug-notes.md)     | Phase 2a                             | Seeded from Phase 1; immutable thereafter  |
| Confidence trajectory table (in bug-notes.md) | Phase 4 (and re-runs)                | Append on every gate evaluation            |
| Bug-fix-pack                                  | Phase 6                              | Passed to `aw-planner`                     |
| `.agent/{branch}/plan.md` + `plan.v{N}.md`    | `aw-planner`                         | Phase 6                                    |
| Draft PR + commit history                     | `aw-executor`                        | Phase 6                                    |
| Verifier report                               | `bug-fix-verifier`                   | Phase 7 (fresh context)                    |
| Phase 8 verification log                      | `telemetry-verification.md`          | Phase 8 (post-deploy)                      |

`--analyse-only` runs produce only Phases 0–4 artifacts (no plan.md, no PR, no verifier, no Phase 8); diagnoses against analyse-only runs have a thinner evidence trail and the report should call that out.

---

## Validators

- `claude plugin validate skills/fix-bug` — frontmatter + structure check.
- Re-run the failing repro on the diagnosed branch — confirms the proposed change addresses the original failure.
- Inspect `.agent/{branch}/bug-notes.md` after applying a diagnosis diff — the ledger should still parse and every phase's append section should remain intact.
