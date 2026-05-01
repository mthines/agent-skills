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

## Overview

The autonomous-workflow runs as two agents connected by a single artifact:

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

`plan.md` is the contract. The executor's **only** input is this file plus the worktree it lives in. Required sections (per the [`aw-create-plan`](../../aw-create-plan/SKILL.md) template):

| Section                | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| Summary                | One-paragraph description of what's being built and why           |
| Background & Context   | Phase 0 discussion, motivation, links to related work             |
| Requirements           | Tagged list (must-have / nice-to-have / out-of-scope)             |
| Out of Scope           | Explicit list of things discussed but excluded                    |
| Decisions              | Each decision + alternatives considered + rationale               |
| Technical Approach     | Architecture, data flow, integration points                       |
| Patterns to Follow     | Specific existing files referenced as examples                    |
| Acceptance Criteria    | Bullet list — the contract Phase 4 testing gates against          |
| Implementation Order   | Numbered sequence the executor follows verbatim                   |
| File Changes           | Action / File / Change / Reason table                             |
| Tests                  | Test cases + files + what they validate                           |
| Dependencies           | New packages, version constraints                                 |
| Risks                  | Likelihood / impact / mitigation                                  |
| Verification           | Commands for fast-check (after edit) and broad-check (before PR)  |
| Progress Log           | Append-only log of every phase milestone                          |

All multi-signal `confidence(plan)` rule checks must pass:

- File paths in the File Changes table resolve in the worktree
- Requirements are tagged (must / nice / out-of-scope)
- Acceptance Criteria section is non-empty
- Implementation Order is numbered and references actual files
- Verification commands are concrete (no placeholders)

If any check fails, the gate fails and the planner enters the iterate-or-escalate flow described in [`phase-1-planning.md#confidence-gate`](./phase-1-planning.md#confidence-gate).

---

## Handoff message format

**Anchor:** `handoff-message-format`

At the end of Phase 2, the planner outputs **one** of the two messages below — never both, never something else.

### High-confidence (auto-handoff ready)

```
✓ Plan ready
- Path: .agent/{branch}/plan.md
- Confidence: X% (passed gate)
- Worktree: <path>
- Files to change: N
- Acceptance Criteria: M items

Reply "execute" or "continue" to dispatch the executor.
Reply "review" to inspect the plan first.
```

The planner then **STOPS**. It does not auto-invoke the executor. The user (or main session) sees the message and decides whether to dispatch.

### Below-gate (user must approve)

```
⚠️ Plan confidence below 90%
- Path: .agent/{branch}/plan.md
- Confidence: X% (Y/Z rule checks failed)
- Concerns:
  1. <concern from confidence output>
  2. ...

Choose:
- refine — planner does up to 2 more research iterations
- proceed — accept and dispatch executor anyway (NOT recommended)
- stop — abandon
```

The planner **STOPS** and waits for the user's choice. `refine` re-enters Phase 1 research for **up to 2 more iterations** (matching the planner template's pre-escalation retry budget); if still below 90% after those, the planner escalates again with the same below-gate message — no infinite refine loop. `proceed` falls through to the high-confidence handoff message (with the lower score logged); `stop` removes the worktree (Phase 7 cleanup) or leaves it for manual inspection.

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
| Fan out parallel implementation work     | Phase 3 is sequential by design ([`companion-skills.md`](./companion-skills.md#parallelization)) |

**Allowed:** Phase 1's parallel `Explore` sub-agents — those produce planning context (research summaries), not code, and are bounded to the planner's session.

---

## What the executor DOES NOT do

The executor's scope starts at Phase 3 and ends at Phase 7 CI gate. It must not:

| Forbidden action                                | What to do instead                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Run Phase 0 (clarifying questions on the prompt) | The plan is the answer. If the plan is unclear, escalate to user — don't re-derive intent. |
| Revisit Phase 1 design decisions silently        | If the plan is wrong, escalate to the user (or trigger Phase 4 stuck-loop auto-replan). Don't quietly redesign. |
| Skip Phase 2 verification                        | Even though the planner created the worktree, the executor still verifies it's inside the right one. |

If the executor discovers mid-implementation that the plan is fundamentally flawed, it follows the [Phase 4 stuck-loop protocol](./companion-skills.md#stuck-loop-protocol-phase-4) — auto-replan via `confidence(bug-analysis)` + `holistic-analysis` is the recovery, not silent improvisation.

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
