---
title: Repository Conventions — agent-skills.git
impact: HIGH
tags:
  - repository
  - symlinks
  - inventory
  - install
---

# Repository Conventions

Conventions specific to **this** repo (`agent-skills.git`). Skip this rule
if the user is publishing the skill to a different repo.

## Where the skill lives

```
skills/<category>/<name>/SKILL.md
```

Skills live under `skills/`, nested one level inside a category directory.
The seven categories are `workflow/`, `quality/`, `delivery/`, `testing/`, `design/`, `analysis/`, and `authoring/`.
Pick the category that matches the skill's job; do not create new categories without updating the root `CLAUDE.md` inventory structure.
Agents (specialised sub-processes with their own model + tool config) live under `agents/`. Everything else
(`packages/`, `plugins/`) is package code, not a skill.

## The two-tier symlink chain (local development)

The author's machine wires this repo into the harness via two symlinks per
skill:

```
~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <this repo>/skills/<category>/<name>
```

The installed-side paths stay **flat** (`~/.claude/skills/<name>`, `~/.agents/skills/<name>`) because that is how every Agent-Skills-compatible tool reads them; only the repo target is category-nested.
The middle layer (`~/.agents/skills/`) is the cross-tool discovery
directory used by Codex, Cursor, OpenCode, and other Agent Skills-
compatible clients. One chain serves every tool.

### Wire a new skill

Run the repo's sync script from the repo root — do not create the symlinks by hand:

```bash
bash scripts/sync-symlinks.sh
```

The script walks `skills/` recursively for every directory with a `SKILL.md` (and `agents/` for agents), and wires the full two-tier chain for anything new or missing in one pass.
It is idempotent: it skips entries already linked correctly, repairs broken or wrong-target symlinks, and refuses to overwrite real files or directories.
Pass `--dry-run` (or `-n`) to preview without applying.
Invoke it with `bash` (or `./scripts/sync-symlinks.sh`), **not** `sh` — it uses bash arrays and process substitution.

### Verify

```bash
readlink ~/.claude/skills/<name>     # → ~/.agents/skills/<name>
readlink ~/.agents/skills/<name>     # → <repo>/skills/<category>/<name>
```

Both must resolve. If either is missing, the harness will not see the
skill.

## Editing convention

Always edit at `skills/<category>/<name>/SKILL.md` directly — never via the symlinked
path under `~/.claude/` or `~/.agents/`. Writes through symlinks resolve
correctly but make it ambiguous which checkout the change lands in (this
matters when multiple worktrees exist).

## Inventory updates

Two files list every skill. Update both when adding, renaming, or removing
a skill.

### `CLAUDE.md` (project instructions)

The repo-root `CLAUDE.md` has an inventory under `## Repository Structure`,
grouped by category subsection (`### \`workflow/\``, `### \`quality/\``,
`### \`delivery/\``, `### \`testing/\``, `### \`design/\``,
`### \`analysis/\``, `### \`authoring/\``, plus `### Agents`).
Add the skill to its category's subsection with the correct type marker:
`auto` (model-invokable via `Skill()`), `/` (slash command only), or
`Skill()` (called by other skills, no model invocation).

Each entry is a single bullet:

```markdown
- `<name>` (`auto` | `/` | `Skill()`) — One-line third-person description
  matching the SKILL.md description.
```

### `README.md` (user-facing)

The repo-root `README.md` has three places to update:

1. **The skills table** under "Slash commands" (or whichever section
   matches the invocation type). Add a row:

   ```markdown
   | **[/<name>](./skills/<category>/<name>/SKILL.md)** | One-line description matching SKILL.md. |
   ```

2. **The Repository Structure tree** at the bottom of the README. Add a
   line:

   ```text
     <category>/<name>/  SKILL.md + rules/                   (slash command)
   ```

3. **(Optional)** the slash-command listing under "Quick start" if the
   skill is user-facing.

## Plugin marketplace

This repo also distributes skills via the Claude Code plugin marketplace
(`.claude-plugin/marketplace.json`). New skills are picked up
automatically — no manual edit needed unless the marketplace metadata
changes.

## License and metadata

Default values for new skills in this repo:

```yaml
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: <advisory | applied | orchestrator | scaffolder | slash-command | companion>
```

`metadata.workflow_type` is a free-form repo convention. Use it
consistently:

- `advisory` — read-only review skill (`code-quality`, `dx`, `ux`).
- `applied` — writes code (`tdd`, `implement-suggestion`).
- `orchestrator` — calls other skills (`autonomous-workflow`,
  `batch-linear-tickets`).
- `scaffolder` — generates new artefacts (`documentation`, `create-skill`).
- `slash-command` — slash-only single-purpose tool (`create-pr`,
  `ci-auto-fix`).
- `companion` — workflow companion called by an orchestrator
  (`aw-create-plan`, `aw-create-walkthrough`).

## Prose rules (also in repo-root `CLAUDE.md`)

- One sentence per line (semantic line breaks).
- Inline Markdown links.
- Code fences with a language identifier.
- Sentences end with full stops.
- Oxford comma.
