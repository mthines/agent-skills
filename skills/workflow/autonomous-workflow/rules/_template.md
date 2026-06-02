---
title: 'Rule Title'
impact: HIGH
tags:
  - tag1
  - tag2
---

# Rule Title

## Overview

Brief description of what this rule covers and why it matters.
2-4 sentences maximum.
Each sentence on its own line.

## Core Principles

Prescriptive guidance - tell the agent what to do, not why.

- **Principle 1**: Do X when Y.
- **Principle 2**: Always Z before A.
- **Principle 3**: Never B without C.

## Implementation

### Basic Usage

```bash
# Command example (gw is recommended; native git worktree fallback also supported)
gw command --flag
```

### GOOD Pattern

```bash
# With gw (recommended)
gw add feature/my-task
cd $(gw path feature/my-task)

# Native git worktree (fallback when gw is not installed)
REPO_NAME="$(basename "$(git rev-parse --show-toplevel)")"
git worktree add -b feature/my-task "../${REPO_NAME}-feature-my-task"
cd "../${REPO_NAME}-feature-my-task"
```

### BAD Pattern

```bash
# Incorrect approach - avoid this
git checkout -b feature/my-task  # Don't `git checkout` in the main worktree;
                                 # always create an isolated worktree.
```

## Decision Table

| Scenario    | Action |
| ----------- | ------ |
| Condition A | Do X   |
| Condition B | Do Y   |
| Default     | Do Z   |

## Troubleshooting

### Common Issue 1

**Symptom**: Error message or unexpected behavior.

**Cause**: Why this happens.

**Fix**:

```bash
# Resolution command (with gw)
gw fix-command

# Native git worktree fallback (when gw not installed)
git worktree <equivalent-command>
```

### Common Issue 2

**Symptom**: Another error.

**Fix**: How to resolve it.

## References

- [Official Documentation](https://example.com)
- Related rule: [other-rule](./other-rule.md)
