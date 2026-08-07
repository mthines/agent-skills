---
name: polish
description: >
  Re-runnable pre-PR quality gate for the current branch. Composes two existing
  passes over the branch diff: a broad pr-reviewer pass (read-only review via
  the branch's open PR, which `pr-reviewer` requires) and a code-quality
  simplify pass
  (applies Class M mechanical refactors behind a confidence ≥ 90 % gate,
  reverting on failure). Run bare for the full review + simplify works; scope it
  with `review`, `simplify`, or the light `quick` mechanical pass. Commits each
  pass separately for traceability (`--no-commit` to skip). Use standalone any
  time mid-development to clean a branch. Note that `/create-pr` delegates its
  quality step to `review-loop` (the bounded convergence loop) post-draft, and
  the `review-loop` skill calls only `polish simplify` — never full `polish`.
  Triggers on "polish my branch", "clean this up before the PR", "review and
  simplify", "tidy up", "prep my branch", "/polish".
disable-model-invocation: false
argument-hint: '[review|simplify|quick] [--no-commit] [--critical]'
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: command
  tags:
    - code-quality
    - review
    - simplify
    - refactor
    - pre-pr
    - branch-cleanup
    - pr-reviewer
    - orchestrator
---

# Polish — Re-runnable Branch Quality Gate

Get a branch into clean, reviewable shape **before** it goes up for review — and run it again any time you've made a lot of changes and want to tidy up.

This skill is an **orchestrator**. It does not contain quality rules of its own; it composes two existing pieces over the current branch diff:

1. The **`pr-reviewer` agent** — broad review via the branch's open PR (read-only; findings are surfaced for you to act on, applied via `implement-suggestion`). Requires an open PR — `pr-reviewer` has no PR-less mode. If no PR is open, Pass A is skipped and you are told to open a draft PR via `/create-pr` first.
2. The **`code-quality` skill in `simplify` mode** — applies Class M *mechanical* refactors one at a time behind `Skill("confidence", "code") ≥ 90 %` and a scoped fast-check, reverting any that fail. Class J (judgment) recipes stay as proposals.

`/create-pr` delegates its post-draft quality step to `review-loop` (the bounded convergence loop), which calls only `polish simplify` — never full `polish`. You can run `polish` standalone at any point for a pre-draft local check.

## Modes

Parse the **first token** of `$ARGUMENTS`. Everything else is a flag.

| Mode                 | Trigger                          | What runs                                                                                                    |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **full** *(default)* | No mode token                    | `review` pass (pr-reviewer, read-only), then `simplify` pass. The "do the works" button.                    |
| `review`             | First token `review`             | `pr-reviewer` pass only — read-only review surfaced as findings for you to act on.                           |
| `simplify`           | First token `simplify`           | `code-quality` simplify pass only — apply Class M mechanical refactors.                                      |
| `optimize`           | First token `optimize`           | Optimality pass only — `Skill("optimize-approach", "apply")` over the branch diff (gated approach rewrite).  |
| `quick`              | First token `quick`              | Light mechanical pass only (comments, naming, dead code). No pr-reviewer pass, no structural refactors.      |

In `full` and `review` modes the optimality lens runs **inside** the `pr-reviewer` pass (which runs `optimize-approach` in report mode at Step 2.4c). The standalone `optimize` mode above is for running only that lens without the rest of the review pass.

Flags (compose with any mode):

| Flag          | Effect                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `--no-commit` | Leave all changes in the working tree instead of committing each pass. Use mid-development to keep iterating. |
| `--critical`  | Pass `--critical` through to the `pr-reviewer` agent (adversarial pre-mortem). Ignored by `simplify` / `quick`.    |
| `--no-optimize` | Pass `--no-optimize` through to the `pr-reviewer` agent — skip the default-on optimality lens (Step 2.4c). Ignored by `simplify` / `quick`. |

**Order is fixed in full mode: `review` first, then `simplify`.** The review pass surfaces correctness and obvious cleanups; simplify then applies structural refactors to the already-cleaner code, so confidence gates evaluate the final shape.

## Step 0: Resolve mode and preconditions

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "polish: not a git repo"; exit 1; }
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin main --quiet 2>/dev/null || git fetch origin --quiet 2>/dev/null
```

Refuse to run on the default branch — there is no branch diff to polish:

```bash
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "polish: on $BRANCH — check out a feature branch first."
  exit 1
