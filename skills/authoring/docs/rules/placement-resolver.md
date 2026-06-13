# Placement Resolver

[`content-routing.md`](./content-routing.md) decided the *kind* of destination
(`CLAUDE.md` / `.claude/rules/` / `docs/` / `README.md`). The Placement
Resolver picks the **specific file path** so each rule loads only when
relevant — no hot-path pollution.

## 1. Innermost-Wins Principle

Claude Code only loads a nested `CLAUDE.md` when the agent is operating
inside that subtree. A rule about `packages/foo/**` placed in
`packages/foo/CLAUDE.md` costs **zero tokens** for someone working in
`packages/bar/`. The same rule in root `CLAUDE.md` costs **everyone**
tokens every turn.

**Always push rules to the innermost ancestor that still covers the scope.**

## 2. Step 1 — Determine Scope

Inspect which files the rule would govern, then label the scope:

| Scope label | Definition                                                            | Example                          |
| ----------- | --------------------------------------------------------------------- | -------------------------------- |
| `repo-wide` | Rule applies anywhere in the repo                                     | "Use 2-space indentation"        |
| `subtree`   | All governed files live under a single directory                      | "Use Server Components in `packages/web/**`" |
| `pattern`   | Files matching a name / glob across multiple subtrees                 | "Every `**/bindings.ts` re-exports from `./types`" |
| `area`      | A small contiguous set of files in one subtree (treat as `subtree`)   | "API handlers in `src/api/**`"   |

## 3. Step 2 — Pick the Destination

| Scope                                            | Hot-path (rule / command / gotcha)                                                                                                                | Path-scoped rule                                                                            | Narrative / rationale                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `repo-wide`                                      | Root `CLAUDE.md`                                                                                                                                  | `.claude/rules/<topic>.md` (no `paths:`)                                                    | Root `docs/<topic>.md`                               |
| `subtree` with existing `<dir>/CLAUDE.md`        | `<dir>/CLAUDE.md`                                                                                                                                 | `<dir>/.claude/rules/<topic>.md` if exists, else root `.claude/rules/<topic>.md` with `paths: ["<dir>/**"]` | `<dir>/docs/<topic>.md` if nested docs exist, else root `docs/` |
| `subtree` without `<dir>/CLAUDE.md`              | **Ask the user before scaffolding `<dir>/CLAUDE.md`.** If declined → root `.claude/rules/<topic>.md` with `paths: ["<dir>/**"]`                   | Root `.claude/rules/<topic>.md` with `paths: ["<dir>/**"]`                                  | Root `docs/<topic>.md` + `@import` from nearest CLAUDE.md |
| `pattern` (cross-subtree)                        | **Never** root `CLAUDE.md`. Always `.claude/rules/<topic>.md` with `paths: ["<glob>"]`                                                            | Same                                                                                        | Root `docs/<topic>.md`                               |

## 4. Step 3 — Pre-Write Sanity Checks

Each check is binary. Failing any one blocks the write.

- **Innermost ancestor exists?** If a `CLAUDE.md` lives deeper than your
  chosen target and still covers the scope, prefer it.
- **Double coverage?** If the same rule already lives in root *and* a
  nested `CLAUDE.md`, the nested one wins — propose removing the root copy.
- **Pattern in root?** If a `pattern`-scoped rule was about to land in
  root `CLAUDE.md`, **reject** — move it to `.claude/rules/`. This is the
  load-bearing invariant; without it the skill regresses to the old
  root-centric behaviour.
- **Scaffolding a new file?** Confirm with the user. New `CLAUDE.md`
  files load on every turn for that subtree thereafter — non-trivial.

## 5. Sub-mode: `nested <dir>`

When the user runs `/docs update nested <dir>`, route every
update for changes under `<dir>` to `<dir>/CLAUDE.md` instead of root.

1. Verify `<dir>` exists and contains source code (not just docs or
   assets).
