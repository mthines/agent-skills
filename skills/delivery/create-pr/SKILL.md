---
name: create-pr
description: >
  Generates a short, narrative GitHub pull request description (≤ 25 lines,
  hard ceiling 40), pushes the branch, opens the PR as a draft, then runs
  review-loop (pr-reviewer → implement-suggestion → code-quality simplify, up to 5
  iterations) until every review thread is resolved via fix or reply. Scale
  down with --no-review, --no-simplify, --quick (light mechanical pass only),
  or --no-quality (skip the loop). On a UI diff, injects a preview
  verification spec by default (--no-ui-verify to skip). Before the push,
  converges the branch by default with review-branch, which needs no PR, so
  the draft opens already review-clean (--no-pre-review to skip). With
  --split, breaks the branch diff into 2–4 focused,
  dependency-ordered draft PRs after user approval. Hands red CI to
  ci-auto-fix, which fixes or escalates. Invoke with /create-pr or
  /create-pr --split.
disable-model-invocation: false
argument-hint: '[--split] [--quick] [--no-pre-review] [--no-review] [--no-simplify] [--no-quality] [--no-ui-verify]'
license: MIT
metadata:
  author: mthines
  version: '4.0.0'
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
| `default`      | No flag                                            | One PR for the whole branch. After opening the draft PR (Step 6), Step 6.5 runs `Skill("review-loop", "<pr-url> --no-ci")` — up to 5 iterations of `pr-reviewer` → `implement-suggestion` → `code-quality simplify`, converging until every review thread is resolved (fix or reply) and refreshing the PR description. |
| `split`        | `--split`, `-s`, or first positional token `split` | Analyse the branch diff, propose 2–4 dependency-ordered draft PRs (hard cap 5), execute only after user approval. Jump to the **Split Mode** section after the description-contract step. |
| `no-review`    | `--no-review`                                       | Step 6.5 drops the `pr-reviewer` pass from the loop → runs only `code-quality simplify` once.                                                                                     |
| `no-simplify`  | `--no-simplify`                                     | Step 6.5 drops the simplify pass from the loop → runs only `pr-reviewer` (one-shot, no apply).                                                                              |
| `quick`        | `--quick`                                           | Step 6.5 runs only the light mechanical pass → `Skill("code-quality", "quick")` (no pr-reviewer, no structural refactors).                                                        |
| `no-quality`   | `--no-quality` anywhere in arguments               | Skip Step 6.5 entirely. Wins over every other quality flag.                                                                  |
| `no-ui-verify` | `--no-ui-verify` (or the legacy alias `--no-preview-spec`) anywhere in arguments | Skip the **default-on** UI verification spec authoring (Step 6.4). Composes with everything. `--no-preview-spec` is the pre-rename spelling, still honoured so existing scripts and muscle memory keep working. |
| `no-pre-review` | `--no-pre-review` anywhere in arguments            | Skip the **default-on** Step 5.5 — `Skill("review-branch", …)` **before** the push, which opens the draft already converged. Split mode then falls back to the review-less `Skill("code-quality", "simplify")` pre-split pass.        |

