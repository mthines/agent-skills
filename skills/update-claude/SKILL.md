---
name: update-claude
description: >
  Analyze code changes and update CLAUDE.md and .claude/rules/ documentation to stay
  in sync with the codebase. Uses git diff analysis to detect what changed and holistic
  analysis to understand the impact. Invoke with /update-claude.
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: command
---

# Update Claude Documentation

Analyze recent code changes and incrementally update CLAUDE.md and `.claude/rules/` files so they accurately reflect the current codebase. This is the counterpart to `/init-claude` — init bootstraps, this command evolves.

## Argument Parsing

Check `$ARGUMENTS` for options:

| Argument | Default | Description |
|----------|---------|-------------|
| `branch` | **yes** | Compare current branch against base branch (main/master) |
| `recent [N]` | | Analyze the last N commits (default 10) |
| `paths <glob>` | | Analyze specific paths only |
| `holistic` | | Run `/holistic-analysis refactor` on each affected area before updating docs |
| `dry-run` | | Show proposed changes without writing files |
| `all` | | Full audit of all docs against current codebase |

Examples:
- `/update-claude` — diff current branch vs base, update affected docs
- `/update-claude holistic` — same but with deep holistic analysis per area
- `/update-claude recent 5` — analyze last 5 commits
- `/update-claude paths src/api/**` — update docs for API layer only
- `/update-claude all` — full audit, check every doc section against code
- `/update-claude dry-run` — preview changes without writing

---

## Phase 1: Detect What Changed

### 1a. Determine base branch

```bash
# Find the default branch
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"
```

### 1b. Gather changes based on scope

**Branch mode** (default):
```bash
# Files changed on this branch vs base
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
git diff --name-only --diff-filter=ACMR ${BASE_BRANCH}...HEAD
git diff --stat ${BASE_BRANCH}...HEAD
git log --oneline ${BASE_BRANCH}..HEAD
```

**Recent mode**:
```bash
git diff --name-only --diff-filter=ACMR HEAD~${N}..HEAD
git log --oneline -${N}
```

**Paths mode**:
```bash
git diff --name-only --diff-filter=ACMR ${BASE_BRANCH}...HEAD -- ${PATHS}
```

**All mode**:
```bash
# No diff needed — audit everything
find . -name "CLAUDE.md" -o -name "*.md" -path "*/.claude/rules/*" | head -50
```

### 1c. Classify changes by area

Group changed files into documentation areas:

| File Pattern | Documentation Area | Target Doc |
|-------------|-------------------|------------|
| `src/api/**`, `routes/**` | API layer | `.claude/rules/api.md` or relevant section in CLAUDE.md |
| `**/*.test.*`, `**/*.spec.*` | Testing | `.claude/rules/testing.md` |
| `*.config.*`, `package.json`, `tsconfig.*` | Build/tooling | CLAUDE.md Commands section |
| `src/components/**` | Frontend | `.claude/rules/frontend.md` or CLAUDE.md Architecture |
| `migrations/**`, `schema.*` | Database | `.claude/rules/database.md` |
| `Dockerfile`, `docker-compose.*`, `.github/**` | Infrastructure/CI | CLAUDE.md or `.claude/rules/infra.md` |
| New top-level directories | Architecture | CLAUDE.md Architecture section |
| Deleted files/directories | Architecture | Remove stale references from docs |

Also detect:
- **New patterns introduced**: New frameworks, libraries, or architectural patterns in the diff
- **Breaking changes**: Renamed exports, changed APIs, moved files
- **New gotchas**: Error-prone patterns visible in the diff

---

## Phase 2: Read Current Documentation

Read ALL existing Claude documentation:

```bash
# Find all Claude doc files
find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*"
find .claude/rules -name "*.md" 2>/dev/null
```

Read each file and build a map of what's currently documented:
- Which paths/areas have dedicated rules files?
- What sections exist in CLAUDE.md?
- What commands, patterns, gotchas are documented?
- What `@imports` exist?

---

## Phase 3: Drift Analysis

For each documentation area affected by the changes, check for drift:

### 3a. Staleness Checks (deterministic, no guessing)

