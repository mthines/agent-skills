---
name: create-pr
description: >
  Generate a short, narrative GitHub pull request description (≤ 25 lines, hard
  ceiling 40), run a pre-push quality pass over the branch diff via the `polish`
  skill, then push the branch, open the PR, and watch CI to auto-fix simple
  failures (lint, format, lockfiles) before handing back. The pre-push step
  delegates to `/polish`, whose default is the DEEP tier: the local `reviewer`
  agent (auto-fix simple, plan complex) followed by code-quality simplify deep —
  which applies Class M mechanical refactors AND the bigger Class J refactors
  (deduplication, structural, type-driven) behind a test-backed gate (confidence
  ≥ 90 % plus behaviour-preservation evidence; unprovable findings stay
  proposals) — all before pushing, so the PR is clean when it goes up. Scale it
  down with --no-review (mechanical simplify only), --no-simplify (reviewer
  only), --quick (light mechanical pass only), or --no-quality (skip pre-push
  quality entirely). A post-push reviewer-feedback loop also runs by default
  (--no-feedback to skip). With --split, analyses the branch diff and breaks it
  into 2–4 focused, dependency-ordered draft PRs after user approval. Escalates
  judgment-required CI failures via /confidence rather than guessing. Invoke
  with /create-pr, /create-pr --no-review, /create-pr --quick, /create-pr
  --no-quality, or /create-pr --split.
disable-model-invocation: false
argument-hint: '[--split] [--quick] [--no-review] [--no-simplify] [--no-quality] [--no-feedback]'
license: MIT
metadata:
  author: mthines
  version: '2.1.0'
  workflow_type: command
---

# Generate Pull Request Description

Generate a **short, narrative** PR description that tells reviewers *why* this change exists and *what* to expect when they open the diff.
Reviewers skim.
If the description is long, they skip it.
Respect their time.

## Modes

