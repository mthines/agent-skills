---
title: Worktree Resolution — One Worktree Per PR
impact: HIGH
tags:
  - worktree
  - gw
  - git
  - isolation
---

# Worktree Resolution

Each PR is processed in its own worktree so multiple PRs in one run never
interleave commits, edits, or pushes on each other's branches.

## Procedure

For each PR tuple from Phase 0:

### Step 1 — Try `gw checkout`

The `gw` CLI ([gw-tools](https://github.com/mthines/gw-tools)) is the canonical tool; without it, an isolated equivalent is `git worktree add ../<repo>-pr-<n> <head-branch>` after `git fetch origin <head-branch>`.

```bash
gw checkout <prNumber>          # if the current repo matches the PR's repo
gw checkout <pr-url>            # cross-repo or to be explicit
```

`gw checkout` creates the worktree if it does not exist, reuses it if it does,
and leaves it on the PR's head branch. Capture the resulting absolute path
from the command output.

### Step 2 — Fallback when `gw` is unavailable

If `gw --help` exits non-zero:

```bash
gh pr checkout <prNumber> --repo <owner>/<repo>   # in the main repo
```

`gh pr checkout` switches the **current** working directory's branch. This is
not isolated — only use it when there is exactly one PR in the run and the
user accepts the trade-off. Surface this in the final report.

For multi-PR runs without `gw`, stop and tell the user to install `gw`. Do not
serially `gh pr checkout` across PRs in the same directory — it leaves the
final PR's branch checked out and silently abandons earlier PRs.

### Step 3 — Verify clean state

Inside the resolved worktree:

```bash
cd <worktree-path>
git status --porcelain          # must be empty
git rev-parse HEAD              # must equal headRefOid from Phase 0
```

If either check fails:

- Dirty working tree → stop for this PR, surface, do **not** auto-stash.
- HEAD ≠ headRefOid → the local branch is behind/ahead the remote. Run
  `git fetch origin` and `git pull --ff-only`. If `--ff-only` fails (branch
  has diverged), stop for this PR and surface — do **not** auto-rebase.

### Step 4 — Record the path

Maintain a map `{ prNumber → worktreePath }` for use in Phase 5. Phase 4 does
not need the worktree path (it only reads metadata and source already fetched
to memory), but Phase 5's `Edit` / `Write` / `git commit` calls all require it.

## Hard rules

- One worktree per PR. Never share a worktree between two PRs in the same run.
- Never auto-stash. A dirty worktree is an unresolved user state.
- Never auto-rebase. If `--ff-only` fails, the human needs to decide.
- Never run `git checkout <branch>` in the user's main worktree to "switch into"
  a PR — that mutates their state without their consent. Always create or reuse
  a `gw` worktree.

## When `gw checkout` finds a stale worktree

If `gw checkout` warns that an existing worktree for the branch is stale (the
remote moved):

1. Surface the warning to the user.
2. Default to **reusing** the worktree and `git pull --ff-only` (Step 3).
3. Never auto-delete the existing worktree.

## Example

```text
PR: dash0/console#1234
1. gw checkout https://github.com/dash0/console/pull/1234
   → ~/Workspace/dash0/console-fix-foo
2. cd ~/Workspace/dash0/console-fix-foo
3. git status --porcelain        → empty ✓
4. git rev-parse HEAD            → 8a7c2d…  (matches headRefOid) ✓
5. Record { 1234 → ~/Workspace/dash0/console-fix-foo }
```
