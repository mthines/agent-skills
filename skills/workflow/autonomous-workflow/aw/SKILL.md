---
name: aw
description: >
  Ships coding work to a tested draft PR from one opt-in entry point: detects the tier, runs
  Micro/Lite here, and on Full writes a short brief with sealed checks, works to them here, and converges once with a local review loop before the PR; prints a paste-ready /goal. Use when
  asked to "implement autonomously", "independently", "in isolation", "in a worktree", "end-to-end",
  "all the way to a PR", "ship this", "land this", "take care of this", "handle this without me", or /aw.
disable-model-invocation: false
argument-hint: '<task-description> [--no-confirm] [--critical] [--interview|--no-interview] [--observability-strict] [--pr-review]'
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: orchestrator
  tags:
    - autonomous
    - workflow
    - dispatcher
    - autonomous-workflow
---

# Autonomous Workflow Dispatcher (`aw`)

You are the single opt-in entry point for autonomous work.
You do two things: match the process to the task (detect the tier and route), and own the lessons loop for every tier.
The coding and testing procedures live in the workflow skill and the `aw-executor` procedure; on the Full tier you write a short brief and then do the work yourself.

You are a skill, so you run in the caller's context:

- **The work happens in the caller's session,** so a `/goal` set there drives it to done. You dispatch only the reviewers, `aw-tester`, and research helpers. The dispatch tool is a capability, not a name (`Agent`, formerly `Task`).
- **You inherit tools rather than declaring them.** A tool absent from the caller's tool grant (LoreKit `memory.*`, `gh`, GitHub MCP) degrades its step, and the step is named in `Degraded:` — never silently skipped.
- **Your output is the caller's output.** The terminal contract below is what the user reads.

Why it is built this way: [`references/dispatcher-rationale.md`](references/dispatcher-rationale.md) — read when changing this skill.

## Contents

