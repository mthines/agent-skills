---
name: create-pr
description: >
  Writes a short narrative PR description (≤ 25 lines, hard ceiling 40), converges the branch with
  review-loop in local mode, pushes, opens a draft PR, runs review-loop until every thread is resolved, and hands red
  CI to ci-auto-fix. Flags: --split (2–4 dependency-ordered draft PRs), --quick, --no-review,
  --no-simplify, --no-quality, --no-pre-review, --no-post-review, --no-ui-verify, --no-media; invoke with /create-pr.
disable-model-invocation: false
argument-hint: '[--split] [--quick] [--no-pre-review] [--no-post-review] [--no-review] [--no-simplify] [--no-quality] [--no-ui-verify] [--attach <file>] [--no-media]'
license: MIT
metadata:
  author: mthines
  version: '4.0.0'
  workflow_type: command
---

# Create Pull Request

Write a short, narrative PR description that tells reviewers *why* the change exists and *what* to expect in the diff, open it as a draft, converge it, and watch CI.

## Contents

- [Modes](#modes)
- [Step 0: Resolve your GitHub access path](#step-0-resolve-your-github-access-path)
- [Steps 1–5: Write the title and body](#steps-15-write-the-title-and-body-shared-contract)
- [Step 5.5: Pre-push branch convergence](#step-55-pre-push-branch-convergence-local-review-loop)
- [Step 6: Push and Create Draft PR](#step-6-push-and-create-draft-pr)
- [Step 6.2: Attach media](#step-62-attach-screenshots-and-recordings-delegated-to-attach-media)
- [Step 6.4: UI verification spec](#step-64-author-the-ui-verification-spec-default-on-for-ui-changes)
- [Step 6.5: Post-draft quality loop](#step-65-post-draft-quality-loop-delegated-to-review-loop)
- [Step 7: Wait for CI](#step-7-wait-for-ci-to-settle) · [Step 8: Red CI](#step-8-hand-red-ci-to-ci-auto-fix) · [Step 10: Report](#step-10-report)
- [Split Mode](#split-mode---split) · [Anti-patterns](#anti-patterns-to-avoid)

## Modes

Parse `$ARGUMENTS`. `--split` selects an alternate workflow; the other flags scale down the default full review + simplify loop (Step 6.5) and compose with both workflows.

| Mode / Flag | Trigger | Behaviour |
| --- | --- | --- |
| `default` | No flag | One PR for the whole branch; Step 6.5 runs `Skill("review-loop", "<pr-url> --no-ci")`. |
| `split` | `--split`, `-s`, or first positional token `split` | 2–4 dependency-ordered draft PRs (hard cap 5), executed only after user approval. See [Split Mode](#split-mode---split). |
| `no-review` | `--no-review` | Step 6.5 runs only `polish simplify` once. |
| `no-simplify` | `--no-simplify` | Step 6.5 runs only `pr-reviewer` (one-shot, no apply). |
| `quick` | `--quick` | Step 6.5 runs only `Skill("polish", "quick")`. |
| `no-quality` | `--no-quality` anywhere | Skip Step 6.5 entirely. Wins over every other quality flag. |
| `no-ui-verify` | `--no-ui-verify` anywhere | Skip the default-on Step 6.4. |
| `no-pre-review` | `--no-pre-review` anywhere | Skip the default-on Step 5.5. |
| `no-post-review` | `--no-post-review` anywhere | Skip Step 6.5 only; the PR gets no posted review. `aw` passes it because the branch already converged locally. |
| `attach` / `no-media` | `--attach <file>` (repeatable) / `--no-media` | `--attach` adds a local file to Step 6.2 ahead of the branch's captures; `--no-media` skips Step 6.2. |

`rules/legacy-flags.md` — read when `$ARGUMENTS` carries `--review`, `--simplify`, `--pre-review`, `--no-feedback`, or `--no-preview-spec`.

## Step 0: Resolve your GitHub access path

Before any GitHub step, resolve which path you have — `gh` CLI, `mcp__github__*` tools, or neither — per **[`agents/shared/rules/github-access.md`](../../../agents/shared/rules/github-access.md)**. Resolve once, state the path you took, and use it for the whole run.

`gh` is absent in Claude Code cloud sessions; the commands below are the `gh`-path form, so on the MCP path use that file's verb mapping. With **neither** path, say so precisely, do the `git` work you can, and hand the rest back — never report a step you could not perform as blocked-by-something-else.

## Steps 1–5: Write the title and body (shared contract)

Follow **[`rules/description-contract.md`](./rules/description-contract.md)** (gather information → understand the narrative → choose output format → write the title → length self-check); `review-loop` uses the same contract.
If its Step 5 length self-check says the PR is too big, offer `/create-pr --split` instead of expanding the body.
If you can't infer the *why* / *what* from the diff, ask the user — never pad with guesses.
Worked examples: [`rules/description-examples.md`](./rules/description-examples.md).

## Step 5.5: Pre-push branch convergence (local `review-loop`)

Runs by default, in both default and split mode; skip on `--no-pre-review`, `--no-quality`, `--no-review`, or a non-code diff.
[`review-loop`](../../quality/review-loop/SKILL.md) with no PR reference runs local mode: it dispatches `branch-reviewer` with zero GitHub calls, so the draft opens already converged.

| Mode | Invoke |
| --- | --- |
| default | `Skill("review-loop", "--cap 3")` |
| split (`--split`) | `Skill("review-loop", "")` |

`rules/pre-push-review.md` — read when entering this step (skip conditions, handling each return, the outcome value for Step 10). Load-bearing:

- **Surface every `flagged` finding to the user before pushing.**
- **Absent sub-agent dispatch is `NOT REVIEWED`, never a skip.**
- **Record the outcome now**, before continuing. Step 10's slot for it is mandatory on every run.

## Step 6: Push and Create Draft PR

Open the PR as a **draft** so `pr-reviewer` can post inline comments during Step 6.5.

```bash
git push                    # tracking already configured by gw add

gh pr create --draft \
  --title "<imperative title>" \
  --body "$(cat <<'EOF'
<your narrative description>
EOF
)"
```

Capture the PR URL/number from the output.

## Step 6.2: Attach screenshots and recordings (delegated to `attach-media`)

Skip on `--no-media`. Otherwise `rules/attach-media-step.md` — read now: it selects up to 6 images and 2 videos (`--attach` files, then this branch's captures newer than the merge base) and delegates to `Skill("attach-media", "<pr-url> <file>#<alt> ... --to body")`.
Record its first report line for Step 10. Never write a media placeholder.

## Step 6.4: Author the UI verification spec (default ON for UI changes)

**Skip this step** when `--no-ui-verify` or `--no-quality` is in `$ARGUMENTS`, or when `ui-verify` is not installed (`Skill()` raises — catch, log one line, continue).

Do not eyeball the diff to decide whether it is UI: `ui-verify author` decides mechanically with its shared `is-ui-diff` gate and returns `not authored (no UI files in diff)` for a non-UI diff.
So delegate unconditionally when neither skip condition holds:

```
Skill("ui-verify", "author <pr-url>")
```

`ui-verify` edits the PR body in place, adding one `<!-- ui-verify:v2 -->` block; the block is exempt from the length budget and preserved by the review-loop's description refresh ([description contract](./rules/description-contract.md#ui-verification-spec-optional)).
Continue to Step 6.5 regardless. This step only authors; Step 6.5's `review-loop` runs the spec against the preview once at exit (do not pass `--no-preview-run`).

**Record which branch you took, now, before continuing.** Write down exactly one of the six values for the Step 10 `UI verify` slot:

| What happened here | Record |
| --- | --- |
| Delegated, `ui-verify` reported `<N>` specs authored | `authored (<N> specs)` |
| Delegated, and `ui-verify`'s `is-ui-diff` gate found no UI files in the diff | `not authored (no UI files in diff)` |
| Skipped: `--no-ui-verify` in `$ARGUMENTS` | `skipped (--no-ui-verify)` |
| Skipped: `--no-quality` in `$ARGUMENTS` | `skipped (--no-quality)` |
| Skipped: `Skill()` raised — `ui-verify` not installed | `skipped (ui-verify not available)` |
| Delegated, and `ui-verify` reported a failure — including its own `failed (no GitHub access path)`, which means the block never reached the PR body | `failed (<reason>)`, quoting its reason verbatim |

Never soften the last row into a skip: a `failed` return means no block exists for any later reader to run.

## Step 6.5: Post-draft quality loop (delegated to `review-loop`)

Skip entirely on `--no-quality`, `--no-post-review`, or a non-code-only diff (docs, generated artefacts, lockfiles, asset binaries).
Otherwise evaluate in this precedence order (first match wins):

| # | Flags present | Invoke | What runs |
| - | --- | --- | --- |
| 1 | `--quick`, or both `--no-review` **and** `--no-simplify` | `Skill("polish", "quick")` | Light mechanical pass (comments, docstrings, `else` after `return`, naming). |
| 2 | `--no-review` | `Skill("polish", "simplify")` | Mechanical cleanups (comments, dead code, nesting, constants) applied once, each behind a test check. |
| 3 | `--no-simplify` | `Task(subagent_type="pr-reviewer", prompt="<pr-url>")` | `pr-reviewer` **agent** (Task tool, not `Skill()`) one-shot — findings surfaced, not applied. |
| 4 | **none of the above (default)** | `Skill("review-loop", "<pr-url> --no-ci")` | `pr-reviewer` → `implement-suggestion` → `polish simplify`, up to 5 iterations, until every thread is resolved (fix or reply); refreshes the PR description. |

Pass `--critical` through to `review-loop` / `pr-reviewer` if the user passed it.
**Always pass `--no-ci` to `review-loop` here** — Steps 7–8 own CI for this invocation and cover every commit the loop pushes.

**Rows 3 and 4 both need sub-agent dispatch.** Before taking either row, confirm that **some** available tool dispatches a sub-agent — a capability check, never a tool-name check (`Task` in Claude Code, `Agent` in the Agent SDK, `task` in OpenCode-based hosts such as Dash0 Agent0). If none does, do not attempt the dispatch and do not fall through to row 2 — record `NOT REVIEWED (sub-agent dispatch unavailable)` for Step 10.

After the loop returns:

- Converged → continue to Step 7. The loop already refreshed the PR description; do not re-edit the body.
- Cap hit with threads still open → surface them to the user before Step 7.
- **Loop returned a skip** → the PR has **not been reviewed**. Continue, carrying `NOT REVIEWED` into Step 10 verbatim; never describe the PR as converged, clean, or review-ready.

Never delete or weaken a test or change public API / exported types as a mechanical fix. One `review-loop` invocation per PR creation.
There is no background external-bot watch; a later reviewer is picked up by the next `review-loop` run or by `/implement-suggestion <pr> --watch` run on purpose.

## Step 7: Wait for CI to Settle

Block on CI so the user doesn't come back to a red PR. Two harness facts govern this step:

1. **Issue each watch call with the Bash tool's `timeout` parameter explicitly set to `600000`.** The default is 120 000 ms; without it the call is killed at 2 minutes with no exit code, whatever the inner `timeout`.
2. **`gh pr checks` exits non-zero (8) while checks are merely pending.** Classify on the exit code plus a literal stderr match, never on "was there output".

### Step 7a: wait for checks to register

Run the shared poll — **[`rules/registration-poll.md`](./rules/registration-poll.md)** — and map its outcomes:

| Poll outcome | Step 7 does |
| ------------ | ----------- |
| `registered` | Go to Step 7b |
| `tooling-failure` | Report the failure and escalate. Do **not** conclude anything about CI, and do **not** go to Step 8 |
| `no-ci` (after 3 polls, no runs awaiting approval) | This repo does not run CI on PRs — jump to Step 10 |

### Step 7b: watch to completion

```bash
# Issue this Bash call with the tool parameter timeout: 600000.
# 540 < 600 so `timeout` fires first and yields a real exit 124.
timeout 540 gh pr checks <pr-number> --watch
```

| Exit | Next |
| ---- | ---- |
| 0 | CI green — jump to Step 10 |
| 124 | Timed out with checks still running — watch again, up to **4 attempts total** (≈ 36 min). After the fourth, run `gh pr checks <pr-number>` once, report the still-pending checks, and escalate — never watch again |
| 127, or stderr matching `command not found` / `could not resolve` / `authentication` / `rate limit` | **Tooling failure, not a CI failure** (`timeout` is absent on stock macOS — use `gtimeout`). Report it; do **not** fan out CI-log triage against a run that never failed |
| Any other non-zero | A check genuinely failed — go to Step 8 |

Print `ci-watch attempt N/4` (or `registration poll N/3`) as you make each attempt and carry the lines into Step 10. Increment before comparing. Both caps are local to this invocation; there is no shared counter across skills or sub-agents.

## Step 8: Hand red CI to `ci-auto-fix`

A check genuinely failed. Invoke once:

```text
Skill("ci-auto-fix", "<pr-url>")   → fixed | still-failing | escalated, with its report
```

`ci-auto-fix` owns the whole failure path (grouping, log reading, flake rerun, fix, local verify, push, re-verify); add no triage fan-out or `/confidence` pass of your own around it.

**Cap: 2 invocations per `create-pr` run.** Invoke a second time only when the first returned `fixed` and a *different* check went red on the pushed revision; never re-invoke on a check the first gave up on. Print `ci-auto-fix invocation N/2` as you make each one.

**Never do these to make CI green:**

- Disable, skip, or set `continue-on-error` on a failing check
- Delete or weaken tests, lint rules, or type checks
- Push with `--no-verify` or otherwise skip hooks
- Mark the PR ready-for-review while checks are red

## Step 10: Report

Short summary: final check status, one line per auto-fix, and anything left for the user (only if Step 8 escalated or hit the cap).

```
PR: <pr-url>
Title: <imperative title>

Pre-push review (Step 5.5, local review-loop): <converged (<N> iterations, <A> applied, <D> declined) | flagged (<G> findings) | cap-reached (<O> open) | checks-red (<checks>) | skipped (<flag>) | skipped (non-code diff) | NOT REVIEWED (sub-agent dispatch unavailable; fallback: <polish simplify | none>)>

Media (Step 6.2): <the attach-media summary line | none (no captures or --attach files) | none (merge base unresolved) | skipped (--no-media) | skipped (attach-media not available)>

UI verify (Step 6.4): <authored (<N> specs) | not authored (no UI files in diff) | skipped (--no-ui-verify) | skipped (--no-quality) | skipped (ui-verify not available) | failed (<reason>)>

Review loop (review-loop / pr-reviewer):
  Iterations: <N> of <cap>
  Stop reason: <all-threads-resolved | no-progress (flags remain) | cap-reached | skipped (--no-quality) | skipped (--no-post-review) | NOT REVIEWED (sub-agent dispatch unavailable)>
  Open threads at exit: <count>
  Description refreshed: <yes | unchanged | skipped>
  Final verdict: <PASS | FAIL>

CI:
  Watch attempts: <the `ci-watch attempt N/4` lines you printed, or "none needed">
  Final status: <green | which checks red>
  Auto-fixed: <one line per fix, or "none">
  ci-auto-fix: <the `ci-auto-fix invocation N/2` lines you printed, or "not needed">

Head commit: <sha — the head CI was last verified on>
```

**The `UI verify` line is mandatory on every run, including a non-UI diff** — `not authored (no UI files in diff)` is the informative answer there, not silence.
**The `Pre-push review` line is mandatory on every run too**, including every skipped one; when it is `flagged`, list every flagged finding underneath.
Why these slots exist: [`references/design-rationale.md`](./references/design-rationale.md).

## Split Mode (`--split`)

`rules/split-mode.md` — read when `--split` is set, before Step 1. It defines how split mode changes Steps 1–5.5, then Steps S1–S8 (analyse, group, detect dependencies, propose and **wait for approval**, execute, watch CI bottom-up, rollback, report) and the split-mode hard rules.

## Anti-patterns to Avoid

- **Listing every file changed.** Describe ideas, not paths.
- **Restating the title in the summary.**
- **Padded checklists.** Only checkboxes from a real template, checked only when they apply.
- **Strings of unrelated features** ("adds X, Y, Z and also…") — suggest splitting.
- **Narrating the process** ("First I tried X…"). Reviewers want the result.
- **Vague verbs** ("improved", "enhanced", "updated"). Say what changed and why it's better.
- **Media placeholders.** Never `TODO: add screenshots`, an empty `<!-- screenshots -->`, or a local `.agent/` path in the body.
- **Co-Authored-By lines.** Never include `Co-Authored-By: Claude` or any AI co-author attribution.
- Prefer linking (`Closes #123`) over re-explaining context already in the issue.
