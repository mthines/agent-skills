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
Runs on your own PR (`local` or `preview`) and on a branch with no PR yet ([Own PR](#own-pr-fix-until-verified)); never on someone else's PR, and not under `--no-fix`: there every finding stays `open` and the report says so.

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

## Own PR: fix until verified

The PR is yours when `gh pr view <pr> --json author --jq .author.login` matches `gh api graphql -f query='{ viewer { login } }' --jq .data.viewer.login`, both lowercased with one trailing `[bot]` stripped; an unknown viewer means it is not.

| PR | Do |
| --- | --- |
| Your own PR, `local` or `preview` | Iterate: fix every open in-scope finding (§ Per finding), push, re-verify, re-render the verdict. Stop at `✅ verified`, or after **at most 3 iterations**; then post the report |
| Someone else's PR | Report only: no fixes, no pushes; `preview` findings go to `review-loop --ui` |
| No PR yet | § Per finding on `local`, same cap; the caller posts later with `report <pr-url>` |

One iteration on `preview`:

1. Work in a checkout of the PR's head branch (`gw checkout <head-ref>` when this one is not on it); never fix in a detached copy.
2. Fix and commit each finding per § Per finding, guard tests included, then push (own PR: `policies.push: never` or `--no-push` ends the loop with `fixes committed, not pushed`).
3. Wait for the preview of the new head SHA (ui-verify's `--wait-preview`), then re-run the specs and probes that failed, plus every AC spec, and re-read their telemetry window.
4. `✅ verified` → stop. Otherwise the next iteration takes the findings still open.

At the cap, post the report with the open findings as `open` and their attempts as evidence; never loop a 4th time.
The comment is written once, after the last iteration, so it describes the final head SHA.

## Delegates that refuse `Skill()`

Some repo skills are slash-only (`disable-model-invocation: true`); `.agents/aw/notes.md` lists known ones.
When `Skill("<name>", …)` is refused, read the repo's copy (`.agents/skills/<name>/SKILL.md` or `.claude/skills/<name>/SKILL.md`) and follow it in this context.
A personal install of the same name may be model-invocable; prefer `Skill()` when it works.

## Push

After the last fix, once all touched tests pass:

| `policies.push` (or `--no-push`) | Action |
| --- | --- |
| `always` | `git push` |
| `own-prs` | Push when the PR is yours ([Own PR](#own-pr-fix-until-verified) names the check); with no PR yet, leave commits local and say so. Someone else's PR has no fix commits to push |
| `never` / `--no-push` | Leave commits local |

Never force-push. A rejected push (the branch moved) → `git pull --rebase`, re-run the AC specs, then push.

## Common mistakes

- One commit for all fixes. **Fix:** one finding, one commit; a reviewer must be able to revert one.
- Marking fixed after the unit test passes. **Fix:** fixed means the original browser or API probe now passes and its telemetry window is clean.
- Fixing a finding by loosening the spec. **Fix:** a spec changes only when the ticket proves the spec wrong; that is `spec-drift`, reported.
