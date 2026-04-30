---
name: create-pr
description: >
  Generate a short, narrative GitHub pull request description (≤ 25 lines, hard
  ceiling 40), push the branch, open the PR, then watch CI and auto-fix simple
  failures (lint, format, lockfiles) before handing back. Escalates
  judgment-required failures via /confidence rather than guessing. Invoke with
  /create-pr.
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.1.0'
  workflow_type: command
---

# Generate Pull Request Description

Generate a **short, narrative** PR description that tells reviewers *why* this change exists and *what* to expect when they open the diff. Reviewers skim. If the description is long, they skip it. Respect their time.

## Length budget — the hard rule

A reviewer should read the entire description in **under 30 seconds**. Concretely:

- **Body target: ≤ 25 rendered lines.** Hard ceiling: 40. Tables, checklists, and blank lines all count toward this.
- **Why: 1–2 sentences.** Not paragraphs.
- **What changed: 2–4 bullets, one line each.** No sub-bullets, no code blocks inside bullets.
- **How to verify: ≤ 3 lines.** Prefer a single command over prose.
- **Notes for reviewers: optional. If present, ≤ 2 sentences.** Move implementation detail into code comments or PR review threads, not the body.

If you can't fit the change inside this budget, the PR is probably too big — flag that to the user instead of expanding the description.

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

If you've cut as much as you can and it's still over 40 lines, the PR is too big. Tell the user before pushing.

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

## Step 7: Wait for CI to Settle

The job isn't done when the PR is created. Block on CI so the user doesn't have to come back to a red PR later.

```bash
sleep 10                                # let workflows register
gh pr checks <pr-number> --watch        # blocks until every check completes; non-zero exit if any failed
```

`--watch` waits for queued/running checks and exits with the final aggregate status. If the exit code is 0, jump to Step 10. Otherwise continue.

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
  Then re-watch with `gh pr checks <pr-number> --watch`. At most one rerun per check.

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

- **If the PR is hard to summarize concisely, the PR is probably too big.** Suggest splitting before writing prose to paper over it.
- **One concept = one PR.** Mixed-purpose PRs make narrative descriptions awkward — that's the description telling you something.
- **Prefer linking** (`Closes #123`) over re-explaining context that's already in the issue.
- **Always push first** — `gh pr create` requires the branch on the remote. With `gw add`, tracking is pre-configured so plain `git push` works.
