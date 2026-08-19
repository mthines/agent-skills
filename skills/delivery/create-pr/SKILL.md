---
name: create-pr
description: >
  Generate a short, narrative GitHub pull request description (≤ 25 lines, hard
  ceiling 40), push the branch, open the PR as a draft, then run the review-loop
  skill for a bounded review-apply-simplify convergence before finalizing. The
  review-loop (pr-reviewer → implement-suggestion → polish simplify, up to 5
  iterations, converging until every review thread is resolved via fix or reply)
  runs AFTER the draft PR is open — the single reviewer now operates
  on PRs. Scale down with --no-review (skip the pr-reviewer pass), --no-simplify
  (skip simplify), --quick (light mechanical pass only), or --no-quality (skip
  the loop entirely). A post-push external-bot feedback loop also runs by default
  (--no-feedback to skip), scoped to external bots only so it does not re-apply
  the review-loop's own findings. With --split, analyses the branch diff and
  breaks it into 2–4 focused, dependency-ordered draft PRs after user approval.
  Escalates judgment-required CI failures via /confidence rather than guessing.
  Invoke with /create-pr, /create-pr --no-review, /create-pr --quick, /create-pr
  --no-quality, or /create-pr --split.
disable-model-invocation: false
argument-hint: '[--split] [--quick] [--no-review] [--no-simplify] [--no-quality] [--no-feedback]'
license: MIT
metadata:
  author: mthines
  version: '3.1.0'
  workflow_type: command
---

# Generate Pull Request Description

Generate a **short, narrative** PR description that tells reviewers *why* this change exists and *what* to expect when they open the diff.
Reviewers skim.
If the description is long, they skip it.
Respect their time.

## Modes

Parse `$ARGUMENTS`. `--split` selects an alternate workflow. The post-draft quality step (Step 6.5) runs the **full review + simplify loop by default**; the `--no-*` / `--quick` flags below **scale it down**. All flags compose with the default and split workflows.

