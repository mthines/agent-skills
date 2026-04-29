---
title: 'Smart Worktree Detection'
impact: CRITICAL
tags:
  - worktree
  - detection
  - fuzzy-match
  - context
---

# Smart Worktree Detection

## Overview

Before creating a new worktree, check if the current context matches the task.
If the user is already on a related worktree, prompt them to continue or create new.
This prevents unnecessary worktree proliferation and respects ongoing work.

## Core Principles

- **Check before creating**: Always run detection before `gw add`.
- **Fuzzy match keywords**: Match significant words from task to worktree name.
- **Always prompt on match**: Let user decide to continue or create new.
- **On main/master**: Always create new worktree without prompting.

## Detection Algorithm

### Step 1: Get Current Worktree Info

```bash
# Get current branch/worktree
gw list
git branch --show-current
pwd
```

Extract:

- Current worktree name
- Current branch name
- Current directory path

### Step 2: Parse Task for Keywords

Extract significant words from task description:

```
Task: "implement user authentication flow"
Keywords: ["user", "authentication", "auth", "flow"]

Task: "add dark mode toggle"
Keywords: ["dark", "mode", "toggle", "theme"]

Task: "fix login validation error"
Keywords: ["login", "validation", "error", "fix"]
```

**Ignore common words:**

- Verbs: "add", "fix", "update", "implement", "create", "remove"
- Articles: "the", "a", "an"
- Prepositions: "to", "for", "in", "on", "with"

### Step 3: Fuzzy Match

Check if any task keywords appear in current worktree/branch name:

```
Worktree: "feature/add-authentication"
Task keywords: ["user", "authentication", "auth"]
Match: "auth" found in "add-authentication" ✓
```

**Match rules:**

- Case-insensitive comparison
- Partial match counts (auth matches authentication)
- At least one significant keyword must match

## Decision Logic

| Scenario                            | Action                     |
| ----------------------------------- | -------------------------- |
| On main/master/develop              | Always create new worktree |
| Worktree name matches task keywords | Prompt user with options   |
| No keyword match                    | Create new worktree        |
| User says "continue here"           | Work in current directory  |
| User says "create new"              | Create new worktree        |

## User Prompt Template

When match detected:

```markdown
**Current worktree detected:** `feature/add-authentication`
**Task:** "implement user authentication flow"

It looks like you may already be working on a related task.

**Options:**

1. **Continue in current worktree** (recommended if same feature)
2. **Create new worktree** (if this is a separate task)
3. **Let me explain the differences first**

Which would you prefer?
```

## Implementation

### Before Phase 2

```bash
# 1. Get current context
CURRENT_WORKTREE=$(basename $(pwd))
CURRENT_BRANCH=$(git branch --show-current)

# 2. Check if on protected branch
if [[ "$CURRENT_BRANCH" =~ ^(main|master|develop)$ ]]; then
    # Always create new worktree
    gw add <new-branch>
    exit
fi

# 3. Extract keywords from task
# (Done in agent logic, not bash)

# 4. Fuzzy match
# (Done in agent logic)

# 5. If match, prompt user
# (Done in agent logic)
```

### Agent Logic

```markdown
1. Parse task description
2. Extract significant keywords
3. Get current worktree name
4. Check for keyword matches
5. If on main/master: skip to worktree creation
6. If match found: use AskUserQuestion to prompt
7. Based on response: continue or create new
```

## Examples

### Example 1: Match Found

```
Current: feature/user-auth
Task: "add OAuth integration to authentication"
Keywords: ["OAuth", "authentication", "auth"]
Match: "auth" in "user-auth" ✓

→ Prompt user: Continue on feature/user-auth or create new?
```

### Example 2: No Match

```
Current: feature/dark-mode
Task: "fix login validation error"
Keywords: ["login", "validation", "error"]
Match: None

→ Create new worktree: fix/login-validation
```

### Example 3: On Main

```
Current: main
Task: "implement dashboard widgets"

→ Always create new worktree: feat/dashboard-widgets
```

## Benefits

- **Prevents worktree sprawl**: Avoid creating duplicate worktrees
- **Respects context**: Continues work where user left off
- **User control**: Always prompts, never assumes
- **Faster workflow**: Reuse existing environment/dependencies

## References

- Related rule: [phase-2-worktree](./phase-2-worktree.md)
- Related skill: [git-worktree-workflows](../../git-worktree-workflows/)
