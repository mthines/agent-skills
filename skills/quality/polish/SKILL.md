---
name: polish
description: >
  Re-runnable pre-PR quality gate for the current branch. Composes two existing
  passes over the branch diff: a broad reviewer-agent pass (auto-fixes simple
  issues, plans complex ones) and a code-quality simplify pass (applies Class M
  mechanical refactors behind a confidence ≥ 90 % gate, reverting on failure).
  Run bare for the full review + simplify works; scope it with `review`,
  `simplify`, or the light `quick` mechanical pass. Commits each pass separately
  for traceability (`--no-commit` to skip). Use standalone any time mid-development
  to clean a branch, and note that `/create-pr` delegates to it (default → quick,
  `--review` → review, `--simplify` → simplify). Triggers on "polish my branch",
  "clean this up before the PR", "review and simplify", "tidy up", "prep my
  branch", "/polish".
disable-model-invocation: false
argument-hint: '[review|simplify|quick] [--no-commit] [--critical]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: command
  tags:
    - code-quality
    - review
    - simplify
    - refactor
    - pre-pr
    - branch-cleanup
    - reviewer-agent
    - orchestrator
---

# Polish — Re-runnable Branch Quality Gate

Get a branch into clean, reviewable shape **before** it goes up for review — and run it again any time you've made a lot of changes and want to tidy up.

This skill is an **orchestrator**. It does not contain quality rules of its own; it composes two existing pieces over the current branch diff:

1. The **`reviewer` agent** — broad own-work review (correctness, holistic intent/system-fit, code-quality, UX). Auto-fixes simple issues; plans complex ones.
2. The **`code-quality` skill in `simplify` mode** — applies Class M *mechanical* refactors one at a time behind `Skill("confidence", "code") ≥ 90 %` and a scoped fast-check, reverting any that fail. Class J (judgment) recipes stay as proposals.

`/create-pr` delegates its pre-push quality step to this skill, so the two never drift. You can also run it standalone at any point.

## Modes

Parse the **first token** of `$ARGUMENTS`. Everything else is a flag.

| Mode                 | Trigger                          | What runs                                                                                                  |
| -------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **full** *(default)* | No mode token                    | `review` pass, then `simplify` pass. The "do the works" button.                                           |
| `review`             | First token `review`             | Reviewer-agent pass only — auto-fix simple, plan complex.                                                  |
| `simplify`           | First token `simplify`           | `code-quality` simplify pass only — apply Class M mechanical refactors.                                    |
| `quick`              | First token `quick`              | Light mechanical pass only (comments, naming, dead code). No reviewer agent, no structural refactors.     |

Flags (compose with any mode):

| Flag          | Effect                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `--no-commit` | Leave all changes in the working tree instead of committing each pass. Use mid-development to keep iterating. |
| `--critical`  | Pass `--critical` through to the reviewer agent (adversarial pre-mortem). Ignored by `simplify` / `quick`.    |

**Order is fixed in full mode: `review` first, then `simplify`.** The reviewer fixes correctness and obvious cleanups; simplify then applies structural refactors to the already-cleaner code, so confidence gates evaluate the final shape.

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

Dispatch the **`reviewer` agent** as a subagent. It auto-detects its sub-mode from the working tree (own branch with no PR → Fix Mode, auto-fix simple + plan complex; own PR exists → Self-Review, same auto-fix policy). It never writes to GitHub.

```
Agent(
  subagent_type: "reviewer",
  description: "Polish: review + auto-fix current branch",
  prompt: |
    Review the current branch diff against origin/main as own work.
    Auto-fix simple issues directly in the working tree; plan (do not apply)
    complex ones. Do not touch GitHub. Do not weaken or delete tests.
    Return: the verdict, the list of auto-fixed items (one line each), and
    the list of planned-but-not-applied complex items (title + why + files).
    <pass "--critical" here only if the user passed --critical to polish>
)
```

Capture from the agent's reply: the verdict, the auto-fixed list, and the planned-complex list. The planned-complex items are **surfaced to the user**, not applied — they need judgment.

The reviewer runs its own post-fix verification (targeted tests for changed files) and reverts any auto-fix that regresses. Do not re-run a full verify here; trust its gate.

### Pass B — `simplify` (modes: full, simplify)

Invoke the code-quality skill in simplify mode against the branch diff:

```
Skill("code-quality", "simplify")
```

This runs the code-quality review pass, then **applies** Class M (mechanical) refactors one at a time — each behind `Skill("confidence", "code") ≥ 90 %` and a scoped fast-check, reverting any that fail its check. Class J (judgment) recipes are returned as proposals only.

Capture from its output: which recipes were applied (by ID, e.g. R6, R12) and which were surfaced as judgment-required proposals.

Do **not** pass `aggressive` unless the user explicitly asked for it — the default (High-impact Class M only) is the safe pre-PR setting.

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
git add -u && git commit -m "chore: review pass (auto-fixes from reviewer)"

# After Pass B (simplify):
git add -u && git commit -m "chore: simplify pass (mechanical refactors)"

# After Pass C (quick):
git add -u && git commit -m "chore: code-quality pass (comments, naming, dead code)"
```

In full mode this can produce up to two commits (review, then simplify). That is intended — each pass is independently revertible.

With `--no-commit`, stage nothing; leave every change in the working tree for the user to review and commit themselves.

## Step 4: Report

Print a compact summary. Match the depth to what ran.

```
Polish (<mode>) on <branch>

Review pass:
  Verdict: <Approve | Approve with comments | Request changes | n/a (not run)>
  Auto-fixed: <one line per fix, or "none">
  Planned (needs your judgment): <one line per complex item, or "none">

Simplify pass:
  Applied: <recipe IDs + one-line each, or "none">
  Proposed (Class J, not applied): <one line each, or "none">

Quick pass:        # only if mode == quick
  Applied: <one line per mechanical fix, or "none">

Commits: <SHA + message per pass, or "none (--no-commit)">
```

Surface the **planned-complex** (review) and **Class J proposals** (simplify) prominently — these are the items the user still needs to decide on. Do not silently drop them.

## Hard rules

- **Never weaken the codebase to look clean.** No deleting/skipping/weakening tests, no disabling lint rules or type checks, no `--no-verify`.
- **Never change public API or exported types** as a mechanical fix. That is always judgment-required — surface it.
- **Never apply a Class J (judgment) refactor automatically.** Only Class M, only behind the confidence gate. When unsure whether a fix is mechanical or judgment, treat it as judgment and surface it.
- **Never write to GitHub.** Polish is local-only. PR creation and any GitHub-side review belong to `/create-pr`.
- **Never stash, reset, or discard the user's uncommitted work.**
- **One pass each per invocation. Do not loop.** If the branch still has issues after a polish run, that is a signal for the user to act on, not for the skill to grind.

## Relationship to `/create-pr`

`/create-pr` delegates its pre-push quality step to this skill:

| `/create-pr` invocation     | Delegates to            |
| --------------------------- | ----------------------- |
| `/create-pr` (default)      | `Skill("polish", "quick")`    |
| `/create-pr --review`       | `Skill("polish", "review")`   |
| `/create-pr --simplify`     | `Skill("polish", "simplify")` |
| `/create-pr --review --simplify` | `Skill("polish")` (full) |
| `/create-pr --no-quality`   | *(polish skipped)*      |

Because the logic lives here, the standalone `/polish` command and `/create-pr`'s pre-push pass can never drift apart.