| Mode / Flag    | Trigger                                            | Behaviour                                                                                                                                                                     |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`      | No flag                                            | One PR for the whole branch. After opening the draft PR (Step 6), Step 6.5 runs `Skill("review-loop", "<pr-url> --no-ci")` — up to 5 iterations of `pr-reviewer` → `implement-suggestion` → `polish simplify`, converging until every review thread is resolved (fix or reply) and refreshing the PR description. |
| `split`        | `--split`, `-s`, or first positional token `split` | Analyse the branch diff, propose 2–4 dependency-ordered draft PRs (hard cap 5), execute only after user approval. Jump to the **Split Mode** section after the description-contract step. |
| `no-review`    | `--no-review`                                       | Step 6.5 drops the `pr-reviewer` pass from the loop → runs only `polish simplify` once.                                                                                     |
| `no-simplify`  | `--no-simplify`                                     | Step 6.5 drops the simplify pass from the loop → runs only `pr-reviewer` (one-shot, no apply).                                                                              |
| `quick`        | `--quick`                                           | Step 6.5 runs only the light mechanical pass → `Skill("polish", "quick")` (no pr-reviewer, no structural refactors).                                                        |
| `no-quality`   | `--no-quality` anywhere in arguments               | Skip Step 6.5 entirely **and** the Step 6.7 external-bot feedback loop. Wins over every other quality flag.                                                                  |
| `no-feedback`  | `--no-feedback` anywhere in arguments              | Skip the **default-on** external-bot feedback loop (Step 6.7). Composes with everything. Does not skip the review-loop step.                                                |

> **Legacy positive flags.** `--review` and `--simplify` are still accepted as explicit single-pass scoping: `--review` alone ≡ `--no-simplify` (pr-reviewer only), `--simplify` alone ≡ `--no-review` (simplify only), and `--review --simplify` ≡ the default (full loop). Prefer the `--no-*` form — with the full loop now the default, the negative flags read more clearly.

**The external-bot feedback loop (Step 6.7) is ON by default.** After the review-loop converges, a background subagent runs `/implement-suggestion <pr> --watch`, which waits for the repo's **external** review bots (CodeRabbit, human reviewers, …) and applies their actionable feedback. It is scoped to comments posted **after** the review-loop's last push, so it does not re-apply the loop's own findings. Pass `--no-feedback` to skip it.

In split mode, skip the contract's length self-check "PR too big" trim — the split *is* the response to that signal.
Each resulting sub-PR must still pass it on its own.

Step 6.5 cannot serve split mode: it is post-draft and its `review-loop` needs an open PR, which does not exist before S1. So with `--split`, run `Skill("polish", "simplify")` **once on the full branch** before computing the split (before S1) — it is branch-scoped and needs no PR — so each sub-PR inherits the cleaned-up code. Each sub-PR then gets the per-PR quality pass defined in [`rules/split-mode.md`](./rules/split-mode.md).

## Step 0: Resolve your GitHub access path

Before any GitHub step, resolve which path you have — `gh` CLI, `mcp__github__*` tools, or neither — per **[`agents/shared/rules/github-access.md`](../../../agents/shared/rules/github-access.md)**. Resolve once, state the path you took, and use it for the whole run.

`gh` is **absent in Claude Code cloud sessions**, so the commands written below are the `gh`-path form; on the MCP path use the verb mapping in that file rather than attempting them. With **neither** path, GitHub steps cannot be performed: say so precisely, do the `git` work you can, and hand the rest back — never report a step you could not perform as blocked-by-something-else.

## Steps 1–5: Write the title and body (shared contract)

The narrative rules, the length budget, and the five authoring steps (gather
information → understand the narrative → choose output format → write the title →
length self-check) live in one shared file so `create-pr` and `review-loop` write
identical-quality descriptions: **[`rules/description-contract.md`](./rules/description-contract.md)**.

Follow that contract to produce the title and body. Two `create-pr`-specific notes:

- The contract's Step 5 length self-check is the same "PR too big → `/create-pr --split`" signal referenced in the Modes section; in split mode you skip it (the split *is* the response).
- If you can't infer the *why* / *what* from the diff, ask the user — never pad with guesses.

Then continue to Step 6 to push and open the draft PR.

## Step 6: Push and Create Draft PR

Push the branch and open the PR as a **draft** first — the quality loop runs after the PR exists so `pr-reviewer` can post inline comments.

```bash
git push                    # tracking already configured by gw add

gh pr create --draft \
  --title "<imperative title>" \
  --body "$(cat <<'EOF'
