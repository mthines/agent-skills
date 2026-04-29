# Agent Skills

## Audience

The skills and agents in this repository are consumed operationally by agentic frameworks (AI coding agents, copilots, and autonomous developer tools).
Every piece of guidance must be written so that an agent can act on it without human interpretation.

When writing or editing content, follow these principles:
- **Be prescriptive, not descriptive.**
  Tell the agent what to do, not explain concepts.
- **Make decisions enumerable.**
  Provide numbered decision processes, lookup tables, or explicit criteria.
- **Include code examples for every actionable rule.**
  Show both correct and incorrect patterns.
- **Avoid subjective conditions.**
  State concrete, testable criteria.
- **Keep rules self-contained.**
  Each file must make sense on its own.

## Repository Structure

Skills live in `skills/` as standard SKILL.md files.
Agents live in `agents/` since they require their own model and tool configuration.

### Auto-activated skills
- `confidence` — Confidence assessment for plans, code, and bug analysis
- `dx` — Developer Experience review for CLI tools and shell scripts
- `review-quality-gate` — Self-check quality gate for review findings before delivery
- `ux` — UX design review for web and React Native apps
- `holistic-analysis` — Full execution path analysis for stuck bugs/refactors
- `tdd` — Test-Driven Development with strict RED-GREEN-REFACTOR cycles

### Slash commands (`disable-model-invocation: true`)
- `init-claude` — Initialize Claude Code configuration for a project
- `update-claude` — Update CLAUDE.md and rules based on code changes
- `resolve-conflicts` — Analyze and resolve Git merge/rebase conflicts
- `review-changes` — Review branch changes or PR (dispatches to reviewer)
- `implement-suggestion` — Implement fixes from review comments
- `create-pr` — Generate a narrative PR description, push, then watch CI and auto-fix simple failures (lint, format, lockfiles); escalates judgment-required failures via `/confidence`
- `fix-github-action` — Diagnose and fix a failed GitHub Action check, iteratively pushing fixes until CI is green

### Agents
- `reviewer` — Constructive code reviewer with auto-fix, report, and PR comment modes

## Local Development

The author's machine has this repo wired into Claude Code via a two-tier symlink chain so every edit to `skills/<name>/SKILL.md` is picked up live on the next turn — no `npx skills add` reinstall.

```
~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <this repo>/skills/<name>
~/.agents/agents/<name>.md  →  <this repo>/agents/<name>.md
```

The middle layer (`~/.agents/skills/`) is the cross-tool discovery directory used by Codex, Cursor, OpenCode, and other Agent Skills-compatible clients, so a single chain serves every tool.

### Add a new skill

1. Create `skills/<name>/SKILL.md` in this repo.
2. Symlink it into the cross-tool dir: `ln -s "$REPO/skills/<name>" "$HOME/.agents/skills/<name>"`.
3. Symlink that into Claude's dir: `ln -s "$HOME/.agents/skills/<name>" "$HOME/.claude/skills/<name>"`.
4. Add an entry to the inventory in `CLAUDE.md` and `README.md`.

For agents, write `agents/<name>.md` in this repo and create one symlink: `ln -s "$REPO/agents/<name>.md" "$HOME/.agents/agents/<name>.md"`.

### Edit an existing skill

Edit the file at `skills/<name>/SKILL.md` in this repo directly — never through the `~/.claude` or `~/.agents` symlinked path. Writes through symlinks resolve correctly but make it ambiguous which checkout the change lands in, which matters when multiple worktrees exist.

### Verify a skill is wired up

```bash
readlink ~/.claude/skills/<name>     # → ~/.agents/skills/<name>
readlink ~/.agents/skills/<name>     # → <repo>/skills/<name>
```

Both must resolve. If either is missing, the harness will not see the skill.

## Prose Rules

- One sentence per line (semantic line breaks).
- Use inline Markdown links.
- Fence code with language identifier.
- End sentences with full stops.
- Use the Oxford comma.
