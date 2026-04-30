---
title: 'Phase 6: PR Creation & Delivery'
impact: HIGH
tags:
  - pr
  - delivery
  - phase-6
  - review-changes
  - create-walkthrough
  - create-pr
---

# Phase 6: PR Creation & Delivery

## Overview

Hand the work off to the user as a reviewable DRAFT pull request — but only after a quality review and (in Full Mode) a generated walkthrough. This phase is orchestrated almost entirely through companion skills:

1. Pre-flight checks pass (build, lint, tests).
2. `Skill("review-changes")` catches quality/correctness issues before they go up.
3. `Skill("create-walkthrough")` (Full Mode) generates `.agent/{branch}/walkthrough.md`.
4. `Skill("create-pr")` writes the narrative description, pushes, opens the draft PR, and watches CI initialization.
5. The walkthrough content is shown inline in the conversation. **The PR is not "delivered" until the user has seen the walkthrough.**

Gate: walkthrough shown in chat, draft PR opened, CI watch started.

## Core Principles

- **Pre-flight validation**: build/lint/test must pass before invoking any companion.
- **Review before pushing**: every PR gets `review-changes` first.
- **Draft PR only**: never mark ready-to-merge automatically.
- **Show the walkthrough**: blocking — output the walkthrough content in chat after PR creation.
- **Preserve the worktree**: user may want to review or iterate locally; cleanup is Phase 7.
- **No AI co-author tags**: NEVER add `Co-Authored-By` lines to commit messages or PR descriptions. The user owns the commits.

## Procedure (Order of Operations)

| Step | Action                                                                  | Required in     |
| ---- | ----------------------------------------------------------------------- | --------------- |
| 1    | Pre-flight checks (clean tree, build, lint, test)                       | Full + Lite     |
| 2    | `Skill("review-changes")`                                               | Full + Lite     |
| 3    | `Skill("create-walkthrough")` → `.agent/{branch}/walkthrough.md`        | **Full only**   |
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

ALWAYS invoke `review-changes` before pushing. Purpose: catch quality and correctness issues before they reach the PR. The `review-changes` skill internally dispatches to a `reviewer` sub-agent — it is already isolated, so do **not** wrap it in another sub-agent.

```
Skill("review-changes")
```

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| Skips silently if missing | Yes — log and continue with manual diff review                         |
| Disable                   | Remove this section (not recommended; you lose the pre-push safety net)|

Handle the review output:

| Reviewer verdict       | Action                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| No blocking issues     | Continue to walkthrough / PR creation                                             |
| Suggestions only       | Decide per suggestion: apply now, defer to follow-up, or note in PR description   |
| Blocking issues        | Fix in this branch, re-run pre-flight checks, then re-invoke `review-changes`     |

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 6: review-changes — invoked (0 blocking, 2 suggestions applied)
```

Or, if companion missing:

```markdown
- [TIMESTAMP] Phase 6: review-changes — not available, continuing
```

## Walkthrough

**Full Mode only.** Generate `.agent/{branch}/walkthrough.md` to give the reviewer a narrative tour of the change.

```
Skill("create-walkthrough")
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
- [TIMESTAMP] Phase 6: create-walkthrough — invoked (.agent/{branch}/walkthrough.md generated)
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
- [ ] `Skill("review-changes")` invoked, blocking issues resolved
- [ ] `Skill("create-walkthrough")` invoked (Full Mode)
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
- Related skill: [review-changes](../../review-changes/SKILL.md)
- Related skill: [create-walkthrough](../../create-walkthrough/SKILL.md)
- Related skill: [create-pr](../../create-pr/SKILL.md)