<your narrative description>
EOF
)"
```

Capture the PR URL/number from the output — the next steps need it.

## Step 6.5: Post-draft quality loop (delegated to `review-loop`)

After the draft PR is open, run the bounded review-apply-simplify convergence loop.

Skip this step entirely if any of the following hold:

- `--no-quality` was passed in `$ARGUMENTS`.
- The branch diff is non-code only (docs, generated artefacts, lockfiles, asset binaries).

Otherwise, map the `create-pr` flags to the appropriate invocation. Evaluate in this precedence order (first match wins):

| # | Flags present                                            | Invoke                                           | What runs                                                       |
| - | -------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| 1 | `--quick`, or both `--no-review` **and** `--no-simplify` | `Skill("polish", "quick")`                      | Light mechanical pass (comments, naming, dead code).            |
| 2 | `--no-review` (or legacy `--simplify` alone)             | `Skill("polish", "simplify")`                   | code-quality simplify — apply Class M refactors once.           |
| 3 | `--no-simplify` (or legacy `--review` alone)             | `Task(subagent_type="pr-reviewer", prompt="<pr-url>")` | `pr-reviewer` **agent** (Task tool, not `Skill()`) one-shot only — findings surfaced, not applied. |
| 4 | **none of the above (default)**                          | `Skill("review-loop", "<pr-url> --no-ci")`      | Full loop: `pr-reviewer` → `implement-suggestion` → `polish simplify`, up to 5 iterations; converges until every review thread is resolved (fix or reply) and refreshes the PR description. |

(`--no-quality` is handled above as an outright skip and never reaches this table.)

Pass `--critical` through to `review-loop` / `pr-reviewer` if the user passed it to `create-pr`.

**Always pass `--no-ci` to `review-loop` here.** The loop has its own CI sub-step that
would dispatch `ci-auto-fix`; letting it run would make it a second spender of the
handoff budget that Steps 7–9 own for this invocation. `create-pr` does not
need it: Steps 7–9 run **after** this step, so every commit the loop pushes is
covered by the watch that follows. Suppressing the loop's CI step here is what keeps
this invocation's budget accountable to one owner — the counters live in this
skill's own transcript, never in a state file carried between phases.

**Rows 3 and 4 both need sub-agent dispatch.** `pr-reviewer` is `Task`-only with no in-context substitute. Confirm `Task` is available before taking either row; if it is not, do not attempt the dispatch and do not silently fall through to row 2 — record `NOT REVIEWED` and carry it into Step 10.

After the loop returns:

- If the loop converged (every review thread resolved via fix or reply), continue to Step 6.7 (external-bot feedback). The loop also refreshes the PR description to match the converged diff, so do not re-edit the body here.
- If the cap was hit with threads still open — human-judgment flags or unresolved blockers — surface them to the user before continuing to CI watch.
- **If the loop returned a skip**, the PR has **not been reviewed**. Continue, but carry `NOT REVIEWED` into the Step 10 report verbatim. Never describe such a PR as converged, clean, or review-ready.

**Hard rules for this step:**

- Never delete or weaken a test, never change public API or exported types as a mechanical fix.
- One `review-loop` invocation per PR creation — the loop has its own cap.

## Step 6.7: Dispatch the external-bot feedback loop (default ON)

After the review-loop converges, absorb whatever feedback external review bots
(CodeRabbit, human reviewers, …) post — without blocking the main thread.
This step is scoped to comments posted **after** the review-loop's last push,
so it does not re-apply the loop's own findings.

**Skip this step** when `--no-feedback` or `--no-quality` is in `$ARGUMENTS`.
Otherwise run it for every `create-pr`.

Dispatch a subagent with `run_in_background: true` that drives the watch loop,
and **continue to Step 7 in the main thread immediately** — do not block on it:

```
Agent(
  description: "Absorb external PR review feedback (watch loop)",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: |
    Drive the external-reviewer-feedback loop for PR <pr-url> to completion.

    Invoke: Skill('implement-suggestion', '<pr-url> --watch')

    That skill waits for new external review-bot / human comments (CodeRabbit,
    humans, etc.) after each push, validates each through /critical + /confidence,
    applies the actionable ones, pushes, and repeats until the reviewers go quiet
    (max 5 iterations). It never opens a new PR and never undrafts this one.
    It only acts on comments from EXTERNAL parties (not from the review-loop's
    pr-reviewer pass that already ran).

    Return its final watch report verbatim: the per-iteration table, the
    stop reason, the head commit SHA, and any surfaced (needs-user) comments.
    Keep it under 150 words; do not paste comment bodies or diffs.
)
```

The watch loop and the main-thread CI watch (Steps 7–9) push to the same branch in parallel.
Each downstream skill handles pull-rebase internally; do not add explicit serialisation.

Print one line before continuing:

```
Dispatched background external-reviewer-feedback loop (PR: <pr-url>). Continuing with CI watch.
```

## Step 7: Wait for CI to Settle

The job isn't done when the PR is created. Block on CI so the user doesn't have to come back to a red PR later.

**Two harness facts govern this step. Get either wrong and the watch hangs instead of waiting.**

1. **The Bash tool's timeout defaults to 120 000 ms; 600 000 ms is the opt-in maximum.** A long `timeout N` *inside* the command is irrelevant if the tool call is killed first — the agent then sees an opaque tool timeout with no exit code, and every rule below becomes unreachable. **Issue each watch call with the tool's `timeout` parameter explicitly set to `600000`.** Setting it is not optional; omitting it caps the watch at 2 minutes regardless of the inner `timeout`.
2. **`gh pr checks` exits non-zero while checks are merely pending** (exit 8), printing them to stdout. Non-zero does **not** mean failure here, so classify on the exit code plus a literal stderr match — never on "was there output".

### Step 7a: wait for checks to register

`--watch` does not wait for checks that do not exist yet, and registration takes seconds after a push. Run the shared poll — **do not restate it here**:

**→ [`rules/registration-poll.md`](./rules/registration-poll.md)**

Map its caller-neutral outcomes onto this step:

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

**Count both caps within this skill invocation, and write each attempt down.** Print `ci-watch attempt N/4` (or `registration poll N/3`) as you make it, and carry those lines into the Step 10 report. Externalising the count into the transcript is the point: prose asking an agent to *remember* a number across a step transition and a subagent fan-out is fragile, whereas prose asking it to *record* one is not. Increment *before* comparing — a counter still at 0 compared against `< 4` runs five attempts, not four.

There is deliberately **no shared counter across skills or subagents.** Miscounting a local cap costs one extra 9-minute watch or one early escalation; miscounting a shared one produced a false green. That trade — a correctness risk converted into a latency risk — is why the shared budget was removed; see [`phase-7-ci-gate.md`](../../workflow/autonomous-workflow/rules/phase-7-ci-gate.md).

## Step 8: Triage Failures (delegate log-reading to subagents)

CI logs are huge and most of their content is irrelevant the moment you've classified the failure. Don't pull them into the main thread — fan out one `general-purpose` subagent per failed check. They run in parallel; each returns a short, structured summary.

Spawn one subagent per failed check, all in the same turn so they run concurrently:

```
description: Triage CI failure on <check-name>
subagent_type: general-purpose
prompt: |
  Read the failing GitHub Actions log and classify it. Do not fix anything — just report.

  Run: gh run view <run-id> --log-failed
  PR: <pr-url>
  Check: <check-name>
  Diff context: this PR's branch is <branch>; relevant files are <list>.

  Return a report with exactly these fields:
  - failing_step: which job/step failed
  - error_excerpt: the 5–15 most relevant log lines, no more
  - category: one of [lint-format, generated-artifact, trivial-type, snapshot, real-test, ambiguous-type-or-build, unrelated-or-flake, infra-or-workflow, sensitive (auth/security/migration/data)]
  - suggested_fix: one sentence; if mechanical, name the exact command (e.g. `pnpm lint --fix`)
  - flake_suspected: true/false with one-line reason

  Keep the whole report under 200 words. Do not paste raw logs.
