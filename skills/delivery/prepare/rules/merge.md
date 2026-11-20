---
title: --merge — squash-merge each PR once every gate passes
impact: HIGH
tags:
  - prepare
  - merge
  - stack
---

# `--merge`

Read this file only when `--merge` was passed.
It replaces the end of the run: instead of stopping at green, each PR is merged, bottom to top.

## Gates

Check each of these explicitly, after the fixes are pushed, before merging a PR:

| Gate | Passes when |
| --- | --- |
| Threads | Every review thread is resolved |
| CI | Checks on the new head are passing |
| Conflicts | `mergeable` is not `CONFLICTING` |
| Review | `reviewDecision` is not `CHANGES_REQUESTED` |

**Why:** a merge is hard to undo, so each gate is read from live PR state, not assumed from the fixes just made.

## Order

1. Take the lowest open PR in `PRS`.
2. Run Step 2 of [`SKILL.md`](../SKILL.md) on it if it needs work; a PR that was already green skips straight to the gates.
3. If every gate passes, run `gh pr merge <n> --squash`.
4. Move to the next PR.
   Before fixing it, retarget it to the base when GitHub did not (`gh pr edit <n> --base <base>`), then re-check its state: the merge below can create conflicts or red CI.
5. Stop at the first PR that cannot be merged and say what blocks it.
   Never merge a PR above one that is still open.

## Report

One line per PR:

```text
#1 merged · #2 fixed CI, merged · #3 blocked: review requested changes
```
