---
title: 'Brief ↔ Executor Handoff'
impact: HIGH
tags:
  - brief
  - executor
  - handoff
  - phase-boundary
---

# Brief ↔ Executor Handoff

## Contents

- [Overview](#overview)
- [Handoff contract](#handoff-contract)
- [Refinement contracts (caller-specified)](#refinement-contracts-caller-specified)
- [Handoff message format](#handoff-message-format)
- [Edit-driven iteration loop](#edit-driven-iteration-loop)
- [Receiving handoff (executor entry point)](#receiving-handoff-executor-entry-point)
- [What the brief writer DOES NOT do](#what-the-brief-writer-does-not-do)
- [What the executor DOES NOT do](#what-the-executor-does-not-do)
- [References](#references)

## Overview

In the **Full tier**, two parties are connected by one artifact (Micro/Lite run single-pass and never reach this handoff):

- **The brief writer** — the `aw` dispatcher in the caller's context ([`aw/rules/full-tier.md`](../aw/rules/full-tier.md)), or an orchestrator such as `/fix-bug`, runs phases 0–2: validation, a short look at the code, the worktree, and `plan.md` + sealed `checks.yaml` via [`aw-create-plan`](../../aw-create-plan/SKILL.md).
- **The executor** ([`templates/aw-executor.agent.md`](../templates/aw-executor.agent.md)) runs phases 3–7: implementation, review, testing, docs, PR, CI. By default the brief writer plays this role in the same session ([`full-tier.md` Step 2](../aw/rules/full-tier.md#step-2--work-here-until-the-checks-pass)); the `aw-executor` agent runs it only for an explicit background or parallel request.

The handoff happens at the **Phase 2 → Phase 3 boundary**, mediated by `plan.md` and gated by deterministic validation, not by an LLM confidence score.
**Why:** [`aw/references/dispatcher-rationale.md`](../aw/references/dispatcher-rationale.md#full-tier-short-brief-work-in-session-review-after).

---

## Handoff contract

Two artifacts cross the boundary, with distinct jobs:

- **`checks.yaml` is the living contract** — one executable check per `AC-{n}`, immutable fields sealed in `checks.lock`. The executor's Phase 4 [Executable Checks Loop](./phase-4-testing.md#executable-checks-loop) gates on the `run-checks.mjs` sentinel line.
- **`plan.md` is the brief** — what changes, what must not change, and what done looks like. It is self-contained but lean; the executor discovers the details while it works.

**Core — the brief, always present, in this order:**

| Section | Purpose |
| --- | --- |
| Task | 1–3 sentences: what changes, why, what done looks like. The human-review surface. |
| Requirements | Tagged list (`[user-stated]` / `[inferred]`) with an Out of Scope subsection, numbered by position (R1, R2, …) |
| Guardrails | What must not change: out-of-bounds paths, preserved interfaces and behaviour, forbidden moves. Every file outside File Changes is out of bounds. |
| Acceptance Criteria (Definition of Done) | `AC-{n}` items with `(covers: R{m})`, mirrored 1:1 into `checks.yaml`; the After-editing and Before-PR commands; done = `CHECKS M/M PASS` |
| Turn Cap | The turn budget that bounds the `/goal` line ([`goal-emission.md`](./goal-emission.md)) |
| File Changes | Action / File / Change / Reason — the only files the executor may touch; for a boundary task, every entry point found by [correction C2](./corrections.md#c2--enumerate-every-entry-point-of-a-boundary) |

**Extended** sections and their triggers live in `aw-create-plan`'s `rules/extended-sections.md`; the executor never bails because an Extended section is absent.

The brief crosses the boundary only when every validation below passes:

- The six Core headings are present: `grep -cE '^## (Task|Requirements|Guardrails|Acceptance Criteria|Turn Cap|File Changes)' plan.md` prints 6.
- The `AC-{n}` count in `plan.md` equals the `- id: AC-` count in `checks.yaml`, and `checks.lock` exists.
- Every `[user-stated]` requirement is covered by a `(covers: R{m})` annotation ([correction C1](./corrections.md#c1--every-stated-requirement-and-default-is-a-check)).
- File paths in File Changes resolve in the worktree, except `create` rows.
- The After-editing and Before-PR commands are concrete (no placeholders).

A failed validation is fixed in the brief and re-run; it is never waived.

---

## Refinement contracts (caller-specified)

Orchestrators that write the brief may attach a **refinement contract**.
When present, the brief includes the contract verbatim in `plan.md` and the executor honours it during Phase 3 implementation.

A refinement contract is generic — this skill does not specify what is checked or how the executor refines. The orchestrator owns the semantics; this skill owns delivery. A contract specifies:

| Field | Meaning |
|-------|---------|
| **Check** | A command or condition the executor runs after each implementation edit (e.g., a failing reproduction test, a property test, a benchmark threshold). |
| **On-failure action** | What the executor does when the check fails — typically: capture evidence verbatim, append it to a [caller-supplied context artefact](./artifacts-overview.md#caller-supplied-context-artefacts), and refine the implementation using the captured evidence as concrete input. |
| **Round cap** | Maximum refinement rounds before escalation (typically 3 — beyond which the executor stops and surfaces the failed evidence rather than guessing). |
| **Escalation path** | Where the executor returns when the cap is hit — usually `confidence(analysis)` or back to the orchestrator. |

The pattern descends from counterexample-guided synthesis (CEGIS) — the failing input from a check is more valuable feedback than the boolean check result, so refinement should consume the input directly. See [LLM-CEGIS-Repair (AAAI 2025)](https://github.com/pmorvalho/LLM-CEGIS-Repair) for the formal treatment; reports +15-30% on Defects4J vs single-shot generation.

### Canonical example: `/fix-bug` CEGIS contract

`/fix-bug` Phase 6 attaches the following contract to its brief:

- **Check**: run the reproduction test (`<repro_command>`) after each implementation edit.
- **On-failure action**: capture the failing input/output verbatim, append to the bug-notes ledger under `Counterexamples`, refine the patch using the captured input.
- **Round cap**: 3.
- **Escalation path**: re-run `Skill("confidence", "analysis fix")` and return to the orchestrator with the failed evidence.

Full contract at [`/fix-bug rules/autonomous-handoff.md`](../../fix-bug/rules/autonomous-handoff.md#step-6c--cegis-refinement-contract).

This skill does not parse the check or evaluate refinement quality — it only carries the contract from the brief to the executor through `plan.md`.

---

## Handoff message format

**Anchor:** `handoff-message-format`

After validation passes, the brief writer prints this block, then dispatches the executor without waiting (the user can interrupt; `--no-confirm` only skips Phase 0's wait):

```
✓ Brief ready
- Path: .agent/{branch}/plan.md
- Version: N (frontmatter)
- Worktree: <path>
- Files to change: N
- Acceptance Criteria: M items
- Checks: .agent/{branch}/checks.yaml (M checks: K command/grep, J judge; sealed)
- UI: yes — the executor writes and runs specs.md after the UI exists (C5) | no
- Goal: <the one-line /goal built per goal-emission.md>
```

When the user replies `iterate` (or edits `plan.md` before or after a run), follow the edit-driven iteration loop below.

---

## Edit-driven iteration loop

**Anchor:** `edit-driven-iteration-loop`

`iterate` is the **user-edit-driven** refinement path: the user has edited `plan.md` (or left `<!-- ... -->` notes in it), and the file is the new constraint set.

1. **Read `plan.md`** in the worktree end-to-end and parse the `version:` frontmatter field (missing → `0`).
2. **Collect every user feedback comment.** Walk each `<!-- ... -->` block and treat any directive, conversational, or critical one ("use Y instead", "this is wrong because…") as a **hard constraint**; ignore the template's instructional comments.
   In snapshot mode ([`aw-create-plan/rules/snapshot-mode.md`](../../aw-create-plan/rules/snapshot-mode.md)), diff against the latest `plan.v*.md` to separate the two kinds.
3. **Print the detected edits and every comment** with its section and how it will be addressed. State `Detected inline comments: none` explicitly when there are none — silence means the scan was skipped.
4. **Re-derive downstream sections.** An edited Task, Requirements, or Guardrails section re-derives Acceptance Criteria and File Changes; a downstream edit that contradicts an upstream one is surfaced and asked about.
5. **Write version N+1** via `aw-create-plan`, which re-derives and re-seals `checks.yaml`; log the edits and the comments addressed in the Progress Log.
6. **Re-run the validation** from [Handoff contract](#handoff-contract) and re-print the handoff message.

The loop has no iteration cap — each round is user-initiated.

---

## Receiving handoff (executor entry point)

At the start of Phase 3, `aw-executor`:

1. Confirms the worktree: `git branch --show-current` matches the `.agent/{branch}/` path.
2. Reads `plan.md` and `checks.yaml` end to end, and [`corrections.md`](./corrections.md).
3. Logs the takeover to the Progress Log with a full ISO 8601 timestamp:

   ```markdown
   - [2026-04-29T15:30:00Z] Phase 3: executor took over (brief version N, M checks sealed)
   ```

### Bail conditions

If any of the following holds, the executor STOPS without writing code and replies verbatim:

> "no brief to execute — run aw first"

| Condition                       | Detection                                                  |
| ------------------------------- | ---------------------------------------------------------- |
| `plan.md` missing               | `cat` returns "No such file or directory"                  |
| `plan.md` malformed             | Fewer than the six Core headings, and not a `/fix-bug` fast-lane plan (which keeps the eight pre-brief headings: TL;DR, Requirements, Decisions, Acceptance Criteria, Implementation Order, File Changes, Verification, Progress Log) |
| Acceptance Criteria empty       | Section exists but has no bullets                          |
| Wrong worktree                  | Branch name doesn't match `.agent/{branch}/` path          |

---

## What the brief writer DOES NOT do

| Forbidden action                         | Why                                                                |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Write production code                    | That's Phase 3, the executor's job                                 |
| Run tests or open PRs                    | Phases 4 and 6                                                     |
| Write `specs.md`                         | The executor writes it after the UI exists ([C5](./corrections.md#c5--a-ui-spec-is-written-against-the-built-ui-and-run)) |
| Edit source while the executor runs      | One writer per worktree                                            |

**Allowed:** up to two `Explore` sub-agents for an unfamiliar area — they produce context, not code.

---

## What the executor DOES NOT do

| Forbidden action                                | What to do instead                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Re-run Phase 0 on the prompt                     | The brief is the answer. If it is unclear, escalate to the user.    |
| Silently change a requirement, guardrail, or AC  | Escalate to the user; record the answer in `plan.md` and re-seal via `aw-create-plan`. |
| Skip the worktree check                          | Verify it is inside the right worktree even though the brief writer created it. |

If the executor discovers mid-implementation that the brief is wrong, it follows the [Phase 4 stuck-loop protocol](./companion-skills.md#stuck-loop-protocol-phase-4), not silent improvisation.

---

## References

- Full-tier procedure: [`aw/rules/full-tier.md`](../aw/rules/full-tier.md)
- Phase rules: [phase-1-planning.md](./phase-1-planning.md), [phase-2-worktree.md](./phase-2-worktree.md), [phase-3-implementation.md](./phase-3-implementation.md)
- Corrections: [corrections.md](./corrections.md)
- Companion registry: [companion-skills.md](./companion-skills.md)
- Architecture research: [`references/anthropic-architecture-research.md`](../references/anthropic-architecture-research.md)
- Executor: [`templates/aw-executor.agent.md`](../templates/aw-executor.agent.md)
