---
title: Frontmatter — Field Reference and Validation
impact: HIGH
tags:
  - frontmatter
  - yaml
  - validation
---

# Frontmatter

Every `SKILL.md` starts with YAML frontmatter between `---` markers. The
frontmatter is **the only part of the file that is always loaded into
context** at session start (the `name` and `description` are pre-loaded into
the system prompt). Treat it like a public API.

## Contents

- Required and recommended fields
- Portability profile
- Validation checklist
- Boilerplate (single-file skill)
- Boilerplate (slash-command skill)
- Boilerplate (workflow companion)
- Common mistakes

## Required and recommended fields

| Field                      | Required    | Constraints                                                                                                                                          |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Recommended | ≤ 64 chars, matches `^[a-z0-9]+(-[a-z0-9]+)*$` (no leading, trailing, or doubled hyphen), no XML tags (a bare `<placeholder>` is fine in Claude Code; the Skills API upload rejects any `<`/`>`, which `--portable` enforces), no reserved words (`anthropic`, `claude`) when uploading to the Skills API — a substring match, so `--portable` fails on them and default mode only warns. Falls back to the directory name. |
| `description`              | Recommended | ≤ 1024 chars, non-empty, no XML tags (a bare `<placeholder>` is fine in Claude Code; the Skills API upload rejects any `<`/`>`, which `--portable` enforces). Third-person. Front-load triggers. Falls back to the first paragraph of body if omitted.                       |
| `when_to_use`              | Optional    | Extra trigger context. Appended to `description`; combined cap is 1,536 chars in the skill listing.                                                  |
| `argument-hint`            | Required*   | Autocomplete hint shown in the `/` menu. **Required** unless `user-invocable: false`. Mirror the skill's actual modes / flags. Use `[…]` for optional, `<…>` for placeholders, `\|` for alternatives. Examples: `[plan\|review\|simplify]`, `<pr-url> [--publish]`, `[--mode static\|mutate] [<paths>]`. |
| `arguments`                | Optional    | Named positional args for `$name` substitution. Space-separated string or YAML list.                                                                 |
| `disable-model-invocation` | Optional    | `true` → only the user can invoke (slash-only). Also stops the skill from being preloaded into subagents and from being offered for scheduled-task use. Default `false`.       |
| `user-invocable`           | Optional    | `false` → hidden from the `/` menu. Use for background-knowledge skills. Default `true`.                                                             |
| `allowed-tools`            | Optional    | Tools Claude may call without a permission prompt while this skill is active. Space-separated or YAML list.                                          |
| `disallowed-tools`         | Optional    | Tools removed from the active set while this skill is active — a real restriction, unlike `allowed-tools`, which only pre-approves. Clears on the next user message. Cannot remove `EndConversation` on its own. |
| `model`                    | Optional    | Override the active model for this skill's turn (`opus`, `sonnet`, `haiku`, or `inherit`).                                                            |
| `effort`                   | Optional    | `low` / `medium` / `high` / `xhigh` / `max`. Available levels depend on the model.                                                                   |
| `context`                  | Optional    | `fork` runs the skill in a forked subagent context (no conversation history).                                                                        |
| `agent`                    | Optional    | When `context: fork`, picks the subagent type (`Explore`, `Plan`, `general-purpose`, or a custom `.claude/agents/<name>`).                            |
| `background`               | Optional    | Only meaningful with `context: fork`. `true` (default) runs the forked skill without blocking the conversation. Claude still waits on it when running non-interactively (`-p`), when `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` is set, when the same skill is already running, or inside a scheduled task — and the forked context gets a narrower tool set and can edit files outside normal checkpoints. |
| `hooks`                    | Optional    | Hooks scoped to this skill's lifecycle.                                                                                                              |
| `paths`                    | Optional    | Glob patterns that limit when the skill auto-loads. Comma-separated string or YAML list.                                                              |
| `shell`                    | Optional    | `bash` (default) or `powershell` for `` !`<cmd>` `` injection.                                                                                       |
| `license`                  | Optional    | Project convention. This repo uses `MIT`.                                                                                                             |
| `compatibility`            | Optional    | ≤ 500 chars. Spec field describing runtime/model compatibility notes for consumers outside Claude Code (e.g. the Skills API, claude.ai upload). Claude Code itself ignores it. |
| `metadata`                 | Optional    | Free-form. This repo uses `metadata.author`, `metadata.version`, `metadata.workflow_type`, `metadata.tags`. The Agent Skills spec defines `metadata` values as string-to-string only — this repo's list-valued `metadata.tags` is a Claude-Code-only extension. |

Boolean fields (`disable-model-invocation`, `user-invocable`, `background`,
…) accept `yes` / `no`, `on` / `off`, `1` / `0`, or `true` / `false`.

