---
name: polish
description: >
  Re-runnable pre-PR quality gate for the branch: a read-only pr-reviewer
  pass via the open PR, then a code-quality simplify pass applying mechanical
  refactors behind a confidence >= 90 % gate; scope with review, simplify,
  optimize, or quick; --no-commit skips commits. Triggers on "polish my
  branch", "clean this up before the PR", "review and simplify",
  "tidy up",
  "prep my branch", "/polish".
disable-model-invocation: false
argument-hint: '[review|simplify|quick] [--no-commit] [--critical]'
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: command
  tags: [code-quality, review, simplify, refactor, pre-pr, branch-cleanup, pr-reviewer, orchestrator]
---

# Polish — Re-runnable Branch Quality Gate

Get a branch into reviewable shape, and re-run any time after a batch of changes.
Polish has no quality rules of its own; it composes the `pr-reviewer` agent (read-only review via the branch's open PR) and `code-quality` in `simplify` mode over the branch diff.
How `review-loop` and `/create-pr` call polish: [`references/callers.md`](./references/callers.md).

## Modes

Parse the **first token** of `$ARGUMENTS`. Everything else is a flag.

| Mode | Trigger | What runs |
| --- | --- | --- |
| **full** *(default)* | No mode token | Pass A (`review`), then Pass B (`simplify`) — this order is fixed. |
| `review` | First token `review` | Pass A only. |
| `simplify` | First token `simplify` | Pass B only. |
| `optimize` | First token `optimize` | Pass D only. |
| `quick` | First token `quick` | Pass C only — light mechanical pass (comments, naming, dead code); no pr-reviewer pass, no structural refactors. |

| Flag | Effect |
| --- | --- |
| `--no-commit` | Leave all changes in the working tree instead of committing each pass. |
| `--critical` | Pass `--critical` through to `pr-reviewer`. Ignored by `simplify` / `quick`. |
| `--no-optimize` | Pass `--no-optimize` through to `pr-reviewer` (skips its optimality lens, Step 2.4c). Ignored by `simplify` / `quick`. |

## Step 0: Resolve mode and preconditions

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "polish: not a git repo"; exit 1; }
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin main --quiet 2>/dev/null || git fetch origin --quiet 2>/dev/null
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "polish: on $BRANCH — check out a feature branch first."
  exit 1
fi
git diff --name-only origin/main...HEAD     # files changed on this branch
git diff --stat origin/main...HEAD
```

- Empty branch diff: print `polish: no changes vs origin/main — nothing to do.` and exit.
- Non-code-only diff (docs, lockfiles, generated artefacts, asset binaries — decide from the file list, not the line count): print `polish: branch diff is non-code only — skipping.` and exit.

## Step 1: Working-tree check

Run `git status --porcelain`.
If the tree is dirty and you will commit (no `--no-commit`), print `polish: working tree is dirty; pass commits will include your uncommitted changes. Commit or stash first to keep them separate.` and continue.
Never stash, discard, or reset the user's uncommitted work.

## Step 2: Run the passes

Run only the passes the resolved mode selects.

### Pass A — `review` (modes: full, review)

Resolve the PR with `PR_URL=$(gh pr view --json url -q .url 2>/dev/null)`.
If no PR is open, skip Pass A and tell the user to open a draft PR (via `/create-pr`) and re-run `polish` — `pr-reviewer` has no PR-less mode.
Otherwise dispatch the agent with the Task tool — `pr-reviewer` is an agent, and `Skill("pr-reviewer")` errors with `Unknown skill`:

```
Task(subagent_type="pr-reviewer", prompt="<PR-URL-or-number> [--critical if user passed it] [--no-optimize if user passed it]")
```

It posts one visible `COMMENT` review and returns a verdict and findings; its optimality lens (Step 2.4c) runs in report mode.
Capture the verdict and findings and surface all of them — polish never applies them.
For applied findings, point the user to `review-loop` rather than `polish review`.

### Pass B — `simplify` (modes: full, simplify)

```
Skill("code-quality", "simplify")
```

It applies Class M (mechanical) refactors one at a time, each behind `Skill("confidence", "code") ≥ 90 %` and a scoped fast-check, reverting any that fail; Class J (judgment) recipes come back as proposals.
Capture the applied recipe IDs (e.g. R6, R12) and the proposals.
Do not pass `aggressive` unless the user explicitly asked for it.

### Pass D — `optimize` (mode: optimize only)

```
Skill("optimize-approach", "apply")
```

It applies at most one materially-better approach rewrite behind its own `apply_safe` + `confidence(code) ≥ 90 %` gate, with a scoped check and revert-on-failure; everything else comes back as proposals.
Capture the applied rewrite (axis + files) and the proposals.
Never run Pass D in `full` mode.

### Pass C — `quick` (mode: quick only)

Read [`rules/quick-pass.md`](./rules/quick-pass.md) when the mode is `quick`: it runs `Skill("code-quality", "review")` and auto-applies only the mechanical subset, with the docstring-trimming rule.

## Step 3: Commit each pass that changed files

Unless `--no-commit`, commit each pass that produced edits as its own commit; skip a pass with no edits.
Pass A is read-only, so it normally has nothing to commit.

```bash
git add -u && git commit -m "chore: review pass (findings from pr-reviewer)"                  # Pass A, only if polish made edits
git add -u && git commit -m "chore: simplify pass (mechanical refactors)"                    # Pass B
git add -u && git commit -m "chore: code-quality pass (comments, naming, dead code)"         # Pass C
git add -u && git commit -m "chore: optimize pass (approach rewrite)"                        # Pass D
```

With `--no-commit`, stage nothing.

## Step 4: Report

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

Surface the review findings and Class J proposals prominently; never drop them.

## Hard rules

- **Never weaken the codebase to look clean.** No deleting/skipping/weakening tests, no disabling lint rules or type checks, no `--no-verify`.
- **Never change public API or exported types** as a mechanical fix. That is always judgment-required — surface it.
- **Never apply a Class J (judgment) refactor automatically.** Only Class M, only behind the confidence gate. When unsure whether a fix is mechanical or judgment, treat it as judgment and surface it.
- **Approach rewrites (optimize pass) apply only behind the confidence gate, scoped to the diff's files, with revert-on-failure.** A rewrite touching a public API, a forbidden target, or files outside the diff stays a proposal — that policy lives in `optimize-approach` and polish does not override it.
- **Never write to GitHub.** Polish is local-only. PR creation and any GitHub-side review belong to `/create-pr`.
- **Never stash, reset, or discard the user's uncommitted work.**
- **One pass each per invocation. Do not loop.** Remaining issues after a run are for the user to act on.
