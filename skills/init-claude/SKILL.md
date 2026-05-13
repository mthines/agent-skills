---
name: init-claude
description: >
  Initializes Claude Code configuration for a project by analyzing directory structure
  and tech stack, then scaffolding a tiered docs setup: CLAUDE.md and .claude/rules/
  for the agent hot path, plus a docs/ tree (root and nested for monorepos) for
  narrative content humans also use. Routes content by kind: rules and decision
  tables stay inline; rationale, onboarding, and architecture narrative go to docs/.
  Triggers on "bootstrap CLAUDE.md", "set up Claude config", "scaffold .claude",
  "initialize Claude Code", "/init-claude".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.1.0'
  workflow_type: command
  tags:
    - documentation
    - claude-md
    - scaffold
    - tiered-docs
    - hot-path
    - monorepo
    - bootstrap
    - project-init
---

# Initialize Claude Configuration

Generate project-specific Claude Code configuration by analyzing the codebase. Creates concise, actionable configuration following official best practices.

## Key Principles (from Official Docs)

- **CLAUDE.md should be 50-100 lines** in root, use `@imports` for detailed sections
- **Include only what Claude can't infer** from code
- **Use `.claude/rules/`** for modular, path-targeted instructions
- **Less is more** - bloated files cause Claude to ignore rules
- **Hybrid CLAUDE.md + `docs/`**: keep prescriptive rules in CLAUDE.md (auto-loaded hot path) and link to `docs/` for explanatory content that humans also benefit from. See "Content Routing Rubric" below.

## Content Routing Rubric

CLAUDE.md is auto-loaded into every Claude Code session — every line is a recurring token cost. `docs/` is loaded on demand via the Read tool (or via `@import` from CLAUDE.md). Route each piece of content to the cheapest destination that still reaches its reader.

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

**CLAUDE.md must always keep:** the file inventory of `docs/` so the agent knows what to Read without listing the directory.

**Never:** duplicate content between CLAUDE.md and `docs/`. Link, don't copy. Drift will follow the duplicates.

**Never:** make CLAUDE.md a thin pointer file. If the agent has to Read 3+ docs to do its job, the hot path is broken — promote rules back inline.

## Step 1: Check Existing Configuration

```bash
# Check current directory
pwd

# Check for existing Claude configuration
ls -la CLAUDE.md .claude/ 2>/dev/null || echo "No existing config"

# Check for existing .gitignore
grep -l "\.claude" .gitignore 2>/dev/null || echo "No .claude in gitignore"
```

If configuration exists, ask using AskUserQuestion:
- **Overwrite**: Replace existing configuration
- **Merge**: Add missing sections only
- **Skip**: Only create missing files
- **Abort**: Cancel operation

## Step 2: Analyze Project Size & Complexity

First, determine project complexity to decide configuration approach:

```bash
# Count source files (excluding node_modules, vendor, build outputs, caches)
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.rb" \) \
  -not -path "*/node_modules/*" -not -path "*/vendor/*" -not -path "*/.git/*" \
  -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/target/*" -not -path "*/out/*" \
  -not -path "*/.next/*" -not -path "*/.nuxt/*" -not -path "*/.svelte-kit/*" -not -path "*/.turbo/*" \
  -not -path "*/coverage/*" -not -path "*/__pycache__/*" -not -path "*/.venv/*" -not -path "*/venv/*" | wc -l

# Count directories (depth indicator)
find . -type d \
  -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/vendor/*" \
  -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/target/*" -not -path "*/out/*" \
  -not -path "*/.next/*" -not -path "*/.nuxt/*" -not -path "*/.svelte-kit/*" -not -path "*/.turbo/*" \
  -not -path "*/coverage/*" -not -path "*/__pycache__/*" -not -path "*/.venv/*" -not -path "*/venv/*" | wc -l

# Check for multiple languages/packages
ls packages/ apps/ libs/ services/ 2>/dev/null | wc -l
```

### Complexity Thresholds (Auto-Decision)