Parse `$ARGUMENTS`. `--split` selects an alternate workflow. The pre-push quality step (Step 5.5) runs the **deep review + simplify works by default** (polish's default is the deep tier — reviewer agent → simplify deep, including the test-backed Class J refactors); the `--no-*` / `--quick` flags below **scale it down**. All flags compose with the default and split workflows.

| Mode / Flag    | Trigger                                            | Behaviour                                                                                                                                                              |
| -------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`      | No flag                                            | One PR for the whole branch. Step 5.5 runs the **deep** polish pass (reviewer agent → simplify deep, with test-backed Class J refactors) via `Skill("polish")`. Follow Steps 1–10 below. |
| `split`        | `--split`, `-s`, or first positional token `split` | Analyse the branch diff, propose 2–4 dependency-ordered draft PRs (hard cap 5), execute only after user approval. Jump to the **Split Mode** section after Core Principles. |
| `no-review`    | `--no-review`                                       | Step 5.5 drops the reviewer pass → `Skill("polish", "simplify")` (mechanical simplify only, no Class J).                                                              |
| `no-simplify`  | `--no-simplify`                                     | Step 5.5 drops the simplify pass → `Skill("polish", "review")` (reviewer only).                                                                                      |
| `quick`        | `--quick`                                           | Step 5.5 runs only the light mechanical pass → `Skill("polish", "quick")` (no reviewer agent, no structural refactors).                                              |
| `no-quality`   | `--no-quality` anywhere in arguments               | Skip the Step 5.5 pre-push quality pass entirely **and** the Step 6.5 post-push feedback loop. Wins over every other quality flag.                                    |
| `no-feedback`  | `--no-feedback` anywhere in arguments              | Skip the **default-on** post-push reviewer-feedback loop (Step 6.5). Composes with everything.                                                                       |

The pre-push quality step is a thin delegation to the [`polish`](../../quality/polish/SKILL.md) skill — see Step 5.5 for the full flag-to-mode mapping and precedence.

> **Legacy positive flags.** `--review` and `--simplify` are still accepted as explicit single-pass scoping: `--review` alone ≡ `--no-simplify` (reviewer only), `--simplify` alone ≡ `--no-review` (mechanical simplify only), and `--review --simplify` ≡ the default (deep). Prefer the `--no-*` form — with the deep pass now the default, the negative flags read more clearly.

**The post-push reviewer-feedback loop (Step 6.5) is ON by default.** After the PR is created, a background subagent runs `/implement-suggestion <pr> --watch`, which waits for the repo's review bots (Claude, CodeRabbit, …) and humans to comment, applies the actionable feedback, pushes, and repeats until the reviewers go quiet (max 5 iterations). It runs in parallel with the CI watch (Steps 7–9). Pass `--no-feedback` to skip it. On repos with no review automation it ends quietly after the first wait, so the default is safe.

In split mode, skip Step 5's "PR too big" trim — the split *is* the response to that signal.
Each resulting sub-PR must still pass it on its own. With `--split`, run the resolved polish pass **once on the full branch** before computing the split (i.e. run Step 5.5 before S1), so each sub-PR inherits the cleaned-up code.

## Length budget — the hard rule

A reviewer should read the entire description in **under 30 seconds**. Concretely:

- **Body target: ≤ 25 rendered lines.** Hard ceiling: 40. Tables, checklists, and blank lines all count toward this.
- **Why: 1–2 sentences.** Not paragraphs.
- **What changed: 2–4 bullets, one line each.** No sub-bullets, no code blocks inside bullets.
- **How to verify: ≤ 3 lines.** Prefer a single command over prose.
- **Notes for reviewers: optional. If present, ≤ 2 sentences.** Move implementation detail into code comments or PR review threads, not the body.

If you can't fit the change inside this budget, the PR is probably too big — stop and offer the user `/create-pr --split` instead of expanding the description.

## Core Principles

1. **Narrative over checklist.** Reads like prose explaining a decision, not a bullet-point manifest of every file touched.
2. **Why first, then what, then how to verify.** Motivation drives understanding. A reviewer should be able to predict the diff after reading the description.
3. **Group by concept, not by file.** Don't enumerate every changed file — describe the *ideas* the change introduces.
4. **No filler.** Skip empty checklists, stock "Code follows guidelines" boxes, and boilerplate that adds noise without information.
5. **One line per bullet.** If a bullet wants a follow-up clause, it's two changes — split or cut the second.

## Step 1: Gather Information

Run these in parallel:

```bash
git branch --show-current
git log main..HEAD --oneline
git diff main...HEAD --name-status
git diff main...HEAD --stat
git diff main...HEAD              # full diff — needed to understand intent
```

Also check for a PR template:

```bash
# Common template locations (check all)
ls .github/pull_request_template.md \
   .github/PULL_REQUEST_TEMPLATE.md \
   .github/PULL_REQUEST_TEMPLATE/ \
   docs/pull_request_template.md \
   PULL_REQUEST_TEMPLATE.md 2>/dev/null
```

## Step 2: Understand the Narrative

Before writing anything, answer these questions for yourself by reading the diff:

- **What problem or goal motivated this change?** (the *why*)
- **What is the core idea of the solution?** (one sentence — the *headline*)
- **What are the 2–4 conceptual moves the diff makes?** (not files — concepts)
- **What should a reviewer pay extra attention to?** (risk areas, judgment calls, follow-ups)
- **How was it verified?** (tests added, manual checks, scenarios covered)

If you can't answer these from the diff alone, ask the user — don't pad the description with guesses.

## Step 3: Choose Output Format

**Branch A — Repository has a PR template:** Use it. Fill each section with the *narrative* version (short, focused, no filler). Leave optional sections empty rather than padding with `N/A` boilerplate. Keep checkbox lists if the template has them, but only check what genuinely applies.

**Branch B — No PR template:** Use the lean default below. Do not invent extra sections.

### Lean default (when no template exists)

```markdown
## Why

[1–2 sentences. The problem or user-visible outcome. Link the issue if there is one. Don't restate the title.]

## What changed

- [Conceptual change 1 — one line]
- [Conceptual change 2 — one line]
- [Conceptual change 3 — one line]

## How to verify

- [Single test command or one scenario, one line]

## Notes for reviewers

[Optional, ≤ 2 sentences. Skip this section entirely if there's nothing load-bearing to flag.]
```

Aim for **2–4 bullets** under "What changed". If you have 6+, the PR is too big or you're enumerating files instead of concepts.

## Step 4: Write the Title

- Imperative mood, specific, under ~70 chars.
- Follow Conventional Commits if the repo uses them: `type(scope): brief description`.
- Good: `fix(auth): refresh token when API returns 401`
- Bad: `Bug fix`, `Various improvements`, `feat: stuff`

## Step 5: Length self-check (before pushing)

Count the rendered lines of the body. If it's over 25, cut. Common cuts:

- **Collapse "Notes for reviewers"** unless it flags a real risk or judgment call. "We chose X because Y" usually belongs in a code comment.
- **Drop "internal narration"** — explanations of memo deps, useEffect timing, and other implementation detail that a reviewer will read in the diff anyway.
- **Merge bullets that share a verb.** "Added X. Added Y. Added Z." → one bullet listing the three.
- **Cut "How to verify" prose** — one command beats three sentences.
- **Drop sub-bullets entirely.** If a bullet needs a sub-bullet, split it into two top-level bullets or remove the detail.

If you've cut as much as you can and it's still over 40 lines, the PR is too big. Stop and offer the user `/create-pr --split` before pushing.

## Step 5.5: Pre-push quality pass (delegated to `polish`)

Clean the branch before it goes up by delegating to the [`polish`](../../quality/polish/SKILL.md) skill. `polish` owns all the pre-push quality logic (the mechanical-fix criteria, the docstring R35 special case, the reviewer-agent dispatch, the simplify pass, and the commit-per-pass behaviour), so `create-pr` carries none of it — the two can never drift.

Skip this step entirely if any of the following hold:

- `--no-quality` was passed in `$ARGUMENTS`.
- The branch diff is non-code only (docs, generated artefacts, lockfiles, asset binaries). Decide from the file list, not the line count.

Otherwise, map the `create-pr` flags to a `polish` mode and invoke it once. The **default is the deep pass**; the flags scale it down. Evaluate in this precedence order (first match wins):

| # | Flags present                                          | Invoke                          | What runs                                              |
| - | ------------------------------------------------------ | ------------------------------- | ----------------------------------------------------- |
| 1 | `--quick`, or both `--no-review` **and** `--no-simplify` | `Skill('polish', 'quick')`     | Light mechanical pass (comments, naming, dead code).  |
| 2 | `--no-review` (or legacy `--simplify` alone)            | `Skill('polish', 'simplify')`   | code-quality simplify — mechanical Class M refactors only. |
| 3 | `--no-simplify` (or legacy `--review` alone)            | `Skill('polish', 'review')`     | Reviewer agent — auto-fix simple, plan complex.       |
| 4 | **none of the above (default)**                         | `Skill('polish')`               | Deep: review pass, then simplify deep (mechanical Class M **and** test-backed Class J refactors). |

(`--no-quality` is handled above as an outright skip and never reaches this table.)

Pass `--critical` through to `polish` if the user passed it to `create-pr`.

`polish` operates on the same branch diff from Step 1, applies its fixes, and commits each pass as its own `chore:` commit — so `create-pr` does **not** commit here; `polish` already did.

After it returns, read its report:

- If `polish` surfaced **planned-complex** (reviewer) or **Class J** (simplify) proposals worth a reviewer's eye, append at most one bullet under "Notes for reviewers" naming the largest one. Don't enumerate every finding.
- If `polish` made no changes, continue silently.

**Hard rules for this step** (enforced inside `polish`, restated here as the contract):

- Never delete or weaken a test, never change public API / exported types as a mechanical fix.
- One `polish` invocation per PR creation. Don't loop.

## Step 6: Push and Create Draft PR

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

## Step 6.5: Dispatch the post-push reviewer-feedback loop (default ON)

After the PR exists, absorb whatever feedback the repo's review bots (Claude, CodeRabbit, …) and humans post — iteratively — without blocking the main thread.

**Skip this step** when `--no-feedback` (or `--no-quality`, which implies no automated feedback work) is in `$ARGUMENTS`. Otherwise run it for every `create-pr`.

Dispatch a subagent with `run_in_background: true` that drives the watch loop, and **continue to Step 7 in the main thread immediately** — do not block on it:

```
Agent(
  description: "Absorb PR review feedback (watch loop)",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: |
    Drive the reviewer-feedback loop for PR <pr-url> to completion.

    Invoke: Skill('implement-suggestion', '<pr-url> --watch')

    That skill waits for new review-bot / human comments after each push,
    validates each through /critical + /confidence, applies the actionable
    ones, pushes, and repeats until the reviewers go quiet (max 5 iterations).
    It never opens a new PR and never undrafts this one.

    Return its final watch report verbatim: the per-iteration table, the
    stop reason, the head commit SHA, and any surfaced (needs-user) comments.
    Keep it under 150 words; do not paste comment bodies or diffs.
)
```

The watch loop and the main-thread CI watch (Steps 7–9) push to the same branch in parallel. Each downstream skill handles pull-rebase internally; do not add explicit serialisation.

Print one line before continuing:

```
Dispatched background reviewer-feedback loop (PR: <pr-url>). Continuing with CI watch.
```

## Step 7: Wait for CI to Settle

The job isn't done when the PR is created. Block on CI so the user doesn't have to come back to a red PR later.

```bash
sleep 10                                          # let workflows register
timeout 1800 gh pr checks <pr-number> --watch     # blocks until every check completes (30-min cap); non-zero exit if any failed
```

`--watch` waits for queued/running checks and exits with the final aggregate status. If the exit code is 0, jump to Step 10. Otherwise continue.

The `timeout 1800` cap keeps a hung or queued-forever check from blocking the skill indefinitely — same idea as the bounded poll in the watch loop ([`../../workflow/implement-suggestion/rules/watch-mode.md`](../../workflow/implement-suggestion/rules/watch-mode.md)). If it expires (exit code 124), run `gh pr checks <pr-number>` once, report the still-pending checks to the user, and escalate instead of re-watching.

If `gh pr checks` reports no checks at all after a minute, this repo probably doesn't run CI on PRs — also jump to Step 10.

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
  Then re-watch with `timeout 1800 gh pr checks <pr-number> --watch` (same 30-minute cap and expiry handling as Step 7). At most one rerun per check.

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

**Unless `--no-feedback` was passed**, also wait for the background reviewer-feedback loop (Step 6.5) to complete — you will be notified — and append its result. Final report shape:

```
PR: <pr-url>
Title: <imperative title>

CI:
  Final status: <green | which checks red>
  Auto-fixed: <one line per fix, or "none">
  Iterations: <total /ci-auto-fix subagent dispatches>

Reviewer feedback loop (/implement-suggestion --watch):
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
