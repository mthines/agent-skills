---
title: Line validity — hunk-bounds pre-flight on the RIGHT side
impact: HIGH
tags:
  - pr-reviewer
  - github-api
  - diff-hunks
---

# Line validity

## Pre-flight is a pure in-memory computation — zero GitHub API calls

Line validity is decided **entirely** from the patch data already cached in `/tmp/pr-files.json` at Step 1.2, using the `compute_valid_right_lines` hunk-walk below. It makes **no network calls of any kind**.

**Never post a probe, test, or throwaway comment to GitHub to discover whether a line is valid.** There is no such thing as a "safe test comment": every `POST .../pulls/{n}/reviews` call is a real review — under some configurations (e.g. `event: "COMMENT"`) it is submitted and made public immediately, producing duplicate/stray comments the author sees. The **first and only** GitHub review API call in the whole run is the final submit POST in `posting-mechanics.md` that carries all comments in one payload. If you find yourself reaching for `gh api` during pre-flight to "check" a line, STOP — the answer is already in `/tmp/pr-files.json`.

The GitHub review API `line` parameter refers to the line number on the **RIGHT side** (new file) of the diff. A comment whose line falls outside any diff hunk on the RIGHT side returns:

```
HTTP 422: Pull request review thread line must be part of the diff
          and Pull request review thread diff hunk can't be blank.
```

**One bad comment fails the entire review payload.** If 5 comments are posted and one has an out-of-hunk line, all 5 are rejected. Pre-flight every comment.

## Cache the patch list once

At Step 1.2 in `pr-reviewer.md`, cache every changed file's patch:

```bash
REPO=${PR_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
gh api repos/$REPO/pulls/$PR_NUMBER/files \
  --jq '.[] | {filename, patch}' > /tmp/pr-files.json
```

`/tmp/pr-files.json` is the single source of truth for line validity. The agent never re-derives valid lines from `gh pr diff` later in the run.

## How to compute the valid RIGHT-side range

For each `@@ -a,b +c,d @@` hunk:

1. Valid RIGHT-side range starts at `c`, extends `d - 1` lines beyond.
2. From that range, subtract:
   - Lines prefixed `-` (deleted from the LEFT side; not on RIGHT).
   - The `@@` header line itself.
3. The remaining lines are valid `line` targets.

Example:

```diff
@@ -10,6 +10,8 @@
 unchanged line          ← line 10  (valid)
 unchanged line          ← line 11  (valid)
+new line I want         ← line 12  (valid)
+another new line        ← line 13  (valid)
 unchanged line          ← line 14  (valid)
-deleted line            ← (skip — not on RIGHT side)
 unchanged line          ← line 15  (valid)
```

## Pre-flight per comment

For each proposed comment in the local proposal (output of `rubric-composition.md` after all earlier gates):

```python
def validate_line(file: str, line: int, patches: dict) -> tuple[bool, int | None, str]:
    """
    Returns (is_valid, suggested_retarget, reason).
    suggested_retarget is None if the line is already valid; otherwise the
    nearest valid RIGHT-side line in the SAME hunk, or None if no hunk owns
    the file or no valid retarget exists.
    """
    patch = patches.get(file)
    if not patch:
        return (False, None, "file not in PR changeset")
    valid_lines = compute_valid_right_lines(patch)  # see hunk-walk above
    if line in valid_lines:
        return (True, None, "")
    # Find nearest valid line in any hunk that covers the file
    nearest = min(valid_lines, key=lambda v: abs(v - line), default=None)
    if nearest is None:
        return (False, None, "no valid RIGHT-side lines in file")
    if abs(nearest - line) <= 3:
        return (True, nearest, f"retargeted from {line} to {nearest}")
    return (False, None, f"closest valid line {nearest} is too far")
```

## Decision matrix

| Result | Action |
| --- | --- |
| `(True, None, "")` | Use line as-is |
| `(True, <new>, reason)` | Retarget; **append the move note to the comment body**: `(originally proposed for line N — moved to nearest hunk line)` |
| `(False, None, reason)` | Drop the comment; surface in terminal output for manual posting |

## Why retarget only when ≤ 3 lines away

A retarget that moves a comment by 5+ lines often crosses a logical boundary — it ends up pinned to code the comment does not describe. Three lines is the empirical threshold that keeps the comment anchored to the right context. Above that, drop is safer.

## Multi-line comments

For multi-line comments (`start_line` + `line` both set), both endpoints must be in the same hunk and both must be on the RIGHT side. If either is out of bounds, drop — do not split the multi-line range into two single-line comments, the resulting pair often loses the original semantic.

## Pre-existing-issue interaction

A finding may be on a **context line** (` `-prefix, valid for commenting) or on an **unchanged line outside any hunk** (invalid). Context lines are valid review targets — the API accepts comments on them — but they are pre-existing issues (`agents/pr-reviewer.md` Step 1.5 tags them `[pre-existing]`). These comments are still posted, but counted separately in the Quality Gate summary and excluded from the verdict math.

## What this rule does not catch

- Comments whose `line` is correct on the RIGHT but whose `path` is wrong (e.g. agent typed `src/Foo.ts` when the file is `src/foo.ts`). Caught by `gh api` with HTTP 422 "file not in PR"; mitigation: the pre-flight reads `filename` from `/tmp/pr-files.json` so a path typo would have already failed earlier.
- The "diff hunk can't be blank" error when GitHub considers a hunk too small. Rare; if hit, the agent reports the failure and the user re-runs after the patch grows.
- Race condition where the PR receives new commits between the Step 1.2 cache and the Step 5 post. Mitigation: post against `commit_id = head.sha` captured at the cache step, not the latest SHA at post time.
