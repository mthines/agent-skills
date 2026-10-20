---
title: Fix loop — root-cause, fix, re-verify, one commit per finding
impact: HIGH
tags:
  - fix
  - commits
  - re-verification
---

# Fix loop

Phase 4 fixes findings autonomously, highest severity first, and proves each fix with the exact probe that found it.
Runs on `local` only; skipped under `--no-fix` and on `preview`: every finding stays `open` and the report says so.

## Scope

| Finding | Action |
| --- | --- |
| `in_scope: true`, any severity | Fix |
| `in_scope: false`, `critical`/`high`, fix touches ≤ 2 files the PR already changes | Fix, and label it `pre-existing` in the commit and report |
| `in_scope: false`, anything else | Do not fix; report with a suggested follow-up ticket title |
| Needs a product decision the ticket does not settle, after the precedent search below | `escalated` with the options and your recommendation |
| Cause is outside this repo (infra, a third-party API, dev-cluster data) | `escalated` with evidence |

## Per finding

1. **Reproduce** with the probe that found it (spec, curl, or trace). Cannot reproduce → re-run once; still no → `wont-fix (not reproducible)` with both attempts as evidence.
2. **Root-cause.** Start at the deepest failing span or the component that rendered the bad state; read the code path end to end. Fix the cause, never the symptom:

   ```ts
   // ❌ hides the crash the probe found
   try { await saveView(input) } catch {}
   // ✅ handles the failure the edge case defines
   const result = await saveView(input)
   if (!result.ok) { setFieldError(result.error); return }
   ```

3. **Decide "right" by precedent** when the expected behavior is unclear:
   1. the ticket and PR say → do that;
   2. the codebase already solves the same situation (grep the nearest sibling feature's empty/error/loading handling) → match it;
   3. still unclear → apply the `ux` skill to the component and follow its recommendation;
   4. record which of the three decided it, in one line, on the finding.
4. **Guard it.** Add or extend the nearest test (unit, component, or table test) so the failure is caught without a stack. Skip only when no test harness covers that layer, and say so.
5. **Rebuild** per [`local-stack.md § Step 4`](./local-stack.md#step-4--rebuild-after-a-fix).
6. **Re-verify** the original probe, then have `telemetry-verify` re-read its new window. Fail → back to step 2, max 3 attempts, then `escalated`.
7. **Check for collateral.** Run the affected package's fast tests and re-run the AC specs that share the changed file.
   Test command, first that applies: `.agents/aw/notes.md` → the repo's `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` → the manifest (`package.json` `test` script, `go test ./<pkg>/...`, `pytest <dir>`, `cargo test -p <crate>`).
8. **Commit** only the files of this fix, in the repo's commit format, first that applies:
   a `commit` skill in the repo (`.agents/skills/commit/SKILL.md`, `.claude/skills/commit/SKILL.md`) → `.agents/aw/notes.md` → `CONTRIBUTING.md` → the style of the last 20 commits (`git log --format=%s -20`) → Conventional Commits.
   Put the finding ID and the trace or screenshot evidence in the body (`# Why` below).

   ```text
   fix(views): keep form input when saving a view fails

   # Why
   verify F-4 (EC-9): a 500 from POST /api/views cleared the form and showed a blank toast.

   # What
   Save handler returns the API error to the form and renders it inline; adds a component test for the failed-save path.
   ```

9. Update the finding: `status: fixed`, `fix_commit`, `reverified`.

## Delegates that refuse `Skill()`

Some repo skills are slash-only (`disable-model-invocation: true`); `.agents/aw/notes.md` lists known ones.
When `Skill("<name>", …)` is refused, read the repo's copy (`.agents/skills/<name>/SKILL.md` or `.claude/skills/<name>/SKILL.md`) and follow it in this context.
A personal install of the same name may be model-invocable; prefer `Skill()` when it works.

## Push

After the last fix, once all touched tests pass:

| `policies.push` (or `--no-push`) | Action |
| --- | --- |
| `always` | `git push` |
| `own-prs` | Push only when `gh pr view --json author` matches `gh api user --jq .login`; otherwise leave commits local and say so |
| `never` / `--no-push` | Leave commits local |

Never force-push. A rejected push (the branch moved) → `git pull --rebase`, re-run the AC specs, then push.

## Common mistakes

- One commit for all fixes. **Fix:** one finding, one commit; a reviewer must be able to revert one.
- Marking fixed after the unit test passes. **Fix:** fixed means the original browser or API probe now passes and its telemetry window is clean.
- Fixing a finding by loosening the spec. **Fix:** a spec changes only when the ticket proves the spec wrong; that is `spec-drift`, reported.
