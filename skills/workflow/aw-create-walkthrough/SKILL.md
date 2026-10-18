---
name: aw-create-walkthrough
description: >
  Writes `.agent/{branch}/walkthrough.md`, a one-page post-hoc review of finished work — what
  changed, what was assumed, and the evidence — for the reviewer to read after the fact. Use at
  Phase 6 before the draft PR; triggers on create walkthrough, generate walkthrough, write
  walkthrough artifact.
license: MIT
disable-model-invocation: false
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: advisory
---

# Create Walkthrough Artifact

Write `.agent/{branch}/walkthrough.md`: the page a reviewer reads instead of approving a plan up front.
It leads with one screen — what changed, what was assumed, and the evidence — and keeps the detail below it.

## Contents

- [Prerequisites](#prerequisites)
- [Procedure](#procedure)
- [Template](#template)
- [Validation](#validation)

## Prerequisites

1. `run-checks.mjs` has printed its sentinel line on the current head (`CHECKS n/n PASS (<sha>)`, or the FAIL line with the user's approval to ship).
2. Documentation is updated.
3. You are inside the worktree, and `.agent/{branch}/plan.md` exists for a Full-tier run.

## Procedure

### Step 1: Gather the facts

```bash
BRANCH=$(git branch --show-current)
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)
mkdir -p ".agent/${BRANCH}"
git diff --stat "$BASE"...HEAD
git diff --name-only "$BASE"...HEAD
git log --oneline "$BASE"...HEAD
cat ".agent/${BRANCH}/plan.md" 2>/dev/null
tail -n 1 ".agent/${BRANCH}/checks.run.log" 2>/dev/null   # last sentinel, when the executor teed it
```

Never guess the branch name or the base.
Take Task, Guardrails, File Changes, and any Decisions from `plan.md`; take the sentinel line from the last `run-checks.mjs` output in this session or from `checks.run.log`.

### Step 2: List the assumptions

An assumption is a choice you made that the plan, the user, or the code did not settle.
List each with the evidence that would prove it wrong.
Write `none` only when every choice traces to the plan or the user.

```markdown
<!-- ✗ Wrong — restates the task, names no choice -->
- Assumed the feature should work.

<!-- ✓ Right — a real choice and how to falsify it -->
- Assumed expired tokens return 401, not 403 — the API guide does not say; check `docs/api/errors.md`.
```

### Step 3: Check the guardrails

Compare `git diff --name-only` with File Changes.
Every file outside File Changes goes in the summary's `Out of bounds:` line with the reason; `none` when there is none.

### Step 4: Write and present

Write the file from [Template](#template), then print its Review summary inline in the conversation together with the PR URL.
The file alone does not count as delivery: the reviewer reads the inline copy first.

## Template

Timestamps are ISO 8601 with time (`2026-03-07T14:30:00Z`).

````markdown
---
created: {TIMESTAMP}
branch: {BRANCH}
task: {TASK_DESCRIPTION}
pr: {PR_URL}
---

# Walkthrough: {TASK_DESCRIPTION}

## Review summary

**What changed** — {one sentence}.

```text
{before → after diagram of the change, ≤ 12 lines; a mermaid flowchart is fine when it renders}
request ──▶ authGuard ──▶ handler
                │
                └─ expired token ──▶ 401 (new)
```

**What I assumed**

- {assumption} — {how to falsify it}

**Evidence**

- Checks: `{the sentinel line, verbatim — CHECKS n/n PASS (<sha>)}`
- Suite: `{before-PR command}` → {exit code / summary}
- Out of bounds: {files changed outside File Changes, with reason | none}
- PR: {PR_URL}

## Changes

| File | Change | Purpose |
| ---- | ------ | ------- |

## How to verify

1. {a step a reviewer can run}

## Decisions

1. {decision — rationale} <!-- omit the section when plan.md had none -->
````

Rules for the template:

| Part | Rule |
| --- | --- |
| Review summary | Fits one screen (≤ 30 lines); written for a reviewer who has not read the plan |
| Diagram | Shows the changed path or structure, not the file list; omit only for a pure text or config edit |
| Evidence → Checks | The sentinel line copied verbatim, never paraphrased |
| Changes | One row per file in `git diff --name-only` — no file missing, none invented |
| How to verify | Commands or clicks a reviewer can repeat |

## Validation

- [ ] The file is at `.agent/{branch}/walkthrough.md` inside the worktree.
- [ ] Frontmatter has `created`, `branch`, `task`, `pr`.
- [ ] The Review summary is ≤ 30 lines and contains What changed, What I assumed, and Evidence.
- [ ] The Checks line equals the latest `run-checks.mjs` sentinel output.
- [ ] The Changes table lists exactly the files in `git diff --name-only "$BASE"...HEAD`.
- [ ] The Review summary and PR URL were printed in the conversation.
