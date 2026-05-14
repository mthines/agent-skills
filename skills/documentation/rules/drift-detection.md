# Drift Detection

Documentation drifts faster than code because tooling does not warn
about it. This rule covers the deterministic checks (run them every
`update` invocation) and the semantic checks (run them when the diff
suggests they will be useful).

## 1. Gather the Diff

The skill operates on **changes** by default, not the whole repo. Pick
the diff strategy from `$ARGUMENTS`:

### Branch mode (default for `update`)

```bash
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
  | sed 's@^refs/remotes/origin/@@' || echo "main")

# Files changed on this branch vs base
git diff --name-only --diff-filter=ACMR "${BASE_BRANCH}...HEAD"
git diff --stat "${BASE_BRANCH}...HEAD"
git log --oneline "${BASE_BRANCH}..HEAD"
```

### Recent mode (last N commits)

```bash
git diff --name-only --diff-filter=ACMR "HEAD~${N}..HEAD"
git log --oneline -${N}
```

### Paths mode (limit by glob)

Quote `${PATHS}` so multi-value globs survive shell-split.

```bash
git diff --name-only --diff-filter=ACMR "${BASE_BRANCH}...HEAD" -- "${PATHS}"
```

### All mode (full audit, no diff)

```bash
# No diff needed — audit everything
find . -name "CLAUDE.md" -o -name "*.md" -path "*/.claude/rules/*" | head -50
```

## 2. Classify Changes by Area

Group changed files into documentation areas. Each area can hit the hot
path (CLAUDE.md / rules) **and / or** `docs/` — pick by content kind in
`content-routing.md`, not by file pattern alone.

| File pattern                                            | Documentation area | Hot-path target                                | `docs/` target                                   |
| ------------------------------------------------------- | ------------------ | ---------------------------------------------- | ------------------------------------------------ |
| `src/api/**`, `routes/**`                               | API layer          | `.claude/rules/api.md`                         | `docs/explanation/architecture.md` (rationale only) |
| `**/*.test.*`, `**/*.spec.*`                            | Testing            | `.claude/rules/testing.md`                     | `docs/how-to/run-tests.md`                       |
| `*.config.*`, `package.json`, `tsconfig.*`              | Build / tooling    | `CLAUDE.md` Commands                           | `docs/how-to/contributing.md` (env setup)        |
| `src/components/**`                                     | Frontend           | `.claude/rules/frontend.md`                    | `docs/explanation/architecture.md`               |
| `migrations/**`, `schema.*`                             | Database           | `.claude/rules/database.md`                    | `docs/explanation/architecture.md` (data model)  |
| `Dockerfile`, `docker-compose.*`, `.github/**`          | Infra / CI         | `CLAUDE.md` or `.claude/rules/infra.md`        | `docs/how-to/contributing.md` (local infra)      |
| New top-level directories                               | Architecture       | `CLAUDE.md` Architecture section               | `docs/explanation/architecture.md` (full narrative) |
| Deleted files / directories                             | Architecture       | Remove stale references from `CLAUDE.md` / rules | Remove stale references from `docs/`             |
| `docs/**` itself changed                                | Documentation       | (no hot-path action)                          | Verify cross-links and `@imports` still resolve  |

Also detect:

- **New patterns introduced** — new frameworks, libraries, or
  architectural patterns in the diff
- **Breaking changes** — renamed exports, changed APIs, moved files
- **New gotchas** — error-prone patterns visible in the diff

## 3. Deterministic Staleness Checks

Run these every `update` invocation. They are deterministic, fast, and
high-signal.

### 3.1 Path references

Do file paths mentioned in docs still exist? The regex accepts any
extension and well-known extensionless filenames, then strips an
optional `:line` / `:line:col` suffix before the existence check.

