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
| 1.5   | Pre-flight sweep                      | [preflight.md](./preflight.md)                                                           | Probes appended; optional single-commit short-circuit identified; can upgrade triage to `simple` |
| 2a    | Build the Evidence Record             | [bug-notes template](../templates/bug-notes.md)                                          | Single Evidence Record assembled                                                       |
| 2.5   | Reproduction lock                     | [reproduction.md](./reproduction.md)                                                     | Failing repro at lowest viable layer (or best-effort markdown checklist + flagged); best-effort blocks fast-lane |
| 2c    | Bisect fast-path (regression class)   | [reproduction.md § bisect-fast-path](./reproduction.md#bisect-fast-path)                 | If `last_green_sha` + non-best-effort repro: `git bisect run`; ≤ 50 LOC ⇒ short-circuit |
| 2d    | Seed Evidence Record into bug-notes ledger | [bug-notes-ledger.md](./bug-notes-ledger.md)                                        | Evidence Record appended; ledger exists (created on first write — normally the Phase 0.5 triage append) |
| 3     | Root-cause analysis (complex only)    | [root-cause-analysis.md](./root-cause-analysis.md) (in-context trace + `confidence(analysis)`) | Root-Cause Record carrying root cause + score appended to the ledger. **Skipped** when triage = `simple`; lightweight in-skill analysis runs instead per [complexity-triage.md](./complexity-triage.md#what-simple-actually-skips) |
| 4     | Confidence gate                       | `Skill("confidence", "analysis")`                                                   | Score appended to ledger's confidence trajectory                                        |
| 5     | Branch decision                       | [SKILL.md § Phase 5](../SKILL.md#phase-5--branch-decision)                               | ≥ 92 % auto-implement (no human confirmation); 80–91 % stop with raise-the-score guidance, force-proceed offered (→ standard-lane); 70–79 % stop, force-proceed NOT recommended; < 70 % stop, no force-proceed |
| 6     | Autonomous handoff (lane-split)       | [autonomous-handoff.md](./autonomous-handoff.md)                                         | Fast-lane (simple + ≥92 %): `/fix-bug` → `aw-create-plan` → work in session (Step 6b); CEGIS round-3 falls back to standard-lane. Standard-lane (complex / downgrade / force-proceed): `/fix-bug` → `aw-create-plan` six-Core brief → work in session (Step 6b), gated on deterministic brief validation; `branch-reviewer` before the PR, `feature-pr-verifier` at PR open |
| 7     | Verification                          | [independent-verification.md](./independent-verification.md)                             | Four in-context checks; verdict + evidence written to the PR body; PR stays draft on green and red — a human undrafts |
| 8     | Telemetry verification                | [telemetry-verification.md](./telemetry-verification.md)                                 | Originating Dash0 query stops firing per chosen mode (rate-decay / extended-watch / cohort-absence / build-version-absence / deferred-watch) |

The bug-notes ledger ([`bug-notes-ledger.md`](./bug-notes-ledger.md)) is read on entry and appended on exit by every phase — it is not a phase, it is a cross-cutting durability mechanism.

---

## Existing guards per phase

| Phase | Existing guards                                                                                                                                          | Typical gaps                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 0     | First-match input-classification table; mode-flag detection (`--analyse-only`, `--verify-deploy`, `--force-holistic`); `bugClass` inference; refuse-on-free-text | Input shape misclassified (e.g. URL-only stack trace); `bugClass` set to `unknown` and downstream gates didn't compensate    |
| 0.5   | 14-row signal table; conservative-by-default decision rule; refuses `force-simple` when input lacks an anchor; pre-flight can upgrade `complex` → `simple`; `lorekit(memory.list <repo::/global> loop::fix-bug-lessons)` applies prior triage/repro/analysis lessons as advisory inputs | Classified `simple` on a cross-cutting bug (caught by CEGIS round 3 fallback); classified `complex` on a trivial bug (wasted tokens, no correctness loss); a recorded lesson existed but its **Applies when** bugClass didn't match so it wasn't applied |
| 1a    | Per-input resolution procedures; capability gates for Dash0 / Linear / video MCPs                                                                        | MCP missing ⇒ silent fallback that produced a thin Evidence Record                                                           |
| 1.5   | Recent-commits probe; lockfile / env diff; last-known-green deploy SHA; CI flip detection                                                                | Pre-flight short-circuit fired on coincidence (commit aligned but wasn't the cause)                                           |
| 2a    | Evidence Record schema in [`templates/bug-notes.md`](../templates/bug-notes.md)                                                                          | Required field left blank ⇒ Phase 3 analysis (full or lightweight) ran on incomplete evidence              |
| 2.5   | Layer routing table delegates to `/tdd` / `/e2e-testing` / `/e2e-testing-mobile`; best-effort flag when no test layer captures the bug                    | Repro passed when the bug was present (false-green); layer chosen too high (E2E for what should have been a unit test); best-effort flag missed ⇒ fast-lane preconditions wrongly held |
| 2c    | `git bisect run` on the repro; 50-LOC threshold for revert-or-amend short-circuit                                                                        | Bisect identified a refactor commit, not the real cause; threshold tripped on a coincidental small commit                     |
| 3     | In-context execution-path trace per [root-cause-analysis.md](./root-cause-analysis.md) (≥ 2 alternatives ruled out with evidence, root cause vs. symptom); ruled-out hypotheses read from the ledger to prevent re-exploration; **skipped on simple path** (lightweight in-skill analysis instead with the same Evidence Record contract) | Analysis blamed wrong file/line; ruled-out hypothesis re-explored despite ledger entry; lightweight analysis under-determined and triage did not upgrade to complex |
| 4     | `confidence(analysis)` gate; ledger trajectory captured; **score is from `confidence` skill, not self-graded on either lane**                          | Score inflated by overconfident root-cause certainty; gap between LLM score and reality                                     |
| 5     | **Step 5a — mechanical reproduction gate** (reads bug-notes ledger; passes only if `Path:` resolves to a runnable test with `Status: failing on HEAD as expected` OR to a `repro/*.md` with `Status: best-effort` AND `Reason:` in the closed list {race, production-only, heisenbug, visual, performance}; fails-closed with no force-proceed; runs before Step 5b). Four-band confidence-based action (≥ 92 fully autonomous / 80–91 stop, force-proceed offered / 70–79 stop, force-proceed NOT recommended / < 70 stop, no force-proceed); force-proceed on 70–91 % always routes to standard-lane | Force-proceed taken at 70–91 % when the proposal was wrong; user pressured into auto-implement; ≥ 92 % silent dispatch on a fast-lane downgrade the user wanted to see; **Phase 2.5 self-skip survived because the ledger's Reproduction section was filled with prose steps instead of the structured `Path:` / `Status:` / `Reason:` fields the gate matches against** (caught by F1 — see taxonomy) |
| 6     | **Step 6.pre — branch pre-flight assertion** (fails-closed if current branch is in `{main, master, develop, trunk}`; no force-proceed). **Lane selection** (fast-lane preconditions vs standard-lane); fast-lane validates plan.md before Step 6b; fast-lane round-3 CEGIS failure falls back to the standard-lane; standard-lane brief validated deterministically before work starts; CEGIS counterexample loop capped at 3 rounds; the brief carries the contract from the bug-fix-pack (standard); fast-lane plan contract carries it (fast). **File edits happen only in the `fix/<slug>` worktree (Step 6b), never on a protected branch; the Step 6b guard compares the original checkout against its pre-edit snapshot before Step 3 and Step 4; `branch-reviewer` reviews the diff before the PR.** | Fast-lane taken when bug was actually cross-cutting (caught by CEGIS round-3 fallback); fast-lane plan.md missing required sections and validation passed anyway; standard-lane CEGIS refined the wrong hypothesis 3 rounds running; standard-lane brief missed a constraint surfaced in Evidence Record; **agent self-skipped dispatch entirely and edited inline on a protected branch** (caught by F2 — see taxonomy + Step 6.pre / Step 7.pre) |
| 7     | **Step 7.pre — draft PR assertion** (fails-closed if `gh pr view --json url,isDraft,headRefName` does not return a draft PR matching the current branch; no force-proceed). In-context checks graded against the repro, diff, and Evidence Record — not `plan.md` (identical for both lanes); FAIL_TO_PASS / PASS_TO_PASS / diff sanity / repro integrity; evidence written to the PR body; `/fix-bug` never undrafts                       | Verification accepted a weakened repro (PASS_TO_PASS narrow); diff sanity missed a `.skip` / `.only` introduced elsewhere; **agent self-skipped verification with rationalization "small diff" or "diff-sanity grading only"** (caught by F2 — see taxonomy + Step 7.pre)          |
| 8     | Five verification modes; capability gate for Dash0 MCP; deferred-watch fallback for one-shot bugs with no cohort                                          | Mode mis-classified (rate-decay used for a low-frequency bug); deploy ID resolution wrong ⇒ polled the wrong release          |

Cross-cutting guards (apply to every phase):

- **Bug-notes ledger** — survives compaction; phases append on exit so the next phase reads the full record on entry. Failure mode: ledger written but not read (phase ran with stale Evidence Record).
- **Three independent gates** — `confidence(analysis)` at 4, deterministic plan validation plus the sealed checks and the Step 6b worktree guard at 6, Phase 7 checks plus a human undraft at 7. Self-grading is not allowed at any of these.
- **Self-improvement loop (`fix-bug-lessons`)** — read at Phase 0.5, written at Phase 7 verification red / Phase 8 telemetry-still-firing / triage upgrades / Phase 5 stops. Lessons are advisory only (never relax a gate); a recurring lesson (`seen_count >= 3`) is promotion-eligible into a permanent guard via `diagnose`. Implementation-phase lessons are owned by `aw-lessons` (read and written by Step 6b), not here. Failure mode: a recurring diagnostic-phase failure that was never written as a lesson, so it recurs every run. See [`self-improvement-loop.md`](./self-improvement-loop.md).

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID      | Class                                  | Symptom                                                                                                                                                                                                                                                       | Primary phase | Primary gate / companion                                                                                                                       |
| ------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | Phase 2.5 self-skip on rationalization                       | Agent did not invoke `/tdd` / `/e2e-testing` / `/e2e-testing-mobile` and did not mark the repro as best-effort with a valid reason from the [closed list](./reproduction.md#best-effort-fallback). Self-justified with "small diff", "pattern exercised elsewhere", "scaffolding overhead", or "would duplicate the fix."                                                                                                                                                                                                                              | Phase 2.5      | [Phase 5 reproduction gate](../SKILL.md#step-5a--reproduction-gate-mechanical) + [reproduction.md § Forbidden reasons](./reproduction.md#forbidden-reasons-to-skip-phase-25)                                                                                                            |
| F2      | Phase 6 dispatch + Phase 7 verification coordinated self-skip | Agent bypassed Phase 6 (no `gw checkout fix/<slug>`, no `aw-create-plan`, edits outside the `fix/<slug>` worktree — at the time of the incident, also no `aw-executor` dispatch, which is no longer the default path), edited files inline on a protected branch, committed and/or pushed directly to that branch, then self-skipped Phase 7 verification with rationalization "small diff" or "verification is for diff-sanity grading only." The two skips are causally linked: no PR exists to verify. | Phase 6 / 7   | [Phase 6.pre branch pre-flight assertion](../SKILL.md#step-6pre--branch-pre-flight-assertion-mechanical) + [Phase 7.pre draft PR assertion](../SKILL.md#step-7pre--draft-pr-assertion-mechanical)                                                                                       |
| F-novel | Novel mode                                                  | Does not match any existing row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —             | Diagnosis proposes a new row inline (added on user approval only)                                                                                                                                                                                                                       |

The taxonomy is **append-only** and intentionally seeded with `F-novel` only.
Speculative categories were not pre-populated — they push the diagnoser toward forcing a match where none exists.
Real-world failure classes (e.g. "false-green repro", "verification accepted weakened test", "mode mis-classified at Phase 8", "pre-flight short-circuit on coincidence") will be added as confidence-gated, user-approved diagnoses produce them.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **`/fix-bug` never undrafts the PR.** Phase 7 writes the verdict and evidence into the PR body; a human reads it and runs `gh pr ready`. Source: Anthropic's "agents reliably skew positive when grading their own work."
- **Phase 7 grades against artefacts only.** It reads the Evidence Record, repro path/command, bug-notes ledger (read-only), and the PR diff — never `plan.md` or the executor's summary.
- **The bug-notes ledger is append-only.** Phases never rewrite prior entries. The ledger is the durability mechanism that survives compaction; rewriting breaks the recovery handle for `--verify-deploy`.
- **Three independent gates on both lanes.** On the standard-lane: `confidence(analysis)` at Phase 4, the six-Core brief validation with sealed checks, Phase 7 checks plus a human undraft. On the fast-lane: `confidence(analysis) ≥ 92 %` (stricter, because the fast-lane plan skips the sealed six-Core brief), the fast-lane plan.md validator inside `/fix-bug`, and Phase 7 checks plus a human undraft. None of these may be merged or replaced — they are independent on purpose.
- **Fast-lane requires `confidence(analysis) ≥ 92 %`.** The fast-lane plan skips the sealed six-Core brief, so the stricter threshold keeps marginal diagnoses off the lane with the fewest guards. Lowering it is forbidden.
- **Fast-lane requires a non-best-effort repro.** The repro IS the executor's contract; without it, there's nothing to gate CEGIS on. Best-effort repros automatically downgrade to standard-lane.
- **Fast-lane round-3 CEGIS failure falls back to the standard-lane — single-shot.** No fast-lane round 4, no second fallback. The fallback IS the safety net for "triage classified simple but the bug wasn't."
- **No force-proceed under 70 %.** Below 70 % the skill stops and hands back to the user. There is no escape hatch.
- **Force-proceed on 70–91 % always routes to standard-lane.** The six-Core brief with sealed checks is the extra safety net when analysis confidence is marginal.
- **CEGIS refinement is capped at 3 rounds on both lanes.** After 3 failing-counterexample rounds, escalate to `confidence(analysis fix)` (standard-lane) or to the fast-lane round-3 fallback (fast-lane) — do not loop further.
- **Telemetry-sourced bugs are not done until Phase 8 closes the signal.** A Dash0-sourced bug is not "fixed" at merge — it is fixed when the originating query stops firing per the chosen mode (or deferred-watch closes provisionally).
- **Phase 0 refuses to analyse free text alone.** Clarifying questions first — never run root-cause analysis on under-specified input.
- **Triage is conservative by default.** When `simple` and `complex` signals both fire, pick `complex`. When no signals fire, pick `complex`. The cost of running the full trace on a trivial bug is wasted tokens; the cost of bypassing it on a real one is a wrong fix.
- **Pre-flight short-circuit can upgrade `complex` → `simple` but never downgrade.** Triage's `complex` default is overrideable by pre-flight evidence; the reverse direction is not.
- **`--force-holistic` always picks `complex`.** User opt-in for the slower path is honoured without question. Interactive `force-simple` is refused when the input lacks an anchor (signals 11, 12).
- **Phase 7 verification is identical for both lanes.** Same four checks, same no-undraft rule. No lane-specific loosening.
- **Phase 7 `FAIL_TO_PASS` may not be weakened.** If the repro is best-effort, Phase 7 explicitly skips the check rather than redefining "pass" — this is logged in the ledger. Best-effort repros never reach the fast-lane.
- **Phase 2.5's `/tdd` / `/e2e-testing*` delegation is not optional outside the documented best-effort carve-out, and is enforced mechanically at Phase 5.** A repro may be marked best-effort only when the bug matches one of the cases in [`reproduction.md` § Best-effort fallback](./reproduction.md#best-effort-fallback) (race / production-only / Heisenbug) or rows 7–8 of the layer routing table (visual / performance). The [Phase 5 reproduction gate](../SKILL.md#step-5a--reproduction-gate-mechanical) runs a deterministic check on the bug-notes ledger's `## Reproduction (Phase 2.5)` section before any dispatch and fails-closed when the closed list is not satisfied. "Small diff", "pattern exercised elsewhere", "scaffolding overhead", and "would duplicate the fix" are forbidden self-justifications per [`reproduction.md` § Forbidden reasons to skip Phase 2.5](./reproduction.md#forbidden-reasons-to-skip-phase-25). No force-proceed below this gate.
- **Phase 6 dispatch and Phase 7 verification are mechanically required and bypass-resistant.** Implementation work runs **only** in the `fix/<slug>` worktree, in this session (Step 6b) or a user-requested `aw-executor` — never on a protected branch. The [Phase 6.pre branch pre-flight assertion](../SKILL.md#step-6pre--branch-pre-flight-assertion-mechanical) fails-closed when the agent reaches Phase 6 on a protected trunk branch (`main` / `master` / `develop` / `trunk`); the [Phase 7.pre draft PR assertion](../SKILL.md#step-7pre--draft-pr-assertion-mechanical) fails-closed when no draft PR exists for the current branch. Direct commits to protected branches and skipping verification on "small diff" or "diff-sanity grading only" grounds are forbidden. No force-proceed below either gate.
- **`--verify-deploy` requires a bug-notes ledger.** Without the ledger, the recovery handle is gone; the skill refuses rather than guessing.
- **`fix-bug-lessons` are advisory-only.** A lesson biases triage / repro-layer / analysis from prior misfires but must never relax a confidence gate, the Phase 5 thresholds, the reproduction gate, Phase 7 verification, or any hard invariant above. The only path from a lesson to a behavior change is a confidence-gated, user-approved `diagnose` apply; promotion requires `seen_count >= 3` (or an explicit `structural` tag). A diagnoser must never propose auto-applying lessons or promoting on one run. See [`self-improvement-loop.md`](./self-improvement-loop.md#entrenchment-guards).

---

## Artifacts

| File pattern                                  | Produced by                                                 | When                                                                |
| --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `.agent/{branch}/bug-notes.md`                | Created on first write (normally Phase 0.5 triage); every phase appends | Cross-cutting; survives compaction                      |
| `Complexity triage` section in bug-notes.md   | Phase 0.5                                                   | Append once; pre-flight may append a triage-upgrade note            |
| `repro/{short-bug-id}.{ext}`                  | Phase 2.5 (delegated to /tdd / e2e)                          | Reproduction lock                                                   |
| Evidence Record (section in bug-notes.md)     | Phase 2a                                                    | Seeded from Phase 1; immutable thereafter                           |
| Confidence trajectory table (in bug-notes.md) | Phase 4 (and re-runs)                                       | Append on every gate evaluation                                     |
| Bug-fix-pack                                  | Phase 6 standard-lane                                       | Seeds the six-Core brief via `aw-create-plan`                       |
| Fast-lane plan body                           | Phase 6 fast-lane                                           | Composed in `/fix-bug` and passed to `Skill("aw-create-plan", ...)` |
| `.agent/{branch}/plan.md`                     | `aw-create-plan` (both lanes)                                | Phase 6 — default mode, no `plan.v{N}.md` snapshot (opt-in only)    |
| Draft PR + commit history                     | Phase 6 Step 6b                                             | Phase 6                                                             |
| `## Verification` PR-body section             | `/fix-bug` Phase 7                                          | Phase 7 (both lanes)                                                |
| Phase 8 verification log                      | `telemetry-verification.md`                                 | Phase 8 (post-deploy)                                               |

`--analyse-only` runs produce only Phases 0–4 artifacts (no plan.md, no PR, no Phase 7, no Phase 8); diagnoses against analyse-only runs have a thinner evidence trail and the report should call that out. Triage (Phase 0.5) runs and is logged even in analyse-only mode.

---

## Lessons scope

- Backend: LoreKit `memory.*` tools (via the `lorekit-memory` skill).
- Bucket: tag `loop::fix-bug-lessons` + key namespace `fix-bug-lessons::<slug>` (fix-bug's own diagnostic-phase lessons; implementation-phase lessons live in `aw-lessons`)
- Scopes: `global` (universal bug classes) + `repo::{owner}/{repo}` (project-bound bug patterns)
- Read for evidence with: `memory.list { scope: "global", tags: ["loop::fix-bug-lessons"], limit: 50 }` (and the `repo::{owner}/{repo}` scope for project-bound lessons)

Diagnose Step 2 loads promotion-eligible lessons (the store's own `seen_count >= 3`, or the `status::structural` tag) as evidence — keyed by `bugClass` + input shape. See [`self-improvement-loop.md`](./self-improvement-loop.md).

---

## Validators

- `claude plugin validate skills/workflow/fix-bug` — frontmatter + structure check.
- Re-run the failing repro on the diagnosed branch — confirms the proposed change addresses the original failure.
- Inspect `.agent/{branch}/bug-notes.md` after applying a diagnosis diff — the ledger should still parse and every phase's append section should remain intact.
