---
title: 'Phase 7: CI Gate + Optional Cleanup'
impact: HIGH
tags:
  - ci
  - phase-7
  - ci-auto-fix
  - cleanup
---

# Phase 7: CI Gate + Optional Cleanup

## Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [Procedure](#procedure)
- [Auto Fix](#auto-fix)
- [Parallel CI Fixes](#parallel-ci-fixes)
- [Auto Verify](#auto-verify)
- [Auto Review](#auto-review)
- [Optional Post-Merge Cleanup](#optional-post-merge-cleanup)
- [Phase 7 Checklist](#phase-7-checklist)
- [References](#references)

## Overview

After the draft PR is open, watch CI until every check is green. If a check fails, dispatch `ci-auto-fix` (in parallel when independent failures pile up). Only after the PR is merged is worktree cleanup considered, and only when the user wants it.

The CI gate is the load-bearing part of this phase; cleanup is a tail step.

Gate: CI green OR user-approved stop. Worktree cleanup is optional and never automatic on an open PR.

## Core Principles

- **Watch until done**: don't mark Phase 7 complete on the first green check — watch the full run.
- **Auto-fix mechanical failures**: lint, format, generated artifacts, snapshots, type drift.
- **Escalate judgment failures**: real test failures, ambiguous build errors, infra issues — report to user.
- **Never disable checks to make CI green**: no `--no-verify`, no `continue-on-error`, no skipping suites.
- **Bound the loop**: hard cap of 2 `ci-auto-fix` handoffs per PR. Each handoff has its own internal retry budget; do not wrap it in another loop.
- **Cleanup is opt-in**: never remove an open PR's worktree (whether via `gw remove` or `git worktree remove`).

## Procedure

### Step 1: Identify the PR + Initial Watch

After Phase 6, you should already have the PR URL and number. Start watching:

```bash
# Watch all checks on the PR until they all complete
gh pr checks <pr-number> --watch

# Or watch a single workflow run by id
gh run watch <run-id>
```

| Outcome             | Next step                                                              |
| ------------------- | ---------------------------------------------------------------------- |
| All checks succeed  | Go to Step 4 (report success), then optional cleanup                   |
| One check fails     | Go to Auto Fix                                                         |
| Multiple fail       | Go to Parallel CI Fixes                                                |
| No checks at all    | Likely no CI configured — note in conversation, treat as success       |

### Step 2: Triage Failures (one-line classification)

Before invoking `ci-auto-fix`, decide whether the failure is mechanical or judgment-required. The PR is in your hand and you have the failed check name and log URL.

| Category                                 | Mechanical? | Path                                  |
| ---------------------------------------- | ----------- | ------------------------------------- |
| Lint / format                            | Yes         | Auto Fix                              |
| Generated artifact / snapshot drift      | Yes         | Auto Fix                              |
| Trivial type error                       | Yes         | Auto Fix                              |
| Real test failure                        | No          | Escalate (after one re-run on suspected flake) |
| Ambiguous build / type error             | No          | Escalate                              |
| Infra / workflow YAML failure            | No          | Escalate                              |
| Sensitive (secrets, perms, deploys)      | No          | Escalate, never auto-fix              |
| Suspected flake / unrelated              | Maybe       | Re-run failed jobs once, then re-classify |

```bash
# Re-run only failed jobs once if a flake is suspected
gh run rerun <run-id> --failed
```

## Auto Fix

For any failed check classified as mechanical, invoke `ci-auto-fix` with the run id or PR URL. The skill is provider-agnostic (currently targets GitHub Actions) and owns the full fix → commit → push → re-watch loop.

```
Skill("ci-auto-fix", "<run-id|pr-url>")
```

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| Skips silently if missing | Yes — fall back to manual fix-and-push, log and continue               |
| Disable                   | Remove this section; the workflow then stops at first failure and reports to user |

Each `ci-auto-fix` invocation has its own internal retry budget. **Do not wrap it in another loop.** When it returns, accept its verdict and move on.

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 7: ci-auto-fix(<check>) — invoked
- [TIMESTAMP] Phase 7: ci-auto-fix(<check>) — fixed (commit <sha> pushed, CI re-running)
```

## Parallel CI Fixes

When **multiple independent checks** fail in the same CI run, fan out: spawn one `ci-auto-fix` sub-agent per failure, all in the same turn so they run concurrently. This mirrors the parallel pattern in [`create-pr` Step 8](../../../delivery/create-pr/SKILL.md) — align with it rather than duplicating.

Rules for fan-out:

| Rule                                                                  | Why                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Spawn all sub-agents in **one** turn                                  | Concurrency requires same-turn dispatch                            |
| One sub-agent per **independent** failure                             | Failures that share a root cause should be one handoff             |
| **Cap: 2 handoffs per PR** (total across the phase, not per turn)     | Each handoff already burns a full internal retry budget            |
| **Do not wrap each sub-agent in another retry loop**                  | The skill has its own retry budget; layering loops wastes tokens   |
| If 2-handoff cap is reached and CI is still red, **stop and report** | Beyond two handoffs it is no longer mechanical                     |

Sub-agent prompt template (one per failed check):

```
description: Run ci-auto-fix for <check-name>
subagent_type: general-purpose
prompt: |
  Drive the ci-auto-fix workflow end-to-end for this PR.

  PR: <pr-url>
  Failing check: <check-name>
  Run id: <run-id>

  Follow the ci-auto-fix skill's instructions. Apply the minimal fix, commit,
  push, and watch until CI completes. Honor its guardrails — no --no-verify,
  no continue-on-error, no disabling checks.

  Sub-Agent Resource Discipline: use scoped commands only — narrow
  tsc/eslint/jest to the files/paths you touched. Do NOT run
  whole-project npm run lint, npx tsc --noEmit (without project refs), npm test
  (without --testPathPattern), or npm run build. The orchestrator runs
  whole-project verification after all sub-agents return.
```

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 7: ci-auto-fix fan-out — 3 sub-agents dispatched (lint, types, snapshots)
- [TIMESTAMP] Phase 7: ci-auto-fix fan-out — 2 fixed, 1 returned still-failing → escalating
```

### Step 3: Escalation

If `ci-auto-fix` returns **still-failing** or **gave-up**, or if the 2-handoff cap is hit, do **not** keep retrying. Stop the loop and report to the user.

Report must include:

| Field                       | Why                                                            |
| --------------------------- | -------------------------------------------------------------- |
| PR URL + check name(s)      | So the user can jump straight to logs                          |
| Failure category            | Lint, real-test, build, infra, sensitive, etc.                 |
| Short error excerpt         | Top of the failing log, not the whole thing                    |
| What was attempted          | Which sub-agents ran, what they tried                          |
| Why auto-fix stopped        | Cap reached, gave-up, judgment-required, sensitive area        |
| Suggested next step         | Manual fix path, or "this looks like a flake worth one rerun"  |

For judgment-required failures (real-test, ambiguous build, sensitive area), do not invoke `ci-auto-fix` at all. Surface the failure summary and let the user decide.

### Step 4: Report Success

Once all checks are green:

```markdown
- [TIMESTAMP] Phase 7: CI green — PR #XX ready for review
```

Tell the user: PR URL, all checks green, and that the worktree is preserved pending their review/merge.

Then proceed to [Auto Verify](#auto-verify) before any cleanup.

## Auto Verify

After CI is green and **before** Auto Review, dispatch the `feature-pr-verifier` agent in fresh context to grade the PR against `plan.md`'s Acceptance Criteria, PASS_TO_PASS, diff sanity, and walkthrough integrity. This closes the same self-grading loophole `bug-fix-verifier` closes for bug fixes — Anthropic's harness research is explicit that "agents reliably skew positive when grading their own work."

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes (Lite Mode has no `plan.md` to verify against — skip)              |
| Runs in Lite Mode         | No                                                                     |
| Skips silently if missing | Yes — log one line and continue to Auto Review                         |
| Verdict effect            | Advisory — surfaced inline in chat. The user undrafts the PR.         |
| Disable                   | Remove this section; Auto Review then becomes the next step after CI green |

### Step 1: Detect the `feature-pr-verifier` agent

Stop at the first hit, in this order:

```bash
[ -f ".claude/agents/feature-pr-verifier.md" ] && VERIFIER_AVAILABLE=1
[ -z "$VERIFIER_AVAILABLE" ] && [ -f "$HOME/.agents/agents/feature-pr-verifier.md" ] && VERIFIER_AVAILABLE=1
[ -z "$VERIFIER_AVAILABLE" ] && [ -f "$HOME/.claude/agents/feature-pr-verifier.md" ] && VERIFIER_AVAILABLE=1
```

If none of the paths resolve, log and skip to Auto Review:

```markdown
- [TIMESTAMP] Phase 7: feature-pr-verifier — not available, continuing (install `agents/feature-pr-verifier.md` from agent-skills.git into one of: `.claude/agents/`, `~/.agents/agents/`, `~/.claude/agents/`)
```

If running in Lite Mode (no `plan.md`), also skip:

```markdown
- [TIMESTAMP] Phase 7: feature-pr-verifier — skipped (Lite Mode has no plan.md to verify against)
```

### Step 2: Dispatch the `feature-pr-verifier` sub-agent

Spawn one sub-agent with `subagent_type: feature-pr-verifier` and pass the inputs the agent's contract requires.

```
description: Verify PR after CI green
subagent_type: feature-pr-verifier
prompt: |
  Verify this feature PR. Inputs:

  - plan.md path: .agent/<branch>/plan.md
  - walkthrough.md path: .agent/<branch>/walkthrough.md
  - PR head SHA: <pr_head_sha>
  - Base SHA: <base_sha>
  - Project test command: <project_test_command>

  Follow the feature-pr-verifier agent's procedure end-to-end. Run all four
  checks. Return the verdict block in the exact format specified. Do not
  propose fixes; do not editorialise; do not request additional inputs.
```

Do **not** wrap the sub-agent call in a retry loop — the verifier owns its own validation and returns a single terminal verdict.

### Step 3: Surface the verdict

When the sub-agent returns:

```markdown
- [TIMESTAMP] Phase 7: feature-pr-verifier — verdict: <green|red> (<one-line summary>)
```

Show the user the verifier's full verdict block (it's terse). Then proceed to [Auto Review](#auto-review) regardless of green or red — the user makes the final call on undrafting:

| Verifier verdict | What to tell the user                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| green            | "Verifier passed all four checks. PR ready for your review and undraft."                                 |
| red              | "Verifier flagged Check N: <reason>. PR remains in draft. Recommend addressing the finding before undraft." |

Never auto-undraft. The verifier is advisory; the human is the gatekeeper.

## Auto Review

After CI is green, automatically dispatch the `reviewer` agent in **PR Mode**. Because Phase 7 PRs are always self-authored (aw-executor opens them), the reviewer enters **PR (self-review)** sub-mode: auto-fix runs and findings are emitted as an inline terminal report (Step 5.8). No pending GitHub comments are posted. **`reviewer` is an optional agent companion**, not a skill — invocation and graceful-skip semantics differ slightly from `Skill()`-based companions.

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| Skips silently if missing | Yes — log one line and continue to cleanup step                        |
| Posts comments live?      | No — self-review sub-mode: reviewer auto-fixes and emits inline terminal report (Step 5.8) |
| Disable                   | Remove this section; CI green becomes the terminal gate                |

### Step 1: Detect the `reviewer` agent

Check the three locations the harness loads agent definitions from. Stop at the first hit:

```bash
# Project-scoped (highest priority)
[ -f ".claude/agents/reviewer.md" ] && REVIEWER_AVAILABLE=1

# Cross-tool discovery dir (used by Codex, Cursor, OpenCode, …)
[ -z "$REVIEWER_AVAILABLE" ] && [ -f "$HOME/.agents/agents/reviewer.md" ] && REVIEWER_AVAILABLE=1

# Global Claude Code dir
[ -z "$REVIEWER_AVAILABLE" ] && [ -f "$HOME/.claude/agents/reviewer.md" ] && REVIEWER_AVAILABLE=1
```

If none of the paths resolve, log and skip:

```markdown
- [TIMESTAMP] Phase 7: reviewer — not available, continuing (install `agents/reviewer.md` from agent-skills.git into one of: `.claude/agents/`, `~/.agents/agents/`, `~/.claude/agents/`)
```

Then proceed to [Optional Post-Merge Cleanup](#optional-post-merge-cleanup).

### Step 2: Dispatch the `reviewer` sub-agent

Spawn one sub-agent with `subagent_type: reviewer` and pass the PR URL. The reviewer will detect self-authorship via Rule 0 and enter PR (self-review) sub-mode automatically: auto-fix actionable findings, then emit findings as an inline terminal report (Step 5.8).

```
description: Auto-review PR after CI green
subagent_type: reviewer
prompt: |
  <pr-url> --pr

  Phase 7 of the autonomous-workflow has just turned CI green on a self-authored
  PR. Run a full PR review. The reviewer will detect self-authorship via Rule 0
  (gh api user vs pr author) and enter PR (self-review) sub-mode automatically:
  auto-fix actionable findings, then emit findings as an inline terminal report
  (Step 5.8) — do not post pending GitHub comments.
```

Do **not** wrap the sub-agent call in a retry loop — `reviewer` owns its own validation.

### Step 3: Log and hand back

When the sub-agent returns, log:

```markdown
- [TIMESTAMP] Phase 7: reviewer — self-review complete (N findings; M auto-fixed; inline report above)
```

Tell the user: PR URL, that the reviewer auto-fixed M issues and surfaced N findings inline above, and that they should review the Critical and High items before undrafting. Then proceed to [Optional Post-Merge Cleanup](#optional-post-merge-cleanup).

## Optional Post-Merge Cleanup

After the PR is merged (state `MERGED`), optionally tear the worktree down to reclaim disk and reduce branch clutter. **Skip if the user wants to keep it.**

### Step 1: Confirm PR Is Merged

```bash
gh pr view <pr-number> --json state,mergedAt
```

| State                | Action                                                       |
| -------------------- | ------------------------------------------------------------ |
| `MERGED`             | Cleanup eligible — proceed to confirm with user              |
| `CLOSED` (not merged)| Cleanup eligible only with explicit user confirmation        |
| `OPEN`               | **Never cleanup** — Phase 7 stays in CI watch                |

### Step 2: Confirm with User

If you don't have an explicit cleanup directive yet, ask:

> "PR #XX is merged. Should I remove the `<branch-name>` worktree?"

Wait for confirmation. Default is to keep the worktree if the user is silent.

### Step 3: Remove Worktree

```bash
# With gw (recommended — handles branch + worktree atomically)
gw remove <branch-name>

# Native git worktree fallback (when gw is not installed)
REPO_NAME="$(basename "$(git rev-parse --show-toplevel)")"
BRANCH_SLUG="$(echo "<branch-name>" | tr '/' '-')"
git worktree remove "../${REPO_NAME}-${BRANCH_SLUG}"
git branch -d "<branch-name>"
```

Validate:

| Check                                                     | Expected                       |
| --------------------------------------------------------- | ------------------------------ |
| `gw list` (or `git worktree list`) no longer shows branch | Yes                            |
| Worktree directory deleted                                | Yes                            |
| `.agent/{branch-name}/` artifacts                         | Removed alongside the worktree |

### Step 4: Navigate Back to Main

```bash
# With gw (shell integration required)
gw cd main

# Native fallback: cd back to the original repo path
cd "$(git rev-parse --show-toplevel)"
# or just `cd ../<repo>` from the worktree
```

### Step 5: Report Cleanup

```markdown
- [TIMESTAMP] Phase 7: Worktree <branch-name> removed (post-merge)
```

## Phase 7 Checklist

- [ ] CI watch started after PR opened
- [ ] All failures triaged (mechanical vs judgment)
- [ ] `ci-auto-fix` invoked per mechanical failure (parallel when independent, cap 2)
- [ ] Judgment failures escalated to user with full report
- [ ] CI is green OR user has approved stopping
- [ ] (Optional, Full Mode) `feature-pr-verifier` agent dispatched after CI green; verdict surfaced or skip logged
- [ ] (Optional) `reviewer` agent dispatched after CI green; inline report surfaced or skip logged
- [ ] (Optional) PR merged → worktree removed with user confirmation
- [ ] Final status reported to user

## References

- Related rule: [phase-6-pr-creation](./phase-6-pr-creation.md)
- Companion registry: [companion-skills.md](./companion-skills.md)
- Related skill: [ci-auto-fix](../../../delivery/ci-auto-fix/SKILL.md)
- Related skill: [create-pr — Step 8 parallel pattern](../../../delivery/create-pr/SKILL.md)
- Related agent: [reviewer](../../../../agents/reviewer.md) — optional Phase 7 auto-review
- Related agent: [feature-pr-verifier](../../../../agents/feature-pr-verifier.md) — optional Phase 7 auto-verify (Full Mode)
- Related rule: [git-worktree-workflows cleanup](../../git-worktree-workflows/rules/cleanup.md)