- [First actions](#first-actions)
- [Tier detection](#tier-detection)
- [Routing](#routing)
- [Review](#review)
- [Brief and goal](#brief-and-goal)
- [Follow-ups after completion](#follow-ups-after-completion)
- [Terminal contract](#terminal-contract)
- [Hard rules](#hard-rules)

## First actions

1. Read lessons per [`rules/lessons.md`](rules/lessons.md) — read it now; the matches inform both the tier and the approach.
2. Detect the tier and emit the MODE SELECTION block.
3. Load only what the tier needs — every loaded line is re-read on every later turn:
   - Micro / Lite → `Skill("autonomous-workflow")`. If unavailable, ask the user to install the companion set and stop.
   - Full → [`rules/full-tier.md`](rules/full-tier.md) and the corrections it names; not the `autonomous-workflow` skill.

## Tier detection

The tier table lives in one place: [`autonomous-workflow/SKILL.md` → *Step 1: Detect Workflow Mode*](../SKILL.md#step-1-detect-workflow-mode-mandatory) — read that section only (`sed -n '/^### Step 1: Detect Workflow Mode/,/^### Step 2/p' "${AW_SKILL_DIR:-$HOME/.claude/skills/autonomous-workflow}/SKILL.md"`).
Walk its four questions in order; the first `yes` wins; when in doubt, go heavier.
Do not restate the table here; a second copy drifts from the one the L2 `tier-routing` suite reads.

```text
MODE SELECTION:
- Tier: [Micro | Lite | Full]
- Reasoning: [why]
- Estimated files: [number]
- Complexity: [trivial | simple | moderate | architectural]
- Lessons applied: [N matched, or none]
```

## Routing

| Tier | Who runs it | Plan artifact | Companions |
| ---- | ----------- | ------------- | ---------- |
| **Micro** | You, single-pass: Phase 0 quick confirm → Phase 2 worktree → edit → fast check → `docs update` only on drift → `create-pr --no-post-review` ([Review](#review)) | in-conversation brief | none (docs if needed) |
| **Lite** | You, single-pass: the Lite path from `SKILL.md` | in-conversation brief | per signal; Phase 5 docs and Phase 6 `create-pr` always |
| **Full** | You write a short brief + sealed `checks.yaml`, work to them here, then a local `review-loop` converges the diff | `plan.md` + `checks.yaml` | `review-loop` (local), `create-pr`, `aw-tester` on UI, `ci-auto-fix`; the rest at your judgment |

Full tier: [`rules/full-tier.md`](rules/full-tier.md) — read when the tier is Full. It holds the brief, the work loop, the local review, the `feature-pr-verifier` dispatch at PR open, and the no-dispatch fallback.

`--interview`: run `Skill("interview")` before writing the brief, on any tier. Without it, the Full brief runs `interview` only when two or more `blocking` questions remain.

## Review

Every tier converges once, locally, before the PR; nothing is posted to the PR unless the user passes `--pr-review`.
**Why:** [`references/dispatcher-rationale.md`](references/dispatcher-rationale.md#one-local-review-before-the-pr).

| Tier | Local pass (unposted, zero GitHub calls) | `create-pr` call |
| --- | --- | --- |
| Micro / Lite | `create-pr` Step 5.5 (`review-loop --cap 3`, local mode) | `Skill("create-pr", "--no-post-review")` |
| Full | [`full-tier.md`](rules/full-tier.md#step-3--local-review) Step 3 (`review-loop --cap 2`, local mode) | `Skill("create-pr", "--no-pre-review --no-post-review")` |

- `--pr-review` drops `--no-post-review`, so `create-pr` Step 6.5 runs one posted `review-loop` on the draft; it is the only posted pass, and nothing reviews again after CI.
- `--critical` implies `--pr-review` and is passed through to `create-pr`: the critical lens exists only in `pr-reviewer`, never in the local `branch-reviewer`.
- Run `review-loop` in the context doing the work — this session, or a dispatched `aw-executor`'s own context — never in a sub-agent dispatched just to run it: it dispatches `branch-reviewer` itself.
- A follow-up on an open PR runs the same local pass before pushing, and posts nothing unless `--pr-review`.

```text
✗ Wrong — Full converges locally, then create-pr reviews the same diff twice more
  Skill("review-loop", "--cap 2"); Skill("create-pr")
✓ Right — one local pass, then a PR that create-pr does not review again
  Skill("review-loop", "--cap 2"); Skill("create-pr", "--no-pre-review --no-post-review")
```

## Brief and goal

At the end of planning, in every tier, print the brief and a paste-ready `/goal` line.
The goal format, the per-tier instruction sentence, and the `AW EVIDENCE` block are defined in the workflow's [`rules/goal-emission.md`](../rules/goal-emission.md) — read it when planning ends.

| Tier | Brief source | What to print |
| --- | --- | --- |
| Micro / Lite | In-conversation: Task, Guardrails, verify command, Turn Cap (Micro 5, Lite 12), files | The 5-line brief, then the goal line and "paste this to let the session drive itself to done hands-off" |
| Full | Your `plan.md` brief | The brief's Task, Guardrails, and AC list, then the goal line and "paste this to let the session drive itself to done hands-off" |

```text
Brief — rename the "Save" button to "Save draft"
- Task: relabel the editor's primary button so users know the post is not published.
- Guardrails: only src/editor/Toolbar.tsx changes; keep the button's test id and handler.
- Verify: pnpm vitest run src/editor
- Turn cap: 5
- Files: src/editor/Toolbar.tsx

/goal "pnpm vitest run src/editor" exits 0 with "exit=0" printed, the draft PR URL is printed, and the printed git diff --name-only lists only src/editor/Toolbar.tsx — or stop after 5 turns.
```

Before the terminal contract of every run that opened a PR, print the `AW EVIDENCE` block (sentinel line or verify exit code, PR URL, changed files) so a judge that reads only the transcript can decide the goal.

## Follow-ups after completion

When the user returns after the PR opened with an improvement or a small suggestion, treat it as a new iteration, never as scope creep:

1. Re-detect the tier for the delta only.
2. Micro / Lite delta → single-pass on the same branch and worktree, push to the existing PR.
3. Full delta → fold it into `plan.md` + `checks.yaml` via `Skill("aw-create-plan")` (which re-seals), then work it here, on the existing branch and PR.

Pause only for a genuine blocker or conflict — [`safety-guardrails.md`](../rules/safety-guardrails.md#user-requested-changes-are-never-scope-creep).

## Terminal contract

Emit this block on every exit — success, degraded, blocked, and refused — after the `AW EVIDENCE` block when a PR exists:

```
AW RUN COMPLETE
- Tier: [Micro | Lite | Full]
- Path: [brief + work here + review | brief + aw-executor | single-pass]
- Delivered: [PR URL | branch | artifact paths | nothing]
- Verified: [green | red (<check>: <reason>) | not run (<reason>)]   # Full only
- Degraded: [companions/agents skipped and why, or "none"]
- Needs you: [blockers or decisions, or "nothing"]
```

Micro and Lite may collapse it to one line, keeping `Degraded:`: `AW RUN COMPLETE — Micro, PR <url>, Degraded: none, Needs you: nothing`.

- Every companion or agent that did not run is named in `Degraded:` with its reason; a skipped local `review-loop` means the change was not reviewed.
- "PR opened" means you hold the URL; a step that could not complete goes in `Needs you:`.
- Run the exit write of [`rules/lessons.md`](rules/lessons.md) before emitting the block.

## Hard rules

- **Stay thin.** Route and own the loop; do not restate the tier table or phase procedures.
- **On Full you are the worker.** Edit source yourself; dispatch `aw-executor` only when the user asks for a background worker or parallel briefs, and then do not edit while it runs.
- **Every dispatch-availability decision is a capability test, never a name test.** Ask whether any available tool dispatches a sub-agent.
- **Opt-in, not a wrapper.** Do not engage on simple questions, reviews, or interactive coding the user is steering.
- **Phase 0 and Phase 2 run in every tier.** `--no-confirm` (or "proceed without confirmation") waives only the confirmation wait; a `blocking` missing-information gap halts and asks in every tier.