fi
```

Establish the scope and whether there's anything to do:

```bash
git diff --name-only origin/main...HEAD     # files changed on this branch
git diff --stat origin/main...HEAD
```

If the branch diff is empty, print `polish: no changes vs origin/main — nothing to do.` and exit.

If the branch diff is **non-code only** (docs, lockfiles, generated artefacts, asset binaries — decide from the file list, not the line count), print one line and exit: `polish: branch diff is non-code only — skipping.`

## Step 1: Working-tree check

```bash
git status --porcelain
```

- **Clean tree (empty output):** ideal. Each pass's commit contains only that pass's changes.
- **Dirty tree, committing (default):** print a one-line warning — `polish: working tree is dirty; pass commits will include your uncommitted changes. Commit or stash first to keep them separate.` — then continue.
- **Dirty tree, `--no-commit`:** no warning needed; nothing is committed.

Never stash, discard, or reset the user's uncommitted work to "clean up" the tree.

## Step 2: Run the passes

Run only the passes the resolved mode selects (see the Modes table). Each pass below is self-contained.

### Pass A — `review` (modes: full, review)

Invoke `pr-reviewer` against the branch's open PR.
`pr-reviewer` requires a PR — it always posts one visible `COMMENT` review and returns findings.
Polish does not apply those findings itself; surface them to the user.

```bash
# Resolve the current branch's PR — pr-reviewer requires one.
PR_URL=$(gh pr view --json url -q .url 2>/dev/null)
```

If no PR is open, skip Pass A and tell the user to open a draft PR first (via `/create-pr`), then re-run `polish`.
When a PR exists, dispatch the review. `pr-reviewer` is an **agent** — dispatch it via
the Task tool (`subagent_type="pr-reviewer"`), **not** `Skill()` (there is no
`pr-reviewer` skill; `Skill("pr-reviewer")` errors with `Unknown skill`):

```
Task(subagent_type="pr-reviewer", prompt="<PR-URL-or-number> [--critical if user passed it] [--no-optimize if user passed it]")
```

The `pr-reviewer` pass includes the **optimality lens** (Step 2.4c, report-only).
Pass `--no-optimize` through when the user set it on polish.

Capture from the agent's reply: the verdict and the findings list.
Surface all findings to the user — polish does not auto-apply them.
If you want findings applied, use `review-loop` (which calls `implement-suggestion` after each `pr-reviewer` pass) rather than `polish review`.

### Pass B — `simplify` (modes: full, simplify)

Invoke the code-quality skill in simplify mode against the branch diff:

```
Skill("code-quality", "simplify")
```

This runs the code-quality review pass, then **applies** Class M (mechanical) refactors one at a time — each behind `Skill("confidence", "code") ≥ 90 %` and a scoped fast-check, reverting any that fail its check. Class J (judgment) recipes are returned as proposals only.

Capture from its output: which recipes were applied (by ID, e.g. R6, R12) and which were surfaced as judgment-required proposals.

Do **not** pass `aggressive` unless the user explicitly asked for it — the default (High-impact Class M only) is the safe pre-PR setting.

### Pass D — `optimize` (mode: optimize only)

The standalone optimality pass. Invoke `optimize-approach` in apply mode against the branch diff:

```
Skill("optimize-approach", "apply")
```

This judges each approach unit against the four-axis rubric and **applies** at most one materially-better approach rewrite behind its own `apply_safe` + `confidence(code) ≥ 90 %` gate, with a scoped check and revert-on-failure. Anything not apply-safe or below the gate is surfaced as a proposal, not applied. Capture which rewrite was applied (axis + files) and which proposals were reported.

Do not run this pass in `full` mode — `full`'s reviewer pass already covers optimality via Step 2.4c, and running it twice would double the work.

### Pass C — `quick` (mode: quick only)

The light mechanical pass. Invoke code-quality in **review** mode against the branch diff, then auto-apply only the mechanical subset:

```
Skill("code-quality", "review")
```

**Auto-apply** a finding only when it meets **all three**:

- Footprint stays inside files already in the branch diff (no new files, no edits outside the diff).
- The fix is mechanical, not a judgment call: removing/rewriting a plain inline comment that explains WHAT or references the current task; renaming a local variable to a domain noun; dropping `else` after `return`/`throw`; extracting a magic number to a named constant; deleting unreachable/dead code introduced on this branch; flipping a single guard clause to an early return.
- The fix does not change behaviour observable from a test or a caller.

**Docstring / JSDoc / TSDoc / Python-docstring blocks attached to a function, method, class, type, or exported constant are a special case.** Never delete the block as noise removal — IDE hover, type strippers, and doc generators read it. Instead apply code-quality recipe **R35 step 4**: trim verbose prose to a one-sentence summary plus the structured tags (`@param`, `@returns`, `@throws`, `@deprecated`, `@since`, `@example`, `@see`, `@internal`, `@experimental`). Keep the summary line and every contract-bearing tag; drop only the restated-WHAT prose. If the block would be empty after trimming, surface it as a judgment-required finding instead of removing it. License / SPDX headers and linter pragmas (`eslint-disable-next-line`, `@ts-expect-error`, `# noqa`) are never removed.

