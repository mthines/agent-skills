---
name: resolve-conflicts
description: Analyze and resolve Git merge/rebase conflicts intelligently, showing diffs and asking clarifying questions when needed
---

# Resolve Git Conflicts

You are tasked with helping resolve Git merge or rebase conflicts. This command handles both active conflict states and proactive conflict preview/resolution.

## Step 1: Detect Conflict State

First, determine the current state:

```bash
# Check if we're in the middle of a merge
git rev-parse --verify MERGE_HEAD 2>/dev/null && echo "MERGE_IN_PROGRESS" || echo "NO_MERGE"

# Check if we're in the middle of a rebase
test -d "$(git rev-parse --git-dir)/rebase-merge" -o -d "$(git rev-parse --git-dir)/rebase-apply" && echo "REBASE_IN_PROGRESS" || echo "NO_REBASE"

# Check for unmerged files (active conflicts)
git diff --name-only --diff-filter=U
```

Based on results:
- **Active merge conflict**: MERGE_HEAD exists + unmerged files present
- **Active rebase conflict**: rebase-merge/rebase-apply dir exists + unmerged files present
- **No active conflict**: Can preview differences for potential conflicts

## Step 2: Gather Context

### Get Branch Information

```bash
# Current branch
git branch --show-current

# Target branch (default: main)
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"

# Fetch latest to ensure accurate comparison
git fetch origin
```

### If Active Conflict Exists

```bash
# List all conflicted files
git diff --name-only --diff-filter=U

# Show the conflict markers in each file
git diff --check
```

### If No Active Conflict (Preview Mode)

```bash
# Show what would change when merging target into current
git diff origin/main...HEAD --name-status

# Show detailed diff
git diff origin/main...HEAD --stat

# Identify files modified in both branches (potential conflicts)
git log origin/main..HEAD --name-only --pretty=format: | sort -u > /tmp/head_files
git log HEAD..origin/main --name-only --pretty=format: | sort -u > /tmp/main_files
comm -12 /tmp/head_files /tmp/main_files
```

## Step 3: Analyze Each Conflicted File

For each conflicted or potentially conflicting file:

### 3.1 Show Both Versions

```bash
# For active conflicts - show the three-way diff
git diff <file>

# Show "ours" version (current branch)
git show :2:<file>

# Show "theirs" version (incoming branch)
git show :3:<file>

# Show common ancestor
git show :1:<file>
```

### 3.2 Understand the Changes

For each file, analyze:
1. **What "ours" (current branch) changed**: What was the intent of changes on the current branch?
2. **What "theirs" (target branch) changed**: What was the intent of changes from the incoming branch?
3. **Conflict type**:
   - **Overlapping edits**: Same lines modified differently
   - **Adjacent edits**: Close proximity changes
   - **Structural conflicts**: Function/class restructuring
   - **Semantic conflicts**: Logic changes that may conflict conceptually

### 3.3 Propose Resolution Strategy

For each conflict, suggest one of:

1. **Accept Ours**: Keep current branch changes (theirs were superseded/duplicated)
2. **Accept Theirs**: Accept incoming changes (ours are outdated/wrong)
3. **Merge Both**: Both changes are valid and can coexist
4. **Manual Resolution**: Changes conflict semantically - need human decision

## Step 4: Ask Clarifying Questions

When intent is ambiguous, ask specific questions:

### Template Questions

**For overlapping edits:**
> "In `<file>` at line X, both branches modified the same code:
> - Current branch: [summary of change]
> - Incoming branch: [summary of change]
>
> Which behavior should we keep?
> 1. Current branch's approach
> 2. Incoming branch's approach
> 3. Combine both (explain how)
> 4. Need more context to decide"

**For structural conflicts:**
> "The file `<file>` was restructured differently in both branches:
> - Current branch: [describe restructure]
> - Incoming branch: [describe restructure]
>
> This requires manual review. Would you like me to show the full diff?"

**For semantic conflicts:**
> "Both branches changed the logic in `<function>`:
> - Current: [behavior description]
> - Incoming: [behavior description]
>
> These may be incompatible. Which business logic is correct?"

## Step 5: Apply Resolutions

After understanding all conflicts and getting answers to questions:

### For Accept Ours
```bash
git checkout --ours <file>
git add <file>
```

### For Accept Theirs
```bash
git checkout --theirs <file>
git add <file>
```

### For Merge Both
Edit the file to combine both changes, then:
```bash
git add <file>
```

### For Manual Edits
After editing:
```bash
# Verify no conflict markers remain
grep -n "^<<<<<<< " <file> && echo "Still has conflict markers!" || git add <file>
```

## Step 6: Verify Resolution

After resolving all conflicts:

```bash
# Check no unmerged files remain
git diff --name-only --diff-filter=U

# Verify no conflict markers in staged files
git diff --cached | grep -E "^[+](<<<<<<<|=======|>>>>>>>)" && echo "Warning: Conflict markers still present!"

# Show what will be committed
git diff --cached --stat
```

## Step 7: Complete the Merge/Rebase

### For Merge Conflicts
```bash
# Commit the merge
git commit -m "Merge origin/main into $(git branch --show-current)

Resolved conflicts in:
$(git diff --name-only HEAD~1)"
```

### For Rebase Conflicts
```bash
# Continue the rebase
git rebase --continue
```

If more conflicts appear during rebase, repeat from Step 3.

## Step 8: Summary

After completion, provide:

### Resolution Summary

| File | Resolution Type | Notes |
|------|-----------------|-------|
| `path/to/file1.ts` | Accept Theirs | Our changes were outdated |
| `path/to/file2.ts` | Merge Both | Combined feature additions |
| `path/to/file3.ts` | Manual | Required semantic understanding |

### Recommendations

- If many conflicts occurred, consider more frequent rebasing/merging
- If semantic conflicts are common, consider better branch coordination
- Document any non-obvious resolution decisions for PR reviewers

## Abort Options

If resolution isn't going well:

### Abort Merge
```bash
git merge --abort
```

### Abort Rebase
```bash
git rebase --abort
```

## Tips

- **Always fetch first**: Ensure you have the latest remote state
- **Small conflicts are easier**: Merge frequently to avoid large conflicts
- **Tests after resolution**: Run tests to verify merged code works
- **Commit message clarity**: Document what conflicts were resolved and how
- **When in doubt, ask**: Semantic conflicts often need human judgment
