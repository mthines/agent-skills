---
name: <kebab-case-name>
description: >
  <Third-person verb> <what it does>. <Methodology / approach>. Use when
  <when to use>. Triggers on "<phrase 1>", "<phrase 2>", "<phrase 3>",
  "/<name>".
argument-hint: '[<mode-a>|<mode-b>] [<positional>]'
license: MIT
metadata:
  author: <handle>
  version: '1.0.0'
  workflow_type: <advisory | applied | orchestrator | scaffolder | slash-command | companion>
  tags:
    - <tag-1>
    - <tag-2>
    - <tag-3>
---

# <Skill Title>

<One paragraph: what this skill produces / decides / changes.>

> **This `SKILL.md` is a thin index.** Detailed rules live in
> `rules/*.md` and load on demand. Worked examples live in
> `references/*.md`.

---

## Mode Detection (only if multi-mode)

Parse `$ARGUMENTS` and detect the mode:

| Mode       | Default | Trigger                                |
| ---------- | ------- | -------------------------------------- |
| `<mode-1>` | yes     | <when this mode applies>               |
| `<mode-2>` |         | <when this mode applies>               |

## Workflow

| Phase | Name        | Rule file                                                    | Gate                  |
| ----- | ----------- | ------------------------------------------------------------ | --------------------- |
| 0     | <Name>      | [`rules/<name>.md`](./rules/<name>.md)                       | <Pass criterion>      |
| 1     | <Name>      | [`rules/<name>.md`](./rules/<name>.md)                       | <Pass criterion>      |
| 2     | <Name>      | [`rules/<name>.md`](./rules/<name>.md)                       | <Pass criterion>      |

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files                                                       |
| ----- | ----------------------------------------------------------- |
| 0     | [`rules/<name>.md`](./rules/<name>.md)                      |
| 1     | [`rules/<name>.md`](./rules/<name>.md)                      |
| 2     | [`rules/<name>.md`](./rules/<name>.md)                      |

## Core Principles

1. <Principle 1>.
2. <Principle 2>.
3. <Principle 3>.

## Anti-patterns (one-liners)

- <Anti-pattern 1>.
- <Anti-pattern 2>.
- <Anti-pattern 3>.

## Definition of Done

- [ ] <Check>.
- [ ] <Check>.
- [ ] <Check>.