```

Use the returned `category` to decide the path:

- `lint-format`, `generated-artifact`, `trivial-type`, `snapshot` → **mechanical**, go to Step 9 auto-fix.
- `real-test`, `ambiguous-type-or-build`, `infra-or-workflow`, `sensitive` → **judgment**, go to Step 9 escalation.
- `unrelated-or-flake` (or `flake_suspected: true`) → re-run failed jobs once before treating it as real:
  ```bash
  gh run rerun <run-id> --failed
  ```
  Then re-watch with `timeout 540 gh pr checks <pr-number> --watch` (tool `timeout: 600000`), drawing from the same 4-attempt cap you have been counting in Step 7b — a rerun does not reset it. At most one rerun per check.

## Step 9: Apply Fixes

**Mechanical failures — delegate the whole fix loop to a subagent.** The `/ci-auto-fix` skill owns the fix-commit-push-rewatch cycle and is loud (it will run linters, push commits, watch CI). That output doesn't belong in the main thread. Spawn one subagent per independent failure (parallel if there are multiple):

```
description: Run /ci-auto-fix for <check-name>
subagent_type: general-purpose
prompt: |
  Drive the /ci-auto-fix workflow end-to-end for this PR.

  PR: <pr-url>
  Failing check: <check-name>
  Triage summary (from prior subagent): <paste category + suggested_fix + error_excerpt>

  Follow the /ci-auto-fix skill's instructions. Apply the minimal fix, commit,
  push, and watch until CI completes. Honor its guardrails — no --no-verify, no
  continue-on-error, no disabling checks.

  Return only:
  - outcome: fixed | still-failing | gave-up
  - what_was_fixed: one line
  - iterations: how many fix-push-watch cycles you used
  - remaining_error: one short paragraph if still red, else empty
