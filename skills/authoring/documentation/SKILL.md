---
name: documentation
description: >
  Authors, audits, and maintains project documentation across CLAUDE.md /
  .claude/rules/, AGENTS.md, README.md, and Diátaxis docs/ trees (root +
  nested for monorepos). Four modes: init scaffolds a tiered docs setup
  from scratch; update detects drift (dead @imports, renamed commands,
  stale narrative) and incrementally refreshes via a Placement Resolver
  that pushes rules to the innermost-ancestor destination; readme writes
  or audits a README against the standard-readme spec; audit produces a
  documentation health report across every surface. Routes by kind: hard
  rules to CLAUDE.md, path-scoped patterns to .claude/rules/, narrative
  to docs/, marketing to README.md. Triggers on "init claude", "bootstrap
  docs", "scaffold CLAUDE.md", "update docs", "sync CLAUDE.md", "docs
  drift", "write a README", "audit our docs", "review the README",
  "Diátaxis", "/documentation".
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: command
  tags:
    - documentation
    - claude-md
    - readme
    - docs-folder
    - diataxis
    - drift-detection
    - tiered-docs
    - agent-readable
    - monorepo
    - placement-resolver
    - bootstrap
    - audit
---

# Documentation

Author, audit, and maintain project documentation across every surface that matters: the **agent hot path** (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/`), the **human entry point** (`README.md`), and the **narrative tier** (`docs/`).
This is the single home for "make our docs good" work — bootstrapping a new project, refreshing docs after a sprint, writing a README that converts readers into users, or auditing the whole estate for drift.

> **This `SKILL.md` is a thin index.** Detailed authoring rules live in
> `rules/*.md` and load on demand. Worked examples are in
> `references/*.md`. Literal scaffolding skeletons are in `templates/*.md`.
> Do not preload everything — load only what the current phase asks for.

---

## Mode Detection

Parse `$ARGUMENTS` (first token) and route to one of four modes.
A second token of `--auto` is a cross-cutting modifier (see below).

| Mode      | Default | Trigger                                                                                |
| --------- | ------- | -------------------------------------------------------------------------------------- |
| `init`    |         | "init", "bootstrap", "scaffold", or `$ARGUMENTS == "init"` (no existing CLAUDE.md).    |
| `update`  | **yes** | Default when a `CLAUDE.md` already exists. "update", "sync", "refresh", "drift".       |
| `readme`  |         | "readme", "write a README", "audit the README", or `$ARGUMENTS == "readme"`.          |
| `audit`   |         | "audit", "review the docs", "doc health check", or `$ARGUMENTS == "audit"`.            |

**`--auto` modifier** — append to any mode token to enable the autonomous-workflow guardrails.
Always passed by `autonomous-workflow` Phase 5 as `Skill("documentation", "update --auto")`.
When `--auto` is present, also load [`auto-update-loop.md`](./rules/auto-update-loop.md) before executing the mode's phases.

Disambiguation rule when no mode token is passed:

1. If `./CLAUDE.md` does not exist → `init`.
2. Else if `./README.md` does not exist and the user mentioned "README" → `readme`.
3. Else → `update`.

State the detected mode in one line before continuing:

```
Mode: update
Target: this repo
```

---

## Shared Foundations (every mode loads these)

Regardless of mode, every run is governed by three rule files.
Load them once on first need; do not reload them per phase.

| File                                    | What it gives you                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`rules/content-routing.md`](./rules/content-routing.md) | The Content Routing Rubric — which surface owns which kind of content, and why.                |
| [`rules/placement-resolver.md`](./rules/placement-resolver.md) | The innermost-wins algorithm for picking the *specific* file (root vs nested CLAUDE.md, `.claude/rules/` with `paths:`, etc.). |
| [`rules/writing-style.md`](./rules/writing-style.md) | Google + Microsoft style highlights, plain-language rules, and the agent-readable docs pattern. |

Then add the rule files specific to the mode:

| Mode     | Additional rules to load                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `init`   | [`claude-md.md`](./rules/claude-md.md), [`readme.md`](./rules/readme.md), [`docs-folder.md`](./rules/docs-folder.md)       |
| `update` | [`drift-detection.md`](./rules/drift-detection.md), [`claude-md.md`](./rules/claude-md.md)                                |
| `readme` | [`readme.md`](./rules/readme.md)                                                                                          |
| `audit`  | All of the above, plus [`maintenance.md`](./rules/maintenance.md) for CI lint stack guidance.                             |

When invoked from a non-interactive caller (`autonomous-workflow` Phase 5) — passed as `--auto` — also load [`auto-update-loop.md`](./rules/auto-update-loop.md).
That rule adds four non-negotiable gates (hot-path budget, recurrence threshold ≥ 2, removed-rules ledger, optional ablation) plus the JSON run-summary contract the caller logs.

---

## Mode: `init` — bootstrap docs from scratch

Use when a project has no Claude configuration and (optionally) no documentation.
Produces a tiered setup sized to the project's complexity.

### Phases

1. **Detect existing config.** Check for `CLAUDE.md`, `.claude/`, `AGENTS.md`,
   `README.md`, `docs/`. If any exist, ask via `AskUserQuestion`:
   **Overwrite** / **Merge missing** / **Skip / Abort**.
2. **Triage complexity.** Count source files, directories, monorepo
   packages, CI/CD presence. See [`references/archetypes.md`](./references/archetypes.md)
   for the small / medium / large thresholds and the per-tier file matrix.
3. **Detect tech stack.** Package manager (pnpm / npm / yarn / bun / poetry /
   cargo / go.mod), test framework, linters, monorepo signal (`nx.json`,
   `turbo.json`, `pnpm-workspace.yaml`).
4. **Scaffold the tier's files.** Use `templates/claude-md.md`,
   `templates/readme.md`, and the `docs/*` templates listed in
   [`rules/docs-folder.md`](./rules/docs-folder.md).
5. **Wire `.gitignore`.** Add `.claude/settings.local.json` idempotently.
6. **Summarize.** Print a table of created files with line counts and
   audience.

### Hard rules during `init`

- **Route by kind, not by file pattern.** Rules go to `CLAUDE.md` /
  `.claude/rules/`; narrative goes to `docs/`; marketing goes to `README.md`.
  See [`rules/content-routing.md`](./rules/content-routing.md).
- **CLAUDE.md ≤ 200 lines.** Anthropic's own threshold — beyond it,
  adherence drops measurably.
- **README first viewport must answer** *what is this, does it solve my
  problem, can I trust it?* See [`rules/readme.md`](./rules/readme.md) for the
  above-the-fold checklist.
- **Never duplicate** content between `CLAUDE.md`, `README.md`, and `docs/`.
  Pick one owner; link from the others.

---

## Mode: `update` — sync docs with the codebase

Use after work has landed on a branch.
Detects drift, applies targeted fixes, and pushes new rules to the innermost-ancestor destination so the hot path does not bloat over time.

### Argument parsing

| Argument          | Default | Effect                                                                                       |
| ----------------- | ------- | -------------------------------------------------------------------------------------------- |
| `branch`          | **yes** | Compare current branch vs the default branch. Default for `update`.                          |
| `recent [N]`      |         | Diff the last N commits (default 10).                                                        |
| `paths <glob>`    |         | Limit the diff to `<glob>`. The Placement Resolver still decides destinations.               |
| `nested <dir>`    |         | Route all updates for changes under `<dir>` to `<dir>/CLAUDE.md` (scaffold if missing).      |
| `pattern <glob>`  |         | Discovery-driven — scan files matching `<glob>` for shared structure, emit one rule.         |
| `holistic`        |         | Run `holistic-analysis refactor` on each affected area before drafting docs updates.         |
| `dry-run`         |         | Preview only. Print proposed changes; do not write.                                          |
| `all`             |         | Full audit against the current codebase (no diff). Equivalent to `audit` mode for sync only. |

### Phases

1. **Detect changes** (see `rules/drift-detection.md` §1 for `git diff`
   commands and the area-classification table).
2. **Read current docs** — every `CLAUDE.md`, `.claude/rules/*.md`,
   `docs/**/*.md`, `AGENTS.md`. Build a map of what's documented today.
3. **Drift analysis.** Run deterministic checks first (dead paths,
   removed commands, broken `@imports`); then semantic checks (architecture
   claims, style claims, stale gotchas). See [`rules/drift-detection.md`](./rules/drift-detection.md).
4. **Holistic analysis** (if `holistic` was passed) — see
   [`rules/drift-detection.md`](./rules/drift-detection.md) §4.
5. **Generate updates.** Each proposed change is classified by content
   kind, routed via [`content-routing.md`](./rules/content-routing.md), and
   placed via [`placement-resolver.md`](./rules/placement-resolver.md).
   Priority tiers: P0 stale fixes apply immediately; P1 new patterns ask
   for confirmation; P2 polish skips unless requested.
6. **Apply (or dry-run report).**
7. **Summarize.** Per-file table of changes plus a list of areas
   intentionally skipped because Claude can infer them.

### Sub-modes inside `update`

- `update nested <dir>` — see [`rules/placement-resolver.md`](./rules/placement-resolver.md) §4.
- `update pattern <glob>` — see [`rules/placement-resolver.md`](./rules/placement-resolver.md) §5.

---

## Mode: `readme` — write or audit a README

Use when the README is the asset under work.
Two sub-modes detected from context:

- **No README exists or user says "write a README"** → scaffold mode.
- **README exists and user says "audit / review / improve"** → audit mode.

### Scaffold sub-mode

1. Detect tech stack and project type (library / app / monorepo root /
   CLI tool).
2. Render `templates/readme.md` with the structure from the standard-readme
   spec — see [`rules/readme.md`](./rules/readme.md) for the mandatory section
   order and the badge selection rules.
3. Apply the **above-the-fold checklist** before declaring done — the
   first viewport must carry name, one-line tagline, hero visual or
   demo, primary CTA badges, and one install line.

### Audit sub-mode

1. Read the README.
2. Run the README audit rubric in [`rules/readme.md`](./rules/readme.md) §4.
   Score each item PASS / WARN / FAIL with one line of evidence.
3. End with a prioritized **Top 3 fixes** list — biggest reader-time
   wins first.

---

## Mode: `audit` — comprehensive documentation health check

Read-only by default.
Produces a structured report covering every doc surface.

### Phases

1. **Inventory.** List every documentation file across the repo.
2. **Per-surface audits**:
   - `CLAUDE.md` and `.claude/rules/` — see [`rules/claude-md.md`](./rules/claude-md.md) §5.
   - `README.md` and any per-package READMEs — see [`rules/readme.md`](./rules/readme.md) §4.
   - `docs/` tree — see [`rules/docs-folder.md`](./rules/docs-folder.md) §3.
3. **Drift checks** — full set from [`rules/drift-detection.md`](./rules/drift-detection.md) §3 (dead paths, removed commands, broken `@imports`, hot-path leakage).
4. **CI lint coverage** — see [`rules/maintenance.md`](./rules/maintenance.md) for the recommended `markdownlint` / Vale / alex / lychee stack.
5. **Prioritized report.** P0 (stale / wrong) → P1 (missing high-value content) → P2 (polish).

If the user asks to apply fixes, route to `update` mode with the audit findings as the input.

---

## Definition of Done

Each mode has a closing gate. Treat any unchecked item as a defect.

### `init`

- [ ] Tier picked and the per-tier files matrix matches the output.
- [ ] `CLAUDE.md` ≤ 200 lines.
- [ ] `README.md` first viewport (~600 px) carries name, tagline, hero,
      primary badges, install line.
- [ ] `docs/` tree (medium / large only) has `README.md`, `architecture.md`,
      `contributing.md`, and (large only) per-package nested folders.
- [ ] `.gitignore` contains `.claude/settings.local.json`.
- [ ] No content is duplicated across `CLAUDE.md`, `README.md`, and `docs/`.

### `update`

- [ ] Every P0 drift item from `drift-detection.md` §3 either fixed or
      explicitly skipped with reason.
- [ ] Every new rule placed via `placement-resolver.md` — no pattern-scoped
      rule landed in root `CLAUDE.md`.
- [ ] Every `@import` added resolves to a real file.
- [ ] No content moved into `docs/` while a duplicate remains in
      `CLAUDE.md` (or vice versa).
- [ ] Summary table delivered.

### `readme`

- [ ] All mandatory standard-readme sections present in correct order.
- [ ] Above-the-fold checklist passes.
- [ ] Badge count between 0 and 10, and every badge represents signal
      (build / version / license / coverage / security / contributors),
      not noise (stars / forks / "made with love").
- [ ] Every relative link resolves.

### `audit`

- [ ] Every file in the inventory has a row in the report (PASS / WARN /
      FAIL or N/A).
- [ ] Top 3 fixes list at the end, ordered by reader-time impact.
- [ ] No file mutations — `audit` is read-only.

---

## Core Principles

1. **Right surface, right cost.** `CLAUDE.md` is auto-loaded — every
   line is a recurring token cost. `README.md` is read once by humans
   evaluating the project. `docs/` is loaded on demand. Route by these
   costs, not by what feels natural to write.
2. **Innermost-wins.** Nested `CLAUDE.md` files load only when the agent
   is in that subtree. A rule about `packages/foo/**` placed in
   `packages/foo/CLAUDE.md` costs zero tokens for someone in
   `packages/bar/`. The same rule in root costs everyone, every turn.
3. **Be prescriptive, not descriptive.** Tell the agent what to do; do
   not explain concepts. Decision tables and numbered lists beat prose.
4. **Each document serves exactly one Diátaxis quadrant.** Tutorial *or*
   how-to *or* reference *or* explanation. If a doc serves two, split it.
5. **Never duplicate facts across surfaces.** Pick one owner; link from
   the others. Duplicates always drift.
6. **Test the docs by removal.** "Would removing this cause Claude or a
   reader to make a mistake?" If no, delete it.

---

## Anti-patterns (one-liner — full list in `rules/` per surface)

- `CLAUDE.md` over 200 lines (Anthropic's own threshold — adherence drops).
- Pattern-scoped rule placed in root `CLAUDE.md` instead of `.claude/rules/`
  with `paths:`.
- README wall-of-badges (>10 badges); TOC for a 60-line README.
- `docs/` files unreferenced from anywhere (orphans).
- Same fact written in `CLAUDE.md` *and* `docs/` — one will drift.
- Narrative paragraphs ("we picked X because Y, the system grew as Z…") in
  `CLAUDE.md` instead of `docs/`.
- Marketing prose ("blazingly fast," "simply," "easily") with no benchmark.
- README API reference dump — move to `docs/`.
- Backslash paths anywhere.
- Time-sensitive claims ("after August 2025…") in any surface.

---

## Cross-tool note: AGENTS.md

[`agents.md`](https://agents.md/) is the cross-tool open spec read by
Codex CLI, Cursor, Aider, Devin, GitHub Copilot, Gemini CLI, and others.
Claude Code reads `CLAUDE.md`, not `AGENTS.md` directly.

Two interop options:

- **Symlink** — `ln -s CLAUDE.md AGENTS.md` (simplest; one source of truth).
- **`@import`** — keep both files but have `CLAUDE.md` start with `@AGENTS.md` and put shared content in `AGENTS.md`.

For mixed-tool teams, prefer the symlink.
For Claude-Code-first teams with cross-tool readers as secondary, prefer the `@import`.
See [`rules/claude-md.md`](./rules/claude-md.md) §6 for the trade-offs.
