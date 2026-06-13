---
title: 'Phase 6: PR Creation & Delivery'
impact: HIGH
tags:
  - pr
  - delivery
  - phase-6
  - reviewer
  - aw-create-walkthrough
  - create-pr
---

# Phase 6: PR Creation & Delivery

## Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [Procedure (Order of Operations)](#procedure-order-of-operations)
- [Pre-Push Review](#pre-push-review)
- [Findings Quality Gate](#findings-quality-gate)
- [Walkthrough](#walkthrough)
- [PR Creation](#pr-creation)
- [Delivery Checklist](#delivery-checklist)
- [References](#references)

## Overview

Hand the work off to the user as a reviewable DRAFT pull request — but only after a quality review and (in Full Mode) a generated walkthrough. This phase is orchestrated almost entirely through companion skills:

1. Pre-flight checks pass (build, lint, tests).
2. The `reviewer` agent (dispatched directly via the Agent tool, `--critical`) catches quality and correctness issues before they go up.
3. `Skill("aw-create-walkthrough")` (Full Mode) generates `.agent/{branch}/walkthrough.md`.
4. `Skill("create-pr")` writes the narrative description, pushes, opens the draft PR, and watches CI initialization.
5. The walkthrough content is shown inline in the conversation. **The PR is not "delivered" until the user has seen the walkthrough.**

Gate: walkthrough shown in chat, draft PR opened, CI watch started.

## Core Principles

- **Pre-flight validation**: build/lint/test must pass before invoking any companion.
- **Review before pushing**: every PR gets the `reviewer` agent (`--critical`, auto-fix all severities) dispatched first.
- **Draft PR only**: never mark ready-to-merge automatically.
- **Show the walkthrough**: blocking — output the walkthrough content in chat after PR creation.
- **Preserve the worktree**: user may want to review or iterate locally; cleanup is Phase 7.
- **No AI co-author tags**: NEVER add `Co-Authored-By` lines to commit messages or PR descriptions. The user owns the commits.

## Procedure (Order of Operations)

| Step | Action                                                                  | Required in     |
| ---- | ----------------------------------------------------------------------- | --------------- |
| 1    | Pre-flight checks (clean tree, build, lint, test)                       | Full + Lite     |
| 2    | `Agent(subagent_type: "reviewer", --critical, auto-fix all severities)` | Full + Lite     |
| 3    | `Skill("aw-create-walkthrough")` → `.agent/{branch}/walkthrough.md`     | **Full only**   |
| 4    | `Skill("create-pr")` → push, open draft, watch initial CI               | Full + Lite     |
| 5    | Show `walkthrough.md` content inline in conversation                    | **Full only**   |
| 6    | Report PR URL + summary, log Progress                                   | Full + Lite     |

### Step 1: Pre-Flight Validation

Run the full verification suite (the commands listed in `plan.md`'s Verification section, or whatever the project uses):

```bash
# Working tree must be clean
git status

# Run full suite — adjust to project's actual commands
npm test && npm run build && npm run lint
```

**If ANY check fails: stop, fix, re-run from Phase 3 or 4 as appropriate. Do NOT continue to review/PR.**

## Pre-Push Review

**Anchor:** `pre-push-review`

ALWAYS dispatch the `reviewer` agent before pushing — directly via the Agent tool, not through `Skill("review-changes")`. Purpose: catch quality and correctness issues before they reach the PR. `review-changes` is a slash-only router (`disable-model-invocation: true`), so the workflow invokes the reviewer agent itself.

```
Agent(
  description: "Pre-push self-review with critical pre-mortem",
  subagent_type: "reviewer",
  prompt: "Pre-push review of the working tree on the autonomous-workflow's own branch. --critical\n\nApply auto-fix for ALL severities (Critical / High / Medium / Low / Nitpick / Nice-to-have) where the auto-fix policy classifies the finding as Simple — typos, unused imports, lint/format errors, dead code, comment trims (R35), whitespace, obvious annotations. Complex findings (signature changes, public renames, >10-line edits, generated/migration/lock files) stay propose-only per `agents/reviewer/rules/auto-fix-policy.md`.\n\nFollow the agent's standard pipeline; Rule 0 detects this is your own branch and selects Fix Mode. Emit the inline terminal report at the end."
)
```

`--critical` forces the adversarial pre-mortem via `Skill("critical", "code")` even on a low-stakes diff, and the prompt names every severity bucket so the reviewer does not skip Nitpick / Nice-to-have findings — the auto-fix-policy's Simple-vs-Complex split is the safety floor, not the severity bucket.

This is the workflow's final structural review. The reviewer agent loads the
`code-quality` rubric on substantive diffs and walks the full review
checklist — not just the comment pass. Expect findings (and auto-fixes) across:

- **Structure** — function length, nesting, single responsibility, guard clauses (Pass 1).
- **Naming** — domain accuracy, boolean phrasing, noise words (Pass 2).
- **Cognitive complexity** — top-to-bottom readability per function (Pass 3).
- **Comments** — every comment earns its place, **no verbose multi-paragraph blocks** (apply **R35** to trim), no commented-out code, no orphan TODOs (Pass 4).
- **Error handling, type-driven design, architecture, API design, correctness, testability, collaboration, future-proofing** — Passes 5–14.
- **Adversarial pre-mortem** (`--critical`) — failure-mode taxonomy, blast radius, rollback, hidden coupling, mandatory steelman of one alternative.

The autonomous-workflow runs as the PR author, so the reviewer is invoked on the own-branch (no PR yet) and lands in **Fix Mode**: simple findings auto-applied to the working tree before the PR opens; complex findings surfaced in the inline terminal report (with fix plans) for the user to act on.

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| Skips silently if missing | Yes — if `reviewer.md` is not installed at any of `.claude/agents/reviewer.md`, `~/.agents/agents/reviewer.md`, `~/.claude/agents/reviewer.md`, log and continue with manual diff review |
| Disable                   | Remove this section (not recommended; you lose the pre-push safety net)|

## Findings Quality Gate

**Anchor:** `findings-quality-gate`

Before acting on the review output, run the optional false-positive filter over the findings list:

```
Skill("aw-review-quality-gate")     # skips silently if not installed
```

The gate runs its six-question checklist per finding, drops findings that fail two or more checks, downgrades findings that fail exactly one, and emits a `### Quality Gate` summary (reviewed / dropped / downgraded / passed).
Act on the **filtered** findings list, not the raw one.
The gate is advisory — it filters review noise; it never blocks the phase.

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| Skips silently if missing | Yes — act on the raw findings list, log and continue                   |
| Disable                   | Remove this section; the raw `reviewer` output is used directly        |

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 6: aw-review-quality-gate — N reviewed, X dropped, Y downgraded
- [TIMESTAMP] Phase 6: aw-review-quality-gate — not available, continuing
```

Handle the (filtered) review output:

| Reviewer verdict       | Action                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| No blocking issues     | Continue to walkthrough / PR creation                                             |
| Suggestions only       | Decide per suggestion: apply now, defer to follow-up, or note in PR description   |
| Blocking issues        | Fix in this branch, re-run pre-flight checks, then re-dispatch the `reviewer` agent |

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 6: reviewer (pre-push, --critical) — invoked (N findings; M auto-fixed; 0 blocking)
```

Or, if the reviewer agent is missing:

```markdown
- [TIMESTAMP] Phase 6: reviewer — not available, continuing (install `agents/reviewer.md` from agent-skills.git into one of: `.claude/agents/`, `~/.agents/agents/`, `~/.claude/agents/`)
```

## Walkthrough

**Full Mode only.** Generate `.agent/{branch}/walkthrough.md` to give the reviewer a narrative tour of the change.

```
Skill("aw-create-walkthrough")
```

The skill gathers context from `plan.md`, git history, and test results to produce the walkthrough. It writes to `.agent/{branch}/walkthrough.md` inside the worktree.

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | **No** — Lite skips this step entirely                                 |
| Skips silently if missing | Yes — log and continue without the walkthrough artifact                |
| Disable                   | Switch the task to Lite Mode                                           |

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 6: aw-create-walkthrough — invoked (.agent/{branch}/walkthrough.md generated)
```

## PR Creation

Invoke `create-pr` to handle the rest of the delivery in one go: narrative description generation, push, open the draft PR, and watch the initial CI run.

```
Skill("create-pr")
```

What `create-pr` handles:

| Step                    | Owner       |
| ----------------------- | ----------- |
| Description generation  | `create-pr` |
| `git push -u origin`    | `create-pr` |
| `gh pr create --draft`  | `create-pr` |
| Watch initial CI        | `create-pr` |

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| Skips silently if missing | Yes — fall back to the manual flow below                               |
| Disable                   | Remove this section and use the manual `gh pr create --draft` fallback |

**Manual fallback** (used only when `create-pr` is unavailable or explicitly disabled):

```bash
git push -u origin <branch-name>

gh pr create \
  --draft \
  --title "<type>(<scope>): <description>" \
  --body "$(cat <<'EOF'
## Summary

[High-level overview]

## Changes

- [User-facing change 1]
- [User-facing change 2]

## Implementation Details

- Modified `file1.ts`: [what and why]
- Added `file2.ts`: [purpose]

## Testing

- [x] Unit tests pass
- [x] Integration tests pass
- [x] Manual testing completed

## Breaking Changes

[None / List with migration path]

## Related Issues

Closes #[issue-number]
EOF
)"
```

**Always use `--draft`.** Never add `Co-Authored-By` lines.

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 6: create-pr — invoked (PR #XX opened as draft, CI watch started)
```

### Step 5: Show the Walkthrough Inline (BLOCKING)

After `create-pr` returns the PR URL, the workflow MUST output the contents of `.agent/{branch}/walkthrough.md` inline in the conversation, followed by the PR link.

This is a hard requirement — the user has not been "delivered to" until they have seen the walkthrough in chat. Do not summarize, do not link-only; paste the markdown content (or a faithful excerpt for very long walkthroughs, with a note that the full file is at `.agent/{branch}/walkthrough.md`).

In Lite Mode, skip this step (no walkthrough was generated) and instead post a 3–5 line summary of the change followed by the PR link.

### Step 6: Report Completion & Update Progress Log

```markdown
- [TIMESTAMP] Phase 6: PR #XX delivered (draft, walkthrough shown inline)
```

Then move to Phase 7 to watch CI to green.

### Step 7: Preserve Worktree

**Do NOT remove the worktree yet.** The user may want to review, iterate, or run things locally. Worktree cleanup belongs to Phase 7, after the PR is merged.

## Delivery Checklist

- [ ] Pre-flight validation passed (clean tree, build, lint, test)
- [ ] `reviewer` agent dispatched (`--critical`, auto-fix all severities); blocking issues resolved
- [ ] `Skill("aw-create-walkthrough")` invoked (Full Mode)
- [ ] `Skill("create-pr")` invoked OR manual fallback executed
- [ ] PR opened as draft
- [ ] Walkthrough content shown inline in conversation (Full Mode)
- [ ] PR URL delivered to user
- [ ] Worktree preserved for review
- [ ] Phase 7 (CI gate) starts watching CI

## References

- Related rule: [phase-5-documentation](./phase-5-documentation.md)
- Related rule: [phase-7-ci-gate](./phase-7-ci-gate.md)
- Companion registry: [companion-skills.md](./companion-skills.md)
- Related skill: [review-changes](../../../quality/review-changes/SKILL.md)
- Related skill: [aw-create-walkthrough](../../aw-create-walkthrough/SKILL.md)
- Related skill: [create-pr](../../../delivery/create-pr/SKILL.md)
