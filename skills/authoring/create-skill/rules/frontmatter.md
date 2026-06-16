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

## Required and recommended fields

| Field                      | Required    | Constraints                                                                                                                                          |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Recommended | ≤ 64 chars, lowercase letters / digits / hyphens only, no XML tags, no reserved words (`anthropic`, `claude`). Falls back to the directory name.     |
| `description`              | Recommended | ≤ 1024 chars, non-empty, no XML tags. Third-person. Front-load triggers. Falls back to the first paragraph of body if omitted.                       |
| `when_to_use`              | Optional    | Extra trigger context. Appended to `description`; combined cap is 1,536 chars in the skill listing.                                                  |
| `argument-hint`            | Required*   | Autocomplete hint shown in the `/` menu. **Required** unless `user-invocable: false`. Mirror the skill's actual modes / flags. Use `[…]` for optional, `<…>` for placeholders, `\|` for alternatives. Examples: `[plan\|review\|simplify]`, `<pr-url> [--publish]`, `[--mode static\|mutate] [<paths>]`. |
| `arguments`                | Optional    | Named positional args for `$name` substitution. Space-separated string or YAML list.                                                                 |
| `disable-model-invocation` | Optional    | `true` → only the user can invoke (slash-only). Default `false`.                                                                                     |
| `user-invocable`           | Optional    | `false` → hidden from the `/` menu. Use for background-knowledge skills. Default `true`.                                                             |
| `allowed-tools`            | Optional    | Tools Claude may call without a permission prompt while this skill is active. Space-separated or YAML list.                                          |
| `model`                    | Optional    | Override the active model for this skill's turn (`opus`, `sonnet`, `haiku`, or `inherit`).                                                            |
| `effort`                   | Optional    | `low` / `medium` / `high` / `xhigh` / `max`. Available levels depend on the model.                                                                   |
| `context`                  | Optional    | `fork` runs the skill in a forked subagent context (no conversation history).                                                                        |
| `agent`                    | Optional    | When `context: fork`, picks the subagent type (`Explore`, `Plan`, `general-purpose`, or a custom `.claude/agents/<name>`).                            |
| `hooks`                    | Optional    | Hooks scoped to this skill's lifecycle.                                                                                                              |
| `paths`                    | Optional    | Glob patterns that limit when the skill auto-loads. Comma-separated string or YAML list.                                                              |
| `shell`                    | Optional    | `bash` (default) or `powershell` for `` !`<cmd>` `` injection.                                                                                       |
| `license`                  | Optional    | Project convention. This repo uses `MIT`.                                                                                                             |
| `metadata`                 | Optional    | Free-form. This repo uses `metadata.author`, `metadata.version`, `metadata.workflow_type`, `metadata.tags`.                                            |

## Validation checklist

Before writing, run every check:

- [ ] `name` matches `^[a-z0-9][a-z0-9-]{0,63}$`.
- [ ] `name` does not contain `anthropic` or `claude`.
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
- [ ] No XML tags inside `description` or `name`.

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
- **Reserved words in `name`.** `claude-tools`, `anthropic-helper`, etc.
  are rejected.
- **Mismatched name and directory.** The directory is the source of truth
  for invocation; the `name:` field should match.
- **Missing `argument-hint`.** A user-invocable skill without one forces
  the user to read the full description to discover its modes / flags.
  Always emit one (unless `user-invocable: false`); for skills with no
  arguments, emit `argument-hint: ''` explicitly so the omission is
  intentional, not forgotten.
