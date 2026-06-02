---
title: Bloat Patterns — Worked Examples
impact: MEDIUM
tags:
  - reference
  - examples
  - before-after
---

# Bloat Patterns

Worked examples for each pattern from [`../rules/classification.md`](../rules/classification.md). Load this file when you need to see a real before/after, or when pattern-matching against an unfamiliar `CLAUDE.md`.

## Contents

- Description duplication
- Mega-entry
- Embedded rationale
- Repeated tree
- Inline examples
- Cross-domain mash-up
- Decayed claim
- Restated harness rule

---

## Description duplication

The #1 win across most repos. The harness preloads each skill's `description:` frontmatter automatically. An inventory paragraph in `CLAUDE.md` that restates it pays the token cost on every session.

### Detection

For each inventory entry that names a `\`skill-name\`` in the first backticks:

1. Read `skills/<skill-name>/SKILL.md`.
2. Compare the inventory paragraph against the frontmatter `description:` field.
3. If lexical overlap > 70% (or both describe the same modes / phases / steps), flag.

### Before (3,582 chars — real example, `fix-bug` entry)

```markdown
- `fix-bug` — Single-bug counterpart to `batch-linear-tickets`. v2.1 ships
  an intake → complexity triage → evidence → preflight → reproduction-lock
  → analyse → gate → lane-split handoff → independent-verify →
  telemetry-verify pipeline (10 phases, one cross-cutting bug-notes ledger).
  Takes any starting evidence (Dash0 span / log / web event URL with UTC
  timezone compensation, raw stack trace, error message, code pointer
  `file:line`, Linear ticket URL via `linear-ticket-investigator`, screen
  recording via `/video-analyser`, free-text symptom). Phase 0 infers a
  `bugClass` (null-deref, race, off-by-one, contract-mismatch, perf,
  config, regression, logic). Phase 0.5 runs complexity triage on a 14-row
  signal table … [continues for 3,000+ more chars]
```

### After (142 chars)

```markdown
- `fix-bug` — Single-bug pipeline: intake → triage → repro → analyse → gate → handoff → verify. See [`skills/fix-bug/SKILL.md`](./skills/fix-bug/SKILL.md).
```

Saved: 3,440 chars / ~860 tokens — on every session, forever.

---

## Mega-entry

A single bullet > 1,500 chars with deeply nested parentheticals.

### Symptom

Reader can't parse the entry without re-reading twice. Internal acronyms, semicolons, and bracketed sub-clauses dominate.

### Before (1,873 chars — real example, `storybook` entry)

```markdown
- `storybook` — Scaffolds and tests Storybook stories for React (web) and
  React Native / Expo. Per invocation, emits three artefacts: a visual
  regression `*.stories.tsx` with all variants grouped into a single render
  tree (one snapshot per file under Chromatic / Loki), a `Playground` story
  whose `args` / `argTypes` mirror the component's prop types, and an
  interaction test `*.test.stories.tsx` under a `/Tests` namespace with
  `tags: ["test"]`, `chromatic.disableSnapshot`, awaited `userEvent` /
  `expect`, and the locator ladder `getByRole` → `getByLabelText` →
  `getByText` → `getByTestId`. Phase 0 preflight detects platform … [continues]
```

### After (155 chars)

```markdown
- `storybook` — Scaffolds + tests Storybook stories for React web and React Native / Expo. See [`skills/storybook/SKILL.md`](./skills/storybook/SKILL.md).
```

---

## Embedded rationale

Prose explaining **why** a decision was made. Useful as history, useless as instruction on every session.

### Symptom

Phrases like "we chose X because Y", "the reason this exists is …", "originally we tried X but switched to Y".

### Before

```markdown
## Why we use Nx 22.4 specifically

We pin Nx to 22.4 because our cross-repo familiarity comes from
`gw-tools.git` which is also on 22.4. Earlier we tried 21.x but the
release config didn't play well with our monorepo layout. The pnpm 10.13
choice follows similar reasoning …
```

### After

In `CLAUDE.md`:

```markdown
The `packages/vscode-agent-tasks/` package uses Nx 22.4 + pnpm 10.13.
```

The "why" lives in `docs/decisions/nx-version.md` (or just dies — `git log` and `git blame` will retrieve it if needed).

---

## Repeated tree

Workspace structure printed in two places (often once at top, once at bottom).

### Detection

`fd '^\#\#\#?.*[Ss]tructure'` and check for repeated tree blocks.

### Fix

Keep one. Link from the other.

---

## Inline examples

A correct/incorrect pattern with 10+ lines of code on each side, embedded in root `CLAUDE.md`.

### Before

```markdown
## Prose Rules

### Good

```markdown
This is a good paragraph.
It has one sentence per line.
```

### Bad

```markdown
This is a bad paragraph that spans multiple sentences on one line. Look at how hard it is to scan.
```
```

### After (in `CLAUDE.md`)

```markdown
## Prose Rules

- One sentence per line (semantic line breaks). See [`docs/prose-style.md`](./docs/prose-style.md) for examples.
```

The examples move to `docs/prose-style.md`.

---

## Cross-domain mash-up

Two unrelated subjects in one root file.

### Symptom

Root `CLAUDE.md` documents the monorepo, the VS Code extension, the plugin, AND the prose rules — each section feels like it belongs in a different home.

### Fix

Move per-package content to per-package `CLAUDE.md`:

```
packages/vscode-agent-tasks/CLAUDE.md   ← extension-specific
plugins/agent-tasks-hooks/CLAUDE.md     ← plugin-specific
.claude/rules/prose-style.md            ← cross-cutting prose rules
CLAUDE.md                                ← top-level orchestration only
```

The harness loads nested `CLAUDE.md` files when the agent navigates into that subtree, so per-package content is loaded **only when relevant**.

---

## Decayed claim

Time-sensitive narrative that has aged into noise.

### Symptom

Phrases like "as of 2026-05-01", "we just added", "currently we're migrating", "the new X replaces the old Y" — all of which require knowing **when** the file was last updated to interpret.

### Fix

- If it encodes a still-true rule → rewrite without the date.
- If it's pure history → delete (the commit log has it).
- If it's a migration in progress → move to `docs/migrations/<topic>.md` with an explicit deadline.

---

## Restated harness rule

The harness already enforces some rules. Restating them in `CLAUDE.md` costs tokens for nothing.

### Examples

- "Use the Read tool to read files." — harness already enforces.
- "Run tests before pushing." — varies; sometimes a real project rule, sometimes a generic restatement. Check.
- "Don't use emojis." — if the harness already loads this from system prompt, delete locally.

### Fix

Delete if the rule is harness-level. Keep if it's project-specific.
