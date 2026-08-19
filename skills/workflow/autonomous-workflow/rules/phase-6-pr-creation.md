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
- [Findings Quality Gate](#findings-quality-gate)
- [Walkthrough](#walkthrough)
- [PR Creation](#pr-creation)
- [Delivery Checklist](#delivery-checklist)
- [References](#references)

## Overview

Hand the work off to the user as a reviewable DRAFT pull request — but only after a quality review and (in Full Mode) a generated walkthrough. This phase is orchestrated almost entirely through companion skills:

1. Pre-flight checks pass (build, lint, tests).
2. `Skill("aw-create-walkthrough")` (Full Mode) generates `.agent/{branch}/walkthrough.md`.
3. `Skill("create-pr")` writes the narrative description, pushes, opens the draft PR, runs the `review-loop` against the draft, and watches CI initialization.
4. The walkthrough content is shown inline in the conversation. **The PR is not "delivered" until the user has seen the walkthrough.**

Gate: walkthrough shown in chat, draft PR opened, CI watch started.

## Core Principles

- **Pre-flight validation**: build/lint/test must pass before invoking any companion.
- **Draft PR first, then review**: open the draft PR, then let `create-pr` run `review-loop` against it (`pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify`, up to 5 iterations, converging until every review thread is resolved via fix or reply).
- **Review is read-only at the PR level**: `pr-reviewer` posts findings; `implement-suggestion` applies them; `polish simplify` cleans up. No pre-push autofix from a retired agent.
- **Draft PR only**: never mark ready-to-merge automatically.
- **Show the walkthrough**: blocking — output the walkthrough content in chat after PR creation.
- **Preserve the worktree**: user may want to review or iterate locally; cleanup is Phase 7.

## Procedure (Order of Operations)

| Step | Action                                                                        | Required in     |
| ---- | ----------------------------------------------------------------------------- | --------------- |
| 1    | Pre-flight checks (clean tree, build, lint, test)                             | Full + Lite     |
| 2    | `Skill("aw-create-walkthrough")` → `.agent/{branch}/walkthrough.md`           | **Full only**   |
| 3    | `Skill("create-pr")` → push, open draft PR, run review-loop, watch initial CI | Full + Lite     |
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

After the draft PR is open, `create-pr` runs the `review-loop` skill against it as `Skill("review-loop", "<pr-url> --no-ci")` (`pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify`, up to 5 iterations, converging until every review thread is resolved via fix or reply). The `--no-ci` is not optional: Phase 7's CI gate owns the CI budget for this PR, so the loop must not spend a second one. The executor invokes `create-pr` bare — `create-pr` drives the loop, and passes that flag, internally.

The `review-loop` posts a `COMMENT` review via `pr-reviewer` (with `REVIEW_RELATION = self` since the executor authored the PR), applies findings via `implement-suggestion`, and runs `polish simplify` each iteration.
`pr-reviewer` loads the `code-quality` rubric on substantive diffs and walks the full review checklist — not just the comment pass.
Expect findings across correctness, holistic intent/system-fit, naming, complexity, comments, error handling, and (with `--critical`) the adversarial pre-mortem.

The `review-loop` skill gracefully skips if not installed — log one line and continue.

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| Skips silently if missing | Yes — if `review-loop` and `pr-reviewer` are absent, log and continue with manual diff review |
| Disable                   | Pass `--no-quality` to `create-pr` (not recommended; you lose the post-draft safety net) |

## Findings Quality Gate

**Anchor:** `findings-quality-gate`

`create-pr`'s `review-loop` handles the review → apply → simplify cycle.
If needed, run the optional false-positive filter over the final findings list:

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
| Disable                   | Remove this section; the raw `pr-reviewer` output is used directly     |

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 6: aw-review-quality-gate — N reviewed, X dropped, Y downgraded
- [TIMESTAMP] Phase 6: aw-review-quality-gate — not available, continuing
```

Handle the (filtered) review output:

| Verdict                | Action                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------- |
| No blocking issues     | Continue to walkthrough / PR creation                                               |
| Suggestions only       | Decide per suggestion: apply now, defer to follow-up, or note in PR description     |
| Blocking issues        | Fix in this branch, re-run pre-flight checks, then re-run `review-loop`             |

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 6: review-loop — invoked (N iterations; M findings applied; 0 blocking remaining)
```

Or, if `review-loop` is missing:

```markdown
- [TIMESTAMP] Phase 6: review-loop — not available, continuing (install review-loop skill from agent-skills.git)
```

## Walkthrough

**Full Mode only.** Generate `.agent/{branch}/walkthrough.md` to give the reviewer a narrative tour of the change.

```
Skill("aw-create-walkthrough")
```

The skill gathers context from `plan.md`, git history, and test results to produce the walkthrough. It writes to `.agent/{branch}/walkthrough.md` inside the worktree.

**Regenerate after the review-loop when it changed files.** The walkthrough is generated here, but `create-pr` Step 6.5 then runs `review-loop`, which applies findings and pushes new commits — so a walkthrough written before the loop describes the pre-review branch. If the `review-loop` applied any findings (`M findings applied > 0` in its Progress Log line), re-run `Skill("aw-create-walkthrough")` after the loop so the narrative matches the final pushed diff.

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

Invoke `create-pr` to handle the rest of the delivery in one go: narrative description generation, push, open the draft PR, run the `review-loop` against the draft, watch the initial CI run, and an external-bot reviewer-feedback loop.

**Invoke it BARE — never scale it down by default:**

```
Skill("create-pr")
```

A bare `create-pr` runs its FULL default pipeline: push → open draft PR → Step 6.5 delegates to `Skill("review-loop", "<pr-url> --no-ci")` (`pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify`, up to 5 iterations, converging until every review thread is resolved) → Step 6.7 runs the external-bot reviewer-feedback loop. **Do NOT pass `--no-review`, `--no-simplify`, `--quick`, `--no-quality`, or `--no-feedback`** unless the user explicitly asked to skip a pass.

> **Resource note — what the "save RAM" rule actually scopes.** This repo's resource guidance is about *execution cost only*: do not run `eslint` / `tsc` / tests **in parallel**, and do not spawn **parallel sub-agents** or **cascading full-verify rounds** (the 55+ GB OOM incident). It does NOT let you skip the quality passes. `create-pr`'s `review-loop` (`pr-reviewer`, `implement-suggestion`, `polish simplify`) and the Phase 6 quality gate are sequential reasoning passes — the single-sequential-loop variant is explicitly permitted. Skipping them to "save RAM" is a category error and a Phase 6 collapse (taxonomy F5).

What `create-pr` handles:

| Step                          | Owner       |
| ----------------------------- | ----------- |
| Description generation        | `create-pr` |
| `git push -u origin`          | `create-pr` |
| `gh pr create --draft`        | `create-pr` |
| Post-draft review loop        | `create-pr` Step 6.5 → `review-loop` (always with `--no-ci`) → `pr-reviewer` + `implement-suggestion` + `polish simplify` |
| Watch initial CI              | `create-pr` |
| External-bot reviewer-feedback | `create-pr` Step 6.7 |

### Phase 6 Delivery Receipt (GATE — Full + Lite)

Phase 6 is NOT complete until you emit this receipt. It is the mechanical proof the quality passes ran; an empty/`skipped`-only receipt without a `companion … not available` line is a Phase 6 collapse — stop and run the missing pass before declaring delivery done.

```bash
# Deterministic check (Full Mode): the walkthrough MUST exist on disk.
test -f ".agent/$(git branch --show-current)/walkthrough.md" \
  && echo "receipt: walkthrough.md present" \
  || echo "receipt: walkthrough.md MISSING — Phase 6 incomplete, run aw-create-walkthrough"
```

Then emit, inline, a `### Phase 6 Delivery Receipt` block with one line per required sub-step, each either a real result or an explicit `not available, continuing` (never silently omitted):

```
### Phase 6 Delivery Receipt
- aw-create-walkthrough: <walkthrough.md present | Lite Mode — skipped | not available, continuing>
- create-pr → review-loop (pr-reviewer pass): <N iterations, M findings, B blocking remaining | not available, continuing>
- create-pr → review-loop (implement-suggestion): <N findings applied | not available, continuing>
- create-pr → review-loop (polish simplify): <recipe IDs applied | none | not available, continuing>
- create-pr → external-reviewer-feedback loop: <stop reason + iterations | --no-feedback (only if user asked) | not available, continuing>
```

If any line above would be blank because the pass did not run AND no `not available` reason applies, the pass was skipped in error: run it, then re-emit the receipt.

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

**Always use `--draft`.**

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
- [ ] `Skill("aw-create-walkthrough")` invoked (Full Mode)
- [ ] `Skill("create-pr")` invoked OR manual fallback executed
- [ ] PR opened as draft
- [ ] `review-loop` ran against the draft PR (via `create-pr` Step 6.5); blocking issues resolved
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