1. **Path references**: Do file paths mentioned in docs still exist?
   ```bash
   # Extract paths from docs and verify they exist
   grep -oE '`[a-zA-Z0-9_./-]+\.(ts|js|py|go|rs|tsx|jsx)`' CLAUDE.md | tr -d '`' | while read f; do
     [ ! -e "$f" ] && echo "STALE: $f referenced in docs but doesn't exist"
   done
   ```

2. **Command references**: Do documented commands still work?
   ```bash
   # Check if documented npm/pnpm scripts exist in package.json
   ```

3. **Import references**: Do `@import` targets still exist?

4. **Rules path globs**: Do `.claude/rules/` path patterns match any current files?

### 3b. Semantic Drift (requires reading code)

For each affected area, compare what the docs say vs what the code now does:

- **Architecture claims**: Has the directory structure changed? New modules? Removed modules?
- **Code style claims**: Has the style evolved? New patterns adopted?
- **Gotchas**: Are documented gotchas still relevant? Are there new ones?
- **Testing patterns**: Have test conventions changed?

---

## Phase 4: Holistic Analysis (if `holistic` argument)

If the user passed the `holistic` argument, run a deeper analysis for each affected area.

For each major area of change:

1. **Gather full context** — read not just the changed files but their callers, dependencies, tests, and recent git history (same as holistic-analysis Phase 0)
2. **Identify the governing principle** — what general concept or pattern governs this area? (holistic-analysis Phase 1)
3. **Scene set in refactor mode** — current state of the documentation vs desired state (holistic-analysis Phase 2)
4. **Generate approaches** — at least 2 ways to update the docs for this area (holistic-analysis Phase 3)
5. **Meta-cognitive check** — am I adding noise? Would Claude do this correctly without the rule? (holistic-analysis Phase 4)

Key questions during holistic analysis:
- **Is this a new architectural pattern** that future Claude sessions need to know about?
- **Did we discover a gotcha** during implementation that should be documented?
- **Has the dependency direction changed** between modules?
- **Are there new conventions** we established during this work?
- **What mistakes did Claude make** during this session that a rule could prevent?

---

## Phase 5: Generate Updates

### 5a. Prioritize what to update

Apply the **"Would removing this cause Claude to make mistakes?"** test to every proposed change. Only include updates that pass this filter.

**Priority tiers:**

| Priority | Type | Example |
|----------|------|---------|
| P0 — Must fix | Stale/wrong information | Dead file path, removed command, deleted module |
| P1 — Should add | New patterns Claude can't infer | New architectural decision, non-obvious convention, discovered gotcha |
| P2 — Nice to have | Clarifications | Better wording, more specific examples |
| Skip | Noise | Things Claude would figure out from reading code |

### 5b. Decide where to put each update

| Situation | Action |
|-----------|--------|
| Existing CLAUDE.md section covers this area | Edit that section |
| Existing rules file covers this area | Edit that rules file |
| New area, project is large (has `.claude/rules/`) | Create new rules file with appropriate `paths:` frontmatter |
| New area, project is small (no rules dir) | Add section to CLAUDE.md |
| Information is stale/wrong | Remove or correct it |
| Rule would only apply to specific file types | Use path-scoped rules file |

### 5c. Draft the changes

For each update, prepare the edit:

- **Edits to existing files**: Use the Edit tool with precise old_string/new_string
- **New rules files**: Use Write tool with proper frontmatter:
  ```markdown
  ---
  description: [One-line description of what this rule covers]
  paths:
    - "src/path/**/*.ts"
  ---

  # [Rule Title]

  - [Concise, actionable rules]
  ```
- **Removals**: Delete stale lines or entire files if fully obsolete

### 5d. Keep it concise

Apply the same principles as init-claude:
- **50-100 lines** for CLAUDE.md total — if adding content, consider removing something less important
- **Under 500 lines** per rules file
- **One concern per rules file** — don't mix unrelated topics
- **Only what Claude can't infer** — if it's obvious from the code, don't document it
- **Use file references, not code snippets** — point to `file:line` instead of pasting code that will go stale

---

## Phase 6: Present and Apply

### Dry-run mode

If `dry-run` was specified, present a summary table and stop:

```
## Proposed Documentation Updates

### Files to Modify
| File | Change Type | Summary |
|------|------------|---------|
| CLAUDE.md | Edit | Update Commands section (pnpm → bun) |
| .claude/rules/api.md | Edit | Add new rate limiting pattern |
| .claude/rules/auth.md | New | Document new auth middleware conventions |

### Stale References Found
| Doc File | Line | Reference | Status |
|----------|------|-----------|--------|
| CLAUDE.md | 42 | `src/old-module/` | Directory deleted |
| .claude/rules/testing.md | 15 | `jest.config.ts` | Renamed to vitest.config.ts |

### Proposed Content
[Show each proposed change as a diff]
```

Then ask the user which changes to apply.

### Apply mode (default)

1. Apply all P0 changes (stale/wrong fixes) immediately
2. Present P1 changes (new patterns) and ask for confirmation using AskUserQuestion:
   - **Apply all**: Apply all proposed changes
   - **Review each**: Walk through one by one
   - **Skip**: Don't apply, just show the summary
3. Skip P2 changes unless specifically requested

After applying:

```bash
# Show what was changed
git diff --stat
```

---

## Phase 7: Summary

Display a summary of what was updated:

```
## Documentation Update Summary

### Changes Applied
| File | Action | What Changed |
|------|--------|-------------|
| CLAUDE.md | Updated | Commands section, Architecture section |
| .claude/rules/api.md | Updated | Added rate limiting conventions |
| .claude/rules/auth.md | Created | New auth middleware rules |
| .claude/rules/testing.md | Updated | Removed stale jest references |

### Areas Analyzed
| Area | Files Changed | Doc Impact |
|------|--------------|------------|
| API layer | 12 files | Updated api.md |
| Auth | 5 files | New auth.md |
| Tests | 8 files | Updated testing.md |
| Config | 2 files | Updated CLAUDE.md |

### Skipped (Claude can infer)
- Variable renames in src/utils/
- New test files following existing patterns
- Import reordering
```

---

## Integration with Other Skills

### With `/holistic-analysis`
When `holistic` argument is passed, this command delegates to the holistic analysis protocol for each affected area, then extracts documentation-worthy insights from the analysis output.

### With `/confidence`
After generating updates, optionally run `/confidence plan` to validate:
- Are the proposed doc changes accurate?
- Do they follow the "only what Claude can't infer" principle?
- Will they actually help future Claude sessions?

### With `/init-claude`
If no CLAUDE.md exists at all, suggest running `/init-claude` first. This command is for evolution, not bootstrapping.

---

## Anti-Patterns — What NOT to Do

- Do NOT rewrite CLAUDE.md from scratch — make targeted edits only
- Do NOT add documentation for things Claude can read from code
- Do NOT document implementation details that will change — document patterns and principles
- Do NOT paste code snippets into docs — use file references (`src/auth/middleware.ts:42`)
- Do NOT add rules "just in case" — every rule should prevent a concrete mistake
- Do NOT bloat CLAUDE.md beyond 100 lines — if adding content, trim something less important
- Do NOT skip the staleness check — removing wrong information is more valuable than adding new information
- Do NOT document temporary workarounds as permanent patterns
- Do NOT create rules files for areas that have no recurring patterns yet
