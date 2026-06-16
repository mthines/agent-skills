---
name: review-changes
description: >
  Review branch changes or a PR for code quality, tests, documentation, and commit
  hygiene. Routes to `reviewer` for own work or `pr-reviewer` for a cross-author PR.
  Invoke with /review-changes.
disable-model-invocation: true
argument-hint: '[<pr-url>|#<n>] [--report] [--critical] [--publish]'
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: command
---

## Routing

Choose the agent based on the argument shape:

| Argument shape | Agent | Reason |
| --- | --- | --- |
| no arg / `--report` | `reviewer` | Own branch (with or without an own PR). `reviewer` auto-detects Fix / Report / Self-Review. |
| PR URL or `#<n>` | run `gh pr view --json author` first; if `author == current user` → `reviewer` Self-Review, else → `pr-reviewer` |
| `--publish` | always `pr-reviewer` (`--publish` is the cross-review authorization token) |

```
# Default — own work
Agent(subagent_type: "reviewer", prompt: "Review changes. Arguments: $ARGUMENTS")

# Cross-review (PR URL or #n with cross-author, OR --publish present)
Agent(subagent_type: "pr-reviewer", prompt: "Review PR. Arguments: $ARGUMENTS")
```

## Usage

| Invocation | Effect |
| --- | --- |
| `/review-changes` | Fix Mode on the current branch — auto-fix simple, plan complex. |
| `/review-changes --report` | Report Mode — propose only, no auto-fixes. |
| `/review-changes --critical` | Adds adversarial pre-mortem (`Skill("critical", "code")`). |
| `/review-changes --with a,b,c` | Loads up to 3 additional review lenses. |
| `/review-changes <PR-URL>` | Routes to `pr-reviewer` if cross-author; to `reviewer` Self-Review if own PR. |
| `/review-changes <PR-URL> --publish` | Cross-review with authorization to post as a pending GitHub review. |

## What replaced `--comments`

The old `--comments` flag is gone. Cross-review with line-level inline comments now lives in the `pr-reviewer` agent and is the default behaviour when a cross-author PR is passed. Authorization to post a pending review is granted via `--publish` (token path) or an explicit authorization phrase in the chat ("publish them", "post them", "go ahead and post", "submit the review") — see `agents/pr-reviewer/rules/authorization-gate.md`.

Without authorization, `pr-reviewer` produces the comment proposal in the terminal and stops. The user reads the proposal and decides whether to re-invoke with `--publish` or paste comments manually.
