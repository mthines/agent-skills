---
name: <kebab-case-name>
description: >
  <Third-person verb> <what it does>. Use when <when to use>. Triggers on
  "<phrase 1>", "<phrase 2>", "<phrase 3>".
license: MIT
compatibility: <optional — runtime/model notes for consumers outside Claude Code, ≤ 500 chars>
metadata:
  author: <handle>
  version: '1.0.0'
allowed-tools: <optional — space-separated tool names, if the target runtime honors this field>
---

# <Skill Title>

<One paragraph: what this skill produces / decides / changes. Lead with
the action, not the rationale.>

## Workflow

1. **<Step name>** — <action>. <Pass criterion>.
2. **<Step name>** — <action>. <Pass criterion>.
3. **<Step name>** — <action>. <Pass criterion>.

## Decision rules

| Signal                              | Action                                    |
| ----------------------------------- | ------------------------------------------ |
| <Specific, testable signal>         | <What to do>                              |
| <Specific, testable signal>         | <What to do>                              |

## Examples

### Good

```<lang>
<example>
```

### Bad — <one-line reason>

```<lang>
<counter-example>
```

## Anti-patterns (one-liners)

- <Anti-pattern 1>.
- <Anti-pattern 2>.
- <Anti-pattern 3>.

## Definition of done

- [ ] <Concrete, testable check>.
- [ ] <Concrete, testable check>.
- [ ] No field outside `name`, `description`, `license`, `compatibility`,
      `metadata`, `allowed-tools` — validated with
      `node skills/authoring/create-skill/scripts/validate-skill.mjs <dir> --portable`.
