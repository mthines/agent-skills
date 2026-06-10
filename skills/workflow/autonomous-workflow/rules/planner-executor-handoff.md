---
title: 'Planner ↔ Executor Handoff'
impact: HIGH
tags:
  - planner
  - executor
  - handoff
  - confidence
  - phase-boundary
---

# Planner ↔ Executor Handoff

## Contents

- [Overview](#overview)
- [Why this boundary](#why-this-boundary)
- [Handoff contract](#handoff-contract)
- [Refinement contracts (caller-specified)](#refinement-contracts-caller-specified)
- [Handoff message format](#handoff-message-format)
- [Edit-driven iteration loop](#edit-driven-iteration-loop)
- [Receiving handoff (executor entry point)](#receiving-handoff-executor-entry-point)
- [What the planner DOES NOT do](#what-the-planner-does-not-do)
- [What the executor DOES NOT do](#what-the-executor-does-not-do)
- [References](#references)

## Overview

In the **Full tier**, the autonomous-workflow runs as two agents connected by a
single artifact (the `aw` dispatcher routes Full tasks here; Micro/Lite run
single-pass and never reach this handoff):

- **Planner agent** ([`templates/planner.template.md`](../templates/planner.template.md)) — runs phases 0–2 (validation, planning, worktree + `plan.md` generation).
- **Executor agent** ([`templates/executor.template.md`](../templates/executor.template.md)) — runs phases 3–7 (implementation, testing, docs, PR, CI).

This split follows Anthropic's "context boundary" principle — separating exploration-heavy work (Phase 0–2) from execution-heavy work (Phase 3–7) keeps each agent's context window focused and avoids polluting implementation decisions with planning dead-ends. See [`references/anthropic-architecture-research.md`](../references/anthropic-architecture-research.md) for the underlying research.

The handoff happens at the **Phase 2 → Phase 3 boundary**, mediated by `plan.md` and gated by `confidence(plan) ≥ 90%`.

---

## Why this boundary

At the end of Phase 2, the planner has produced a gated, self-contained artifact (`plan.md`) inside the worktree. Everything the executor needs is in that file. Splitting here yields three concrete benefits:

| Benefit                          | What it buys                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Clean context reset**          | The planner's exploration history (parallel `Explore` reports, rejected designs, dead ends) does not pollute the executor's working context. |
| **User checkpoint**              | When `confidence(plan) < 90%`, the user is naturally placed in the loop before any code is written. The handoff is the friction point. |
| **Independent re-runnability**   | Replan without losing implementation context (start a fresh planner session), or rerun the executor against the same plan (e.g. on a different branch / fork). |

Phases 0–2 are also the cheapest to redo — no code has been written, no PR exists. Phase 3+ accumulates cost (commits, CI runs). Putting the boundary here minimizes wasted work when a plan turns out to be wrong.

---

## Handoff contract

`plan.md` is the contract. The executor's **only** input is this file plus the worktree it lives in. The [`aw-create-plan`](../../aw-create-plan/SKILL.md) template is two-tier: **Core** sections are always present; **Extended** sections appear only when their `Include when` trigger holds. The executor must not bail because an Extended section is absent — its omission is intentional.

**Core sections — always present:**

| Section                | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| TL;DR                  | 3-5 sentences: what / why / approach (HOW) / done. Human-review surface — readers verify direction here before approving the planner→executor handoff. |
| Requirements           | Tagged list (`[user-stated]` / `[inferred]`), with an Out of Scope subsection |
| Decisions              | Each decision + alternatives considered + rationale               |
| Acceptance Criteria    | Bullet list — the contract Phase 4 testing gates against          |
| Implementation Order   | Numbered sequence the executor follows verbatim                   |
| File Changes           | Action / File / Change / Reason table                             |
| Verification           | Commands for fast-check (after edit) and broad-check (before PR)  |
| Progress Log           | Append-only log of every phase milestone                          |

**Extended sections — present only when the task needs them:**

| Section                | Included when                                                     |
| ---------------------- | ----------------------------------------------------------------- |
| Background & Context   | The "why" is not self-evident from the TL;DR                       |
| Technical Approach     | Architectural / multi-component change (high-level only)          |
| Patterns to Follow     | A non-obvious existing convention must be matched                 |
| Edge Cases             | Non-trivial edge / error cases beyond the Acceptance Criteria     |
| API / Interfaces       | A public interface / type / config shape is defined or changed    |
| Tests                  | Test design is non-obvious beyond Acceptance Criteria + Verification |
| Dependencies           | A dependency is added, removed, or upgraded                       |
| Risks                  | High complexity, migration, or irreversible operation             |

All multi-signal `confidence(plan)` rule checks must pass:

- All eight Core sections are present
- File paths in the File Changes table resolve in the worktree
- Requirements are tagged (must / nice / out-of-scope)
- Acceptance Criteria section is non-empty
- Implementation Order is numbered and references actual files
- Verification commands are concrete (no placeholders)

If any check fails, the gate fails and the planner enters the iterate-or-escalate flow described in [`phase-1-planning.md#confidence-gate`](./phase-1-planning.md#confidence-gate).

---

## Refinement contracts (caller-specified)

Orchestrators that invoke `aw-planner` may attach a **refinement contract** to the planner pack. When present, the planner includes the contract verbatim in `plan.md` and the executor honours it during Phase 3 implementation.

A refinement contract is generic — this skill does not specify what is checked or how the executor refines. The orchestrator owns the semantics; this skill owns delivery. A contract specifies:

| Field | Meaning |
|-------|---------|
| **Check** | A command or condition the executor runs after each implementation edit (e.g., a failing reproduction test, a property test, a benchmark threshold). |
| **On-failure action** | What the executor does when the check fails — typically: capture evidence verbatim, append it to a [caller-supplied context artefact](./artifacts-overview.md#caller-supplied-context-artefacts), and refine the implementation using the captured evidence as concrete input. |
| **Round cap** | Maximum refinement rounds before escalation (typically 3 — beyond which the executor stops and surfaces the failed evidence rather than guessing). |
| **Escalation path** | Where the executor returns when the cap is hit — usually `confidence(analysis)` or back to the orchestrator. |

The pattern descends from counterexample-guided synthesis (CEGIS) — the failing input from a check is more valuable feedback than the boolean check result, so refinement should consume the input directly. See [LLM-CEGIS-Repair (AAAI 2025)](https://github.com/pmorvalho/LLM-CEGIS-Repair) for the formal treatment; reports +15-30% on Defects4J vs single-shot generation.

### Canonical example: `/fix-bug` CEGIS contract

`/fix-bug` Phase 6 attaches the following contract to its bug-fix pack:

- **Check**: run the reproduction test (`<repro_command>`) after each implementation edit.
- **On-failure action**: capture the failing input/output verbatim, append to the bug-notes ledger under `Counterexamples`, refine the patch using the captured input.
- **Round cap**: 3.
- **Escalation path**: re-run `Skill("confidence", "analysis fix")` and return to the orchestrator with the failed evidence.

Full contract at [`/fix-bug rules/autonomous-handoff.md`](../../fix-bug/rules/autonomous-handoff.md#step-6c--cegis-refinement-contract).

This skill does not parse the check or evaluate refinement quality — it only carries the contract from planner to executor through `plan.md`. New orchestrators with their own refinement loops (property-based testing, benchmark-driven optimisation, eval-driven iteration) follow the same shape: declare the four fields in your pack, document the loop in your skill's rules, let `aw-planner` and `aw-executor` deliver it unmodified.

---

## Handoff message format

**Anchor:** `handoff-message-format`

At the end of Phase 2, the planner outputs **one** of the two messages below — never both, never something else.

### High-confidence (auto-handoff ready)

```
✓ Plan ready
- Path: .agent/{branch}/plan.md
- Version: N (frontmatter)
- Confidence: X% (passed gate)
- Worktree: <path>
- Files to change: N
- Acceptance Criteria: M items

Reply with one of:
- "execute" / "continue" — dispatch the executor.
- "review" — inspect the plan first.
- "iterate" — edit plan.md directly in your editor, then reply
  "iterate" to have the planner read your edits, re-run the gate, and
  bump plan.md to version N+1. You can also leave inline notes as HTML
  comments (<!-- ... -->) anywhere in plan.md — the iterate loop scans
  for them and treats each one as a hard constraint. See "Edit-driven
  iteration loop" below.
```

The planner then **STOPS**. It does not auto-invoke the executor. The user (or main session) sees the message and decides whether to dispatch.

### Below-gate (user must approve)

```
⚠️ Plan confidence below 90%
- Path: .agent/{branch}/plan.md
- Version: N (frontmatter)
- Confidence: X% (Y/Z rule checks failed)
- Concerns:
  1. <concern from confidence output>
  2. ...

Choose:
- refine — planner does up to 2 more research iterations (planner-driven).
- iterate — edit plan.md yourself, then reply "iterate" (user-edit-driven;
  inline <!-- ... --> comments are picked up as hard constraints; see
  "Edit-driven iteration loop" below).
- proceed — accept and dispatch executor anyway (NOT recommended).
- stop — abandon.
```

The planner **STOPS** and waits for the user's choice. `refine` re-enters Phase 1 research for **up to 2 more iterations** (matching the planner template's pre-escalation retry budget); if still below 90% after those, the planner escalates again with the same below-gate message — no infinite refine loop. `proceed` falls through to the high-confidence handoff message (with the lower score logged); `stop` removes the worktree (Phase 7 cleanup) or leaves it for manual inspection.

---

## Edit-driven iteration loop

**Anchor:** `edit-driven-iteration-loop`

`iterate` is the **user-edit-driven** refinement path. It is distinct from:

- The confidence-retry loop inside Phase 1 ([`phase-1-planning.md#confidence-gate`](./phase-1-planning.md#confidence-gate)), which is planner-driven and re-runs research up to twice.
- The `aw-create-plan` skill's generic "iterate on plan" trigger, which is the artifact-write primitive consumed by this procedure.

The loop fires whenever the user replies `iterate` to either handoff message. The user has already done the editing — `plan.md` IS the new constraint set. Procedure:

1. **Read `plan.md`** in the worktree end-to-end. Trust the file: the user's edits are the new constraints.
2. **Parse the `version:` frontmatter field.** If missing, treat as `0` (legacy plan written before this loop existed). The next write will be `version: <current + 1>`.
3. **Scan for inline user feedback (HTML comments).** Users leave inline notes as `<!-- ... -->` blocks anywhere in `plan.md`. **These are hard constraints — never skip them.** Two kinds of HTML comments coexist in the file:

   | Kind | Origin | Treat as |
   |------|--------|----------|
   | Template instructional comments | Carried in from the `aw-create-plan` template (e.g. `<!-- Why is this needed? ... -->`, `<!-- ALL requirements from Phase 0. ... -->`). Already addressed by the section content beneath them. | Ignore. |
   | User feedback comments | Added by the user inline to direct this iteration (e.g. `<!-- this also needs to handle the timeout case -->`, `<!-- use the existing logger, not a new one -->`). | **Hard constraint** — must be addressed in version N+1. |

   To separate them reliably, diff against the previous immutable snapshot — `aw-create-plan` guarantees one exists for every prior version ([`aw-create-plan/SKILL.md`](../../aw-create-plan/SKILL.md)):

   ```bash
   DIR=".agent/$(git branch --show-current)"
   PREV=$(ls "${DIR}"/plan.v*.md 2>/dev/null | sort -V | tail -n 1)
   if [ -n "${PREV}" ]; then
     diff -u "${PREV}" "${DIR}/plan.md" | grep -E '^\+.*<!--|^\+.*-->' || echo "(no new comments)"
   fi
   ```

   Every added line containing `<!--` or `-->` in that diff is user feedback introduced in this iteration. For each one, record the enclosing section heading, the comment text, and the apparent intent (e.g. "Acceptance Criteria → user comment: 'cover the offline case' → add an acceptance criterion for offline mode").

   If no previous `plan.v*.md` snapshot exists (rare — only when iterating before any prior version was written), walk every `<!-- ... -->` block and flag any whose content is **directive, conversational, or critical** ("change this", "make sure X", "use Y instead", "this is wrong because…"). Treat those as user feedback; ignore template instructional prose.

4. **Summarise what changed at the section level AND list every user comment.** Recap to the user, listing the sections that have moved relative to the planner's last-known mental model and **every** user feedback comment from step 3 with its location and how you plan to address it. Surface this summary before re-planning:

   ```
   Iterating on plan.md (version N → N+1).
   Detected edits:
   - Requirements: added "..."
   - Acceptance Criteria: removed "..."
   - Implementation Order: reordered steps 3 and 4

   Detected inline comments (HTML <!-- -->):
   - Acceptance Criteria → "cover the offline case"
       → will add an acceptance criterion for offline mode
   - File Changes → "use the existing logger, not a new one"
       → will reuse src/lib/logger.ts instead of adding a new module

   Re-running planning with your edits AND comments as constraints.
   Reply "cancel" to abort before the new version is written.
   ```

   If there are zero detected comments, state "Detected inline comments: none" explicitly — silence on this line is a bug (it means the scan was skipped). The new `plan.v{N+1}.md` must address every listed comment; the comments themselves are NOT carried forward to the new version (they've been incorporated into the content).

5. **Consistency check inside `plan.md`.** Walk the file and check internal coherence:
   - If the user edited an upstream section (Requirements, Decisions, Technical Approach) but did NOT correspondingly update a downstream section (Implementation Order, File Changes, Tests), **re-derive the downstream sections** rather than blindly preserving them. State the inferred downstream changes back to the user.
   - If the user edited a downstream section in a way that contradicts an upstream section, **surface the contradiction** and ask whether to update the upstream section, revert the downstream edit, or accept both as-is.
   - Apply the same coherence check to every user feedback comment from step 3 — a comment in `Acceptance Criteria` that contradicts the `Requirements` section is a contradiction, not just a comment.
6. **Re-run planning companions** with the user's edits and comments as constraints:
   - `Skill("code-quality", "plan")` — surface design concerns introduced by the edits.
   - `Skill("confidence", "plan")` — re-score the revised plan against the multi-signal gate.
7. **Invoke `aw-create-plan`** to write `plan.md` with `version: N+1` in the frontmatter. The Progress Log entry for this write MUST cite the user's edits AND the comments addressed:

   ```markdown
   - [{TIMESTAMP}] Phase 2: plan.md updated to version {N+1} (user-edit iteration — {short summary of changed sections}; addressed K inline comment(s): {one-line list})
   ```

8. **Re-emit the handoff message** (high-confidence or below-gate, based on the new `confidence(plan)` score). The user can iterate again, accept, or stop.

### Iteration cap

There is no hard cap on edit-driven iterations — they are user-initiated and each one produces a fresh confidence score and a fresh version. The user is in the loop on every round, so the runaway-iteration failure mode does not apply.

### What this loop does NOT do

- It does not silently accept user edits and skip the confidence gate. Every iteration re-runs `confidence(plan)`.
- It does not produce additional files. `plan.md` is the single source of truth; the `version:` frontmatter field is the durable iteration counter.
- It does not start writing production code. The planner agent's scope still ends at the handoff message.

---

## Receiving handoff (executor entry point)

At the start of Phase 3, the **aw-executor agent**:

1. **Confirms it's inside the worktree.**

   ```bash
   pwd
   git branch --show-current
   ```

   The branch name should match the path `.agent/{branch}/plan.md`. If it doesn't, STOP and tell the user.

2. **Reads `plan.md` end-to-end.**

   ```bash
   cat .agent/$(git branch --show-current)/plan.md
   ```

   Do not skim. The executor's mental model for the rest of the run comes from this file.

3. **Verifies the Acceptance Criteria section is non-empty.** This is the contract Phase 4 testing gates against. An empty section means the plan is incomplete — bail.

4. **Logs the takeover** to the `plan.md` Progress Log:

   ```markdown
   - [TIMESTAMP] Phase 3: executor agent took over (plan confidence Y%)
   ```

   Use a full ISO 8601 timestamp (`2026-04-29T15:30:00Z`).

### Bail conditions

If any of the following holds, the executor STOPS without writing code and tells the user verbatim:

> "no plan to execute, run aw-planner first"

| Condition                       | Detection                                                  |
| ------------------------------- | ---------------------------------------------------------- |
| `plan.md` missing               | `cat` returns "No such file or directory"                  |
| `plan.md` malformed             | Cannot find expected section headers (`## Acceptance Criteria`, `## Implementation Order`) |
| Acceptance Criteria empty       | Section exists but has no bullets                          |
| Wrong worktree                  | Branch name doesn't match `.agent/{branch}/` path          |

---

## What the planner DOES NOT do

The planner's scope ends at the confidence gate + handoff message. It must not:

| Forbidden action                         | Why                                                                |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Write production code                    | That's Phase 3, executor's job                                     |
| Run tests                                | That's Phase 4                                                     |
| Create PRs                               | That's Phase 6                                                     |
| Fan out parallel implementation work     | Implementation fan-out belongs to the executor — Phase 3 allows controlled fan-out over file-disjoint slices (cap 3 concurrent) under the Sub-Agent Resource Discipline ([`parallel-coordination.md`](./parallel-coordination.md#sub-agent-resource-discipline)); the planner never dispatches implementation sub-agents |

**Allowed:** Phase 1's parallel `Explore` sub-agents — those produce planning context (research summaries), not code, and are bounded to the planner's session.

---

## What the executor DOES NOT do

The executor's scope starts at Phase 3 and ends at Phase 7 CI gate. It must not:

| Forbidden action                                | What to do instead                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Run Phase 0 (clarifying questions on the prompt) | The plan is the answer. If the plan is unclear, escalate to user — don't re-derive intent. |
| Revisit Phase 1 design decisions silently        | If the plan is wrong, escalate to the user (or trigger Phase 4 stuck-loop auto-replan). Don't quietly redesign. |
| Skip Phase 2 verification                        | Even though the planner created the worktree, the executor still verifies it's inside the right one. |

If the executor discovers mid-implementation that the plan is fundamentally flawed, it follows the [Phase 4 stuck-loop protocol](./companion-skills.md#stuck-loop-protocol-phase-4) — auto-replan via `confidence(analysis)` + `holistic-analysis` is the recovery, not silent improvisation.

---

## References

- Phase rules updated for handoff:
  - [phase-1-planning.md](./phase-1-planning.md) — Phase 1 ends here for the planner agent
  - [phase-2-worktree.md](./phase-2-worktree.md) — Phase 2 ends here for the planner agent
  - [phase-3-implementation.md](./phase-3-implementation.md) — Phase 3 starts here for the executor agent
- Companion registry: [companion-skills.md](./companion-skills.md)
- Architecture research: [`references/anthropic-architecture-research.md`](../references/anthropic-architecture-research.md)
- Templates:
  - [`templates/planner.template.md`](../templates/planner.template.md) — planner agent
  - [`templates/executor.template.md`](../templates/executor.template.md) — executor agent
