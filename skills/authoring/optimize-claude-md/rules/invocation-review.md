---
title: Invocation Review — Slash-Conversion Candidates
impact: HIGH
tags:
  - invocation
  - slash-command
  - baseline-cost
  - context-budget
---

# Invocation Review

A second optimization lever beyond trimming inventory entries: converting an **agent-invokable** skill (default) to **slash-only** (`disable-model-invocation: true`) removes its `description` from the always-on available-skills list. Zero baseline context cost until the user types `/<name>`.

> The **canonical decision authority** for the invocation flags is
> [`create-skill/rules/invocation-control.md`](../../create-skill/rules/invocation-control.md).
> This rule does not duplicate that matrix — it provides a procedure for
> reviewing **existing** skills against it as part of a CLAUDE.md
> optimization run.

## When to run

Run during `audit` Phase 2.5 (between classification and mode-specific output). Skip if the repo does not own `skills/<name>/SKILL.md` files (the lens only applies to skills the user can re-configure).

## What the lens evaluates

For each skill in `skills/<name>/SKILL.md` whose frontmatter does **not** set `disable-model-invocation: true`:

1. Read the skill's `description` length.
2. Classify against the decision matrix below.
3. If it's a candidate, emit a suggestion with the estimated baseline saving.

## Decision table

Map each skill to one of four invocation outcomes:

| Signal                                                                                  | Outcome              | Action                                                                                    |
| --------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| Side-effectful action (push, deploy, send message, open PR)                             | **slash-only**       | Recommend `disable-model-invocation: true`.                                               |
| Workflow companion called only by another skill via `Skill()`                           | **slash-only + hidden** | Recommend `disable-model-invocation: true` **and** `user-invocable: false`.            |
| Used rarely (< 1× per project on average), invoked by user when needed                  | **slash-only**       | Recommend `disable-model-invocation: true`.                                               |
| Verbose `description` (> 800 chars) but used infrequently                                | **slash-only**       | Recommend `disable-model-invocation: true`. Big baseline win.                              |
| Advisory / composable skill the model should auto-invoke on relevant phrases (`tdd`, `code-quality`, `ux`, `dx`, `holistic-analysis`) | **leave**            | No change.                                                                                |
| Skill with a `paths:` glob that scopes auto-load to specific files                       | **leave**            | No change — `paths:` already minimizes the trigger surface.                                |
| Background knowledge the model applies silently, no user-facing command                  | **hidden**           | Recommend `user-invocable: false` (keep model invocation).                                 |

## Heuristics for "rarely used"

The skill cannot read invocation telemetry. Use proxies:

| Proxy                                                                              | Treat as rare?           |
| ---------------------------------------------------------------------------------- | ------------------------ |
| Skill's `description` already says "use when you …" (explicit user-driven trigger) | **yes**                  |
| Skill is a workflow companion (called via `Skill()` from one orchestrator)          | **yes**                  |
| Skill has `slash command` in its `workflow_type` tag or `CLAUDE.md` placement       | **already slash-only**   |
| Skill is listed under root `CLAUDE.md`'s "Agent-invokable skills" section           | **review case-by-case**  |
| Skill matches the every-task profile (build/test/lint/PR/review patterns)           | **no — leave as default** |

## Procedure

For each agent-invokable skill in `skills/`:

1. `Read` `skills/<name>/SKILL.md`, parse frontmatter only (lines between first `---` and second `---`).
2. Capture `description` length, `metadata.workflow_type`, `metadata.tags`.
3. Walk the decision table. Pick one outcome per skill.
4. Build a candidate row with these columns:

| Skill                | Current             | Recommended            | Why                              | Baseline saving estimate     |
| -------------------- | ------------------- | ---------------------- | -------------------------------- | ---------------------------- |
| `<name>`             | agent-invokable     | slash-only             | <one-line reason>                | ~<n> tokens per session      |

5. Sort candidates by baseline saving, descending.
6. Add the table to the audit report under "Invocation control candidates".

## Baseline saving estimate

The metric to maximize is **tokens saved from the always-on available-skills list**.

Approximation: `tokens ≈ chars(description) / 4`. Be honest that this is approximate.

Show the running total at the bottom of the candidate table:

```
Total estimated baseline savings: ~3,200 tokens / session
```

## Output integration

The lens emits **suggestions**, not edits. The skill does not modify any `SKILL.md` frontmatter.

For each candidate, surface a routing instruction:

```
To apply: /create-skill review <skill-name> --convert-to-slash
(or edit `skills/<name>/SKILL.md` frontmatter directly and re-run `scripts/sync-symlinks.sh`)
```

If the user accepts the conversion via `/create-skill`, they should also:

- Move the skill's row in root `CLAUDE.md` from "Agent-invokable skills" to "Slash commands".
- Verify the README table notes the slash form.

Both of those are CLAUDE.md edits that fall under this skill's mandate — offer to do them in `trim` mode after the user confirms the conversion landed.

## Refusal and edge cases

- **Skill already `disable-model-invocation: true`** — skip, no suggestion.
- **Skill has `user-invocable: false`** (background knowledge) — skip, this is intentional.
- **Skill is in `agents/` not `skills/`** — agents don't use these flags. Skip.
- **Cannot parse frontmatter** — log a warning, do not block the audit.

## Authority boundary

This rule **never edits** another skill's `SKILL.md` frontmatter — that violates [`hard-rules.md`](./hard-rules.md). It flags candidates and routes the user to `/create-skill`.

## Examples

### Good — high-baseline-savings candidate

```
| `video-analyser`    | agent-invokable | slash-only | Side-effectful (downloads, transcribes); user-driven trigger only | ~70 tokens / session |
```

### Good — leave-as-default

```
| `tdd`               | agent-invokable | leave      | Composable; model auto-loads on "write tests"/"add coverage" | — |
```

### Bad — recommending conversion of a frequently-needed skill

If `code-quality` were flagged as a slash-conversion candidate, the agent would lose the ability to auto-apply it during cross-cutting reviews. **Fix:** leave default for advisory skills the model legitimately auto-invokes.

## Common mistakes

- **Confusing `disable-model-invocation` with `user-invocable`**. They control different axes — see [`create-skill/rules/invocation-control.md`](../../create-skill/rules/invocation-control.md).
- **Recommending conversion based on description length alone.** Length matters, but a verbose-description skill that the model legitimately auto-invokes (e.g. `autonomous-workflow`) must stay default. **Fix:** the "rarely used" axis trumps length.
- **Forgetting the CLAUDE.md inventory move.** After conversion, the entry should move sections. **Fix:** offer the inventory move as a follow-up trim.
- **Editing the target skill's frontmatter directly.** Forbidden. **Fix:** route to `/create-skill`.
