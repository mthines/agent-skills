# CLAUDE.md Authoring

Rules for writing `CLAUDE.md` files (root and nested) and `.claude/rules/`
files. Routing decisions are made by
[`content-routing.md`](./content-routing.md); placement decisions by
[`placement-resolver.md`](./placement-resolver.md). This file covers
structure, length budgets, frontmatter, and the failure modes.

## 1. Length Budget

| File                                | Target lines | Hard cap |
| ----------------------------------- | -----------: | -------: |
| Root `CLAUDE.md`                    |     50 – 150 |      200 |
| Nested `CLAUDE.md` (per package)    |      30 – 80 |      120 |
| `.claude/rules/<topic>.md`          |     30 – 100 |      500 |
| `AGENTS.md` (if symlinked separately) | mirrors CLAUDE.md | mirrors |

Anthropic's guidance: at **200 lines** in a `CLAUDE.md`, adherence drops
measurably. Treat 200 lines as a red line, not a target.

## 2. Required Sections — Root `CLAUDE.md`

Every root `CLAUDE.md` must carry these sections in this order. Drop a
section only when there is literally nothing to say.

```markdown
# <Project Name>

<One-line description — what the project is, in one sentence.>

## Commands

```bash
# Development
<detected dev command>

# Testing
<detected test command>

# Linting
<detected lint command>

# Build
<detected build command>
```

## Code Style

- <Only rules that differ from defaults for the detected language>
- <Framework-specific conventions>

## Architecture

- <Key directory purposes — only non-obvious ones>
- <Important patterns to follow>

## Gotchas

- <Common mistakes to avoid>
- <Non-obvious behaviors>
```

Tier-conditional appendix — append **only** for Medium and Large tiers
(see [`docs-folder.md`](./docs-folder.md) §1 for tier definitions):

```markdown
## Documentation

Narrative content lives in `docs/`. Read on demand.

- `docs/architecture.md` — directory layout, module boundaries, design rationale
- `docs/contributing.md` — dev environment, branch workflow, PR conventions
- `docs/<topic>.md` — domain glossary, ADRs, deeper walkthroughs

@docs/architecture.md
@docs/contributing.md
```