2. Check whether `<dir>/CLAUDE.md` already exists.
   - **Exists** — edit it. Do NOT also touch root `CLAUDE.md` for the
     same content.
   - **Missing** — ask the user via `AskUserQuestion` whether to
     scaffold one. If yes, render `templates/claude-md.md` sized for the
     subtree (Commands / Code Style / Architecture / Gotchas), tier-
     appropriate.
3. Run drift detection with `paths:` scoped to `<dir>/**`.
4. **Migration check** — if root `CLAUDE.md` already contains content
   that should belong here (a rule that names `<dir>` paths verbatim),
   propose moving it down and removing the root copy. Innermost wins.

## 6. Sub-mode: `pattern <glob>`

When the user runs `/docs update pattern <glob>`, switch from
diff-driven to discovery-driven. Use this when shared shape exists
across many files of the same name (`bindings.ts`, `route.ts`,
`*.test.ts`).

1. Resolve the glob to a file list. Hard cap at 50 files — if more, ask
   the user to narrow before continuing.
2. Read each matched file (sample, if the corpus is large enough that
   50 reads strain the context).
3. Extract recurring structural features:
   - Exports (named vs default; types vs values)
   - File-internal ordering (imports → types → schema → handlers → exports)
   - Naming conventions (camelCase / PascalCase / specific suffixes)
   - Recurring imports or dependencies
   - Common pitfalls visible in the corpus
4. Check `.claude/rules/` for any existing rule whose `paths:` already
   covers `<glob>`. If one exists, propose an edit; otherwise propose a
   new file `.claude/rules/<topic>.md`.
5. The proposed rule **must** use `paths: ["<glob>"]` (sequence form)
   and **must not** live in root `CLAUDE.md` — that defeats the point of
   a pattern rule.

## 7. Cookbook — Glob Recipes for `paths:`

`.claude/rules/<topic>.md` files use a YAML `paths:` sequence to declare
which files the rule covers. The glob syntax matches standard
gitignore-style patterns: `**` matches any number of directories, `*`
matches any segment within a name, brace expansion (`{a,b}`) selects
alternatives.

