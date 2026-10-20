# Setup

Read this for install options beyond the two-line clone, keeping a fork current, and per-project plug-ins.
The [root README](../README.md) has the short version.

## Install

Two ways in:

| Path | Stays current? | Customizable? | Best for |
| ---- | -------------- | ------------- | -------- |
| **Clone + symlink** (recommended) | Yes — `git pull` updates everything live | Yes — edit any skill in place | Living with these skills day to day |
| **`npx skills add`** | No — installs a frozen copy you re-fetch to update | No — edits are overwritten on re-fetch | A quick, no-clone trial — one skill or all |

### Recommended: clone + symlink

```bash
git clone https://github.com/mthines/agent-skills.git
cd agent-skills
bash scripts/sync-symlinks.sh
```

The script builds a two-tier symlink chain, so a single clone serves every Agent Skills–compatible tool:

```
~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <clone>/skills/<category>/<name>
~/.claude/agents/<name>.md  →  ~/.agents/agents/<name>.md  →  <clone>/agents/<name>.md
```

Because skills are symlinked, your edits and every `git pull` land on the **next agent turn** — no reinstall. The middle layer (`~/.agents/skills/`) is the cross-tool discovery directory other tools read. Run it with `bash`, not `sh`; pass `--dry-run` to preview.

Any skill that ships its own `install.sh` (currently only [`autonomous-workflow`](../skills/workflow/autonomous-workflow/), which links two `aw-` agents and a routing rule) auto-runs at the end of the sync — no separate step.

### Upgrading

```bash
cd agent-skills && git pull
bash scripts/sync-symlinks.sh   # link new skills/agents, prune deleted ones
```

`git pull` updates every symlinked skill in place. Re-run the sync script after a pull to link skills or agents that are **new** and to prune the dangling links a deleted or renamed one leaves behind (`--no-prune` to skip); already-correct links are left alone.

> **Coming from `npx skills add`?** That copy never tracks upstream — which is why upgrading felt hard. Delete the copied entries from `~/.claude/skills/` (and `~/.agents/skills/`), then switch to [clone + symlink](#recommended-clone--symlink). After that, `git pull` is the whole upgrade.

### Customize and still track upstream

To bend a skill to your own preferences **and** keep pulling new changes, fork and track this repo as `upstream`:

```bash
# Clone YOUR fork, then add this repo as upstream:
git clone https://github.com/<you>/agent-skills.git
cd agent-skills
git remote add upstream https://github.com/mthines/agent-skills.git
bash scripts/sync-symlinks.sh

# Edit any skill, commit to your fork, and pull new work anytime:
git pull upstream main
```

Customizations live on your fork; `git pull upstream main` merges in upstream changes. Keep edits scoped to the skills you actually change so merges stay clean.

### Quick try: `npx skills add`

A no-clone way to grab one skill or the whole collection. This installs a **frozen copy** — re-run to pick up changes; it does not track upstream.

> **Keep it tidy.** Always pass `--agent <your-tool>` (e.g. `--agent claude-code`). Without it, `npx skills` symlinks every skill into ~24 different AI-tool directories at once.

```bash
# One skill, Claude Code:
npx skills add https://github.com/mthines/agent-skills --skill confidence --agent claude-code --yes

# All skills, Claude Code:
npx skills add https://github.com/mthines/agent-skills --all --agent claude-code

# Universal — any Agent Skills tool:
npx skills add https://github.com/mthines/agent-skills --all
```

<details>
<summary>Other tools (Claude Code marketplace, Gemini, manual clone)</summary>

```bash
# Claude Code plugin marketplace:
/plugin marketplace add mthines/agent-skills
/plugin install mthines-agent-skills@mthines

# Gemini CLI:
gemini extensions install https://github.com/mthines/agent-skills

# Cursor / Copilot / Codex / manual — most tools auto-discover ~/.agents/skills/:
git clone https://github.com/mthines/agent-skills.git ~/.agents/skills/mthines-agent-skills
```

</details>

## Autonomous workflow (`aw`)

The [clone + symlink](#recommended-clone--symlink) install already links the `aw` dispatcher skill, the two `aw-` agents, and the routing rule — `sync-symlinks.sh` runs the dispatcher installer for you. If you used `npx skills add` instead, run the dispatcher installer manually (it places the `aw` dispatcher, which a plain skill install cannot reach — it is nested inside the autonomous-workflow skill):

```bash
bash ~/.claude/skills/autonomous-workflow/install.sh --global
```

Companions (`tdd`, `ux`, `docs`, `ci-auto-fix`, …) never block the workflow; an absent one is reported `skipped (not installed)` — see [Customizing](../skills/workflow/autonomous-workflow/README.md) to opt out individually. Drop `--global` for a per-project install. Requires [`gh`](https://cli.github.com); [`gw`](https://github.com/mthines/gw-tools) is optional (native `git worktree` fallback).

## VS Code extension

The [`vscode-agent-tasks`](../packages/vscode-agent-tasks/) package visualizes `plan.md`, `task.md`, and `walkthrough.md` in the VS Code sidebar — phase progress, decisions, blockers, and completed checkboxes update live as the agent works.

Install from the Marketplace by searching for **Agent Tasks** or:

```
mthines.agent-tasks
```

Default scan paths are `.agent/` and `.gw/`. Configure via `agentTasks.directories`. See [`packages/vscode-agent-tasks/README.md`](../packages/vscode-agent-tasks/README.md) for full docs.

For live session status in the panel, add the optional [`agent-tasks-hooks`](../plugins/agent-tasks-hooks/README.md) Claude Code plugin — it emits privacy-safe NDJSON lifecycle events the extension reads. It's only useful with the extension installed:

```
/plugin marketplace add mthines/agent-skills
/plugin install agent-tasks-hooks@agent-skills-plugins
```

## Domain navigator (per-project plug-in)

`/fix-bug` turns a Linear ticket into an Evidence Record in its own context ([Linear input](../skills/workflow/fix-bug/rules/evidence-resolution.md#linear-input)). Its accuracy depends on grounding in your project's structure.

It looks for context in this order:

1. Top-level `CLAUDE.md` / `AGENTS.md`.
2. Component-specific `CLAUDE.md` / `AGENTS.md` in directories the ticket points at.
3. A **domain-navigator skill**, auto-discovered by name.
4. Top-level `README.md` (fallback).

Steps 1, 2, and 4 work out of the box. Step 3 is the high-leverage customization for monorepos.

### Naming convention

`/fix-bug` scans its available-skills list at runtime for any skill whose name is:

- **exactly `domain-navigator`**, or
- **ending in `-domain-navigator`** — e.g. `dash0-domain-navigator`, `acme-domain-navigator`.

Any match is invoked automatically. No code changes, no registration.

### Starter template

Create `.claude/skills/<project>-domain-navigator/SKILL.md`:

```markdown
---
name: <project>-domain-navigator
description: >
  Maps Linear labels and ticket terminology to component directories in <project>.
  Surfaces cross-component dependencies. Use during investigation or planning.
user-invocable: true
---

# <Project> Domain Navigator

## Label → directory map

| Label | Component paths                       |
| ----- | ------------------------------------- |
| ui    | components/ui/, packages/web/         |
| api   | components/api/, packages/server/api/ |

## Cross-component dependencies

- `ui` calls `api` via `packages/web/src/client/`
- `api` reads from `db-migrator` schemas in `packages/db/`

## Where the docs live

- Architecture overview: `docs/architecture.md`
- API contract: `packages/server/api/openapi.yaml`
```

That is the entire integration.
