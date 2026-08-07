---
name: review-changes
description: >
  Review branch changes or a PR for code quality, tests, documentation, and commit
  hygiene. Routes to the `review-loop` skill for a bounded review-apply-simplify
  convergence loop, or to `pr-reviewer` directly for a one-shot read-only review.
  Invoke with /review-changes.
disable-model-invocation: true
argument-hint: '[<pr-url>|#<n>] [--report] [--critical]'
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
```

## Usage

| Invocation | Effect |
| --- | --- |
| `/review-changes` | Convergence loop on the current branch's open PR — `pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify`, up to 5 iterations, converging until every review thread is resolved (fix or reply). |
| `/review-changes --report` | One-shot read-only review via `pr-reviewer` (no apply). |
| `/review-changes --critical` | Adds adversarial pre-mortem (`Skill("critical", "code")`) to each `pr-reviewer` call. |
| `/review-changes <PR-URL>` | Convergence loop on the specified PR (self or cross — `pr-reviewer` detects relation automatically). |

## What replaced `--comments`

The old `--comments` flag is gone.
Cross-review with line-level inline comments now lives in the `pr-reviewer` agent and is the default behaviour when a PR is passed.

There is no posting-authorization flag any more. `pr-reviewer` Step 4 posts a single
visible `COMMENT` review to `POST /repos/{owner}/{repo}/pulls/{n}/reviews`
unconditionally, in both relations — the old `--publish` token and the pending-review
workflow it gated are gone. Step 3 still prints the full proposal to the terminal
before Step 4 posts it, so you always see what was sent.
