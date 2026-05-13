---
name: update-claude
description: >
  Analyzes code changes and updates CLAUDE.md, .claude/rules/, and the docs/ tree so
  all three documentation tiers stay in sync with the codebase. Uses git diff to
  detect what changed and holistic analysis for impact. Detects drift across tiers
  (dead @imports, stale narrative, hot-path leakage) and resolves placement automatically:
  innermost-ancestor CLAUDE.md for subtree-scoped rules, .claude/rules/ with paths
  globs for cross-cutting patterns, docs/ for narrative. Supports nested-package and
  filename-pattern modes. Triggers on "update docs", "sync CLAUDE.md", "refresh rules",
  "docs drift", "update package docs", "rule for all bindings", "/update-claude".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.1.0'
  workflow_type: command
  tags:
    - documentation
    - drift-detection
    - claude-md
    - docs-routing
    - branch-diff
    - hot-path
    - tiered-docs
    - staleness-check
---

# Update Claude Documentation

Analyze recent code changes and incrementally update CLAUDE.md, `.claude/rules/`, **and `docs/`** so they accurately reflect the current codebase. This is the counterpart to `/init-claude` — init bootstraps, this command evolves.

This command treats documentation as a tiered system:

| Tier | Location | Audience | Cost |
|------|----------|----------|------|
| Hot path | `CLAUDE.md`, `.claude/rules/` | Agent (auto-loaded) | Recurring tokens every turn |
| Narrative | `docs/` (root + nested) | Humans + agent on demand | One Read tool call when fetched |

Each proposed update gets routed to one tier — see "Content Routing Rubric" in Phase 5b.

## Argument Parsing

Check `$ARGUMENTS` for options:

| Argument | Default | Description |
|----------|---------|-------------|
| `branch` | **yes** | Compare current branch against base branch (main/master) |
| `recent [N]` | | Analyze the last N commits (default 10) |
| `paths <glob>` | | Analyze specific paths only (still routes updates via the Placement Resolver) |
| `nested <dir>` | | Route all updates for changes under `<dir>` to `<dir>/CLAUDE.md` (scaffold the file if absent — confirm first) |
| `pattern <glob>` | | Discovery-driven mode: scan files matching `<glob>` for shared structure and emit a path-scoped rule in `.claude/rules/` |
| `holistic` | | Run `/holistic-analysis refactor` on each affected area before updating docs |
| `dry-run` | | Show proposed changes without writing files |
| `all` | | Full audit of all docs against current codebase |

Examples:
- `/update-claude` — diff current branch vs base, update affected docs
- `/update-claude holistic` — same but with deep holistic analysis per area
- `/update-claude recent 5` — analyze last 5 commits
- `/update-claude paths src/api/**` — update docs for API layer only
- `/update-claude nested packages/foo` — update only `packages/foo/CLAUDE.md` (or scaffold it) for changes in that subtree
- `/update-claude pattern "**/bindings.ts"` — discover patterns across every `bindings.ts` and emit a path-scoped rule
- `/update-claude all` — full audit, check every doc section against code
- `/update-claude dry-run` — preview changes without writing

---

## Mode: nested `<dir>`

When `nested <dir>` is passed, route every update for changes under `<dir>` to `<dir>/CLAUDE.md` instead of the root.

1. Verify `<dir>` exists and contains source code (not just docs or assets).
2. Check whether `<dir>/CLAUDE.md` already exists.
   - **Exists** — edit it. Do NOT also touch root `CLAUDE.md` for the same content.
   - **Missing** — ask the user (AskUserQuestion) whether to scaffold one. If yes, create a minimal file using the same template as `/init-claude` Step 5 (Commands / Code Style / Architecture / Gotchas), tier-appropriate.
3. Run Phase 1 with `paths` scoped to `<dir>/**`.
4. Run Phases 2–5 with the Placement Resolver forced to prefer `<dir>/CLAUDE.md` over root for hot-path content.
5. **Migration check** — if root `CLAUDE.md` already contains content that should belong here (a rule that names `<dir>` paths verbatim), propose moving it down and removing the root copy. Innermost wins.

---

## Mode: pattern `<glob>`

When `pattern <glob>` is passed, the skill switches from diff-driven to discovery-driven. Use this when you've noticed a shared shape across many files of the same name (`bindings.ts`, `route.ts`, `*.test.ts`) and want a single path-scoped rule covering them.

1. Resolve the glob to a file list. Hard cap at 50 files — if more, ask the user to narrow before continuing.
2. Read each matched file (sample, if the corpus is large enough that 50 reads strain the context).
3. Extract recurring structural features:
   - Exports (named vs default; types vs values)
   - File-internal ordering (imports → types → schema → handlers → exports)
   - Naming conventions (camelCase / PascalCase / specific suffixes)
   - Recurring imports or dependencies
   - Common pitfalls visible in the corpus (e.g., every `bindings.ts` re-exports from `./types` — so a new one without that re-export will look wrong)
