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
# Command example
gw command --flag
```

### GOOD Pattern

```bash
# Correct approach
gw add feature/my-task
cd $(gw path feature/my-task)
```

### BAD Pattern

```bash
# Incorrect approach - avoid this
git checkout -b feature/my-task  # Don't use git checkout for worktrees
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
# Resolution command
gw fix-command
```

### Common Issue 2

**Symptom**: Another error.

**Fix**: How to resolve it.

## References

- [Official Documentation](https://example.com)
- Related rule: [other-rule](./other-rule.md)