## Portability profile

A skill meant to run outside Claude Code — uploaded to claude.ai, served
through the Skills API, or packaged with `package_skill.py` — is validated
against a **six-field** frontmatter: `name`, `description`, `license`,
`compatibility`, `metadata`, `allowed-tools`.
Every other field documented above (`disable-model-invocation`,
`user-invocable`, `disallowed-tools`, `model`, `effort`, `context`, `agent`,
`background`, `hooks`, `paths`, `shell`, `argument-hint`, `arguments`) is a
Claude Code extension and is a **hard error** on that path:

```text
Unexpected key(s) in SKILL.md frontmatter
```

**Rule:** decide the skill's target runtime during Phase 0 —
`claude-code` (default) or `portable` — and record the answer.
For a `portable` target, validate with
`node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir> --portable`
and keep the frontmatter to the six spec fields only.

## Validation checklist

Before writing, run every check:

- [ ] `name` matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is ≤ 64 chars.
- [ ] `name` does not contain `anthropic` or `claude` — the portable-target rule.
      The Skills API rejects such a `name`; `--portable` FAILs it and default mode
      only warns.
- [ ] `name` matches the directory name.
- [ ] `description` is ≤ 1024 chars.
- [ ] `description` starts with a third-person verb (e.g. "Reviews",
      "Generates", "Detects"), not "I" or "You".
- [ ] `description` lists 3–8 explicit trigger phrases the user might type.
- [ ] If `disable-model-invocation: true`, the description still mentions
      the slash form (e.g. `"/<name>"`) so the user can find it.
- [ ] `argument-hint` is set unless `user-invocable: false`. It mirrors the
      skill's actual modes / flags and uses `[…]` for optional, `<…>` for
      placeholders, `|` for alternatives. If the skill takes no
      arguments, emit `argument-hint: ''` explicitly rather than omitting.
- [ ] `metadata.tags` includes 5–10 specific tags (no `tools` / `helper`).
- [ ] No XML tag inside `description` or `name` — a bare `<placeholder>` is fine
      in Claude Code, but the Skills API upload rejects any `<`/`>`, which
      `--portable` enforces.

## Boilerplate (single-file skill)

```yaml
---
name: <kebab-case-name>
description: >
  <Third-person verb> <what it does>. Use when <when to use>. Triggers on
  "<phrase 1>", "<phrase 2>", "<phrase 3>", "/<name>".
argument-hint: '[<mode-a>|<mode-b>] [<positional>]'
license: MIT
metadata:
  author: <handle>
  version: '1.0.0'
  workflow_type: <advisory | applied | orchestrator | scaffolder | slash-command>
  tags:
    - <tag-1>
    - <tag-2>
---
```

## Boilerplate (slash-command skill)

```yaml
---
name: <kebab-case-name>
description: >
  <Third-person verb> <what it does>. Triggers on "<phrase 1>", "<phrase 2>",
  "/<name>".
disable-model-invocation: true
argument-hint: '[<mode-a>|<mode-b>] [--flag] [<positional>]'
allowed-tools: Bash(git *) Read Edit
metadata:
  author: <handle>
  version: '1.0.0'
  workflow_type: slash-command
  tags:
    - <tag-1>
---
```

## Boilerplate (workflow companion — `disable-model-invocation: true` and
called by an orchestrator via `Skill()`)

```yaml
---
name: <kebab-case-name>
description: >
  <Third-person verb> <what it does>. Called by <orchestrator> via Skill().
  Not user-facing.
disable-model-invocation: true
user-invocable: false
metadata:
  author: <handle>
  version: '1.0.0'
  workflow_type: companion
  tags:
    - companion
---
```

## Common mistakes

- **First-person voice.** "I help you …" causes discovery problems because
  the description is injected into the system prompt. Always third-person.
- **Vague description.** "Helps with files" tells Claude nothing. Name the
  artefact and the action.
- **Forgotten trigger phrases.** A skill the user calls by slash still
  benefits from triggers — Claude uses the description to suggest the
  command.
- **Reserved words in `name` (portable target).** The Skills API rejects a
  `name` containing `anthropic` or `claude` anywhere (`claude-tools`,
  `optimize-claude-md`). Claude Code accepts them; the validator FAILs only
  under `--portable` and warns otherwise.
- **Mismatched name and directory.** The directory is the source of truth
  for invocation; the `name:` field should match.
- **Missing `argument-hint`.** A user-invocable skill without one forces
  the user to read the full description to discover its modes / flags.
  Always emit one (unless `user-invocable: false`); for skills with no
  arguments, emit `argument-hint: ''` explicitly so the omission is
  intentional, not forgotten.