4. Check `.claude/rules/` for any existing rule whose `paths:` already covers `<glob>`. If one exists, propose an edit; otherwise propose a new file `.claude/rules/<topic>.md`.
5. The proposed rule MUST use `paths: ["<glob>"]` (sequence form) and MUST NOT live in root `CLAUDE.md` — that defeats the point of a pattern rule.
6. Hand off to Phase 5 with `scope: pattern` so the Placement Resolver routes to `.claude/rules/` unconditionally.

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

**Paths mode** (quote `${PATHS}` so multi-value globs survive shell-split):
```bash
git diff --name-only --diff-filter=ACMR "${BASE_BRANCH}...HEAD" -- "${PATHS}"
```

**All mode**:
```bash
# No diff needed — audit everything
find . -name "CLAUDE.md" -o -name "*.md" -path "*/.claude/rules/*" | head -50
```

### 1c. Classify changes by area

Group changed files into documentation areas. Each area can hit the hot path (CLAUDE.md / rules) and/or `docs/` — pick by content kind in Phase 5b, not by file pattern alone.

| File Pattern | Documentation Area | Hot-path target | `docs/` target |
|-------------|-------------------|-----------------|-----------------|
| `src/api/**`, `routes/**` | API layer | `.claude/rules/api.md` | `docs/architecture.md` (rationale only) |
| `**/*.test.*`, `**/*.spec.*` | Testing | `.claude/rules/testing.md` | `docs/contributing.md` (how to run) |
| `*.config.*`, `package.json`, `tsconfig.*` | Build/tooling | `CLAUDE.md` Commands | `docs/contributing.md` (env setup) |
| `src/components/**` | Frontend | `.claude/rules/frontend.md` | `docs/architecture.md` |
| `migrations/**`, `schema.*` | Database | `.claude/rules/database.md` | `docs/architecture.md` (data model) |
| `Dockerfile`, `docker-compose.*`, `.github/**` | Infra/CI | `CLAUDE.md` or `.claude/rules/infra.md` | `docs/contributing.md` (local infra) |
| New top-level directories | Architecture | `CLAUDE.md` Architecture section | `docs/architecture.md` (full narrative) |
| Deleted files/directories | Architecture | Remove stale references from CLAUDE.md / rules | Remove stale references from `docs/` |
| `docs/**` itself changed | Documentation | (no hot-path action) | Verify cross-links and `@imports` still resolve |

Also detect:
- **New patterns introduced**: New frameworks, libraries, or architectural patterns in the diff
- **Breaking changes**: Renamed exports, changed APIs, moved files
- **New gotchas**: Error-prone patterns visible in the diff

---

## Phase 2: Read Current Documentation

Read ALL existing project documentation — both hot path and narrative:

```bash
# Hot path (auto-loaded by Claude)
find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*"
find .claude/rules -name "*.md" 2>/dev/null

# Narrative (human-facing, agent-on-demand)
find docs -name "*.md" 2>/dev/null
find packages/*/docs apps/*/docs -name "*.md" 2>/dev/null
```

Read each file and build a map of what's currently documented:
- Which paths/areas have dedicated rules files?
- What sections exist in CLAUDE.md?
- What commands, patterns, gotchas are documented?
- What `@imports` exist, and do they resolve?
- What topics live in `docs/`? Are they referenced from CLAUDE.md?
- Is any content **duplicated** between CLAUDE.md and `docs/`? (Drift risk — flag for consolidation.)

---

## Phase 3: Drift Analysis

For each documentation area affected by the changes, check for drift:

### 3a. Staleness Checks (deterministic, no guessing)