**Surface but do NOT auto-apply** (out of scope for `quick` — that's what `simplify` is for): structural refactors, type-driven design changes, anything that expands blast radius into files outside the diff, anything where a sibling test would need updating.

## Step 3: Commit each pass that changed files

Unless `--no-commit` was passed, commit after each pass that produced changes, as its own commit, so the diff stays traceable. Skip the commit if a pass made no edits.

```bash
# After Pass A (review):
# Note: pr-reviewer is read-only — no local changes to commit from Pass A.
# Commit only if polish itself made edits (e.g. from a quick pass or simplify).
git add -u && git commit -m "chore: review pass (findings from pr-reviewer)"

# After Pass B (simplify):
git add -u && git commit -m "chore: simplify pass (mechanical refactors)"

# After Pass C (quick):
git add -u && git commit -m "chore: code-quality pass (comments, naming, dead code)"

# After Pass D (optimize):
git add -u && git commit -m "chore: optimize pass (approach rewrite)"
```

In full mode this can produce up to two commits (review, then simplify). That is intended — each pass is independently revertible.

With `--no-commit`, stage nothing; leave every change in the working tree for the user to review and commit themselves.

## Step 4: Report

Print a compact summary. Match the depth to what ran.

```
Polish (<mode>) on <branch>

Review pass (pr-reviewer):
  Verdict: <PASS | FAIL | n/a (not run)>
  Findings surfaced: <N findings; apply via review-loop, or "none">
  Needs your judgment: <one line per blocking item, or "none">

Simplify pass:
  Applied: <recipe IDs + one-line each, or "none">
  Proposed (Class J, not applied): <one line each, or "none">

Quick pass:        # only if mode == quick
  Applied: <one line per mechanical fix, or "none">

Optimize pass:     # only if mode == optimize
  Applied: <axis + files of the applied approach rewrite, or "none">
  Proposed (not applied): <one line each, or "none">

Commits: <SHA + message per pass, or "none (--no-commit)">
```

Surface the **findings** (review) and **Class J proposals** (simplify) prominently — these are the items the user still needs to decide on.
Do not silently drop them.

## Hard rules

- **Never weaken the codebase to look clean.** No deleting/skipping/weakening tests, no disabling lint rules or type checks, no `--no-verify`.
- **Never change public API or exported types** as a mechanical fix. That is always judgment-required — surface it.
- **Never apply a Class J (judgment) refactor automatically.** Only Class M, only behind the confidence gate. When unsure whether a fix is mechanical or judgment, treat it as judgment and surface it.
- **Approach rewrites (optimize pass) apply only behind the confidence gate, scoped to the diff's files, with revert-on-failure.** An approach rewrite touching a public API, a forbidden target, or files outside the diff is surfaced as a proposal, never auto-applied — that policy lives in the `optimize-approach` skill and polish does not override it.
- **Never write to GitHub.** Polish is local-only. PR creation and any GitHub-side review belong to `/create-pr`.
- **Never stash, reset, or discard the user's uncommitted work.**
- **One pass each per invocation. Do not loop.** If the branch still has issues after a polish run, that is a signal for the user to act on, not for the skill to grind.

## Relationship to `review-loop` and `/create-pr`

`review-loop` calls only `Skill("polish", "simplify")` — never full `polish` or `polish review`.
This is the anti-circularity guarantee: `review-loop` drives `pr-reviewer` itself each iteration;
having `polish review` re-enter `pr-reviewer` would create a dispatch cycle.

`/create-pr` delegates its post-draft quality step to `review-loop` (the bounded convergence
loop), not directly to `polish`.
`polish` is still useful standalone as a pre-draft local check.

| `review-loop` invocation             | Delegates to                    |
| ------------------------------------ | ------------------------------- |
| `review-loop` (each iteration step C) | `Skill("polish", "simplify")` only |

| `/create-pr` flag         | Post-draft quality path                        |
| ------------------------- | ---------------------------------------------- |
| `/create-pr` (default)    | `Skill("review-loop")` (full convergence loop) |
| `/create-pr --no-review`  | `Skill("polish", "simplify")` — simplify only, one pass |
| `/create-pr --no-simplify`| `pr-reviewer` agent (Task tool) one-shot only  |
| `/create-pr --quick`      | `Skill("polish", "quick")` on the draft diff   |
| `/create-pr --no-quality` | *(quality skipped)*                            |
