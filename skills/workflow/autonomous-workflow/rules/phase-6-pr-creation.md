---
title: 'Phase 6: PR Creation & Delivery'
impact: HIGH
tags:
  - pr
  - delivery
  - phase-6
  - review-loop
  - pr-reviewer
  - aw-create-walkthrough
  - create-pr
---

# Phase 6: PR Creation & Delivery

## Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [Procedure (Order of Operations)](#procedure-order-of-operations)
- [Post-Draft Review](#post-draft-review)
- [Review Output](#review-output)
- [Walkthrough](#walkthrough)
- [PR Creation](#pr-creation)
- [Delivery Checklist](#delivery-checklist)
- [References](#references)

## Overview

Hand the work off to the user as a reviewable DRAFT pull request — but only after a quality review and (in Full Mode) a generated walkthrough. This phase is orchestrated almost entirely through companion skills:

1. Pre-flight checks pass (build, lint, tests).
2. `Skill("aw-create-walkthrough")` (Full Mode) generates `.agent/{branch}/walkthrough.md`.
3. `Skill("create-pr", "--no-post-review")` writes the narrative description, converges the branch with a local `review-loop` (Step 5.5), pushes, opens the draft PR, and watches CI initialization.
4. The walkthrough content is shown inline in the conversation. **The PR is not "delivered" until the user has seen the walkthrough.**

Gate: walkthrough shown in chat, draft PR opened, CI watch started.

## Core Principles

- **Pre-flight validation**: build/lint/test must pass before invoking any companion.
- **Review once, locally, before the PR**: `create-pr` Step 5.5 runs `review-loop` in local mode (`branch-reviewer` → apply → `polish simplify`, zero GitHub calls), so the draft opens converged; nothing is posted to it unless the user passed `--pr-review` ([`aw` § Review](../aw/SKILL.md#review)).
- **Draft PR only**: never mark ready-to-merge automatically.
- **Show the walkthrough**: blocking — output the walkthrough content in chat after PR creation.
- **Preserve the worktree**: user may want to review or iterate locally; cleanup is Phase 7.

## Procedure (Order of Operations)

| Step | Action                                                                        | Required in     |
| ---- | ----------------------------------------------------------------------------- | --------------- |
| 1    | Pre-flight checks (clean tree, build, lint, test)                             | Full + Lite     |
| 2    | `Skill("aw-create-walkthrough")` → `.agent/{branch}/walkthrough.md`           | **Full only**   |
| 3    | `Skill("create-pr", "--no-post-review")` → local review-loop, push, open draft PR, watch initial CI | Full + Lite     |
| 4    | Show `walkthrough.md` content inline in conversation                          | **Full only**   |
| 5    | Report PR URL + summary, log Progress                                         | Full + Lite     |

### Step 1: Pre-Flight Validation

Run the full verification suite (the commands listed in `plan.md`'s Verification section, or whatever the project uses):

```bash
# Working tree must be clean
git status

# Run full suite — adjust to project's actual commands
npm test && npm run build && npm run lint
```

**If ANY check fails: stop, fix, re-run from Phase 3 or 4 as appropriate. Do NOT continue to walkthrough/PR.**

## Post-Draft Review

None by default: `create-pr` Step 5.5 already converged the branch with `review-loop` in local mode before the push, so the executor passes `--no-post-review` and the draft gets no posted review.
With `--pr-review`, invoke `Skill("create-pr")` bare instead: Step 6.5 runs `Skill("review-loop", "<pr-url> --no-ci")`, which posts a `COMMENT` review via `pr-reviewer` and applies findings via `implement-suggestion`. The `--no-ci` is not optional: Phase 7's CI gate owns the CI budget for this PR.

Both loops gracefully skip if `review-loop` is not installed — log one line and continue.

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| If missing | Report `skipped (not installed)`, then if `review-loop` and `pr-reviewer` are absent, log and continue with manual diff review |
| Disable                   | Pass `--no-pre-review` to `create-pr` (not recommended; the PR opens unreviewed) |

## Review Output

**Anchor:** `findings-quality-gate` (kept so older links resolve)

`create-pr`'s local `review-loop` handles the review → apply → simplify cycle, and
the reviewer's own verifier (`branch-reviewer` runs `pr-reviewer`'s detection core) is the false-positive filter — every
finding it posts has already survived verification. Act on its output directly;
there is no second filter pass.

Handle the review output:

| Verdict                | Action                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------- |
| No blocking issues     | Continue to walkthrough / PR creation                                               |
| Suggestions only       | Decide per suggestion: apply now, defer to follow-up, or note in PR description     |
| Blocking issues        | Fix in this branch, re-run pre-flight checks, then re-run `review-loop`             |

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 6: review-loop — ran (N iterations; M findings applied; 0 blocking remaining)
```

Or, if `review-loop` is missing:

```markdown
- [TIMESTAMP] Phase 6: review-loop — skipped (not installed) (install review-loop skill from agent-skills.git)
```

## Walkthrough

**Full Mode only.** Generate `.agent/{branch}/walkthrough.md` to give the reviewer a narrative tour of the change.

```
Skill("aw-create-walkthrough")
```

The skill gathers context from `plan.md`, git history, and test results to produce the walkthrough. It writes to `.agent/{branch}/walkthrough.md` inside the worktree.

**Regenerate after the review-loop when it changed files.** The walkthrough is generated here, but `create-pr` Step 5.5 then runs `review-loop`, which applies findings as new commits — so a walkthrough written before the loop describes the pre-review branch. If the `review-loop` applied any findings (`M findings applied > 0` in its Progress Log line), re-run `Skill("aw-create-walkthrough")` after the loop so the narrative matches the final pushed diff.

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | **No** — Lite skips this step entirely                                 |
| If missing | Report `skipped (not installed)`, then log and continue without the walkthrough artifact                |
| Disable                   | Switch the task to Lite Mode                                           |

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 6: aw-create-walkthrough — ran (.agent/{branch}/walkthrough.md generated)
```

## PR Creation

Invoke `create-pr` to handle the rest of the delivery in one go: narrative description generation, a local `review-loop` before the push, push, open the draft PR, and watch the initial CI run.

**Invoke it with `--no-post-review` and nothing else — never scale it down further by default:**

```
Skill("create-pr", "--no-post-review")
```

That runs Step 5.5's local `review-loop` (`branch-reviewer` → apply → `polish simplify`, cap 3) → push → open draft PR → Steps 7–8 watch CI and hand red CI to `ci-auto-fix`. With `--pr-review`, invoke it bare so Step 6.5 also runs one posted `review-loop`. **Do NOT pass `--no-pre-review`, `--no-review`, `--no-simplify`, `--quick`, or `--no-quality`** unless the user explicitly asked to skip a pass.

> **Resource note — what the "save RAM" rule actually scopes.** This repo's resource guidance is about *execution cost only*: do not run `eslint` / `tsc` / tests **in parallel**, and do not spawn **parallel sub-agents** or **cascading full-verify rounds** (the 55+ GB OOM incident). It does NOT let you skip the quality passes. `create-pr`'s `review-loop` (`pr-reviewer`, `implement-suggestion`, `polish simplify`) and the Phase 6 quality gate are sequential reasoning passes — the single-sequential-loop variant is explicitly permitted. Skipping them to "save RAM" is a category error and a Phase 6 collapse (taxonomy F5).

What `create-pr` handles:

| Step                          | Owner       |
| ----------------------------- | ----------- |
| Description generation        | `create-pr` |
| `git push -u origin`          | `create-pr` |
| `gh pr create --draft`        | `create-pr` |
| Pre-push review loop          | `create-pr` Step 5.5 → local `review-loop` → `branch-reviewer` + apply + `polish simplify`; the posted Step 6.5 loop runs only with `--pr-review` |
| Preview verification spec (UI diffs) | `create-pr` Step 6.4 → `ui-verify` (see below) |
| Watch initial CI              | `create-pr` |
| Red CI                        | `create-pr` Step 8 → `ci-auto-fix` |

### UI-verify

On a UI diff, `create-pr` Step 6.4 delegates to `ui-verify` (`Skill("ui-verify", "author <pr-url>")`), which injects a collapsed, machine-findable UI verification spec into the PR body so an agent can later run it against the preview deployment.
You do not invoke `ui-verify` here — `create-pr` owns the call. Two workflow-specific facts:

- **It seeds from the executor's specs.** When this task wrote `.agent/{branch}/specs.md` (Phase 4, UI tasks), `ui-verify` lifts those already-locally-verified specs into the PR block rather than regenerating from the diff — so the PR-embedded spec matches what Phase 4 ran. `specs.md` is gitignored, but the lift works because `author` runs here in the same worktree; it copies the content into the **committed** PR body, and `specs.md` itself is never committed. Contract: [`ui-verify/rules/spec-sources.md`](../../../testing/ui-verify/rules/spec-sources.md).
- **It is distinct from Phase 7 Spec Rehearsal — two artifacts, two lifetimes.** Phase 7 re-runs the gitignored `.agent/{branch}/specs.md` against the preview *during this run* (local, in-worktree). The ui-verify block *persists in the committed PR description*, so `ui-verify run` and any on-demand agent can repeat the check on a fresh checkout after this run ends. Both are supported; they read different files.

A missing `ui-verify` is reported `companion: ui-verify — skipped (not installed)` (`create-pr` catches and logs). Disable by passing `--no-ui-verify` — but only when the user asked to skip it.

### Phase 6 Delivery Receipt (GATE — Full + Lite)

Phase 6 is NOT complete until you emit this receipt. It is the mechanical proof the quality passes ran. These passes are **required**, so only a reason the run cannot fix may excuse one: `skipped (not installed)`, `skipped (not dispatchable on this host)`, `skipped (tool unavailable: <tool>)`, or `skipped (disabled (<flag>))` for a flag **the user** passed. The walkthrough line's `Lite Mode — skipped` is not a skip reason either: Lite Mode produces no walkthrough, so that line records the mode, not a collapse. `trigger not met` is never admissible here — a required pass has no trigger to miss. A receipt line carrying any other reason, or no line at all, is a Phase 6 collapse — stop and run the missing pass before declaring delivery done.

```bash
# Deterministic check (Full Mode): the walkthrough MUST exist on disk.
test -f ".agent/$(git branch --show-current)/walkthrough.md" \
  && echo "receipt: walkthrough.md present" \
  || echo "receipt: walkthrough.md MISSING — Phase 6 incomplete, run aw-create-walkthrough"
```

Then emit, inline, a `### Phase 6 Delivery Receipt` block with one line per required sub-step, each either a real result or an explicit `skipped (<reason>)` (never silently omitted):

```
### Phase 6 Delivery Receipt
- aw-create-walkthrough: <walkthrough.md present | Lite Mode — skipped | skipped (<reason>)>
- create-pr → local review-loop (branch-reviewer pass): <N iterations, M findings, B open | skipped (<reason>)>
- create-pr → local review-loop (apply): <N findings applied, D declined | skipped (<reason>)>
- create-pr → local review-loop (polish simplify): <recipe IDs applied | none | skipped (<reason>)>
```

If any line above would be blank, or would carry a reason outside the admissible four, the pass was skipped in error: run it, then re-emit the receipt.

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| If missing | Report `skipped (not installed)`, then fall back to the manual flow below                               |
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

**Always use `--draft`.**

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 6: create-pr — ran (PR #XX opened as draft, CI watch started)
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
- [ ] `Skill("aw-create-walkthrough")` invoked (Full Mode)
- [ ] `Skill("create-pr", "--no-post-review")` invoked OR manual fallback executed
- [ ] PR opened as draft
- [ ] Local `review-loop` converged the branch before the push (via `create-pr` Step 5.5); open findings surfaced
- [ ] Walkthrough content shown inline in conversation (Full Mode)
- [ ] PR URL delivered to user
- [ ] Worktree preserved for review
- [ ] Phase 7 (CI gate) starts watching CI

## References

- Related rule: [phase-5-documentation](./phase-5-documentation.md)
- Related rule: [phase-7-ci-gate](./phase-7-ci-gate.md)
- Companion registry: [companion-skills.md](./companion-skills.md)
- Related skill: [aw-create-walkthrough](../../aw-create-walkthrough/SKILL.md)
- Related skill: [create-pr](../../../delivery/create-pr/SKILL.md)