```bash
grep -ohE '`(([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)|(Makefile|Dockerfile|README|LICENSE|CHANGELOG))(:[0-9]+)?(:[0-9]+)?`' CLAUDE.md \
  | tr -d '`' \
  | sed -E 's/:[0-9]+(:[0-9]+)?$//' \
  | sort -u \
  | while read -r f; do
      [ -n "$f" ] && [ ! -e "$f" ] && echo "STALE: $f referenced in docs but doesn't exist"
    done
```

### 3.2 Command references

Do documented `npm` / `pnpm` / `yarn` / `bun` scripts still exist in
`package.json`?

```bash
# Skip silently if there is no package.json at the repo root.
if [ -f package.json ]; then
  grep -ohE '`(npm|pnpm|yarn|bun)( run)? [a-zA-Z][a-zA-Z0-9:_-]*`' CLAUDE.md \
    | tr -d '`' \
    | awk '{print $NF}' \
    | sort -u \
    | while read -r script; do
        if ! grep -qE "\"${script}\"[[:space:]]*:" package.json; then
          echo "STALE: documented script '${script}' missing from package.json"
        fi
      done
fi
```

For non-Node projects, run the equivalent against `Makefile`,
`justfile`, `pyproject.toml` `[tool.poetry.scripts]`, or `Cargo.toml`
`[[bin]]`.

### 3.3 Dead `@imports`

Every `@<path>` reference in `CLAUDE.md` or `.claude/rules/` must
resolve to a real file. The regex matches any relative path
(`@docs/...`, `@.claude/rules/...`, `@packages/<pkg>/CLAUDE.md`, etc.) —
not only `@docs/`.

```bash
grep -rhoE '@[A-Za-z0-9_.][A-Za-z0-9_./-]*\.[A-Za-z0-9]+' CLAUDE.md .claude/rules/ 2>/dev/null \
  | sort -u \
  | while read -r ref; do
      path="${ref#@}"
      [ ! -e "$path" ] && echo "DEAD @import: $ref"
    done
```

### 3.4 Rules-path globs

Do `.claude/rules/` `paths:` patterns match any current files?

```bash
# For each rule with a `paths:` section, expand the glob and check for matches.
# A rule whose paths match zero files is dead — propose removal.
```

### 3.5 Relative links inside `docs/`

```bash
# Find every relative markdown link [...](...) in docs/, resolve, check existence.
grep -rEho '\]\((\./|\.\./)[^)]+\)' docs/ 2>/dev/null \
  | sed -E 's/^\]\(|\)$//g'
```

Run `lychee` or `markdown-link-check` for a thorough sweep — see
[`maintenance.md`](./maintenance.md) §3.

### 3.6 Hot-path leakage

Scan `docs/` for content that *should* be in the hot path. If a `docs/`
file documents a hard rule the agent must obey on every turn ("never
edit `dist/` directly", "every API handler must validate input"),
promote it to `CLAUDE.md` or `.claude/rules/`.

```bash
# Heuristic: look for "MUST", "NEVER", "ALWAYS" in docs/.
grep -rEn '\b(MUST|NEVER|ALWAYS)\b' docs/ 2>/dev/null
```

Inspect each hit. If it is genuinely a rule the agent should obey, move
it; if it is just emphasis in narrative ("we must support both…"),
leave it.

### 3.7 Post-write verification — did the rule actually load?

After writing or editing a `.claude/rules/*.md` file with `paths:`,
verify it loaded. Known Claude Code bugs cause YAML-list `paths:` to
silently fail on some versions ([#17204](https://github.com/anthropics/claude-code/issues/17204),
[#13905](https://github.com/anthropics/claude-code/issues/13905),
[#16299](https://github.com/anthropics/claude-code/issues/16299)).

Two verification options:

1. **`/memory` command** — Claude Code's built-in memory inspection.
   Prints every loaded rule and its source. Run after writing a rule
   and grep for the file you just wrote.

2. **`InstructionsLoaded` hook** — emits one event per rule load. Wire
   into `~/.claude/settings.json`:

   ```json
   {
     "hooks": {
       "InstructionsLoaded": [
         { "type": "command", "command": "echo \"$CLAUDE_HOOK_INPUT\" >> ~/.claude/logs/rules-loaded.log" }
       ]
     }
   }
   ```

   Then read the log to confirm the new rule appeared.

If the rule did not load:

- First, check YAML syntax — quoted globs in a sequence (`- "**/x"`).
- Second, try the `globs:` fallback form (Cursor-style, unquoted,
  comma-separated). See [`placement-resolver.md`](./placement-resolver.md) §7.
- Third, file an issue if both forms fail.

Also run a link checker over every doc surface to catch dead path
references:

```bash
# Lychee — Rust-based, fast. Checks relative + absolute links + anchors.
npx lychee --no-progress --include-fragments \
  CLAUDE.md AGENTS.md README.md .claude/rules/**/*.md docs/**/*.md
```

Block delivery on any broken local link. Warn on broken external links
(rate-limit / temporary outage). See
[`maintenance.md`](./maintenance.md) §3 for the CI workflow.

### 3.8 Duplication between surfaces

Any paragraph that appears verbatim (or near-verbatim) in both
`CLAUDE.md` and `docs/` (or `README.md` and `docs/`) is a drift risk.
Pick a single owner per fact.

```bash
# Quick diff of common headings.
grep -E '^## ' CLAUDE.md docs/*.md README.md 2>/dev/null | sort -t: -k2
# Sections with identical titles across files are duplication candidates.
```

## 4. Semantic Drift Checks (requires reading code)

For each affected area, compare what the docs say to what the code now
does. Less automatable, more judgment-dependent.

| Check                  | Procedure                                                                   |
| ---------------------- | --------------------------------------------------------------------------- |
| Architecture claims     | Has the directory structure changed? New modules? Removed modules?         |
| Code style claims       | Has the style evolved? New patterns adopted?                                |
| Gotchas                 | Are documented gotchas still relevant? Are there new ones?                  |
| Testing patterns        | Have test conventions changed?                                              |
| `docs/architecture.md` directory list | Diff against current `ls` of the repo tree                        |
| `docs/contributing.md` setup steps    | Do the steps still work for a new contributor?                    |

## 5. Holistic Mode (the `holistic` argument)

When the user passes `holistic`, run `holistic-analysis` in refactor
mode for each affected area before drafting docs updates. Useful when:

- Multiple architectural patterns changed at once.
- New conventions were established during the work that future Claude
  sessions need to know about.
- The dependency direction between modules shifted.

Key questions during the holistic pass:

1. Is this a **new architectural pattern** that future sessions need to
   know about?
2. Did we **discover a gotcha** during implementation that should be
   documented?
3. Has the **dependency direction** changed between modules?
4. Are there **new conventions** we established during this work?
5. What **mistakes did Claude make** during this session that a rule
   could prevent?

## 6. Priority Tiers for Updates

| Priority    | Type                                              | Example                                                            |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| **P0 — must fix** | Stale or wrong information                  | Dead file path, removed command, deleted module                    |
| **P1 — should add** | New patterns Claude cannot infer          | New architectural decision, non-obvious convention, discovered gotcha |
| **P2 — nice to have** | Clarifications                          | Better wording, more specific examples                             |
| Skip        | Noise                                             | Things Claude would figure out from reading the code               |

In `apply` mode:

- P0 changes apply immediately (they are correctness fixes).
- P1 changes ask for confirmation via `AskUserQuestion`.
- P2 changes skip unless the user requests them.

## 7. Per-Update Workflow

For each proposed change:

1. **Classify by content kind** ([`content-routing.md`](./content-routing.md) §1).
2. **Route to a surface** ([`content-routing.md`](./content-routing.md) §2).
3. **Pick a specific file path** ([`placement-resolver.md`](./placement-resolver.md) §3).
4. **Run the pre-write sanity checks** ([`placement-resolver.md`](./placement-resolver.md) §4).
5. **Draft the change.** Use `Edit` for existing files; `Write` for new
   files; staged removal for stale content.
6. **Apply.**
7. **Re-run the deterministic checks** to confirm the fix did not
   introduce new drift.

## 8. Sample Dry-Run Output

```
## Proposed Documentation Updates

### Files to Modify
| File                       | Change | Summary                                       |
| -------------------------- | ------ | --------------------------------------------- |
| CLAUDE.md                  | Edit   | Update Commands section (pnpm → bun)          |
| .claude/rules/api.md       | Edit   | Add new rate limiting pattern                 |
| .claude/rules/auth.md      | New    | Document new auth middleware conventions      |
| docs/explanation/architecture.md | Edit | Remove deleted `src/old-module/` reference |

### Stale References Found
| File                       | Line | Reference            | Status              |
| -------------------------- | ---- | -------------------- | ------------------- |
| CLAUDE.md                  | 42   | `src/old-module/`    | Directory deleted   |
| .claude/rules/testing.md   | 15   | `jest.config.ts`     | Renamed to vitest   |

### Priority Breakdown
| Priority | Count | Will apply |
| -------- | ----- | ---------- |
| P0       | 2     | Yes (auto) |
| P1       | 2     | Asks first |
| P2       | 0     | n/a        |
```

## 9. Anti-patterns

- Rewriting `CLAUDE.md` from scratch when only one line changed.
- Adding "just in case" rules — every rule must prevent a concrete
  mistake.
- Documenting temporary workarounds as permanent patterns.
- Skipping the staleness check — removing wrong information is more
  valuable than adding new information.
- Creating new rule files for areas with no recurring patterns yet.
- Leaving new `docs/` files unreferenced — every `docs/<file>.md`
  should be discoverable from `docs/README.md` and `@docs/<file>.md` in
  `CLAUDE.md` when relevant.