Why both inline rules and `@docs/` imports?
Inline rules auto-load — the agent acts on them with zero round-trips.
`@imports` also load **eagerly at session start** (depth ≤ 5, per Anthropic's memory docs) — they are NOT demand-loaded and DO add to the hot-path token cost.
Use `@imports` only for content the agent needs at the start of most turns; move rarely-needed narrative to `docs/` without any `@import`.

## 3. What to Include vs. Exclude

| Include                                       | Exclude                                          |
| --------------------------------------------- | ------------------------------------------------ |
| Commands the agent could not guess            | Standard language conventions Claude knows       |
| Rules that prevent concrete mistakes          | "Just-in-case" rules                             |
| Decision tables (path → owner, file → tool)   | Things Claude reads from code                    |
| File inventory ("key source files: …")        | Per-file descriptions of every module            |
| Repository etiquette (branch naming, PR style) | Detailed API documentation                       |
| Non-obvious dev environment quirks            | Information that changes weekly                  |
| Architectural decisions specific to this repo  | Narrative ("we picked X because Y")              |

The single most useful filter: **would removing this cause Claude to
make a mistake?** If no → delete.

## 4. Frontmatter for `.claude/rules/<topic>.md`

Every path-scoped rule file must have YAML frontmatter:

```markdown
---
description: <one-line description of what this rule covers>
paths:
  - "src/api/**/*.ts"
  - "src/api/**/*.tsx"
---

# <Title>

- <Concise, actionable rules>
```

Notes:

- `paths:` is a **sequence**, not a comma-separated string. The agent
  loads the rule only when a file matches.
- Omit `paths:` for **truly repo-wide** rules (rare — most belong in
  root `CLAUDE.md`).
- One concern per file. Do not mix testing rules with API rules.

## 5. Audit Rubric for an Existing `CLAUDE.md`

Walk every item; mark PASS / WARN / FAIL with one line of evidence.

| Check                                                                                          | Pass condition                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Length within budget                                                                           | Root ≤ 200; nested ≤ 120                                  |
| No duplicated facts (verify against `docs/` and `README.md`)                                   | Each fact has one owner                                   |
| No narrative paragraphs                                                                        | No "we did this because…" prose                           |
| No `@imports` to missing files                                                                 | Every `@path` resolves                                    |
| No documented commands missing from `package.json` / `Makefile` / equivalent                   | Run the staleness check from `drift-detection.md` §3      |
| No path references that no longer exist                                                        | Same check                                                |
| Pattern-scoped rules are in `.claude/rules/`, **not** root                                     | Grep for `paths:` in root                                 |
| File inventory matches actual `docs/` tree                                                     | `ls docs/` vs the inventory list                          |
| Code fences declare a language identifier                                                      | No bare ` ``` ` opens                                     |
| Headings sentence-case                                                                         | Visual inspection                                         |
| Voice is imperative / active                                                                   | No "we", "I", "the user"                                  |

## 6. AGENTS.md Interop

[`agents.md`](https://agents.md/) is the cross-tool open spec. By 2026,
it is read natively by OpenAI Codex CLI, Cursor, Aider, Devin,
Sourcegraph Amp, Google Jules, Zed AI, Continue, Roo Code, Factory,
GitHub Copilot, Gemini CLI, Windsurf, and Amazon Q. Claude Code reads
`CLAUDE.md`, **not** `AGENTS.md` directly.

Two interop options:

| Strategy                                       | When to use                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Symlink** — `ln -s CLAUDE.md AGENTS.md`     | Simplest. One source of truth. Use for mixed-tool teams where every tool sees the same content.   |
| **`@import`** — `CLAUDE.md` starts with `@AGENTS.md` and shared content lives in `AGENTS.md` | Claude-Code-first teams with cross-tool readers as secondary. Lets `CLAUDE.md` add Claude-specific content on top. |

**Do not** maintain two parallel files manually. The duplication will
drift on day three.

## 7. Common Failure Modes

| Failure                                                          | Detection                                                | Fix                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Hot path bloat (>200 lines)                                      | Line count                                               | Move narrative to `docs/`; `@import` back      |
| Narrative leaks into `CLAUDE.md`                                  | Search for "because", "originally", "history", "we"      | Move to `docs/explanation/`                    |
| Pattern-scoped rule in root                                       | Search root `CLAUDE.md` for path globs / file globs      | Move to `.claude/rules/` with `paths:`         |
| Duplicate fact in `CLAUDE.md` and `docs/`                         | Diff the files for matching paragraphs                   | Pick one owner; link from the other            |
| Documented command missing from `package.json`                    | See `drift-detection.md` §3                              | Remove from `CLAUDE.md`                        |
| Dead `@import`                                                    | Run the regex in `drift-detection.md` §3                 | Fix the path or remove the import              |
| Sub-package quirks at root                                        | Scope analysis — file paths the rule mentions            | Move to nested `<dir>/CLAUDE.md`               |

## 8. Examples — Good vs. Bad

| Bad                                                                | Good                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| "Make sure to test your changes."                                  | "Run `pnpm test:unit` before committing."                         |
| "Format code properly."                                            | "Use 2-space indentation."                                        |
| "Keep files organized."                                            | "API handlers live in `src/api/handlers/`."                       |
| "We originally chose Vitest because Jest was too slow."            | (Move to `docs/explanation/test-stack.md`)                        |
| "Use functional components."                                       | "Use functional components. Class components in `src/components/legacy/**` only." |
| "Avoid `any`."                                                     | "Avoid `any`; prefer `unknown` and narrow with type guards."      |
