---
name: create-pr
description: >
  Generates a short, narrative GitHub pull request description (≤ 25 lines,
  hard ceiling 40), pushes the branch, opens the PR as a draft, then runs
  review-loop (pr-reviewer → implement-suggestion → polish simplify, up to 5
  iterations) until every review thread is resolved via fix or reply. Scale
  down with --no-review, --no-simplify, --quick (light mechanical pass only),
  or --no-quality (skip the loop). A post-push external-bot feedback loop
  runs by default (--no-feedback to skip). On a UI diff, injects a preview
  verification spec by default (--no-preview-spec to skip). Before the push,
  converges the branch by default with review-branch, which needs no PR, so
  the draft opens already review-clean (--no-pre-review to skip). With
  --split, breaks the branch diff into 2–4 focused,
  dependency-ordered draft PRs after user approval. Escalates
  judgment-required CI failures via /confidence rather than guessing. Invoke
  with /create-pr or /create-pr --split.
disable-model-invocation: false
argument-hint: '[--split] [--quick] [--no-pre-review] [--no-review] [--no-simplify] [--no-quality] [--no-feedback] [--no-preview-spec]'
license: MIT
metadata:
  author: mthines
  version: '3.5.0'
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
| `no-preview-spec` | `--no-preview-spec` anywhere in arguments        | Skip the **default-on** UI verification spec authoring (Step 6.4). Composes with everything.                                                                                |
| `no-pre-review` | `--no-pre-review` anywhere in arguments            | Skip the **default-on** Step 5.5 — `Skill("review-branch", …)` **before** the push, which opens the draft already converged. Split mode then falls back to the review-less `Skill("polish", "simplify")` pre-split pass.        |

> **Legacy positive flags.** `--review` and `--simplify` are still accepted as explicit single-pass scoping: `--review` alone ≡ `--no-simplify` (pr-reviewer only), `--simplify` alone ≡ `--no-review` (simplify only), and `--review --simplify` ≡ the default (full loop). `--pre-review` is likewise still accepted and is now a **no-op affirmation** of the default. Prefer the `--no-*` form — with the full loop now the default, the negative flags read more clearly.

**The external-bot feedback loop (Step 6.7) is ON by default.** After the review-loop converges, a background subagent runs `/implement-suggestion <pr> --watch`, which waits for the repo's **external** review bots (CodeRabbit, human reviewers, …) and applies their actionable feedback. It is scoped to comments posted **after** the review-loop's last push, so it does not re-apply the loop's own findings. Pass `--no-feedback` to skip it.

In split mode, skip the contract's length self-check "PR too big" trim — the split *is* the response to that signal.
Each resulting sub-PR must still pass it on its own.

Split mode depends on Step 5.5 more than default mode does: Step 6.5 is post-draft and its `review-loop` needs an open PR, which does not exist before S1, so nothing else reviews the whole branch there. Step 5.5 runs on the full branch before computing the split, and each sub-PR inherits reviewed-and-converged code rather than merely simplified code. Each sub-PR then gets the per-PR quality pass defined in [`rules/split-mode.md`](./rules/split-mode.md).

Until now that pre-split slot ran `Skill("polish", "simplify")` — mechanical refactors and **no review at all**, because no reviewer could run without a PR. That is now the *fallback*, taken only when Step 5.5 reports a skip (no sub-agent dispatch) or `--no-pre-review` was passed. Say which one ran; a split whose sub-PRs were never reviewed must not be reported as one whose sub-PRs were.

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
- **Absent sub-agent dispatch is `NOT REVIEWED`, never a skip.** In split mode, fall back to `Skill("polish", "simplify")` and say which one ran — it is the difference between sub-PRs that were reviewed and sub-PRs that were only simplified.
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

- `--no-preview-spec` or `--no-quality` is in `$ARGUMENTS`.
- The diff does **not** touch the UI. Heuristic: no changed file matches `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.css`, `*.scss`, `*.stories.*`, or a component directory. Test-only and config-only changes to those files do not count.
- `preview-spec` is not installed (`Skill()` raises — catch, log one line, continue).

Otherwise delegate — do not author the block by hand:

```
Skill("preview-spec", "author <pr-url>")
```

`preview-spec` owns the spec grammar, the marker contract, and its authoring memory loop; it edits the PR body in place, adding one `<!-- preview-spec:v1 -->` block. The block is exempt from the description length budget and is preserved verbatim by the Step 6.5 review-loop's description refresh — both rules live in the [description contract](./rules/description-contract.md#ui-verification-spec-optional). Continue to Step 6.5 regardless of whether a spec was authored.

**Record which branch you took, now, before continuing.** The Step 10 report has a mandatory preview-spec slot, and a slot whose value is reconstructed from memory at the end of a long run is the blind spot this step's own history demonstrates. Write down exactly one of the six values as you leave this step:

| What happened here | Record |
| --- | --- |
| Delegated, `preview-spec` reported `<N>` specs authored | `authored (<N> specs)` |
| Skipped: no changed file matched the UI heuristic | `not authored (no UI files in diff)` |
| Skipped: `--no-preview-spec` in `$ARGUMENTS` | `skipped (--no-preview-spec)` |
| Skipped: `--no-quality` in `$ARGUMENTS` | `skipped (--no-quality)` |
| Skipped: `Skill()` raised — `preview-spec` not installed | `skipped (preview-spec not available)` |
| Delegated, and `preview-spec` reported a failure — including its own `failed (no GitHub access path)`, which means the block never reached the PR body | `failed (<reason>)`, quoting its reason verbatim |

The last row is the one that must never be softened into a skip. `preview-spec`'s `author` treats the PR-body write as its only deliverable, so a `failed` return means no later reader — the Step 6.5 review-loop's Step 1.6 included — will find a block to run. Reporting that as `not authored` claims a decline where there was an error.

This step only **authors** the spec. The **run** is the review-loop's job: the default Step 6.5 invocation (`Skill("review-loop", "<pr-url> --no-ci")`) executes the block once against the live preview deployment at exit, report-only (its Step 1.6). `create-pr` deliberately does **not** pass `--no-preview-run` — that opt-out is for `autonomous-workflow`, whose Phase 7 rehearses the same specs itself. So a hand-driven UI PR gets both halves here: authored at 6.4, verified at 6.5.

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

Pre-push review (Step 5.5, review-branch): <converged (<N> iterations, <A> applied, <D> declined) | flagged (<G> findings) | cap-reached (<O> open) | checks-red (<checks>) | skipped (<flag>) | skipped (non-code diff) | NOT REVIEWED (sub-agent dispatch unavailable; fallback: <polish simplify | none>)>

Preview spec (Step 6.4): <authored (<N> specs) | not authored (no UI files in diff) | skipped (--no-preview-spec) | skipped (--no-quality) | skipped (preview-spec not available) | failed (<reason>)>

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

**The `Preview spec` line is mandatory on every run, including a non-UI diff.**
Step 6.4 has four skip conditions (`--no-preview-spec`, `--no-quality`, a non-UI diff, `preview-spec` not installed) and one failure mode, and every one of them previously reported as a clean, successful PR — the report had no slot for the spec at all, so an absent block was indistinguishable from a diff that needed none.
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
