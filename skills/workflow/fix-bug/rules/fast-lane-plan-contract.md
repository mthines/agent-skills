---
title: Fast-Lane Plan Contract — plan.md Shape for Direct aw-executor Dispatch
impact: HIGH
tags:
  - fast-lane
  - plan-md
  - aw-create-plan
  - aw-executor
  - bypass-planner
---

# Fast-Lane Plan Contract

Loaded by Phase 6 of `/fix-bug` when triage picked `simple` AND
`confidence(analysis) ≥ 92 %`. Defines the minimum `plan.md` shape that
`/fix-bug` must produce — via `Skill("aw-create-plan", ...)` — for
`aw-executor` to consume without `aw-planner` ever running.

The contract exists because `aw-executor` expects a plan.md written to the
autonomous-workflow shape; without aw-planner in the loop, `/fix-bug` is the
author. The structural requirements below match what aw-planner would have
produced, minus the planner's deep architectural analysis (which a simple bug
does not need).

Source: [autonomous-workflow Phase 2 plan-artifact spec](../../autonomous-workflow/SKILL.md)
— the plan.md shape aw-executor reads from.

## Contents

- [When this rule loads](#when-this-rule-loads)
- [Required sections](#required-sections)
- [Section-by-section spec](#section-by-section-spec)
- [Worktree + invocation sequence](#worktree--invocation-sequence)
- [What the contract intentionally omits](#what-the-contract-intentionally-omits)
- [Hard invariants](#hard-invariants)

---

## When this rule loads

Phase 6 fast-lane only. The complex path uses the existing bug-fix-pack →
aw-planner flow and never touches this rule.

Preconditions checked by Phase 6 step 6a before this rule loads:

1. Phase 0.5 triage classified the bug as `simple`.
2. Phase 4 confidence gate cleared at ≥ 92 %.
3. Phase 2b produced a non-best-effort failing reproduction (best-effort
   repros fall back to standard-lane — fast-lane requires a real
   `FAIL_TO_PASS` contract).
4. The worktree does **not** yet exist — `/fix-bug` creates it as part of
   this rule's procedure.

If any precondition fails, route to standard-lane and log the reason.

---

## Required sections

`plan.md` for the fast-lane MUST have these sections, in this order:

1. **Title** — one-line bug summary (matches PR title)
2. **Branch + worktree** — `fix/<slug>` and `.agent/fix/<slug>/`
3. **Symptom** — verbatim from Evidence Record
4. **Bug class** — from Phase 0
5. **Reproduction** — repro path, command, status
6. **Root cause** — from in-skill lightweight analysis (NOT holistic-analysis)
7. **Proposed change** — file + line + before/after sketch
8. **CEGIS refinement contract** — verbatim (see [Section spec](#section-by-section-spec))
9. **FAIL_TO_PASS contract** — the repro test name + expected failure mode
10. **PASS_TO_PASS contract** — list of test files that must continue to pass
11. **Bug-notes ledger pointer** — path + read/append discipline reminder
12. **Confidence trajectory** — analysis score + breakdown
13. **Out of scope** — explicit list of what NOT to touch
14. **Done criteria** — when aw-executor opens the draft PR

`plan.vN.md` is written alongside per the `aw-create-plan` contract — same
content, immutable snapshot.

---

## Section-by-section spec

### 1. Title

```markdown
# Fix: <one-line summary, ≤ 70 chars>
```

The line is the PR title. Use the same phrasing as the bug-notes ledger's
`Symptom` field, compressed.

### 2. Branch + worktree

```markdown
## Branch + worktree

- Branch: `fix/<slug>`
- Worktree: `.agent/fix/<slug>/`
- Base: `main`
- Created by: `/fix-bug` fast-lane (no aw-planner)
```

### 3. Symptom

Copy the Evidence Record's `Symptom` paragraph verbatim. Do not paraphrase —
the verifier (Phase 7) checks this against the Evidence Record.

### 4. Bug class

Single line: `Bug class: <bugClass from Phase 0>`.

### 5. Reproduction

```markdown
## Reproduction

- Path: `repro/<short-id>.<ext>`
- Command: `<exact command>`
- Expected on HEAD (no fix): FAIL because `<one-line reason>`
- Expected after fix: PASS
```

If the repro is best-effort, the precondition check above fails — this
section will never carry a best-effort repro on the fast-lane.

### 6. Root cause

One paragraph, written by `/fix-bug` itself during the simple-path
lightweight analysis (see
[`complexity-triage.md`](./complexity-triage.md#what-simple-actually-skips)).
The shape matches what `holistic-analysis` produces for the complex path:

```markdown
## Root cause

<One paragraph describing what is broken, where, and why the proposed fix
addresses it. Reference the suspect file + line. State one falsifiable
prediction the repro confirms.>
```

The paragraph must include a `Falsifiable prediction:` line — the assertion
the repro is making. If the repro doesn't falsify a prediction, the bug
isn't actually well-understood and triage should not have picked `simple`.

### 7. Proposed change

```markdown
## Proposed change

### File: `<path>:<line>`

Before:
\`\`\`<lang>
<3–5 lines of current code at the suspect site>
\`\`\`

After:
\`\`\`<lang>
<3–5 lines with the proposed change>
\`\`\`

Why this satisfies the repro:
<one or two sentences linking the change to the failing assertion>
```

For multi-line edits, list each `File` block. The fast-lane is **not**
limited to single-line patches — it's limited to bugs where the change is
**obvious from the suspect site**. A 20-line refactor in one function is
still simple if the cause is contained.

### 8. CEGIS refinement contract

Verbatim from [`bug-fix-pack.md`](../templates/bug-fix-pack.md) — same
3-round cap, same counterexample-append discipline. The aw-executor's
contract does not change between lanes.

```markdown
## CEGIS refinement contract

After each implementation edit:

1. Run the repro at `<path>` with `<command>`.
2. On PASS: continue to PASS_TO_PASS checks.
3. On FAIL: capture the failing input/output verbatim, append to
   `.agent/<branch>/bug-notes.md` under `Counterexamples`, refine the patch
   using the captured input as evidence, and re-run.
4. Cap at **3 refinement rounds**. After the third FAIL, stop refining and
   trigger the fast-lane round-3 fallback in
   [`autonomous-handoff.md`](./autonomous-handoff.md#fast-lane-round-3-fallback) —
   do NOT keep guessing.
```

### 9. FAIL_TO_PASS contract

```markdown
## FAIL_TO_PASS

- Test: `<repro path>::<test name>`
- Pre-fix: MUST FAIL with `<exact assertion or error message>`
- Post-fix: MUST PASS
- Verifier (Phase 7) re-runs this in a fresh context.
```

### 10. PASS_TO_PASS contract

```markdown
## PASS_TO_PASS

The following test files must continue to pass after the fix:

- `<test file 1>`
- `<test file 2>`
- …
```

The list is derived from the **affected files** in the Evidence Record:
every test that imports a changed file is a PASS_TO_PASS candidate. If the
test count exceeds 10, list the *suites* that must pass rather than
individual files — the executor expands suites at run time.

### 11. Bug-notes ledger pointer

```markdown
## Bug-notes ledger

- Path: `.agent/<branch>/bug-notes.md`
- Discipline: read on entry, append on exit. Append-only. See
  [`bug-notes-ledger.md`](./bug-notes-ledger.md).
- The ledger already contains: Phase 0 intake, Phase 0.5 triage, Phase 1
  evidence + pre-flight, Phase 2 Evidence Record + repro, Phase 4 confidence
  trajectory.
```

### 12. Confidence trajectory

```markdown
## Confidence (analysis)

- Evidence strength: <X%>
- Root cause certainty: <X%>
- Fix confidence: <X%>
- **Overall: <X%>** — cleared the ≥ 92 % fast-lane gate at Phase 4.
```

### 13. Out of scope

```markdown
## Out of scope

The executor must NOT:

- Modify any file outside the affected-files table in the Evidence Record
  without re-running confidence(analysis).
- Modify the repro file under `repro/` to make tests pass — verifier
  rejects this.
- Introduce new dependencies.
- Refactor neighbouring code that wasn't part of the failing path.
```

Add bug-specific out-of-scope items as needed. The list is the cheap
guardrail against scope creep on a "simple" fix.

### 14. Done criteria

```markdown
## Done

Executor opens a draft PR when:

1. FAIL_TO_PASS test passes.
2. All PASS_TO_PASS tests/suites pass.
3. The diff touches only files listed in the affected-files table (plus the
   commit message + PR description).
4. Bug-notes ledger has been appended with Phase 6 fast-lane events
   (worktree creation, CEGIS rounds, final patch summary).

Verifier (Phase 7) decides undraft. Executor does NOT undraft.
```

---

## Worktree + invocation sequence

`/fix-bug` performs these steps in order — this **is** the fast-lane Phase 6
procedure that [`autonomous-handoff.md`](./autonomous-handoff.md#fast-lane)
references.

1. **Create the worktree.** Use `gw checkout fix/<slug>` per
   [`MEMORY.md`](/Users/mthines/.claude/projects/-Users-mthines-Workspace-dash0-git/memory/MEMORY.md).
   Capture the worktree path; it is `.agent/fix/<slug>/`.

2. **Move the bug-notes ledger.** If the ledger was initialised under the
   pre-worktree slug, copy it to `.agent/fix/<slug>/bug-notes.md` and update
   the canonical path. Append a `Phase 6 lane: fast-lane` entry.

3. **Invoke `aw-create-plan`.** Pass the fast-lane plan content in the
   skill prompt:

   ```text
   Skill("aw-create-plan", "<full plan.md body per this contract>")
   ```

   `aw-create-plan` writes `.agent/fix/<slug>/plan.md` and the next
   `plan.vN.md` snapshot. It does NOT validate the plan body against this
   contract — that responsibility stays with `/fix-bug`.

4. **Validate the plan.md** — re-read the file and confirm all 14 required
   sections are present. If any are missing, fail with a clear error and do
   NOT dispatch the executor. The bug-notes ledger captures the failure.

5. **Dispatch `aw-executor`.** Use the Agent tool with
   `subagent_type: "aw-executor"` and `isolation: "worktree"` pointing at
   `.agent/fix/<slug>/`. Minimal prompt:

   ```text
   Execute the plan at .agent/fix/<slug>/plan.md in the current worktree.
   This plan was authored directly by /fix-bug (fast-lane); aw-planner did
   not run. The CEGIS refinement contract in the plan is binding.
   ```

6. **Return to** [`autonomous-handoff.md` step 6c](./autonomous-handoff.md#step-6c--report-back)
   for the status report.

---

## What the contract intentionally omits

These sections appear in the standard-lane bug-fix-pack but are NOT required
on the fast-lane:

| Omitted section | Why |
|------------------|-----|
| Architectural analysis | A simple bug by definition does not have one — the suspect site is the architecture. |
| Cross-module dependency map | Same reason; the affected-files table covers the scope. |
| Migration / backwards-compat plan | A null check or off-by-one doesn't migrate anything. |
| Rollout staging | The executor's draft-PR + verifier flow is the rollout. |
| Documentation update plan | If docs need updating, that is `complex` by definition — triage should have caught it. |

If the lightweight analysis surfaces any of these as needed, **escalate to
standard-lane** — that is the signal the bug was not actually simple.

---

## Hard invariants

The diagnoser at [`/create-skill diagnose fix-bug`](../../../authoring/create-skill/SKILL.md#diagnose-workflow)
must not propose to relax any of these without explicit user confirmation:

- **Fast-lane requires confidence ≥ 92 %.** The threshold is the substitute
  for aw-planner's `confidence(plan) ≥ 90 %` gate that fast-lane bypasses.
  Lowering the threshold without re-introducing planner would leave only two
  independent confidence gates instead of three.
- **Fast-lane requires a non-best-effort repro.** The repro IS the
  executor's contract; without it, there's nothing to gate CEGIS on.
- **`/fix-bug` validates plan.md before dispatching the executor.** The
  contract is unenforced if the validator step is skipped.
- **Round-3 CEGIS failure on fast-lane falls back to standard-lane.** The
  fallback is the safety net for "triage classified simple but the bug
  wasn't." See [`autonomous-handoff.md`](./autonomous-handoff.md#fast-lane-round-3-fallback).
- **The verifier (Phase 7) is identical for both lanes.** Fresh context,
  same four checks, only the verifier may undraft. No lane-specific
  loosening.
