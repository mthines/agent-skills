---
title: Quality Checklist — Pre-Publish Self-Check
impact: HIGH
tags:
  - quality
  - checklist
  - review
---

# Quality Checklist

Run every item before declaring a skill done. Each `[ ]` is binary — pass
or fail, no "mostly". Treat unchecked items as defects.

Use this list in two ways:

- **Scaffold mode** — final phase of `create-skill`'s scaffold workflow.
- **Review mode** — applied to an existing skill to produce a report.

## Frontmatter

- [ ] `name` matches `^[a-z0-9][a-z0-9-]{0,63}$`.
- [ ] `name` does not contain `anthropic` or `claude`.
- [ ] `name` matches the directory name.
- [ ] `description` is non-empty and ≤ 1024 chars.
- [ ] `description` opens with a third-person verb (`Reviews`, `Generates`,
      `Detects`, `Scaffolds`, …).
- [ ] `description` includes both **what** the skill does and **when** to
      use it.
- [ ] `description` lists 3–8 explicit trigger phrases (the slash form
      counts as one).
- [ ] No XML tags inside `name` or `description`.
- [ ] `metadata.tags` lists 5–10 specific tags (avoid `tools`, `helper`).
- [ ] `disable-model-invocation` is set explicitly (true or false), not
      omitted, when invocation control matters.
- [ ] `allowed-tools`, if present, is the minimum set the skill needs.
- [ ] If `paths:` is set, the globs match the actual files the skill cares
      about.

## `SKILL.md` body

- [ ] ≤ 500 lines (the hard cap).
- [ ] Soft target ≤ 250 lines for advisory/orchestrator skills.
- [ ] No throat-clearing prose ("It's important to note that…").
- [ ] No definitions of common concepts Claude already knows (PR, branch,
      function, …).
- [ ] No time-sensitive claims ("after August 2025 …").
- [ ] Consistent terminology — one term per concept across the file.
- [ ] One sentence per line (semantic line breaks).
- [ ] All code fences declare a language identifier.
- [ ] Forward slashes in paths.
- [ ] Inline links use Markdown syntax, not HTML.
- [ ] If multi-mode: a clear "Mode Detection" section near the top.
- [ ] If multi-phase: a workflow checklist with explicit gates.

## Progressive disclosure

- [ ] Every `rules/*.md` is linked directly from `SKILL.md` (one level
      deep).
- [ ] Every `references/*.md` is linked directly from `SKILL.md`.
- [ ] No reference chain `SKILL.md` → `a.md` → `b.md` → `c.md`.
- [ ] Every file > 100 lines has a `## Contents` (or `## Table of
      contents`) at the top.
- [ ] Each `rules/*.md` is self-contained: an agent can load it in
      isolation and execute the rule.

## Tone, voice, and audience

- [ ] Third-person voice in `description`.
- [ ] Imperative voice in instructions ("Read the function", not "You
      should read the function").
- [ ] Prescriptive, not descriptive — tells the agent what to do, doesn't
      explain concepts.
- [ ] Decisions are enumerable (numbered steps, decision tables, lookup
      tables).
- [ ] Subjective conditions are replaced with concrete, testable criteria.

## Examples and templates

- [ ] Every actionable rule has at least one code example (good pattern).
- [ ] Where mistakes are common, a paired bad example is shown.
- [ ] Templates in `templates/*.md` are literal text only — no commentary.

## Repository conventions (this repo only)

- [ ] Skill directory is `skills/<name>/`.
- [ ] If using local-dev, both symlinks resolve:
      `~/.claude/skills/<name>` → `~/.agents/skills/<name>` →
      `<repo>/skills/<name>`.
- [ ] An entry exists in the `CLAUDE.md` inventory.
- [ ] An entry exists in the `README.md` table.
- [ ] An entry exists in the `Repository Structure` tree at the bottom of
      `README.md`.

## Reporting

When invoked in `review` mode, format the result as:

```
Skill: <name>
SKILL.md: <line count>/500 lines
Rules: <count> files; largest <N> lines
References: <count> files; longest <N> lines
Templates: <count> files

Frontmatter: <PASS|FAIL> — <evidence>
Body length: <PASS|FAIL>
Description: <PASS|FAIL>
Progressive disclosure: <PASS|FAIL>
Voice/tone: <PASS|FAIL>
Repo conventions: <PASS|FAIL>

Top 3 fixes:
1. ...
2. ...
3. ...
```

When invoked in `scaffold` mode, format the result as:

```
Self-check: PASS (<n>/<n>)
```

or, on failure:

```
Self-check: FAIL — fix these:
- [ ] <item> (evidence: <line / file>)
- [ ] <item> (evidence: <line / file>)
```
