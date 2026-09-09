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

Each item is tagged `(mechanical: <id>)`, where `<id>` is the check id the
validator script reports, or `(judgment)` when no script can decide it.

## Contents

- Mechanical pre-pass
- Frontmatter
- `SKILL.md` body
- Progressive disclosure
- Tone, voice, and audience
- Examples and templates
- Runtime
- Testing
- Repository conventions (this repo only)
- Reporting

## Mechanical pre-pass

Run this before working through the judgment items by hand:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir> [--portable]
```

Every `(mechanical: <id>)` item below is answered by this script's output —
read its `FAIL`/`WARN` findings instead of re-deriving them manually. Only
the `(judgment)` items require the checklist below.

## Frontmatter

- [ ] `name` matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is ≤ 64 chars.
      (mechanical: FM02)
- [ ] `name` does not contain `anthropic` or `claude`; directory is not
      `synced`. (mechanical: FM03)
- [ ] `name` matches the directory name. (mechanical: FM04)
- [ ] `description` is non-empty and ≤ 1024 chars. (mechanical: FM05)
- [ ] `description` opens with a third-person verb (`Reviews`, `Generates`,
      `Detects`, `Scaffolds`, …). (mechanical: FM08)
- [ ] `description` includes both **what** the skill does and **when** to
      use it. (judgment)
- [ ] `description` lists 3–8 explicit trigger phrases (the slash form
      counts as one). (judgment)
- [ ] No XML tags inside `name` or `description`. (mechanical: FM07)
- [ ] `metadata.tags` lists 5–10 specific tags (avoid `tools`, `helper`).
      (judgment)
- [ ] `disable-model-invocation` is set explicitly (true or false), not
      omitted, when invocation control matters. (judgment)
- [ ] `argument-hint` is set unless `user-invocable: false`. Mirrors the
      skill's actual modes / flags; uses `[…]` for optional, `<…>` for
      placeholders, `|` for alternatives. If the skill takes no
      arguments, the empty string `''` is emitted explicitly.
      (mechanical: FM11)
- [ ] `allowed-tools`, if present, is the minimum set the skill needs.
      (judgment)
- [ ] If `paths:` is set, the globs match the actual files the skill cares
      about. (judgment)
- [ ] No unquoted plain scalar in frontmatter contains `: `.
      (mechanical: FM10)
- [ ] `metadata.version`, if present, is semver (`\d+\.\d+\.\d+`).
      (mechanical: FM14)
- [ ] If targeting `portable`, no field outside the six spec fields
      (`name description license compatibility metadata allowed-tools`).
      (mechanical: FM12, only with `--portable`)

## `SKILL.md` body

- [ ] ≤ 500 lines (the hard cap). (mechanical: BD01)
- [ ] Soft target ≤ 250 lines for advisory/orchestrator skills.
      (mechanical: BD02)
- [ ] No throat-clearing prose ("It's important to note that…").
      (judgment)
- [ ] No definitions of common concepts Claude already knows (PR, branch,
      function, …). (judgment)
- [ ] No time-sensitive claims ("after August 2025 …"). (mechanical: BD05)
- [ ] Consistent terminology — one term per concept across the file.
      (judgment)
- [ ] One sentence per line (semantic line breaks). (judgment)
- [ ] All code fences declare a language identifier. (mechanical: BD03)
- [ ] Forward slashes in paths. (mechanical: BD04)
- [ ] Inline links use Markdown syntax, not HTML. (judgment)
- [ ] If multi-mode: a clear "Mode Detection" section near the top.
      (judgment)
- [ ] If multi-phase: a workflow checklist with explicit gates. (judgment)

## Progressive disclosure

- [ ] Every `rules/*.md` is linked directly from `SKILL.md` (one level
      deep). (mechanical: PD01)
- [ ] Every `references/*.md` is linked directly from `SKILL.md`.
      (mechanical: PD01)
- [ ] No reference chain `SKILL.md` → `a.md` → `b.md` → `c.md`. (judgment)
- [ ] No dangling relative link in `SKILL.md`, `rules/`, `references/`.
      (mechanical: PD02)
- [ ] Every `references/*.md` > 100 lines and every `rules/*.md` > 150
      lines has a `## Contents` (or `## Table of contents`) at the top.
      (mechanical: PD03)
- [ ] Each `rules/*.md` is self-contained: an agent can load it in
      isolation and execute the rule. (judgment)
- [ ] `lens.md`, if present, is ≤ 80 lines and declares
      `for: pr-reviewer` + `lens-version: 1`. (mechanical: PD04)

## Tone, voice, and audience

- [ ] Third-person voice in `description`. (judgment)
- [ ] Imperative voice in instructions ("Read the function", not "You
      should read the function"). (judgment)
- [ ] Prescriptive, not descriptive — tells the agent what to do, doesn't
      explain concepts. (judgment)
- [ ] Decisions are enumerable (numbered steps, decision tables, lookup
      tables). (judgment)
- [ ] Subjective conditions are replaced with concrete, testable criteria.
      (judgment)

## Examples and templates

- [ ] Every actionable rule has at least one code example (good pattern).
      (judgment)
- [ ] Where mistakes are common, a paired bad example is shown. (judgment)
- [ ] Templates in `templates/*.md` are literal text only — no commentary.
      (judgment)

## Runtime

- [ ] String substitutions (`$ARGUMENTS`, `$0`/`$1`, named `$<arg>`,
      `${CLAUDE_*}`) are used correctly and the missing-argument case is
      handled. (judgment)
- [ ] Dynamic context injection commands (`` !`cmd` `` / ```` ```! ````)
      either exit 0 in the normal case or are guarded with `|| true` for
      an expected non-zero exit. (judgment)
- [ ] Bundled scripts are referenced through `${CLAUDE_SKILL_DIR}`, not a
      cwd-relative path. (mechanical: SC01, when `scripts/` exists)

## Testing

- [ ] At least 3 realistic test prompts written and run (baseline vs.
      with-skill). (judgment)
- [ ] `evals/triggers.jsonl` written for any `auto` skill (8–10
      should-trigger, 8–10 near-miss should-not-trigger). (judgment)
- [ ] Tested on every model the skill targets, or the user explicitly
      waived a tier. (judgment)
- [ ] The repo eval obligation (root `CLAUDE.md` § "Keeping the evals
      honest") has been checked and its outcome stated. (judgment)

## Repository conventions (this repo only)

- [ ] Skill directory is `skills/<category>/<name>/` (category one of
      `workflow`, `quality`, `delivery`, `testing`, `design`, `analysis`,
      `authoring`). (judgment)
- [ ] If using local-dev, `bash scripts/sync-symlinks.sh` has been run and
      both symlinks resolve:
      `~/.claude/skills/<name>` → `~/.agents/skills/<name>` →
      `<repo>/skills/<category>/<name>`. (judgment)
- [ ] An entry exists in the `CLAUDE.md` inventory. (judgment)
- [ ] An entry exists in the `README.md` table. (judgment)
- [ ] An entry exists in the `Repository Structure` tree at the bottom of
      `README.md`, if one exists for this category. (judgment)

## Reporting

When invoked in `review` mode, format the result as:

```text
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
Portability: <claude-code|portable>
Testing: <PASS|WARN|FAIL>

Top 3 fixes:
1. ...
2. ...
3. ...
```

When invoked in `scaffold` mode, format the result as:

```text
Self-check: PASS (<n>/<n>)
```

or, on failure:

```text
Self-check: FAIL — fix these:
- [ ] <item> (evidence: <line / file>)
- [ ] <item> (evidence: <line / file>)
```