> **Legacy positive flags.** `--review` and `--simplify` are still accepted as explicit single-pass scoping: `--review` alone ≡ `--no-simplify` (pr-reviewer only), `--simplify` alone ≡ `--no-review` (simplify only), and `--review --simplify` ≡ the default (full loop). `--pre-review` is likewise still accepted and is now a **no-op affirmation** of the default. `--no-feedback` is accepted and ignored: the background external-bot watch it disabled was removed in v4.0.0 (see [Step 6.5](#step-65-post-draft-quality-loop-delegated-to-review-loop)). Prefer the `--no-*` form — with the full loop now the default, the negative flags read more clearly.

In split mode, skip the contract's length self-check "PR too big" trim — the split *is* the response to that signal.
Each resulting sub-PR must still pass it on its own.

Split mode depends on Step 5.5 more than default mode does: Step 6.5 is post-draft and its `review-loop` needs an open PR, which does not exist before S1, so nothing else reviews the whole branch there. Step 5.5 runs on the full branch before computing the split, and each sub-PR inherits reviewed-and-converged code rather than merely simplified code. Each sub-PR then gets the per-PR quality pass defined in [`rules/split-mode.md`](./rules/split-mode.md).

Until now that pre-split slot ran a simplify pass — mechanical refactors and **no review at all**, because no reviewer could run without a PR. That is now the *fallback*, taken only when Step 5.5 reports a skip (no sub-agent dispatch) or `--no-pre-review` was passed. Say which one ran; a split whose sub-PRs were never reviewed must not be reported as one whose sub-PRs were.

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

Then continue to Step 5.5, and from there to Step 6 to push and open the draft PR.

## Step 5.5: Pre-push branch convergence (delegated to `review-branch`)

The branch is still local here, so there is no PR and no review thread — which is exactly the gap
[`review-branch`](../../quality/review-branch/SKILL.md) fills. It dispatches `branch-reviewer`,
which runs the same detection core as `pr-reviewer` and carries findings in
`.agent/{branch}/findings.jsonl` instead of GitHub threads. Zero GitHub calls, no PR required.

**It runs by default**, in both default and split mode.
**Skip it** on `--no-pre-review`, `--no-quality`, `--no-review`, or a non-code diff.

| Mode | Invoke |
| --- | --- |
| default | `Skill("review-branch", "--cap 3")` |
| split (`--split`) | `Skill("review-branch", "")` |

**Full procedure lives in [`rules/pre-push-review.md`](./rules/pre-push-review.md).** Load it when
entering this step; it covers the skip conditions, why the step is on by default and why the caps
differ, what to do with each return, and the outcome value to record for Step 10. Three rules from
it are load-bearing enough to restate here:

- **Surface every `flagged` finding to the user before pushing.** Pushing past them silently converts the safety valve into a green-wash.
- **Absent sub-agent dispatch is `NOT REVIEWED`, never a skip.** In split mode, fall back to `Skill("code-quality", "simplify")` (then commit) and say which one ran — it is the difference between sub-PRs that were reviewed and sub-PRs that were only simplified.
- **Record the outcome now**, before continuing. Step 10's slot for it is mandatory on every run.

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

## Step 6.4: Author the UI verification spec (default ON for UI changes)

When the diff touches the UI, attach a collapsed, machine-findable verification spec to the PR description so an agent can later run it against the preview deployment. This is authored once, here, right after the draft opens.

**Skip this step** when any of the following hold:

- `--no-ui-verify` or `--no-quality` is in `$ARGUMENTS`.
- `ui-verify` is not installed (`Skill()` raises — catch, log one line, continue).

**Do not eyeball the diff to decide whether it is UI.** `ui-verify author` now makes that call mechanically with its shared `is-ui-diff` gate (the repo's learned UI surface, falling back to broad defaults) and returns `not authored (no UI files in diff)` for a non-UI diff. That removes the old under-firing heuristic — a web-JS-only glob an agent had to remember to apply — so **delegate unconditionally** when neither skip condition above holds, and record whatever the delegate returns:

```
Skill("ui-verify", "author <pr-url>")
```

`ui-verify` owns the spec grammar, the marker contract, and its authoring memory loop; it edits the PR body in place, adding one `<!-- ui-verify:v1 -->` block. The block is exempt from the description length budget and is preserved verbatim by the Step 6.5 review-loop's description refresh — both rules live in the [description contract](./rules/description-contract.md#ui-verification-spec-optional). Continue to Step 6.5 regardless of whether a spec was authored.

**Record which branch you took, now, before continuing.** The Step 10 report has a mandatory ui-verify slot, and a slot whose value is reconstructed from memory at the end of a long run is the blind spot this step's own history demonstrates. Write down exactly one of the six values as you leave this step:

| What happened here | Record |
| --- | --- |
| Delegated, `ui-verify` reported `<N>` specs authored | `authored (<N> specs)` |
| Delegated, and `ui-verify`'s `is-ui-diff` gate found no UI files in the diff | `not authored (no UI files in diff)` |
| Skipped: `--no-ui-verify` in `$ARGUMENTS` | `skipped (--no-ui-verify)` |
| Skipped: `--no-quality` in `$ARGUMENTS` | `skipped (--no-quality)` |
| Skipped: `Skill()` raised — `ui-verify` not installed | `skipped (ui-verify not available)` |
| Delegated, and `ui-verify` reported a failure — including its own `failed (no GitHub access path)`, which means the block never reached the PR body | `failed (<reason>)`, quoting its reason verbatim |

The last row is the one that must never be softened into a skip. `ui-verify`'s `author` treats the PR-body write as its only deliverable, so a `failed` return means no later reader — the Step 6.5 review-loop's Step 1.6 included — will find a block to run. Reporting that as `not authored` claims a decline where there was an error.

This step only **authors** the spec. The **run** is the review-loop's job: the default Step 6.5 invocation (`Skill("review-loop", "<pr-url> --no-ci")`) executes the block once against the live preview deployment at exit, report-only (its Step 1.6). `create-pr` deliberately does **not** pass `--no-preview-run` — that opt-out is for `autonomous-workflow`, whose Phase 7 rehearses the same specs itself. So a hand-driven UI PR gets both halves here: authored at 6.4, verified at 6.5.

## Step 6.5: Post-draft quality loop (delegated to `review-loop`)

After the draft PR is open, run the bounded review-apply-simplify convergence loop.

Skip this step entirely if any of the following hold:

- `--no-quality` was passed in `$ARGUMENTS`.
- The branch diff is non-code only (docs, generated artefacts, lockfiles, asset binaries).

Otherwise, map the `create-pr` flags to the appropriate invocation. Evaluate in this precedence order (first match wins):

| # | Flags present                                            | Invoke                                           | What runs                                                       |
| - | -------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| 1 | `--quick`, or both `--no-review` **and** `--no-simplify` | `Skill("code-quality", "quick")`, then commit    | Light mechanical pass (comments, naming, dead code).            |
| 2 | `--no-review` (or legacy `--simplify` alone)             | `Skill("code-quality", "simplify")`, then commit | Apply Class M refactors once.                                   |
| 3 | `--no-simplify` (or legacy `--review` alone)             | `Task(subagent_type="pr-reviewer", prompt="<pr-url>")` | `pr-reviewer` **agent** (Task tool, not `Skill()`) one-shot only — findings surfaced, not applied. |
| 4 | **none of the above (default)**                          | `Skill("review-loop", "<pr-url> --no-ci")`      | Full loop: `pr-reviewer` → `implement-suggestion` → `code-quality simplify`, up to 5 iterations; converges until every review thread is resolved (fix or reply) and refreshes the PR description. |

(`--no-quality` is handled above as an outright skip and never reaches this table.)

`code-quality` edits the working tree and never commits. After rows 1 and 2, commit what it applied as its own commit, then push:

```bash
git diff --quiet || { git add -u && git commit -m "chore: code-quality pass" && git push; }
```

Pass `--critical` through to `review-loop` / `pr-reviewer` if the user passed it to `create-pr`.

**Always pass `--no-ci` to `review-loop` here.** The loop has its own CI sub-step that
would dispatch `ci-auto-fix`; letting it run would make it a second spender of the
handoff budget that Steps 7–8 own for this invocation. `create-pr` does not
need it: Steps 7–8 run **after** this step, so every commit the loop pushes is
covered by the watch that follows. Suppressing the loop's CI step here is what keeps
this invocation's budget accountable to one owner — the counters live in this
skill's own transcript, never in a state file carried between phases.

**Rows 3 and 4 both need sub-agent dispatch.** The reviewer runs in a separate context with no in-context substitute. Before taking either row, confirm that **some** available tool dispatches a sub-agent — a capability check, never a tool-name check: the tool is `Task` in the Claude Code CLI, `Agent` in the Claude Agent SDK, and `task` in OpenCode-based hosts such as Dash0 Agent0. If no tool dispatches a sub-agent, do not attempt the dispatch and do not silently fall through to row 2 — record `NOT REVIEWED (sub-agent dispatch unavailable)` and carry it into Step 10.

```text
❌ WRONG — a name check; skips the review on every harness that does not spell it `Task`
if "Task" not in available_tools: NOT REVIEWED

✅ RIGHT — a capability check, name-agnostic
if no available tool dispatches a sub-agent (Task, Agent, task, or another spelling): NOT REVIEWED
```

After the loop returns:

- If the loop converged (every review thread resolved via fix or reply), continue to Step 7. The loop also refreshes the PR description to match the converged diff, so do not re-edit the body here.
- If the cap was hit with threads still open — human-judgment flags or unresolved blockers — surface them to the user before continuing to CI watch.
- **If the loop returned a skip**, the PR has **not been reviewed**. Continue, but carry `NOT REVIEWED` into the Step 10 report verbatim. Never describe such a PR as converged, clean, or review-ready.

**Hard rules for this step:**

- Never delete or weaken a test, never change public API or exported types as a mechanical fix.
- One `review-loop` invocation per PR creation — the loop has its own cap.

**There is no separate external-bot watch.** Up to v3.5 a Step 6.7 backgrounded
`/implement-suggestion <pr> --watch` for bot and human comments posted after the
loop. It was removed because every job it did is already done or cannot be done:

- `review-loop`'s apply step is `implement-suggestion --resolve-all`, which reads
  **every** open thread on the PR — any author, bot or human — on every iteration,
  so a comment that lands while the loop runs is already applied or answered.
- It pushed to the branch **concurrently** with the Step 7 CI watch, so the watch
  could certify a head that the background loop had already moved past.
- A background sub-agent needs a harness that keeps running after the turn ends
  and a dispatch tool at this rung; an Agent0 Automation has neither.

A reviewer who comments after `create-pr` returns is picked up by the next
`review-loop` run, or by `/implement-suggestion <pr> --watch` run on purpose.

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

## Step 8: Hand red CI to `ci-auto-fix`

A check genuinely failed. Invoke `ci-auto-fix` on the PR — **once**:

```text
Skill("ci-auto-fix", "<pr-url>")
```

`ci-auto-fix` owns the whole failure path, so this step adds none of its own:
it captures and groups every failing check, reads the logs, separates mechanical
failures from ones that need diagnosis, allows one corroborated infrastructure
rerun for a flake, applies the smallest justified fix, verifies locally, pushes,
and re-verifies CI on the new revision — up to four fix-push cycles — and it
escalates what it cannot justify instead of guessing.

```text
❌ WRONG — re-implementing ci-auto-fix around ci-auto-fix
fan out one log-triage sub-agent per check → classify → hand each class to
a /ci-auto-fix sub-agent → run /confidence on the rest in this thread

✅ RIGHT — one owner for the failure path
Skill("ci-auto-fix", "<pr-url>")   → fixed | still-failing | escalated, with its report
```

**Cap: 2 invocations per `create-pr` run.** Invoke a second time only when the
first returned `fixed` and a *different* check went red on the pushed revision.
Never re-invoke on a check the first invocation gave up on: it already spent its
fix-push budget there, and a repeat is not mechanical work any more. Print
`ci-auto-fix invocation N/2` as you make each one and carry the lines into Step 10.

**Hard rules — never do these to make CI green** (they are `ci-auto-fix`'s rules too; a caller must not undo them):

- Disable, skip, or set `continue-on-error` on a failing check
- Delete or weaken tests, lint rules, or type checks
- Push with `--no-verify` or otherwise skip hooks
- Mark the PR ready-for-review while checks are red

## Step 10: Report

Short summary:

- Final check status (all green, or which are red and why)
- What was auto-fixed, one line per fix
- Anything left for the user (only if Step 8 escalated or hit the cap)

Final report shape:

```
PR: <pr-url>
Title: <imperative title>

Pre-push review (Step 5.5, review-branch): <converged (<N> iterations, <A> applied, <D> declined) | flagged (<G> findings) | cap-reached (<O> open) | checks-red (<checks>) | skipped (<flag>) | skipped (non-code diff) | NOT REVIEWED (sub-agent dispatch unavailable; fallback: <code-quality simplify | none>)>

UI verify (Step 6.4): <authored (<N> specs) | not authored (no UI files in diff) | skipped (--no-ui-verify) | skipped (--no-quality) | skipped (ui-verify not available) | failed (<reason>)>

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
  ci-auto-fix: <the `ci-auto-fix invocation N/2` lines you printed, or "not needed">

Head commit: <sha — the head CI was last verified on>
```

**The `UI verify` line is mandatory on every run, including a non-UI diff.**
Step 6.4 has four skip conditions (`--no-ui-verify`, `--no-quality`, a non-UI diff, `ui-verify` not installed) and one failure mode, and every one of them previously reported as a clean, successful PR — the report had no slot for the spec at all, so an absent block was indistinguishable from a diff that needed none.
That is the same self-concealing shape as failure modes `F6`/`F7` in [`diagnostic-surface.md`](../../workflow/autonomous-workflow/rules/diagnostic-surface.md): a degraded path that reports as a legitimate outcome is never fixed, because nobody learns it happened.
State which of the six outcomes applied, and never omit the line on the grounds that the diff was not a UI change — `not authored (no UI files in diff)` is the informative answer there, not silence.

**The `Pre-push review` line is mandatory on every run too**, including every run where the step was skipped.
A named skip tells the reader the pass exists and why it did not run; omitting the line tells them nothing and reads identically to a run that took it.
And when the value is `flagged`, list every flagged finding underneath — they are the reason a human is still needed, and the Step 5.5 surfacing happened before the push, several steps and one CI watch ago.

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

Four worked descriptions — a lean feature, a feature in a repo with a PR template, a bug fix, and
a **bad** verbose file-by-file one to recognise and avoid — live with the contract they exemplify:
**[`rules/description-examples.md`](./rules/description-examples.md)**.

## Tips

- **If the PR is hard to summarize concisely, the PR is probably too big.** Offer `/create-pr --split` before writing prose to paper over it.
- **One concept = one PR.** Mixed-purpose PRs make narrative descriptions awkward — that's the description telling you something.
- **Prefer linking** (`Closes #123`) over re-explaining context that's already in the issue.
- **Always push first** — `gh pr create` requires the branch on the remote. With `gw add`, tracking is pre-configured so plain `git push` works.
