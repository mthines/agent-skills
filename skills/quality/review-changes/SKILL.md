---
name: review-changes
description: >
  Review branch changes or a PR for code quality, tests, documentation, and commit
  hygiene. Routes to the `review-loop` skill for a bounded review-apply-simplify
  convergence loop, or to `pr-reviewer` directly for a one-shot read-only review.
  Invoke with /review-changes.
disable-model-invocation: true
argument-hint: '[<pr-url>|#<n>] [--report] [--critical] [--publish]'
license: MIT
metadata:
  author: mthines
  version: '3.0.0'
  workflow_type: command
---

## Routing

Choose the path based on the argument shape:

| Argument shape | Path | Reason |
| --- | --- | --- |
| no arg / `--report` | `Skill("review-loop", "<pr-url>")` on the current branch's open PR, or `pr-reviewer` directly if `--report` (one-shot, no apply) | Own PR convergence loop, or one-shot report. |
| PR URL or `#<n>` | `Skill("review-loop", "<pr-url>")` — runs the bounded review-apply-simplify loop | Converges the PR regardless of who authored it (`pr-reviewer` detects `REVIEW_RELATION` itself). |
| `--publish` | `pr-reviewer` directly (one-shot, cross-review posting authorization) | `--publish` is the cross-review authorization token for a single-pass read-only review. |

```bash
# Resolve the current PR if no argument given
if [ -z "$ARGUMENTS" ] || [ "$ARGUMENTS" = "--report" ]; then
  CURRENT_PR=$(gh pr view --json url -q .url 2>/dev/null)
fi
```

```
# Default — convergence loop on own or specified PR
Skill("review-loop", "<pr-url-or-number> [--critical if passed]")

# Report-only (no apply) — one-shot review
Skill("pr-reviewer", "<pr-url-or-number> [--critical if passed]")

# Cross-review with posting authorization
Skill("pr-reviewer", "<pr-url-or-number> [--publish] [--critical if passed]")
```

## Usage

| Invocation | Effect |
| --- | --- |
| `/review-changes` | Convergence loop on the current branch's open PR — `pr-reviewer` → `implement-suggestion` → `polish simplify`, up to 3 iterations. |
| `/review-changes --report` | One-shot read-only review via `pr-reviewer` (no apply). |
| `/review-changes --critical` | Adds adversarial pre-mortem (`Skill("critical", "code")`) to each `pr-reviewer` call. |
| `/review-changes <PR-URL>` | Convergence loop on the specified PR (self or cross — `pr-reviewer` detects relation automatically). |
| `/review-changes <PR-URL> --publish` | One-shot cross-review with authorization to post a visible `COMMENT` review to GitHub. |

## What replaced `--comments`

The old `--comments` flag is gone.
Cross-review with line-level inline comments now lives in the `pr-reviewer` agent and is the default behaviour when a PR is passed.
Authorization to post a visible review is granted via `--publish` (token path) or an explicit authorization phrase in the chat ("publish them", "post them", "go ahead and post", "submit the review") — see `agents/pr-reviewer/rules/authorization-gate.md`.

Without authorization, `pr-reviewer` produces the comment proposal in the terminal and stops.
The user reads the proposal and decides whether to re-invoke with `--publish` or paste comments manually.