```

Don't wrap the subagent in another loop — it has its own internal iteration cap.

**Judgment-required failures — keep in the main thread.** `/confidence` reviews *this* conversation's reasoning, so a subagent can't run it. With the triage summary already in hand:

1. Run `/confidence` against the failure summary + the relevant diff slice.
2. If confidence ≥ 80% on a specific fix → apply it locally yourself, then hand the push-and-rewatch off to a `/ci-auto-fix` subagent (same template as above).
3. If confidence < 80% → stop. Report the failing check, the error excerpt from the triage report, what you considered, and why you didn't auto-fix. Leave the PR for the user.

**Cap: 2 `/ci-auto-fix` subagent handoffs per PR.** Each handoff already burns a full internal retry budget. If CI is still red after that, it's not mechanical — stop and report.

**Hard rules — never do these to make CI green:**

- Disable, skip, or set `continue-on-error` on a failing check
- Delete or weaken tests, lint rules, or type checks
- Push with `--no-verify` or otherwise skip hooks
- Mark the PR ready-for-review while checks are red

## Step 10: Report

Short summary:

- Final check status (all green, or which are red and why)
- What was auto-fixed, one line per fix
- Anything left for the user (only if Step 9 escalated or hit the cap)

**Unless `--no-feedback` was passed**, also wait for the background external-reviewer-feedback loop (Step 6.7) to complete — you will be notified — and append its result. Final report shape:

```
PR: <pr-url>
Title: <imperative title>

Review loop (review-loop / pr-reviewer):
  Iterations: <N> of <cap>
  Stop reason: <all-threads-resolved | no-progress (flags remain) | cap-reached | skipped (--no-quality) | NOT REVIEWED (sub-agent dispatch unavailable)>
  Open threads at exit: <count>
  Description refreshed: <yes | unchanged | skipped>
  Final verdict: <PASS | FAIL>

CI:
  Watch attempts: <the `ci-watch attempt N/4` lines you printed, or "none needed">
  Final status: <green | which checks red>
  Auto-fixed: <one line per fix, or "none">
  Iterations: <total /ci-auto-fix subagent dispatches>

External reviewer feedback loop (/implement-suggestion --watch):
  Stop reason: <reviewers quiet | nothing actionable left | iteration cap | skipped (--no-feedback)>
  Iterations: <N>
  Applied: <total across iterations>
  Surfaced (needs you): <N>

Head commit: <sha — the latest state after both paths pushed>
```

Because both paths push to the same branch, surface the final head SHA so the user sees the latest state at a glance.

## Split Mode (`--split`)

Use when the branch has accumulated several unrelated changes and a single PR would be hard to review.
The skill analyses the diff, proposes a small number of focused PRs, and after explicit user approval executes the split as dependency-ordered draft PRs.

**Full procedure lives in [`rules/split-mode.md`](./rules/split-mode.md).**
Load that file when entering split mode; it covers when to split, file grouping rules, dependency detection across seven coupling categories, the per-PR execution loop, abort/rollback, and split-specific hard rules.

Quick reference for the shape of the workflow:

| Step | Name                              | Output                                              |
| ---- | --------------------------------- | --------------------------------------------------- |
| S1   | Analyze the diff                  | Conceptual classification of every changed file    |
| S2   | Group files into PRs              | 2–4 candidate groups (hard cap 5)                  |
| S3   | Detect dependencies               | Topological order + file-level-only constraint     |
| S4   | Propose to user                   | Table; **stop and wait** for `approve / modify / abort` |
| S5   | Execute (preflight + per-PR loop) | Patch-based file extraction, sanity check, push    |
| S6   | Watch CI bottom-up, rebase stack  | Auto-fix bottom; rebase upward PRs with `--force-with-lease` |
| S7   | Abort and rollback                | Restore original SHA; ask before deleting remotes  |
| S8   | Report                            | Stack diagram + recommended merge order            |

**Hard preconditions** (enforced in S5 preflight):

- Working tree clean (`git status --porcelain` empty)
- `git fetch origin` ran; first PR bases on `origin/main`, not local `main`
- Original branch SHA recorded for rollback

**Hard prohibitions** (full list in `rules/split-mode.md`):

- Never `git checkout <ref> -- <files>` to extract a PR — it loses deletions and corrupts renames. Use `git diff <parent> <original-sha> -- <files> | git apply --index --3way`.
- Never push or open a PR before the user approves the Step S4 proposal.
- Never force-push a stacked branch with plain `--force` — `--force-with-lease` only.
- Never delete a pushed split branch or close a draft split PR during rollback without explicit user confirmation.

## Anti-patterns to Avoid

- **Listing every file changed.** The diff already shows that. Describe ideas, not paths.
- **Restating the title in the summary.** Use the summary to add information the title can't carry.
- **Padded checklists** (`[x] Code follows style guidelines` on every PR). Only include checkboxes from a real template, and only check ones that actually apply.
- **"This PR adds X, Y, Z and also..."** strings of features. If a PR has many unrelated additions, suggest splitting.
- **Internal narration of process** ("First I tried X, then Y didn't work, so I refactored Z"). Reviewers want the result, not the journey.
- **Vague verbs** ("improved", "enhanced", "updated"). Say what changed and why it's better.
- **Co-Authored-By lines.** Never include `Co-Authored-By: Claude` or any AI co-author attribution.

## Examples

### Good — feature (lean, narrative, fits the 25-line budget)

```markdown
## Why

