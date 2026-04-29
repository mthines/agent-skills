---
title: 'Error Recovery Procedures'
impact: HIGH
tags:
  - errors
  - recovery
  - troubleshooting
---

# Error Recovery Procedures

## Overview

Recovery procedures for common errors during autonomous execution. Don't give
up on errors — diagnose and recover. Where a companion skill is unavailable
or a stuck-loop trips, the workflow has explicit fallback paths so it never
gets stuck silently.

---

## Worktree Creation Failures

**Error:** `gw add` fails

| Cause                 | Fix                                    |
| --------------------- | -------------------------------------- |
| Branch already exists | Use different name or `gw cd <branch>` |
| Permission error      | Check directory permissions            |
| Disk space issue      | Run `gw prune`, free space             |
| Git error             | Read message, fix underlying issue     |

---

## Dependency Installation Failures

**Error:** `npm install` (or equivalent) fails

| Cause                   | Fix                                          |
| ----------------------- | -------------------------------------------- |
| Network error           | Check connection, try different registry     |
| Version incompatibility | Check node requirements, switch version      |
| Lock file mismatch      | Delete lock file and `node_modules`, reinstall |
| Disk space              | Clean cache (`npm cache clean --force`)      |

---

## Test Failures During Iteration

See [phase-4-testing](./phase-4-testing.md) for the full iteration strategy.

**Quick reference (3-iteration cap):**

| Iteration | Action                                                       |
| --------- | ------------------------------------------------------------ |
| 1         | Read error, fix the most likely cause                        |
| 2         | Re-read error in light of attempt 1; adjust mental model     |
| 3         | This is the cap. Run `Skill("confidence", "bug-analysis")`,  |
|           | summarize attempts, escalate to user                         |

After 3 iterations on the same failing area, **stop guessing**. Token spend
beyond this rarely converges.

---

## Stuck-Loop Hit at 3 Iterations

**Detection:** Same failing test or area attempted 3 times without resolution.

**Recovery (mandatory):**

1. Run `Skill("confidence", "bug-analysis")` to root-cause the failure.
2. Append to `plan.md` Progress Log: a one-line summary of each prior attempt
   plus the confidence findings.
3. Present to the user:
   - The 3 attempts (what was tried, why each failed)
   - Confidence findings (root cause, blocked assumptions)
   - Three options: **continue** with new approach / **try a different angle**
     (e.g. holistic-analysis) / **stop and hand back**
4. Wait for user response. **Never auto-continue past iteration 3.**

If the user asks for a fresh analysis, invoke
`Skill("holistic-analysis")` to step back and re-trace the execution path
end-to-end before attempting again.

---

## Companion Skill Not Available

**Detection:** A companion skill is invoked but isn't installed in this
project (Claude returns an error from the Skill tool).

**Recovery:**

1. Log one line in the conversation:
   `companion: <name> — not available, continuing`
2. Append the same line to `plan.md` Progress Log (Full Mode).
3. Continue the workflow. **Never block on a missing companion.**

The only companion that cannot be skipped is `confidence` at Phase 1 (the plan
gate). If `confidence` itself is unavailable, stop and ask the user to
install it before continuing.

---

## Build Failures

| Cause              | Fix                                       |
| ------------------ | ----------------------------------------- |
| TypeScript error   | Fix type issues, add missing types        |
| Missing dependency | Install missing package                   |
| Path/import error  | Check file locations, fix imports         |
| Config error       | Review build config, restore working copy |

---

## CI Failures (Phase 7)

When CI runs complete with status `failure`:

1. Identify the failed checks (`gh pr checks <pr>`).
2. For each independent failure, invoke `Skill("ci-auto-fix", "<run-id|pr-url>")`.
3. Up to 2 parallel `ci-auto-fix` handoffs per PR (see
   [parallel-coordination](./parallel-coordination.md)).
4. If `ci-auto-fix` is not installed: log
   `companion: ci-auto-fix — not available, continuing` and surface the failed
   checks to the user with reproduction commands.

See [phase-7-ci-gate](./phase-7-ci-gate.md) for details.

---

## Agent-Specific Recovery

### Hallucinated Commands

| Hallucinated Command | Correct Command           |
| -------------------- | ------------------------- |
| `gw create`          | `gw checkout` or `gw add` |
| `gw switch`          | `gw cd`                   |
| `gw delete`          | `gw remove`               |
| `gw new`             | `gw checkout`             |

### Stuck in Loop

**Detection:** Same fix attempted 3 times without progress (covered above
under "Stuck-Loop Hit at 3 Iterations").

### Context Loss

**Detection:** Agent re-does completed work or asks already-answered questions.

**Recovery:**

1. Read `.agent/{branch}/plan.md` for full context (decisions, progress,
   requirements).
2. Check Progress Log for what's been completed and which companions ran.
3. Resume from where the log left off.

---

## References

- Related rule: [phase-4-testing](./phase-4-testing.md)
- Related rule: [phase-7-ci-gate](./phase-7-ci-gate.md)
- Related rule: [companion-skills](./companion-skills.md)
- Related rule: [safety-guardrails](./safety-guardrails.md)