| Metric | Small | Medium | Large |
|--------|-------|--------|-------|
| Source files | < 50 | 50–250 | 250+ |
| Directories | < 20 | 20–60 | 60+ |
| Monorepo packages | 0 | 0–1 | 2+ |
| Has CI/CD | No | Yes | Yes |

**Decision Logic (auto-route by tier):**

| Tier | CLAUDE.md | `.claude/rules/` | Root `docs/` | Nested `docs/` |
|------|-----------|------------------|--------------|----------------|
| **Small** | yes | no | no | no |
| **Medium** | yes | yes | yes | no |
| **Large** | yes | yes | yes | yes (per package) |

- **Small project**: Single CLAUDE.md only — explanatory content can live in `README.md`.
- **Medium project**: CLAUDE.md + `.claude/rules/` + root `docs/` for architecture and contributing.
- **Large project / monorepo**: All of the above, plus per-package nested `docs/` for package-specific narrative. Each package's CLAUDE.md links to its own nested `docs/`.

## Step 3: Detect Tech Stack

```bash
# Package managers and languages
ls package.json pnpm-lock.yaml yarn.lock package-lock.json bun.lockb 2>/dev/null
ls Cargo.toml go.mod pyproject.toml requirements.txt setup.py Gemfile composer.json 2>/dev/null

# Monorepo indicators
ls nx.json turbo.json lerna.json pnpm-workspace.yaml 2>/dev/null

# Test frameworks
ls jest.config.* vitest.config.* playwright.config.* cypress.config.* pytest.ini 2>/dev/null

# Linting/formatting
ls .eslintrc* eslint.config.* .prettierrc* biome.json rustfmt.toml .clang-format 2>/dev/null

# CI/CD
ls -d .github/workflows .gitlab-ci.yml .circleci 2>/dev/null

# Read key files for context
head -80 package.json 2>/dev/null
head -30 README.md 2>/dev/null
```

## Step 4: Create Directory Structure

Apply the tier table from Step 2. Create only the directories the tier needs.

**Small project:**
```bash
mkdir -p .claude
```

**Medium project:**
```bash
mkdir -p .claude/rules docs
```

**Large project / monorepo:**
```bash
mkdir -p .claude/rules docs
# Per-package nested docs (run for each detected package):
for pkg in packages/*/; do mkdir -p "${pkg}docs"; done
```

## Step 5: Generate CLAUDE.md

Create a **concise** CLAUDE.md (target 50-100 lines). Focus on:

### What to Include
| Category | Example |
|----------|---------|
| Bash commands Claude can't guess | `pnpm test:unit` not `npm test` |
| Code style rules differing from defaults | `Use ES modules, not CommonJS` |
| Testing instructions | `Run single tests with vitest -t` |
| Repository etiquette | Branch naming, PR conventions |
| Architectural decisions | `All API routes in src/api/` |
| Dev environment quirks | Required env vars |
| Common gotchas | `Never import from @internal` |

### What to Exclude
| Category | Why |
|----------|-----|
| Things Claude can read from code | Redundant |
| Standard language conventions | Claude knows them |
| Detailed API documentation | Link instead |
| Information that changes frequently | Gets stale |
| File-by-file descriptions | Too verbose |

### Template Structure

```markdown
# [Project Name]

[One-line description]

## Commands

```bash
# Development
[detected dev command]

# Testing
[detected test command]

# Linting
[detected lint command]

# Build
[detected build command]
```

## Code Style

- [Only rules that differ from defaults]
- [Framework-specific conventions]

## Architecture

- [Key directory purposes - only non-obvious ones]
- [Important patterns to follow]

## Gotchas

- [Common mistakes to avoid]
- [Non-obvious behaviors]
```

### Tier-conditional appendix

The `## Commands`, `## Code Style`, `## Architecture`, and `## Gotchas` sections above apply to every tier.
Append the following **only for Medium and Large tiers** (Small tier has no `docs/` tree, so the `@imports` would be dead):

