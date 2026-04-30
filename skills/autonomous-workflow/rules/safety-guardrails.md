---
title: 'Safety Guardrails'
impact: CRITICAL
tags:
  - safety
  - guardrails
  - limits
  - rollback
---

# Safety Guardrails

## Overview

Validation checkpoints, resource limits, and rollback procedures for the
autonomous workflow. These guardrails prevent runaway execution and enable
clean recovery.

---

## Validation Checkpoints (per Phase)

| Phase | Gate / Checkpoint                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------- |
| 0     | Mode selected (Full / Lite). User confirmed understanding.                                         |
| 1     | Plan matches requirements. `Skill("confidence", "plan")` >= 90% (mandatory companion).             |
| 2     | Worktree created with `gw add` (or native `git worktree add` fallback). CWD is the worktree. Deps installed. `plan.md` written under `.agent/{branch}/` (Full Mode). |
| 3     | Working in isolated worktree. Build/lint passes after each edit. `code-quality(code)` run at end.  |
| 4     | All tests pass OR user-approved stop after stuck-loop escalation.                                  |
| 5     | Docs reflect changes. `Skill("update-claude")` run.                                                |
| 6     | `Skill("review-changes")` clean. Walkthrough shown. Draft PR opened via `Skill("create-pr")`.      |
| 7     | CI green OR user-approved stop. Optional `gw remove` (or `git worktree remove` + `git branch -d`) after merge. |

See each `phase-N-*.md` rule for full gate details.

---

## Self-Validation Questions

| After Phase | Ask                                              |
| ----------- | ------------------------------------------------ |
| Phase 1     | Can I explain the approach in 2 sentences?       |
| Phase 2     | Is `git worktree list` showing the new worktree? (or `gw list` if `gw` is installed) |
| Phase 3     | Does code compile and lint pass?                 |
| Phase 4     | Are ALL tests passing (or stop user-approved)?   |
| Phase 5     | Do docs match the implementation?                |
| Phase 6     | Is the PR description accurate and walkthrough shown? |
| Phase 7     | Are CI checks green (or escalation explicit)?    |

---

## Stuck-Loop Limit (Phase 4)

**Mode-aware cap: 3 iterations (Lite Mode) / 5 iterations (Full Mode) on the same failing area.**

| Mode      | Cap | At cap                                                                                  |
| --------- | --- | --------------------------------------------------------------------------------------- |
| Lite Mode | 3   | Stop. Run `Skill("confidence", "bug-analysis")`. Auto-replan or escalate to user.       |
| Full Mode | 5   | Stop. Run `Skill("confidence", "bug-analysis")`. Auto-replan or escalate to user.       |

The mode-aware cap is the single biggest cost-saver in the workflow. More
than the cap on the same failing area almost always means the mental model
is wrong — continuing burns tokens without converging.

See [companion-skills.md#stuck-loop-protocol-phase-4](./companion-skills.md#stuck-loop-protocol-phase-4) for the full auto-replan protocol.

---

## Tool Prerequisites

| Tool   | Status        | Behavior if missing                                                       |
| ------ | ------------- | ------------------------------------------------------------------------- |
| `gh`   | **REQUIRED**  | Stop. Phase 6 (PR creation) and Phase 7 (CI gate) cannot proceed.         |
| `gw`   | Recommended   | Continue with native `git worktree` fallback; emit one-time warning. See [prerequisites#fallback-to-native-git-worktree](./prerequisites.md#fallback-to-native-git-worktree). |

**`gw` is NOT a hard prerequisite.** The workflow falls back to native
`git worktree` when `gw` is missing. Only `gh` is hard-required.

## Companion-Skill Safety

| Companion           | Safety-critical? | Behavior if missing                          |
| ------------------- | ---------------- | -------------------------------------------- |
| `confidence` (Phase 1) | **Yes** — the plan gate | Stop, ask user to install before continuing |
| All other companions  | No                       | Log one line, continue without              |

**Companions are NOT safety-critical** — the workflow continues without them.
The ONLY non-removable companion is `confidence` at Phase 1.

When a companion is unavailable, log to conversation and `plan.md` Progress
Log:

> `companion: <name> — not available, continuing`

---

## Resource Limits

### Soft Limits (Guidelines)

- Commits: ~3-10 per feature
- Files changed: ~20 max
- Time: ~1-2 hours

### Hard Limits (Stop and Ask)

| Limit                                  | Action                          |
| -------------------------------------- | ------------------------------- |
| > 50 files changed                     | Scope too large — split PRs     |
| > 3 hours stuck                        | Fundamental issue — escalate    |
| > 100 commits                          | Approach is wrong — escalate    |
| 3 iterations on same failing area      | Run `confidence(bug-analysis)`, escalate |
| 2 `ci-auto-fix` handoffs on same PR    | Stop, surface failures to user  |

---

## When to Stop and Ask

1. Requirements ambiguous mid-implementation.
2. Fundamental blocker encountered.
3. Scope creep detected.
4. Tests reveal misunderstanding.
5. Resource limits approaching.
6. Stuck-loop cap (3 iterations) hit.
7. Critical companion (`confidence`) unavailable.

### How to Ask

```markdown
"Pausing autonomous execution — need guidance.

**Situation:** [what happened]

**Issue:** [the blocker]

**Options:**

1. [Option A] — [pros/cons]
2. [Option B] — [pros/cons]

**My recommendation:** [which and why]

**Question:** [specific question]

Should I proceed with [recommended] or [alternative]?"
```

---

## Quality Gates

**Before each phase transition:**

- Previous phase checklist complete
- Self-validation passed
- No blocking errors
- Clear to proceed

**Before Phase 3 (CRITICAL GATE):**

- Phase 2 complete — worktree created
- Currently in worktree directory (NOT user's original directory)
- Dependencies installed
- Build system works
- `plan.md` written under `.agent/{branch}/` (Full Mode)

**If this gate fails, return to Phase 2.**

---

## Rollback Procedures

```bash
# Undo uncommitted changes
git checkout .

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Return to starting point
git reset --hard origin/main

# Remove worktree entirely
gw remove <branch-name> --force                       # with gw
# or, native fallback:
git worktree remove "$WORKTREE_PATH" --force \
  && git branch -D <branch-name>
```

---

## Checkpoint Failure Protocol

If validation fails:

1. Do NOT proceed to next phase.
2. Analyze what went wrong.
3. Fix the issue.
4. Re-validate.
5. Only proceed when validation passes.

---

## References

- Related rule: [companion-skills](./companion-skills.md)
- Related rule: [error-recovery](./error-recovery.md)
- Related rule: [decision-framework](./decision-framework.md)
- Related rule: [phase-4-testing](./phase-4-testing.md)
- Related rule: [phase-7-ci-gate](./phase-7-ci-gate.md)
