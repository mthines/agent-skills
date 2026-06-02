---
title: Classification — Hot-path vs Cold-path Content
impact: HIGH
tags:
  - classification
  - hot-path
  - cold-path
  - bloat-patterns
---

# Classification

Every line in `CLAUDE.md` is either **hot-path** (must stay loaded on every session) or **cold-path** (can move to a linked file and load on demand). Phase 2 labels every section.

## Decision table

| Signal                                                                       | Class            | Action                                  |
| ---------------------------------------------------------------------------- | ---------------- | --------------------------------------- |
| Project commands an agent runs on every task (`pnpm test`, `nx build`)       | **hot-path**     | Keep verbatim.                          |
| Hard invariants ("never run X", "always Y before Z")                         | **hot-path**     | Keep verbatim.                          |
| File pointers for the active codebase (key source files)                     | **hot-path**     | Keep, terse.                            |
| Prose rules the agent must apply (e.g. "one sentence per line")              | **hot-path**     | Keep, terse.                            |
| Skill / agent inventory ENTRY name + one-line purpose                        | **hot-path**     | Keep as one-liner.                      |
| Skill / agent inventory ENTRY description paragraph                          | **cold-path**    | Trim. Source of truth is the skill's own `SKILL.md`. |
| Design rationale ("we chose X because Y because Z")                          | **cold-path**    | Extract to a `.claude/rules/<topic>.md` or the skill's own `CLAUDE.md`. |
| Feature history / changelog narrative                                        | **cold-path**    | Extract to `docs/` or `CHANGELOG.md`.   |
| Examples of correct/incorrect patterns longer than ~10 lines                 | **cold-path**    | Extract to the rule file that owns the pattern. |
| Content that duplicates a skill's `description` frontmatter                  | **cold-path**    | Trim aggressively — frontmatter is preloaded. |
| Content that exists verbatim in a nested `CLAUDE.md`                         | **cold-path** (in the duplicate) | Keep one copy in the most-specific scope; delete from root. |
| Time-sensitive narrative ("as of 2026-05", "we just added X")                | **rot**          | Delete or rewrite as timeless rule.     |

## Borderline cases

| Case                                                                         | Default          | Override if                            |
| ---------------------------------------------------------------------------- | ---------------- | -------------------------------------- |
| Single skill / feature documented at length because the agent must call it on every task | **hot-path** | Most tasks don't touch it → cold-path. |
| `gh` / `git` command examples                                                | **hot-path**     | They're standard CLI usage → cold-path. |
| Workspace structure tree                                                     | **hot-path** if small (< 20 lines), **cold-path** if large | Always cold-path > 30 lines.  |

## Bloat patterns (the usual suspects)

Match these patterns when scanning. Each is documented with a worked example in [`../references/bloat-patterns.md`](../references/bloat-patterns.md).

| Pattern name                  | What it looks like                                                      | Fix                          |
| ----------------------------- | ----------------------------------------------------------------------- | ---------------------------- |
| **Description duplication**   | Inventory entry > 500 chars repeating the skill's `description:` field. | Trim to one-line hook + link. |
| **Mega-entry**                | One bullet > 1,500 chars with parenthetical sub-clauses.                | Trim to one-line hook + link to a section in the skill's own `SKILL.md`. |
| **Embedded rationale**        | "We chose X because Y because Z" prose in root.                         | Extract to `.claude/rules/<topic>.md`. |
| **Repeated tree**             | Workspace layout printed in two places.                                 | Keep one; link from the other. |
| **Inline examples**           | Multi-block code samples explaining a rule.                             | Move to the rule file; keep a one-line summary. |
| **Cross-domain mash-up**      | Two unrelated subjects in one root file (e.g. monorepo + plugin + prose rules). | Split nested-package content into nested `CLAUDE.md`. |
| **Decayed claim**             | "As of <date>" or "we just added" still loaded months later.            | Delete or convert to timeless rule. |
| **Restated harness rule**     | Repeats something the harness already enforces (e.g. "use the Read tool"). | Delete.                      |

## Examples

### Good — hot-path entry, one-liner

```markdown
- `fix-bug` — Single-bug pipeline. Intake → triage → repro → analyse → gate → handoff → verify. See [`skills/fix-bug/SKILL.md`](./skills/fix-bug/SKILL.md).
```

### Bad — duplicates the skill's own description

```markdown
- `fix-bug` — Single-bug counterpart to `batch-linear-tickets`. v2.1 ships
  an intake → complexity triage → evidence → preflight → reproduction-lock
  → analyse → gate → lane-split handoff → independent-verify →
  telemetry-verify pipeline (10 phases, one cross-cutting bug-notes ledger).
  Takes any starting evidence (Dash0 span / log / web event URL with UTC
  timezone compensation, raw stack trace, error message, code pointer
  `file:line`, Linear ticket URL via `linear-ticket-investigator`, screen
  recording via `/video-analyser`, free-text symptom). Phase 0 infers a
  `bugClass` … [continues for 3,500 chars]
```

The harness already loads the skill's full `description` frontmatter. The paragraph above costs ~900 tokens on every session.

## Common mistakes

- **Misclassifying a long inventory paragraph as hot-path** "because the agent might need the detail." **Fix:** the detail is one Read away. The one-line hook is enough.
- **Extracting a hard invariant.** Invariants like "never bypass hooks" must stay. **Fix:** if you cannot tell, leave it in hot-path.
- **Treating "we use Nx" as cold-path.** Build/test commands are hot-path because the agent runs them. **Fix:** keep the command block; trim the surrounding prose.
- **Deleting time-sensitive narrative without checking if it encodes a rule.** Some "as of <date>" lines hide a real constraint. **Fix:** convert to a timeless rule, do not just delete.