> **Frontmatter compatibility note.** Anthropic's documented schema is
> `paths:` as a YAML sequence of quoted globs ([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)).
> Some Claude Code versions have known bugs where YAML-list `paths:`
> matches silently fail ([claude-code#17204](https://github.com/anthropics/claude-code/issues/17204),
> [#13905](https://github.com/anthropics/claude-code/issues/13905),
> [#16299](https://github.com/anthropics/claude-code/issues/16299)).
> If a rule fails to load, fall back to the Cursor-style comma-separated
> `globs:` field (no quotes) as documented in the bug-tracker workarounds:
>
> ```yaml
> ---
> # Documented Anthropic syntax (preferred — emit this by default)
> paths:
>   - "**/bindings.ts"
> ---
> ```
>
> ```yaml
> ---
> # Fallback if paths: silently fails (community workaround)
> globs: **/bindings.ts, **/urlState/**
> ---
> ```
>
> Verify rule load after writing via `/memory` or the `InstructionsLoaded`
> hook — see [`drift-detection.md`](./drift-detection.md) §3.7.

### 7.1 Rule fires when **any file named X** is touched (anywhere in the repo)

Use `**/<filename>` — the leading `**/` makes it match at any depth.

```yaml
---
description: Conventions for bindings.ts files
paths:
  - "**/bindings.ts"
---
```

This fires when the agent reads or edits:

- `src/api/users/bindings.ts` ✅
- `packages/web/src/state/bindings.ts` ✅
- `apps/mobile/store/bindings.ts` ✅
- `src/api/users/bindings-helpers.ts` ❌ (does not match)

To cover both `bindings.ts` and `bindings.test.ts`, use brace expansion:

```yaml
paths:
  - "**/bindings.{ts,test.ts}"
```

Or list both globs:

```yaml
paths:
  - "**/bindings.ts"
  - "**/bindings.test.ts"
```

### 7.2 Rule fires when working **inside any directory named X** (anywhere in the repo)

Use `**/<dirname>/**` — `**` on both sides so it matches at any depth
and pulls in every file inside.

```yaml
---
description: URL state management conventions
paths:
  - "**/urlState/**"
---
```

This fires for every file under any `urlState/` directory, including:

- `src/features/dashboard/urlState/index.ts` ✅
- `packages/web/src/urlState/parser.ts` ✅
- `packages/web/src/urlState/__tests__/parser.test.ts` ✅
- `src/features/dashboard/urlState.ts` ❌ (file, not directory)

If you also want the rule to fire when a `urlState.ts` *file* is touched
(not just files in `urlState/` directories), combine both:

```yaml
paths:
  - "**/urlState/**"
  - "**/urlState.ts"
```

### 7.3 Rule fires when **a specific filename appears inside a specific directory shape**

Combine directory and filename globs:

```yaml
---
description: Bindings inside urlState dirs only
paths:
  - "**/urlState/**/bindings.ts"
---
```

Fires for `packages/web/src/urlState/bindings.ts` ✅ but **not** for
`packages/web/src/api/bindings.ts` ❌.

### 7.4 Rule fires for **multiple unrelated patterns** (the union)

`paths:` is a sequence — every entry contributes. The rule fires if **any**
entry matches.

```yaml
---
description: State-management conventions across stores and url state
paths:
  - "**/urlState/**"
  - "**/store/**"
  - "**/*.store.ts"
---
```

### 7.5 Anti-patterns — globs that look right but go wrong

| Glob                  | Why it's wrong                                              | Use instead         |
| --------------------- | ----------------------------------------------------------- | ------------------- |
| `bindings.ts`         | No `**/` prefix; only matches `bindings.ts` at the repo root | `**/bindings.ts`    |
| `urlState/**`         | No leading `**/`; only matches the top-level `urlState/` dir | `**/urlState/**`    |
| `src/**/bindings.ts`  | Only matches inside `src/`; misses `packages/`, `apps/`     | `**/bindings.ts`    |
| `**/urlState`         | Matches the directory itself but **not** files inside it    | `**/urlState/**`    |
| `**/*.ts`             | Matches every TypeScript file — defeats the point of path scoping | Be specific  |

### 7.6 Verify a glob before committing the rule

```bash
# Resolve the glob from the repo root and inspect what matches.
find . -path './node_modules' -prune -o -type f -name 'bindings.ts' -print | head -20
```

For directory globs, list directories with that name:

```bash
find . -path './node_modules' -prune -o -type d -name 'urlState' -print | head -20
```

If the result list is empty, the rule is dead — fix the glob or remove
the rule.

## 8. AGENTS.md placement

For cross-tool agent compatibility, place `AGENTS.md` files at the **same
scopes** as `CLAUDE.md` (root, subtree). Nesting rules differ slightly:

- Claude Code **concatenates** broader and narrower `CLAUDE.md` files.
- Most other tools read the **nearest** `AGENTS.md` (walking up).

This means `AGENTS.md` nesting can be more aggressive without bloating
cross-tool context. See [`claude-md.md`](./claude-md.md) §6 for the
symlink-vs-`@import` trade-off.

## 9. Worked example — pattern rule routing

A user runs `/docs update pattern "**/bindings.ts"` and the
skill discovers that every `bindings.ts` re-exports from `./types`. The
Placement Resolver:

1. Scope = `pattern` (cross-subtree).
2. Destination = `.claude/rules/bindings.md` (never root).
3. Frontmatter:

   ```yaml
   ---
   description: Conventions for bindings.ts files
   paths:
     - "**/bindings.ts"
   ---
   ```

4. Body (kept tight):

   ```markdown
   # bindings.ts

   - Every `bindings.ts` re-exports its types from `./types`.
   - Schema validators live alongside the binding, not in a shared schemas/ folder.
   - Tests sit next to the binding as `bindings.test.ts`.
   ```

5. Hot-path cost on a turn that never touches `bindings.ts`: **zero**.
   Compare to placing the same rule in root `CLAUDE.md`: every turn,
   every developer, every session.
