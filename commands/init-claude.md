---
name: init-claude
description: Initialize Claude Code configuration for a project by analyzing directory structure, detecting tech stack, and generating CLAUDE.md and .claude/ files following official best practices
---

# Initialize Claude Configuration

Generate project-specific Claude Code configuration by analyzing the codebase. Creates concise, actionable configuration following official best practices.

## Key Principles (from Official Docs)

- **CLAUDE.md should be 50-100 lines** in root, use `@imports` for detailed sections
- **Include only what Claude can't infer** from code
- **Use `.claude/rules/`** for modular, path-targeted instructions
- **Less is more** - bloated files cause Claude to ignore rules

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
# Count source files (excluding node_modules, vendor, etc.)
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.rb" \) \
  -not -path "*/node_modules/*" -not -path "*/vendor/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" | wc -l

# Count directories (depth indicator)
find . -type d -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/vendor/*" | wc -l

# Check for multiple languages/packages
ls packages/ apps/ libs/ services/ 2>/dev/null | wc -l
```

### Complexity Thresholds (Auto-Decision)

| Metric | Small | Large |
|--------|-------|-------|
| Source files | < 50 | 50+ |
| Directories | < 20 | 20+ |
| Monorepo packages | 0 | 1+ |
| Has CI/CD | No | Yes |

**Decision Logic:**
- **Small project** (any): Single CLAUDE.md only, no rules directory
- **Large project** (2+ large indicators): Full setup with `.claude/rules/`

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

For **large projects** (50+ files, 20+ dirs, or monorepo):
```bash
mkdir -p .claude/rules
```

For **small projects**:
```bash
mkdir -p .claude
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

## References

@docs/contributing.md
@docs/architecture.md
```

## Step 6: Generate Rules (Large Projects Only)

**Skip this step for small projects** - a single CLAUDE.md is sufficient.

For large projects, automatically create path-targeted rules based on detected structure:

### Auto-Generated Rules (based on detected patterns)

**code-style.md** - Path-targeted style rules:
```markdown
---
paths: src/**/*.{ts,tsx}
---

# TypeScript Style

- Prefer interfaces over types for object shapes
- Use explicit return types on exported functions
- Avoid `any`, use `unknown` for truly unknown types
```

**testing.md** - Test-specific rules:
```markdown
---
paths: **/*.test.{ts,tsx,js}
---

# Testing Guidelines

- Use descriptive test names: `it('should X when Y')`
- Prefer integration tests over unit tests for API routes
- Mock external services, not internal modules
```

**api.md** - API development rules:
```markdown
---
paths: src/api/**/*.ts
---

# API Development

- All endpoints must validate input
- Return consistent error shapes
- Document with OpenAPI comments
```

**security.md** - Security practices:
```markdown
# Security

- Never log sensitive data (tokens, passwords, PII)
- Use environment variables for secrets
- Validate all external input
```

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

Add to `.gitignore` if not present:
```
# Claude Code local settings
.claude/settings.local.json
```

## Step 9: Summary

Display a summary table:

### Created Files

| File | Lines | Purpose |
|------|-------|---------|
| `CLAUDE.md` | ~X | Project instructions |
| `.claude/settings.json` | ~X | Team settings |
| `.claude/rules/code-style.md` | ~X | Style rules |
| `.claude/rules/testing.md` | ~X | Test guidelines |

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

## Language-Specific Templates

### Node.js/TypeScript
```markdown
## Commands

```bash
pnpm dev          # Start dev server
pnpm test         # Run tests
pnpm lint         # Run ESLint
pnpm typecheck    # Run tsc --noEmit
```

## Code Style

- ES modules (import/export), not CommonJS
- Prefer `interface` over `type` for objects
- Explicit return types on exported functions
```

### Python
```markdown
## Commands

```bash
poetry run pytest     # Run tests
poetry run ruff check # Lint
poetry run mypy .     # Type check
```

## Code Style

- Type hints required for public functions
- Docstrings follow Google style
- Use `pathlib` over `os.path`
```

### Rust
```markdown
## Commands

```bash
cargo test        # Run tests
cargo clippy      # Lint
cargo fmt --check # Check formatting
```

## Code Style

- Document public items with `///`
- Use `thiserror` for error types
- Prefer `impl Trait` over explicit generics when possible
```

### Go
```markdown
## Commands

```bash
go test ./...         # Run tests
golangci-lint run     # Lint
go generate ./...     # Generate code
```

## Code Style

- Accept interfaces, return structs
- Handle all errors explicitly
- Use table-driven tests
```

## Tips

- **Test your CLAUDE.md**: If Claude asks questions answered in it, the phrasing is ambiguous
- **Prune regularly**: If Claude does something right without the rule, delete it
- **Add emphasis sparingly**: Use "IMPORTANT" or "MUST" only for critical rules
- **Treat as code**: Review and iterate when Claude misbehaves