1. **Path references**: Do file paths mentioned in docs still exist? The regex accepts any extension and well-known extensionless filenames, then strips an optional `:line` / `:line:col` suffix before the existence check.
   ```bash
   # Extract paths from docs and verify they exist. Covers any extension, plus
   # extensionless conventions (Makefile, Dockerfile, README, LICENSE, CHANGELOG).
   grep -ohE '`(([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)|(Makefile|Dockerfile|README|LICENSE|CHANGELOG))(:[0-9]+)?(:[0-9]+)?`' CLAUDE.md \
     | tr -d '`' \
     | sed -E 's/:[0-9]+(:[0-9]+)?$//' \
     | sort -u \
     | while read -r f; do
         [ -n "$f" ] && [ ! -e "$f" ] && echo "STALE: $f referenced in docs but doesn't exist"
       done
   ```

2. **Command references**: Do documented `npm` / `pnpm` / `yarn` / `bun` scripts still exist in `package.json`?
   ```bash
   # Skip silently if there is no package.json at the repo root.
   if [ -f package.json ]; then
     grep -ohE '`(npm|pnpm|yarn|bun)( run)? [a-zA-Z][a-zA-Z0-9:_-]*`' CLAUDE.md \
       | tr -d '`' \
       | awk '{print $NF}' \
       | sort -u \
       | while read -r script; do
           # Match `"script":` with optional whitespace, anchored to the scripts block.
           if ! grep -qE "\"${script}\"[[:space:]]*:" package.json; then
             echo "STALE: documented script '${script}' missing from package.json"
           fi
         done
   fi
   ```

3. **Import references**: Do `@import` targets still exist? See Phase 3c for the generalised dead-import scan.

4. **Rules path globs**: Do `.claude/rules/` path patterns match any current files?

### 3b. Semantic Drift (requires reading code)

For each affected area, compare what the docs say vs what the code now does:

- **Architecture claims**: Has the directory structure changed? New modules? Removed modules?
- **Code style claims**: Has the style evolved? New patterns adopted?
- **Gotchas**: Are documented gotchas still relevant? Are there new ones?
- **Testing patterns**: Have test conventions changed?

### 3c. `docs/` Drift Checks

The narrative tier drifts more slowly than code, but it drifts. Run these checks against `docs/` (root and nested):

1. **Dead `@import` targets**: every `@<path>` reference in CLAUDE.md or `.claude/rules/` must resolve to a real file. The regex matches any relative path (`@docs/...`, `@.claude/rules/...`, `@packages/<pkg>/CLAUDE.md`, etc.) — not only `@docs/`.
   ```bash
   grep -rhoE '@[A-Za-z0-9_.][A-Za-z0-9_./-]*\.[A-Za-z0-9]+' CLAUDE.md .claude/rules/ 2>/dev/null \
     | sort -u \
     | while read -r ref; do
         path="${ref#@}"
         [ ! -e "$path" ] && echo "DEAD @import: $ref"
       done
   ```
2. **Stale narrative**: does `docs/architecture.md` describe directories or modules that no longer exist? Diff its claims against the current file tree.
3. **Outdated contributing guide**: `docs/contributing.md` commands should match `package.json` / `Makefile` / equivalent. Detect renames (e.g. `pnpm test` → `bun test`).
4. **Duplication**: any paragraph that appears verbatim (or near-verbatim) in both CLAUDE.md and `docs/` is a drift risk. Pick a single owner per fact.
5. **Cross-link rot**: relative links inside `docs/` (`[architecture](./architecture.md)`) — verify they still resolve.
6. **Hot-path leakage**: scan `docs/` for content that *should* be in the hot path. If a `docs/` file documents a hard rule the agent must obey on every turn ("never edit `dist/` directly"), promote it to CLAUDE.md.

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

### 5b. Decide where to put each update — Content Routing Rubric

Before placing a change, classify it by **content kind**, not by file pattern. **Same rubric as `/init-claude`** — keep both copies in sync (or extract to a shared file when this rubric becomes load-bearing for a third consumer).

| Content kind | Destination | Why |
|---|---|---|
| Hard rule ("MUST", "NEVER"), command, gotcha | `CLAUDE.md` (inline) | Auto-loaded; agent acts on it without a round-trip |
| Decision table (path → owner, file → command) | `CLAUDE.md` (inline) | Agent hot path; cheap to scan |
| File inventory ("key source files") | `CLAUDE.md` (inline) | Agent needs it before tool calls; humans skim it too |
| Path-scoped rule (only relevant for `src/api/**`) | `.claude/rules/<topic>.md` | Loaded only when matching files are touched |
| Architectural rationale ("we picked X because Y") | `docs/architecture.md` | Humans onboard with it; agent reads on demand |
| Onboarding / dev environment setup | `docs/contributing.md` | Reused by new contributors; rarely needed mid-task |
| Tutorial / conceptual walkthrough | `docs/<topic>.md` | Too verbose for CLAUDE.md; stable enough not to drift |
| Domain glossary, design history, ADRs | `docs/<topic>.md` | Stable reference material; benefits humans equally |
| API reference (generated) | `docs/api/` | Updated mechanically; not Claude's job |

**Routing decision flow per update:**

1. *Is this a rule the agent must obey on every turn?* → CLAUDE.md (inline) or `.claude/rules/` (if path-scoped).
2. *Is this an explanation, rationale, or onboarding step?* → `docs/`.
3. *Is this content already in CLAUDE.md AND `docs/`?* → Pick one owner, link from the other.
4. *Is this a `docs/` file that nobody references?* → Add a `@docs/<file>.md` import in CLAUDE.md (so the agent can find it) and a link in `docs/README.md` (so humans can find it).

**Hot-path budget:** if a CLAUDE.md edit pushes the file past ~150 lines, consider whether the new content is really hot-path material — explanations and history almost always belong in `docs/` instead.

### 5c. Placement Resolver — pick the specific file

5b decided the *kind* of destination (CLAUDE.md / `.claude/rules/` / `docs/`). This step picks the *specific path* so each rule loads only when relevant — no hot-path pollution.

**Innermost-wins principle.** Claude Code only loads a nested `CLAUDE.md` when the agent is operating inside that subtree. A rule about `packages/foo/**` placed in `packages/foo/CLAUDE.md` costs zero tokens for someone working in `packages/bar/`. The same rule in root `CLAUDE.md` costs everyone tokens every turn. Always push rules to the innermost ancestor that still covers the scope.

**Step 1 — Determine scope** for each proposed update by inspecting which files it would govern:

| Scope label | Definition |
|---|---|
| `repo-wide` | Rule applies anywhere in the repo |
| `subtree` | All governed files live under a single directory (`packages/foo/**`) |
| `pattern` | Files matching a name/glob across multiple subtrees (`**/bindings.ts`) |
| `area` | A small contiguous set of files in one subtree (treat as `subtree`) |

**Step 2 — Pick the destination** using this table:

| Scope | Hot-path (rule / command / gotcha) | Path-scoped rule | Narrative / rationale |
|---|---|---|---|
| `repo-wide` | Root `CLAUDE.md` | `.claude/rules/<topic>.md` (no `paths:`) | Root `docs/<topic>.md` |
| `subtree` with existing `<dir>/CLAUDE.md` | `<dir>/CLAUDE.md` | `<dir>/.claude/rules/<topic>.md` if exists, else root `.claude/rules/<topic>.md` with `paths: ["<dir>/**"]` | `<dir>/docs/<topic>.md` if nested docs exist, else root `docs/` |
| `subtree` without `<dir>/CLAUDE.md` | Ask the user before scaffolding `<dir>/CLAUDE.md`. If declined → root `.claude/rules/<topic>.md` with `paths: ["<dir>/**"]` | Root `.claude/rules/<topic>.md` with `paths: ["<dir>/**"]` | Root `docs/<topic>.md` + `@import` from nearest CLAUDE.md |
| `pattern` (cross-subtree) | **Never** root `CLAUDE.md`. Always `.claude/rules/<topic>.md` with `paths: ["<glob>"]` | Same | Root `docs/<topic>.md` |

**Step 3 — Pre-write sanity checks** (each is binary; failing any one blocks the write):

- **Innermost ancestor exists?** If a `CLAUDE.md` lives deeper than your chosen target and still covers the scope, prefer it.
- **Double coverage?** If the same rule already lives in root *and* a nested `CLAUDE.md`, the nested one wins — propose removing the root copy.
- **Pattern in root?** If a `pattern`-scoped rule was about to land in root `CLAUDE.md`, reject — move it to `.claude/rules/`. This is the load-bearing invariant; without it the skill regresses to the old root-centric behaviour.
- **Scaffolding a new file?** Confirm with the user. New `CLAUDE.md` files load on every turn for that subtree thereafter — non-trivial.

### 5d. Draft the changes

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

### 5e. Keep it concise

Apply the same principles as init-claude:
- **50-100 lines** for CLAUDE.md total — if adding content, consider removing something less important or moving narrative to `docs/`
- **Under 500 lines** per rules file
- **One concern per rules file** — don't mix unrelated topics
- **Only what Claude can't infer** — if it's obvious from the code, don't document it
- **Use file references, not code snippets** — point to `file:line` instead of pasting code that will go stale
- **Narrative content belongs in `docs/`** — if you find yourself writing a paragraph of "the reason this works this way is…", that's a `docs/architecture.md` edit, not a CLAUDE.md edit
- **Link, don't duplicate** — when a fact lives in `docs/`, reference it from CLAUDE.md via `@import` instead of copying the prose

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
- Do NOT bloat CLAUDE.md beyond 100 lines — if adding content, trim something less important or move narrative to `docs/`
- Do NOT skip the staleness check — removing wrong information is more valuable than adding new information
- Do NOT document temporary workarounds as permanent patterns
- Do NOT create rules files for areas that have no recurring patterns yet
- Do NOT duplicate facts between CLAUDE.md and `docs/` — pick one owner and link from the other; duplicates always drift
- Do NOT make CLAUDE.md a thin pointer file — if the agent has to Read 3+ docs to do its job, the hot path is broken; promote rules back inline
- Do NOT write narrative ("we did this because…", "the system grew as…") in CLAUDE.md or `.claude/rules/` — that's `docs/` material
- Do NOT leave new `docs/` files unreferenced — every `docs/<file>.md` should be discoverable from `docs/README.md` (humans) and `@docs/<file>.md` in CLAUDE.md (agent) when relevant
