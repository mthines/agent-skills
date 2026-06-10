---
title: Independent Verification — Fresh-Context Verifier Before PR Open
impact: HIGH
tags:
  - verification
  - verifier-agent
  - fail-to-pass
  - pass-to-pass
  - separation-of-concerns
---

# Independent Verification

Phase 7. Runs after the executor has implemented the fix and before the PR is opened for review
(the executor opens the PR as draft; the verifier decides whether to undraft). The verifier is a
**separate agent in a fresh context** with no access to the planner's or executor's reasoning —
this prevents the well-documented self-grading bias in single-agent loops.

Source: [Effective harnesses for long-running agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
— "separating generation from evaluation into distinct agents outperforms self-evaluation,
because agents reliably skew positive when grading their own work."

## Contents

- [When this phase runs](#when-this-phase-runs)
- [Verifier inputs](#verifier-inputs)
- [Verifier checks](#verifier-checks)
- [Outcomes](#outcomes)

---

## When this phase runs

Runs only when **all** hold:

- Phase 6 dispatched `aw-executor` via **either lane** — fast-lane (`/fix-bug` → `aw-create-plan` → `aw-executor`, no aw-planner) or standard-lane (`aw-planner` → `aw-executor`) — and the executor opened a draft PR. Verification is identical for both lanes.
- Phase 5 was in default mode (not `--analyse-only`).
- A valid (non-best-effort) repro exists from Phase 2.5.

Skipped (with explicit log) when:

- The repro is best-effort only — the verifier has no `FAIL_TO_PASS` contract to check. Fall back
  to a manual checklist in the bug-notes ledger.

---

## Verifier inputs

Spawn the verifier with `subagent_type: "bug-fix-verifier"` and `isolation: "worktree"` pointing
at the executor's worktree.

Pass **only** these inputs — explicitly NOT the planner's `plan.md` or the executor's reasoning:

```text
You are verifying a bug fix. You have NO access to the planner's or executor's reasoning by
design — your job is independent grading.

## Inputs
- Evidence Record: <attach>
- Reproduction:
  - Path: <repro path>
  - Command: <repro command>
  - Expected: failing on base branch, passing on PR head
- Bug-notes ledger (read-only): <path to .agent/<branch>/bug-notes.md>
- PR diff: <PR URL or diff>
- Test command: <project's full test command, e.g. "pnpm test">

## Required output
A verdict: green / red, plus the evidence below.
```

The verifier agent definition lives at [`agents/bug-fix-verifier.md`](../../../../agents/bug-fix-verifier.md).

---

## Verifier checks

The verifier runs four checks in order. Stop on the first red.

| # | Check | Command | Pass condition |
|---|-------|---------|----------------|
| 1 | `FAIL_TO_PASS` | Run the repro on the PR head | Exit 0 (was non-zero on base) |
| 2 | `PASS_TO_PASS` | Run the project's full test suite on the PR head | No previously-passing test now fails |
| 3 | Diff sanity | Read the PR diff | No catch-all `try/except: pass`, no `console.log` / `print()` debug statements, no `// TODO`, no test deletions, no `.skip` / `.only` flags |
| 4 | Repro integrity | Inspect the diff for changes to `repro/` | The repro itself was not weakened (assertion not loosened, expected value not changed to match buggy behaviour) |

Sources for checks 1 and 2: SWE-bench Verified harness — every patch must satisfy both. Source
for checks 3 and 4: practitioner consensus on common AI-agent anti-patterns (e.g., "fix the test,
not the bug").

---

## Outcomes

### Green (all four checks pass)

1. Run `gh pr ready <PR>` to undraft the PR.
2. Append to the bug-notes ledger:

   ```markdown
   ### Verification (Phase 7)
   - FAIL_TO_PASS: pass
   - PASS_TO_PASS: pass (N tests, all green)
   - Diff sanity: pass
   - Repro integrity: pass
   - Verdict: green
   ```

3. Continue to Phase 8 (telemetry verification) if the input was a telemetry source. Else report
   success.

### Red (any check failed)

1. Leave the PR as draft.
2. Append the verifier's evidence to the bug-notes ledger as `counterexamples`.
3. Surface to the user with the failing check, the evidence, and three options:
   - **refine** — re-spawn `aw-executor` with the verifier's findings appended to `plan.md`.
     Cap at 3 refinement rounds (per the CEGIS contract in
     [`autonomous-handoff.md`](./autonomous-handoff.md)).
   - **escalate** — re-run `Skill("confidence", "analysis fix")` on the failed verification
     to surface root-cause concerns.
   - **abandon** — close the PR draft, return the bug-notes ledger as the artefact.

Do **not** auto-merge or auto-undraft on red.
