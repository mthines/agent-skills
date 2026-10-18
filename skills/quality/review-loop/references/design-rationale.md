---
title: review-loop — why the loop is shaped the way it is
impact: LOW
tags:
  - review-loop
  - rationale
---

# review-loop design rationale

Read on demand.
The rules live in [`SKILL.md`](../SKILL.md) and `rules/`; this file explains them.

## Contents

- [Convergence](#convergence)
- [Dispatch](#dispatch)
- [The named dispatch](#the-named-dispatch)
- [Iteration 1 apply-first](#iteration-1-apply-first)
- [Sub-step D — CI](#sub-step-d--ci)
- [Only `polish simplify`](#only-polish-simplify)
- [Step 1.6](#step-16)
- [`--merge`](#--merge)
- [Report](#report)
- [Relationship to other skills](#relationship-to-other-skills)

## Convergence

A thread is resolved when it is either fixed (a code change landed) or answered (a reply: the answer to a question, the agent's take on a discussion, or a rationale for a declined suggestion).
The only threads left open at convergence are human-judgment flags: a real potential issue the agent will neither auto-apply nor honestly decline.
That safety valve means the loop cannot green-wash a PR by resolving a live finding — it surfaces it instead.

The no-progress guard counts a `ci-auto-fix` push as progress, so a red-CI iteration that fixed nothing else still gets a re-review.
Two of the four exits (report-only and clean convergence) land straight after a review pass; the no-progress guard and the cap land after a push, which is why the post-loop block re-reads state instead of describing those exits as validated by a final review.
The post-loop gate reads `STOP_REASON`, never `ITERATION == CAP`: report-only forces `CAP=1`, and a clean convergence on the last allowed iteration also ends with `ITERATION == CAP`.

## Dispatch

**The dispatch tool is a capability.** `Task` is the Claude Code CLI's name for it; the Claude Agent SDK harness behind Claude Code on the web and in cloud sessions names it `Agent`.
A `Task`-only check skips the review on every cloud session and reports the PR as unreviewable, and the failure is invisible because a skip is a legitimate outcome.

**Top level only.** Most harnesses give a dispatched sub-agent no dispatch tool under any name: Dash0 Agent0 sub-agents cannot delegate further by platform design, and a Claude Agent SDK sub-agent has neither `Task` nor `Agent`.
A caller that dispatches the loop spends the delegation budget one level too high and leaves the loop nothing to dispatch `pr-reviewer` with.

**One skip is conclusive.** An absent dispatch tool is a property of the dispatch topology, decided before any code is read; a retry costs a round trip and cannot change the outcome.

**No in-context reviewer.** Review independence comes from a fresh, isolated context, so playing the reviewer yourself produces a self-review wearing a reviewer's label, which is worse than no review.
A `general` sub-agent that reads the `pr-reviewer` definition runs in its own fresh context, so it is a route, not a substitute.

**Without a review there is nothing to converge.** Running `polish simplify` alone after a skipped review would misreport an unreviewed PR as converged.

**The check is best-effort.** There is no capability-introspection API, and a refused dispatch may surface as an uncatchable harness error.
Its value is placement: one clean logged deviation at Step 0 instead of a mid-run error the caller has to interpret.

**A dispatch tool without the `pr-reviewer` type is a route.** Agent0 sessions without a setup script have a `task` tool offering `explore` and `general`; treating the missing type as "no reviewer" skipped every `/review-loop` there although rows 2–4 exist for exactly that host.

## The named dispatch

A bare `<dispatch>(subagent_type="pr-reviewer", …)` loses four things the `/pr-review` Step 2 shape provides:

- One shared prepare: the intent worker reads the same `context.json` instead of preparing its own, and the apply-first check reads it before anything is dispatched.
- The intent worker: the dispatched reviewer holds no dispatch tool, so a bare call runs a `hybrid` budget's intent finder in-context, which measurably misses the highest-severity defects an isolated intent finder catches.
- The dispatch stamp: the time the agent spends loading its definition becomes a `load` step instead of an unexplained gap after `prepare`.
- `--repo-dir`: without it the reviewer's workspace rung 0 is skipped and it clones over the network, which can fall through to a failed tarball and a restart.

## Iteration 1 apply-first

When the last `pr-reviewer` review judged the current head, a re-review re-reads code that review already judged and can only carry its findings forward; the skipped pass is the reviewer's fixed cost (loading its definition, the gate checks, re-posting).

| Condition | Why it is required |
| --- | --- |
| `ITERATION == 1` | Every later iteration must review the previous iteration's push |
| `NO_FEEDBACK == 0` | Report-only runs only sub-step A; skipping it leaves the run nothing to do |
| `.mode == "zero-delta"` | The head is the commit the last review judged, so a re-review would re-read nothing |
| `OPEN >= 1` | With no open thread, the zero-delta review is what lets iteration 1 converge without pushing; skipped, a finished PR goes to `polish simplify` and gets new commits |
| `REPLIED == 0` | A reply is the one thing a zero-delta review acts on — it resolves a thread the author declined; skipped, sub-step B meets that thread still open |

`NEW_FINDINGS = true` on the skip keeps iteration 1 off the convergence exit, so convergence and `--merge` always follow a review pass.
The block is one self-contained Bash call because shell state does not survive between tool calls.

## Sub-step D — CI

The check-state read is a query, not a watch: it adds no `gh … --watch` site and spends nothing from the watch budgets `create-pr` Step 8 and `autonomous-workflow`'s `phase-7-ci-gate.md` each count inside their own invocation.
`ci-auto-fix` keeps its own local counter, so no budget is shared or carried across contexts.

- **The `pending` re-read.** Sub-step D reads seconds after its own push, so `pending` is its usual answer; converging on the first one means converging on a build no check has finished. Exactly one re-read, because re-reading until terminal would turn a loop that never waits for CI into a busy-wait. `implement-suggestion`'s `watch-mode.md` applies the same rule before its own stop.
- **The `unread` arm.** Iteration 1 can reach the convergence exit before sub-step D has ever run (a PR that arrives reviewed and thread-clean); without the arm the loop would converge without looking at CI.
- **The reset after a handoff.** A `ci-auto-fix` handoff pushes a fix, so the recorded `red` describes a commit that is no longer head.
- **Cap 2.** It matches the per-PR cap the other two orchestrators use; each handoff already burns a full internal retry budget.

## Only `polish simplify`

The `simplify` mode applies Class M mechanical refactors and dispatches no `pr-reviewer`.
Every other `polish` mode runs an internal reviewer pass, which would create a dispatch cycle.

## Step 1.6

- **`--unattended`.** The step runs at the end of a loop the caller expects to finish on its own; a question would block forever in an automation and fail outright on a host with no ask-user tool.
- **No `--url`.** The deployments API has no `mcp__github__*` equivalent, so on the `mcp` access path `ui-verify run` returns `inconclusive: no access path for deployment lookup (pass --url)`. A second URL resolver here would be a drift surface against `ui-verify`'s `preview-url-resolution.md`.
- **Report-only.** It matches `autonomous-workflow`'s Phase 7 rehearsal, which also never auto-undrafts on the spec verdict; the verdict is surfaced for the human undrafting the PR. `autonomous-workflow` passes `--no-preview-run` because Phase 7 rehearses the same specs; `create-pr` does not, so a hand-driven UI PR gets its authored spec verified here.
- **At most once.** Each run spends a full `aw-tester` Playwright dispatch plus the adversarial pass's own dispatch.
- **The catch-all row.** A delegate that gains an outcome the table has no row for would otherwise be recorded as whatever the run guesses, a pass or a skip.

## `--merge`

- The override of *never undraft* is scoped to `--merge`; a caller that did not pass the flag never reaches Step 2.5.
- The loop's last review judges the body as it was before Step 2 rewrote it, so a `Description vs. code` warning the refresh fixed would block every `--merge` run that applied code without the post-refresh re-review.
- Zero open threads is implied by clean convergence, but it is re-read because merging is irreversible.
- `--merge` + `--no-feedback` is refused: `--no-feedback` applies nothing and never converges, so there is no approval to merge on.

## Report

Report the `STOP_REASON` the loop set, never one re-derived from the iteration count: `Iterations: 1 of 1` is what report-only, a first-iteration convergence, and a `CAP=1` run all look like.
The skip tokens are distinct because their fixes differ: a nested dispatch is a caller bug with a same-day fix, an absent dispatch tool is the environment.
Report-only means a review ran and its findings were not applied — the opposite of a PR that was never reviewed — so a skip is never reported as report-only.

## Relationship to other skills

| Skill | Relationship |
| --- | --- |
| `pr-reviewer` | Sub-step A: the find pass (read-only); resolves its own addressed threads on re-review. Skipped on iteration 1 when its last review still stands |
| `implement-suggestion --resolve-all` | Sub-step B: the apply + resolve pass, single-shot (no `--watch`) |
| `polish simplify` | Sub-step C: the cleanup pass; only the simplify mode |
| `create-pr` description contract | Step 2 reuses it for the PR-description refresh |
| `polish` (bare) | Downstream, not a caller: its Pass A invokes `pr-reviewer` directly and never calls `review-loop` |
| `create-pr` | Upstream caller: delegates post-draft review to `review-loop` |
| `autonomous-workflow` Phase 6/7 | Invokes `review-loop` with `--no-ci` and `--no-preview-run` |
| `ci-auto-fix` | Sub-step D: dispatched on a red check, capped at 2 handoffs per run |
| `ui-verify run` | Step 1.6 at exit, report-only; under `--ui`, replaced by the lane (`rules/ui-lane.md`) |
| `implement-suggestion --watch` | Sibling, never nested: `--watch` waits on an out-of-process reviewer; this loop dispatches its own |
