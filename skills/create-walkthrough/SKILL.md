---
name: create-walkthrough
description: >
  Generate a walkthrough artifact (walkthrough.md) in `.agent/{branch}/` summarizing
  completed work for PR delivery. Gathers information from plan.md, git history, and
  test results to produce a comprehensive summary. Use at Phase 6 before creating
  the draft PR.
  Triggers on create walkthrough, generate walkthrough, write walkthrough artifact.
license: MIT
disable-model-invocation: true
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
---

# Create Walkthrough Artifact

Generate `.agent/{branch-name}/walkthrough.md` — the final summary for PR delivery.

---

## Prerequisites

Before invoking this skill:

1. All tests must be passing
2. Documentation must be updated
3. `plan.md` must exist and have an up-to-date Progress Log
4. You must be inside the worktree

---

## Procedure

### Step 1: Determine file location and gather information

Run this command to get the artifact path and gather git information — do NOT guess the branch name:

```bash
BRANCH=$(git branch --show-current) && mkdir -p ".agent/${BRANCH}" && echo "Artifact path: .agent/${BRANCH}/walkthrough.md" && echo "---" && git diff --stat main...HEAD && echo "---" && git log --oneline main...HEAD
```

**From plan.md** (read the file — must run in the same shell session as above, or re-assign `BRANCH`):

```bash
BRANCH=$(git branch --show-current) && cat ".agent/${BRANCH}/plan.md"
```

Extract: Summary, Decisions, Requirements, File Changes table.

**From test results:**

Recall or re-run the test suite to confirm current status.

### Step 2: Write walkthrough.md

Create the file at the path from Step 1 using the template below. **Do NOT hardcode or guess the branch name.**

### Step 3: Present to user

After writing the file, output the walkthrough content directly in the conversation so the user sees it immediately.

---

## Template

**All timestamps MUST use full ISO 8601 with time: `YYYY-MM-DDTHH:MM:SSZ`**

```markdown
---
created: { TIMESTAMP }
branch: { BRANCH }
task: { TASK_DESCRIPTION }
pr: { PR_NUMBER }
---

# Walkthrough: {TASK_DESCRIPTION}

## Quick Reference

- **Branch**: `{BRANCH}`
- **PR**: #{PR_NUMBER}
- **Worktree**: `{WORKTREE_PATH}`

## Summary

<!-- 2-3 sentences: what was implemented and the key outcome -->

## Changes

| File | Change | Purpose |
| ---- | ------ | ------- |

<!-- List ALL modified/created/deleted files from git diff -->

## Key Decisions

<!-- Numbered list of important decisions made during implementation.
     Pull from plan.md Decisions table — include only the most significant ones. -->

1. {decision and brief rationale}

## Testing Results

<!-- Test outcomes with pass/fail indicators -->

- [x] {test category}: {result summary}
- [x] {test category}: {result summary}

## How to Verify

<!-- Step-by-step instructions for a reviewer to verify the changes work -->

1. {step}
2. {step}
3. {step}

## Next Steps

1. Review draft PR
2. Mark as ready for review
3. After merge: `gw remove {BRANCH}`
```

---

## Validation Checklist

After writing walkthrough.md, verify:

- [ ] **File location**: Path from `git branch --show-current` — inside the worktree
- [ ] **Frontmatter**: created, branch, task, pr — all filled
- [ ] **Timestamps**: ISO 8601 with time
- [ ] **Summary**: Concise, describes what was done and the outcome
- [ ] **Changes table**: Matches actual `git diff --stat` output (no missing files)
- [ ] **Key Decisions**: Pulled from plan.md, covers the important choices
- [ ] **Testing Results**: Reflects actual test run outcomes
- [ ] **How to Verify**: Actionable steps a reviewer can follow
- [ ] **Presented to user**: Walkthrough content shown in conversation (not just written to file)

---

## Delivery

The walkthrough is delivered in **two ways**:

1. **File** — saved to `.agent/{branch-name}/walkthrough.md` for reference and handoff
2. **Inline** — presented in the conversation with PR link so the user sees the summary immediately

**Both are mandatory. Do not announce completion without showing the walkthrough.**