```markdown
## Documentation

Narrative content lives in `docs/` and is human-friendly. Read on demand.

- `docs/architecture.md` — directory layout, module boundaries, design rationale
- `docs/contributing.md` — dev environment, branch workflow, PR conventions
- `docs/<topic>.md` — domain glossary, ADRs, deeper walkthroughs

The agent loads these via `@import` (below) when relevant; humans browse them directly.

@docs/architecture.md
@docs/contributing.md
```

> **Why both inline rules and `@docs/` imports?** Inline rules are auto-loaded — the agent acts on them with zero round-trips. `@imports` give the agent a fallback path to richer narrative when it needs context. Humans get a real `docs/` tree they can read in any editor or render as a static site.

## Step 6: Generate Rules (Large Projects Only)

**Skip this step for small projects** - a single CLAUDE.md is sufficient.

For large projects, automatically create path-targeted rules based on detected structure:

### Auto-Generated Rules (based on detected patterns)

**code-style.md** - Path-targeted style rules:
```markdown
---
description: TypeScript style rules for the src/ tree
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---

# TypeScript Style

- Prefer interfaces over types for object shapes
- Use explicit return types on exported functions
- Avoid `any`, use `unknown` for truly unknown types
```

**testing.md** - Test-specific rules:
```markdown
---
description: Conventions for test files
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.test.js"
---

# Testing Guidelines

- Use descriptive test names: `it('should X when Y')`
- Prefer integration tests over unit tests for API routes
- Mock external services, not internal modules
```

**api.md** - API development rules:
```markdown
---
description: API route conventions
paths:
  - "src/api/**/*.ts"
---

# API Development

- All endpoints must validate input
- Return consistent error shapes
- Document with OpenAPI comments
```

**security.md** - Security practices (project-wide, no `paths:`):
```markdown
---
description: Project-wide security rules
---

# Security

- Never log sensitive data (tokens, passwords, PII)
- Use environment variables for secrets
- Validate all external input
```

## Step 6b: Generate `docs/` Tree (Medium and Large Projects)

**Skip for small projects** — explanatory content can live in `README.md`.

Scaffold a `docs/` tree at the repo root. Each file is a separate concern; keep one topic per file.

### Default scaffolded files

| File | Purpose | Audience |
|------|---------|----------|
| `docs/README.md` | Index of `docs/` topics | Humans (entry point) |
| `docs/architecture.md` | Directory layout, module boundaries, design rationale | Humans + agent fallback |
| `docs/contributing.md` | Dev environment setup, branch workflow, PR conventions | Humans (onboarding) |
| `docs/conventions.md` | Style philosophy, naming, the "why" behind hard rules | Humans + agent fallback |

### `docs/architecture.md` template

```markdown
# Architecture

## Directory layout

[Tree of top-level directories with one-line purpose each]

## Module boundaries

[Which modules depend on which. What the dependency direction is and why.]

## Key design decisions

### [Decision title]

**Context:** [What constraint or problem prompted this.]
**Decision:** [What we picked.]
**Consequences:** [What this enables and what it costs.]
```

### `docs/contributing.md` template

```markdown
# Contributing

## Dev environment

[Required tools, versions, env vars, first-run setup steps.]

## Workflow

[Branch naming, commit conventions, PR checklist, review expectations.]

## Local testing

[How to run tests locally, how to debug a failing CI check.]
```

### Nested `docs/` for monorepos (Large only)

For each detected package (e.g. `packages/*/`, `apps/*/`), scaffold:

```
packages/<pkg>/
├── CLAUDE.md          # package-specific rules (if needed)
├── docs/
│   ├── README.md      # index for this package
│   └── architecture.md  # package-internal design
```

The package's CLAUDE.md `@imports` its nested `docs/architecture.md`, so the agent has a hot path into package-specific narrative when working in that subtree.

### Routing checklist (apply during generation)

For every paragraph you draft, ask: **does this need to be in the agent's hot path, or is it human onboarding?**

- Hard rule, command, gotcha → CLAUDE.md
- Path-scoped rule → `.claude/rules/`
- Why we chose X, how the system grew, walkthrough → `docs/`
- Stable reference (glossary, ADR) → `docs/`

