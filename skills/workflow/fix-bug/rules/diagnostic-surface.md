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
- [Lessons scope](#lessons-scope)
- [Validators](#validators)

---

This file declares the contract `/create-skill diagnose fix-bug` reads to parameterize the generic Diagnose Mode procedure for this skill.
The contract spec lives at [`skills/authoring/create-skill/rules/diagnostic-surface.md`](../../../authoring/create-skill/rules/diagnostic-surface.md).

---

## Source root

`skills/workflow/fix-bug/`

---

## Phase model

`fix-bug` is a 10-phase pipeline (Phases 0–8 plus Phase 0.5 complexity triage) plus three sub-phases (1.5 pre-flight, 2.5 reproduction-lock, 2c bisect), the Phase 6 lane split (fast / standard), and the cross-cutting bug-notes ledger.
The diagnoser walks every row.

| Phase | Name                                  | Rule / template                                                                         | Gate                                                                                  |
| ----- | ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0     | Intake & Classification               | [SKILL.md § Phase 0](../SKILL.md#phase-0--intake--classification)                        | Input classified; `bugClass` inferred; free-text refused without clarifying questions |
| 0.5   | Complexity triage                     | [complexity-triage.md](./complexity-triage.md)                                           | Classification = `simple` or `complex`; signals + decision logged in ledger            |
| 1a    | Per-input evidence resolution         | [evidence-resolution.md](./evidence-resolution.md)                                       | Partial Evidence Record produced for every classified input                            |
| 1b    | Pre-flight sweep                      | [preflight.md](./preflight.md)                                                           | Probes appended; optional single-commit short-circuit identified; can upgrade triage to `simple` |
| 2a    | Build the Evidence Record             | [bug-notes template](../templates/bug-notes.md)                                          | Single Evidence Record assembled                                                       |
| 2b    | Reproduction lock                     | [reproduction.md](./reproduction.md)                                                     | Failing repro at lowest viable layer (or best-effort markdown checklist + flagged); best-effort blocks fast-lane |
| 2c    | Bisect fast-path (regression class)   | [reproduction.md § bisect-fast-path](./reproduction.md#bisect-fast-path)                 | If `last_green_sha` + non-best-effort repro: `git bisect run`; ≤ 50 LOC ⇒ short-circuit |
| 2d    | Initialise bug-notes ledger           | [bug-notes-ledger.md](./bug-notes-ledger.md)                                             | `.agent/{branch}/bug-notes.md` written                                                 |
| 3     | Holistic analysis (complex only)      | `Skill("holistic-analysis", "fix")`                                                     | Holistic analysis emits root cause + score. **Skipped** when triage = `simple`; lightweight in-skill analysis runs instead per [complexity-triage.md](./complexity-triage.md#what-simple-actually-skips) |
| 4     | Confidence gate                       | `Skill("confidence", "analysis")`                                                   | Score appended to ledger's confidence trajectory                                        |
| 5     | Branch decision                       | [SKILL.md § Phase 5](../SKILL.md#phase-5--branch-decision)                               | ≥ 92 % auto-implement (no human confirmation); 70–91 % stop with raise-the-score guidance; < 70 % stop, no force-proceed |
| 6     | Autonomous handoff (lane-split)       | [autonomous-handoff.md](./autonomous-handoff.md)                                         | Fast-lane (simple + ≥92 %): `/fix-bug` → `aw-create-plan` → `aw-executor`; CEGIS round-3 falls back to standard-lane. Standard-lane (complex / downgrade / force-proceed): `aw-planner` → `aw-executor` gated on `confidence(plan)` ≥ 90 % |
| 7     | Independent verification              | [independent-verification.md](./independent-verification.md)                             | `bug-fix-verifier` (fresh context) green ⇒ undraft; red ⇒ leave draft + surface evidence |
| 8     | Telemetry verification                | [telemetry-verification.md](./telemetry-verification.md)                                 | Originating Dash0 query stops firing per chosen mode (rate-decay / extended-watch / cohort-absence / build-version-absence / deferred-watch) |

The bug-notes ledger ([`bug-notes-ledger.md`](./bug-notes-ledger.md)) is read on entry and appended on exit by every phase — it is not a phase, it is a cross-cutting durability mechanism.

---

## Existing guards per phase

| Phase | Existing guards                                                                                                                                          | Typical gaps                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 0     | First-match input-classification table; mode-flag detection (`--analyse-only`, `--verify-deploy`, `--force-holistic`); `bugClass` inference; refuse-on-free-text | Input shape misclassified (e.g. URL-only stack trace); `bugClass` set to `unknown` and downstream gates didn't compensate    |
| 0.5   | 14-row signal table; conservative-by-default decision rule; refuses `force-simple` when input lacks an anchor; pre-flight can upgrade `complex` → `simple`; `persistent-memory(read fix-bug-lessons --tier project-shared)` applies prior triage/repro/analysis lessons as advisory inputs | Classified `simple` on a cross-cutting bug (caught by CEGIS round 3 fallback); classified `complex` on a trivial bug (wasted tokens, no correctness loss); a recorded lesson existed but its `trigger-context` bugClass didn't match so it wasn't applied |
| 1a    | Per-input resolution procedures; capability gates for Dash0 / Linear / video MCPs                                                                        | MCP missing ⇒ silent fallback that produced a thin Evidence Record                                                           |
| 1b    | Recent-commits probe; lockfile / env diff; last-known-green deploy SHA; CI flip detection                                                                | Pre-flight short-circuit fired on coincidence (commit aligned but wasn't the cause)                                           |
| 2a    | Evidence Record schema in [`templates/bug-notes.md`](../templates/bug-notes.md)                                                                          | Required field left blank ⇒ holistic-analysis (or lightweight analysis on fast-lane) ran on incomplete evidence              |
| 2b    | Layer routing table delegates to `/tdd` / `/e2e-testing` / `/e2e-testing-mobile`; best-effort flag when no test layer captures the bug                    | Repro passed when the bug was present (false-green); layer chosen too high (E2E for what should have been a unit test); best-effort flag missed ⇒ fast-lane preconditions wrongly held |
| 2c    | `git bisect run` on the repro; 50-LOC threshold for revert-or-amend short-circuit                                                                        | Bisect identified a refactor commit, not the real cause; threshold tripped on a coincidental small commit                     |
| 3     | Holistic-analysis delegation; ruled-out hypotheses passed in to prevent re-exploration; **skipped on simple path** (lightweight in-skill analysis instead with the same Evidence Record contract) | Analysis blamed wrong file/line; ruled-out hypothesis re-explored despite ledger entry; lightweight analysis under-determined and triage did not upgrade to complex |
| 4     | `confidence(analysis)` gate; ledger trajectory captured; **score is from `confidence` skill, not self-graded on either lane**                          | Score inflated by overconfident root-cause certainty; gap between LLM score and reality                                     |
| 5     | **Step 5a — mechanical reproduction gate** (reads bug-notes ledger; passes only if `Path:` resolves to a runnable test with `Status: failing on HEAD as expected` OR to a `repro/*.md` with `Status: best-effort` AND `Reason:` in the closed list {race, production-only, heisenbug, visual, performance}; fails-closed with no force-proceed; runs before Step 5b). Three-tier confidence-based action (≥ 92 fully autonomous / 70–91 stop with raise-the-score / < 70 stop, no force-proceed); no force-proceed under 70 %; force-proceed on 70–91 % always routes to standard-lane | Force-proceed taken at 70–91 % when the proposal was wrong; user pressured into auto-implement; ≥ 92 % silent dispatch on a fast-lane downgrade the user wanted to see; **Phase 2b self-skip survived because the ledger's Reproduction section was filled with prose steps instead of the structured `Path:` / `Status:` / `Reason:` fields the gate matches against** (caught by F1 — see taxonomy) |
| 6     | **Step 6.pre — branch pre-flight assertion** (fails-closed if current branch is in `{main, master, develop, trunk}`; no force-proceed). **Lane selection** (fast-lane preconditions vs standard-lane); fast-lane validates plan.md before dispatch; fast-lane round-3 CEGIS failure falls back to standard-lane via aw-planner; `aw-planner` + `aw-executor` dispatch on standard-lane; CEGIS counterexample loop capped at 3 rounds; `confidence(plan)` inside planner (standard-lane only); bug-fix-pack carries the contract (standard); fast-lane plan contract carries it (fast). **Main agent does not execute file edits inline — only via `Task(subagent_type="aw-executor", ...)`.** | Fast-lane bypassed planner when bug was actually cross-cutting (caught by CEGIS round-3 fallback); fast-lane plan.md missing required sections and validation passed anyway; standard-lane CEGIS refined the wrong hypothesis 3 rounds running; planner missed a constraint surfaced in Evidence Record; **agent self-skipped dispatch entirely and edited inline on a protected branch** (caught by F2 — see taxonomy + Step 6.pre / Step 7.pre) |
| 7     | **Step 7.pre — draft PR assertion** (fails-closed if `gh pr view --json url,isDraft,headRefName` does not return a draft PR matching the current branch; no force-proceed). `bug-fix-verifier` in **fresh context** (identical for both lanes); FAIL_TO_PASS / PASS_TO_PASS / diff sanity / repro integrity; only the verifier may undraft                       | Verifier accepted a weakened repro (PASS_TO_PASS narrow); diff sanity missed a `.skip` / `.only` introduced elsewhere; **agent self-skipped the verifier with rationalization "small diff" or "diff-sanity grading only"** (caught by F2 — see taxonomy + Step 7.pre)          |
| 8     | Five verification modes; capability gate for Dash0 MCP; deferred-watch fallback for one-shot bugs with no cohort                                          | Mode mis-classified (rate-decay used for a low-frequency bug); deploy ID resolution wrong ⇒ polled the wrong release          |

Cross-cutting guards (apply to every phase):

- **Bug-notes ledger** — survives compaction; phases append on exit so the next phase reads the full record on entry. Failure mode: ledger written but not read (phase ran with stale Evidence Record).
- **Three independent confidence gates** — `confidence(analysis)` at 4, `confidence(plan)` inside `aw-planner` at 6, `bug-fix-verifier` at 7. Self-grading is not allowed at any of these.
- **Self-improvement loop (`fix-bug-lessons`)** — read at Phase 0.5, written at Phase 7 verifier-red / Phase 8 telemetry-still-firing / triage upgrades / Phase 5 stops. Lessons are advisory only (never relax a gate); a recurring lesson (`seen_count >= 3`) is promotion-eligible into a permanent guard via `diagnose`. Implementation-phase lessons are owned by `aw-lessons` (via `aw-executor`), not here. Failure mode: a recurring diagnostic-phase failure that was never written as a lesson, so it recurs every run. See [`self-improvement-loop.md`](./self-improvement-loop.md).

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID      | Class                                  | Symptom                                                                                                                                                                                                                                                       | Primary phase | Primary gate / companion                                                                                                                       |
| ------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | Phase 2b self-skip on rationalization                       | Agent did not invoke `/tdd` / `/e2e-testing` / `/e2e-testing-mobile` and did not mark the repro as best-effort with a valid reason from the [closed list](./reproduction.md#best-effort-fallback). Self-justified with "small diff", "pattern exercised elsewhere", "scaffolding overhead", or "would duplicate the fix."                                                                                                                                                                                                                              | Phase 2b      | [Phase 5 reproduction gate](../SKILL.md#step-5a--reproduction-gate-mechanical) + [reproduction.md § Forbidden reasons](./reproduction.md#forbidden-reasons-to-skip-phase-2b)                                                                                                            |
| F2      | Phase 6 dispatch + Phase 7 verifier coordinated self-skip   | Agent bypassed Phase 6 dispatch (no `gw checkout fix/<slug>`, no `aw-create-plan`, no `Task(subagent_type="aw-executor", ...)`), edited files inline on a protected branch, committed and/or pushed directly to that branch, then self-skipped the Phase 7 verifier with rationalization "small diff" or "verifier exists for diff-sanity grading only." The two skips are causally linked: no PR exists for the verifier to grade. | Phase 6 / 7   | [Phase 6.pre branch pre-flight assertion](../SKILL.md#step-6pre--branch-pre-flight-assertion-mechanical) + [Phase 7.pre draft PR assertion](../SKILL.md#step-7pre--draft-pr-assertion-mechanical)                                                                                       |
| F-novel | Novel mode                                                  | Does not match any existing row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —             | Diagnosis proposes a new row inline (added on user approval only)                                                                                                                                                                                                                       |

The taxonomy is **append-only** and intentionally seeded with `F-novel` only.
Speculative categories were not pre-populated — they push the diagnoser toward forcing a match where none exists.
Real-world failure classes (e.g. "false-green repro", "verifier accepted weakened test", "mode mis-classified at Phase 8", "pre-flight short-circuit on coincidence") will be added as confidence-gated, user-approved diagnoses produce them.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **Only the verifier may undraft the PR.** Phase 7's `bug-fix-verifier` runs `gh pr ready`; nothing else does. Source: Anthropic's "agents reliably skew positive when grading their own work."
- **The verifier runs in fresh context with no access to planner / executor reasoning.** Receives only the Evidence Record, repro path/command, bug-notes ledger (read-only), and the PR diff — not `plan.md` or any executor state.
- **The bug-notes ledger is append-only.** Phases never rewrite prior entries. The ledger is the durability mechanism that survives compaction; rewriting breaks the recovery handle for `--verify-deploy`.
- **Three independent confidence gates on both lanes.** On the standard-lane: `confidence(analysis)` at Phase 4, `confidence(plan)` inside `aw-planner`, `bug-fix-verifier` at Phase 7. On the fast-lane: `confidence(analysis) ≥ 92 %` (the stricter threshold substitutes for the planner gate that fast-lane bypasses), the fast-lane plan.md validator inside `/fix-bug`, and `bug-fix-verifier` at Phase 7. None of these may be merged or replaced — they are independent on purpose.
- **Fast-lane requires `confidence(analysis) ≥ 92 %`.** The threshold is the substitute for aw-planner's `confidence(plan) ≥ 90 %` that fast-lane bypasses. Lowering it without re-introducing planner would leave only two independent gates instead of three.
- **Fast-lane requires a non-best-effort repro.** The repro IS the executor's contract; without it, there's nothing to gate CEGIS on. Best-effort repros automatically downgrade to standard-lane.
- **Fast-lane round-3 CEGIS failure falls back to standard-lane via aw-planner — single-shot.** No fast-lane round 4, no second fallback. The fallback IS the safety net for "triage classified simple but the bug wasn't."
- **No force-proceed under 70 %.** Below 70 % the skill stops and hands back to the user. There is no escape hatch.
- **Force-proceed on 70–91 % always routes to standard-lane.** The planner's `confidence(plan)` gate is the extra safety net when analysis confidence is marginal.
- **CEGIS refinement is capped at 3 rounds on both lanes.** After 3 failing-counterexample rounds, escalate to `confidence(analysis fix)` (standard-lane) or to the fast-lane round-3 fallback (fast-lane) — do not loop further.
- **Telemetry-sourced bugs are not done until Phase 8 closes the signal.** A Dash0-sourced bug is not "fixed" at merge — it is fixed when the originating query stops firing per the chosen mode (or deferred-watch closes provisionally).
- **Phase 0 refuses to analyse free text alone.** Clarifying questions first — never run holistic-analysis on under-specified input.
- **Triage is conservative by default.** When `simple` and `complex` signals both fire, pick `complex`. When no signals fire, pick `complex`. The cost of running holistic-analysis on a trivial bug is wasted tokens; the cost of bypassing it on a real one is a wrong fix.
- **Pre-flight short-circuit can upgrade `complex` → `simple` but never downgrade.** Triage's `complex` default is overrideable by pre-flight evidence; the reverse direction is not.
- **`--force-holistic` always picks `complex`.** User opt-in for the slower path is honoured without question. Interactive `force-simple` is refused when the input lacks an anchor (signals 11, 12).
- **The verifier (Phase 7) is identical for both lanes.** Same fresh context, same four checks, only the verifier may undraft. No lane-specific loosening.
- **Verifier `FAIL_TO_PASS` may not be weakened.** If the repro is best-effort, the verifier explicitly skips the check rather than redefining "pass" — this is logged in the ledger. Best-effort repros never reach the fast-lane.
- **Phase 2b's `/tdd` / `/e2e-testing*` delegation is not optional outside the documented best-effort carve-out, and is enforced mechanically at Phase 5.** A repro may be marked best-effort only when the bug matches one of the cases in [`reproduction.md` § Best-effort fallback](./reproduction.md#best-effort-fallback) (race / production-only / Heisenbug) or rows 7–8 of the layer routing table (visual / performance). The [Phase 5 reproduction gate](../SKILL.md#step-5a--reproduction-gate-mechanical) runs a deterministic check on the bug-notes ledger's `## Reproduction (Phase 2.5)` section before any dispatch and fails-closed when the closed list is not satisfied. "Small diff", "pattern exercised elsewhere", "scaffolding overhead", and "would duplicate the fix" are forbidden self-justifications per [`reproduction.md` § Forbidden reasons to skip Phase 2b](./reproduction.md#forbidden-reasons-to-skip-phase-2b). No force-proceed below this gate.
- **Phase 6 dispatch and Phase 7 verifier invocation are mechanically required and bypass-resistant.** Implementation work runs **only** inside `aw-executor` via `Task(subagent_type="aw-executor", ...)` — never inline by the main agent. The [Phase 6.pre branch pre-flight assertion](../SKILL.md#step-6pre--branch-pre-flight-assertion-mechanical) fails-closed when the agent reaches Phase 6 on a protected trunk branch (`main` / `master` / `develop` / `trunk`); the [Phase 7.pre draft PR assertion](../SKILL.md#step-7pre--draft-pr-assertion-mechanical) fails-closed when no draft PR exists for the current branch. Direct commits to protected branches and skipping the verifier on "small diff" or "diff-sanity grading only" grounds are forbidden. No force-proceed below either gate.
- **`--verify-deploy` requires a bug-notes ledger.** Without the ledger, the recovery handle is gone; the skill refuses rather than guessing.
- **`fix-bug-lessons` are advisory-only.** A lesson biases triage / repro-layer / analysis from prior misfires but must never relax a confidence gate, the Phase 5 thresholds, the reproduction gate, the verifier, or any hard invariant above. The only path from a lesson to a behavior change is a confidence-gated, user-approved `diagnose` apply; promotion requires `seen_count >= 3` (or an explicit `structural` tag). A diagnoser must never propose auto-applying lessons or promoting on one run. See [`self-improvement-loop.md`](./self-improvement-loop.md#entrenchment-guards).

---

## Artifacts

| File pattern                                  | Produced by                                                 | When                                                                |
| --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `.agent/{branch}/bug-notes.md`                | Phase 2d (init), every phase (append)                       | Cross-cutting; survives compaction                                  |
| `Complexity triage` section in bug-notes.md   | Phase 0.5                                                   | Append once; pre-flight may append a triage-upgrade note            |
| `repro/{short-bug-id}.{ext}`                  | Phase 2b (delegated to /tdd / e2e)                          | Reproduction lock                                                   |
| Evidence Record (section in bug-notes.md)     | Phase 2a                                                    | Seeded from Phase 1; immutable thereafter                           |
| Confidence trajectory table (in bug-notes.md) | Phase 4 (and re-runs)                                       | Append on every gate evaluation                                     |
| Bug-fix-pack                                  | Phase 6 standard-lane                                       | Passed to `aw-planner`                                              |
| Fast-lane plan body                           | Phase 6 fast-lane                                           | Composed in `/fix-bug` and passed to `Skill("aw-create-plan", ...)` |
| `.agent/{branch}/plan.md` + `plan.v{N}.md`    | `aw-planner` (standard) or `aw-create-plan` (fast)          | Phase 6                                                             |
| Draft PR + commit history                     | `aw-executor`                                               | Phase 6                                                             |
| Verifier report                               | `bug-fix-verifier`                                          | Phase 7 (fresh context, both lanes)                                 |
| Phase 8 verification log                      | `telemetry-verification.md`                                 | Phase 8 (post-deploy)                                               |

`--analyse-only` runs produce only Phases 0–4 artifacts (no plan.md, no PR, no verifier, no Phase 8); diagnoses against analyse-only runs have a thinner evidence trail and the report should call that out. Triage (Phase 0.5) runs and is logged even in analyse-only mode.

---

## Lessons scope

- Scope: `fix-bug-lessons` (fix-bug's own diagnostic-phase lessons; implementation-phase lessons live in `aw-lessons`)
- Tier: `project-shared` (`<repo>/memory/fix-bug-lessons/`)
- Read for evidence with: `Skill("persistent-memory", "read fix-bug-lessons --tier project-shared")`

Diagnose Step 2 loads promotion-eligible lessons (`seen_count >= 3` or `status: structural`) as evidence — keyed by `bugClass` + input shape. See [`self-improvement-loop.md`](./self-improvement-loop.md).

---

## Validators

- `claude plugin validate skills/workflow/fix-bug` — frontmatter + structure check.
- Re-run the failing repro on the diagnosed branch — confirms the proposed change addresses the original failure.
- Inspect `.agent/{branch}/bug-notes.md` after applying a diagnosis diff — the ledger should still parse and every phase's append section should remain intact.