`gw add` silently auto-cleaned stale worktrees, making the CLI feel frozen on slow filesystems. Users couldn't tell whether it had hung or was working.

## What changed

- Replace background auto-clean with an interactive prompt before deletion
- Surface the same prompt from `gw list` when stale worktrees exist
- Update help text and README to describe the new flow

## How to verify

- `gw add foo` with stale worktrees: prompt appears; Y/N both behave correctly
```

### Good — feature with template (PR template repos)

```markdown
## Summary

Agent0 emits the same logical dashboard several times as it iterates. Today each emission is its own card with its own "Create" button — picking the right one is guesswork. This PR collapses that into one floating card always reflecting the latest version, with revision history folded into the create dialog so users can flip between revisions and see the rendered dashboard before deploying.

### Overview

| Desc.        | Value                                |
| ------------ | ------------------------------------ |
| Preview link | https://example/preview              |
| Feature flag | `USE_AGENT0_SDK`                     |

## What changed

- Floating ArtifactsList above the prompt input — one card per logical artifact
- Cross-chain dedup at the data layer so floating list + dialog tabs share one revisions array
- Revision tabs inside the create dialog with a `Show source` toggle for the YAML diff
- Removed the standalone revision sidebar (~600 LOC deleted)

## How to verify

- Generate a dashboard in the preview, ask the agent to refine it, confirm the card shows one entry with `v{N}` + `Create dashboard`
```

### Good — bug fix

```markdown
## Why

Auth refresh was firing on every request after a 401, causing a token-refresh storm
when the backend was briefly unreachable.

## What changed

- Debounce refresh to one in-flight request per session
- Return the same promise to all callers waiting on the refresh
```

### Bad — verbose, file-by-file

```markdown
## Summary

This PR adds a new feature to the auth module and also updates several other files
in the codebase to support this new functionality.

## Changes

- Modified `src/auth/refresh.ts` to add a new `debouncedRefresh` function
- Modified `src/auth/index.ts` to export the new function
- Modified `src/auth/types.ts` to add a new type
- Updated `tests/auth.test.ts` to add tests
- Updated `tests/refresh.test.ts` to add tests
- Updated `README.md` with new docs
- Updated `CHANGELOG.md`
- Various other small improvements and refactors

## Type
- [x] feat
- [ ] fix
- [ ] docs ...
```

(Why it's bad: the summary is empty calories, the change list is the file list, and the type checklist adds zero signal.)

## Tips

- **If the PR is hard to summarize concisely, the PR is probably too big.** Offer `/create-pr --split` before writing prose to paper over it.
- **One concept = one PR.** Mixed-purpose PRs make narrative descriptions awkward — that's the description telling you something.
- **Prefer linking** (`Closes #123`) over re-explaining context that's already in the issue.
- **Always push first** — `gh pr create` requires the branch on the remote. With `gw add`, tracking is pre-configured so plain `git push` works.