Re-read the "Content Routing Rubric" above whenever uncertain.

---

## Step 7: Generate settings.json (Large Projects Only)

**Skip for small projects** - permissions can go in CLAUDE.md instead.

For large projects, create `.claude/settings.json` for team-shared settings:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash([detected-package-manager] run *)",
      "Bash([detected-package-manager] test *)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)"
    ]
  }
}
```

## Step 8: Update .gitignore

Append the local-settings entry idempotently (the `grep -q` guard makes the step safe to re-run):

```bash
if ! grep -qxF ".claude/settings.local.json" .gitignore 2>/dev/null; then
  {
    [ -s .gitignore ] && echo ""
    echo "# Claude Code local settings"
    echo ".claude/settings.local.json"
  } >> .gitignore
fi
```

## Step 9: Summary

Display a summary table:

### Created Files

| File | Lines | Purpose | Audience |
|------|-------|---------|----------|
| `CLAUDE.md` | ~X | Project instructions (auto-loaded hot path) | Agent |
| `.claude/settings.json` | ~X | Team settings | Agent |
| `.claude/rules/code-style.md` | ~X | Path-scoped style rules | Agent |
| `.claude/rules/testing.md` | ~X | Path-scoped test rules | Agent |
| `docs/README.md` | ~X | Index of narrative docs | Humans |
| `docs/architecture.md` | ~X | Directory layout, design rationale | Humans + agent fallback |
| `docs/contributing.md` | ~X | Dev environment, workflow | Humans |
| `docs/conventions.md` | ~X | Style philosophy / "why" | Humans + agent fallback |

### Detected Stack

| Category | Detected |
|----------|----------|
| Language | TypeScript/Python/Go/Rust/etc |
| Framework | React/Vue/Express/FastAPI/etc |
| Package Manager | npm/pnpm/yarn/cargo/etc |
| Test Framework | Jest/Vitest/Pytest/etc |
| Monorepo | Yes (Nx)/No |

### Next Steps

1. **Review generated files** - Customize for your needs
2. **Remove obvious rules** - If Claude would do it anyway, delete it
3. **Add project-specific gotchas** - Things only you know
4. **Commit to git** - Share with your team
5. **Iterate** - Update when Claude makes repeated mistakes

## Language-Specific Snippets

Drop the matching snippet into the CLAUDE.md template's `## Commands` and `## Code Style` sections. Detect the language from Step 3.

| Language | Commands (substitute into template) | Code style rules to inline |
|----------|-------------------------------------|----------------------------|
| Node.js/TypeScript | `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck` | ES modules (not CommonJS); prefer `interface` over `type` for objects; explicit return types on exported functions |
| Python | `poetry run pytest` / `poetry run ruff check` / `poetry run mypy .` | Type hints on public functions; Google-style docstrings; prefer `pathlib` over `os.path` |
| Rust | `cargo test` / `cargo clippy` / `cargo fmt --check` | Document public items with `///`; use `thiserror` for error types; prefer `impl Trait` over explicit generics |
| Go | `go test ./...` / `golangci-lint run` / `go generate ./...` | Accept interfaces, return structs; handle all errors explicitly; table-driven tests |

Substitute the package manager (`npm`, `yarn`, `bun`) for the one detected in Step 3. Only include style rules that genuinely **differ from defaults** for that language — drop the rest.

## Tips

- **Test your CLAUDE.md**: If Claude asks questions answered in it, the phrasing is ambiguous
- **Prune regularly**: If Claude does something right without the rule, delete it
- **Add emphasis sparingly**: Use "IMPORTANT" or "MUST" only for critical rules
- **Treat as code**: Review and iterate when Claude misbehaves
- **Watch for hot-path erosion**: if you're adding `@import docs/<file>` for content the agent needs every turn, promote it back into CLAUDE.md inline
- **Don't duplicate**: when you write the same fact in CLAUDE.md and `docs/`, one will drift. Link, don't copy
