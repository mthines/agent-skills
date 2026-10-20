# Local development

Read this when you add, wire, or debug a skill, agent, plugin, or package in this repo.
The root [`CLAUDE.md`](../CLAUDE.md) keeps only the one-line rules; this file holds the explanation behind them.

## The symlink chain

The author's machine wires this repo into Claude Code through a two-tier symlink chain, so every edit to `skills/<category>/<name>/SKILL.md` is picked up live on the next turn — no `npx skills add` reinstall.

```text
~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <this repo>/skills/<category>/<name>
~/.claude/agents/<name>.md  →  ~/.agents/agents/<name>.md  →  <this repo>/agents/<name>.md
```

The installed-side paths stay flat (`~/.claude/skills/<name>`, `~/.agents/skills/<name>`) because that is how every Agent-Skills-compatible tool reads them.
Only the repo target is nested; the sync script walks `skills/` recursively to find every directory with a `SKILL.md`.

The middle layer (`~/.agents/skills/`) is the cross-tool discovery directory used by Codex, Cursor, OpenCode, and other Agent Skills-compatible clients, so one chain serves every tool.

## Add a skill or agent

1. Pick a category (`workflow/`, `quality/`, `delivery/`, `testing/`, `design/`, `analysis/`, `authoring/`) and create `skills/<category>/<name>/SKILL.md`.
2. Run `bash scripts/sync-symlinks.sh` to wire the two-tier chain for every new or missing skill and agent in one pass.
3. Add a one-line hook (≤ 300 chars) to the inventory in the root `CLAUDE.md` and an entry to `README.md`.
   Rules go in the skill's `rules/`, their rationale in its `references/`.

For an agent, write `agents/<name>.md` and rerun `bash scripts/sync-symlinks.sh`.

## `sync-symlinks.sh`

- Invoke it with `bash` (or `./scripts/sync-symlinks.sh`), not `sh`: it uses bash arrays and process substitution, which POSIX `sh` does not support.
- It is idempotent: it skips entries already linked correctly, repairs broken or wrong-target symlinks, and refuses to overwrite real files or directories.
- `--dry-run` (or `-n`) previews without applying.
- It does not prune: when a skill is deleted, remove its `~/.claude/skills/<name>` and `~/.agents/skills/<name>` links by hand.

### Skill-local installers

If a skill ships `skills/<category>/<name>/install.sh`, `sync-symlinks.sh` discovers it and runs `bash <path> --development --quiet` after the main symlink pass.
The installer must accept both flags, be idempotent, and write errors to stderr.
The reference implementation is `skills/workflow/autonomous-workflow/install.sh`.

### Naming files a skill installs by symlink

When a skill's `install.sh` symlinks a file verbatim into `~/.claude/agents/` or `~/.claude/rules/`, name the source after what it is:

- `<agent-name>.agent.md` for an agent (e.g. `aw-executor.agent.md` → installed as `aw-executor.md`).
- `<name>.rule.md` for a rule (e.g. `routing.rule.md`).

These are definitions, not fill-in templates — no substitution happens — and the `<name>.agent.md` form lets a repo search for the agent name land directly on the file.
Reserve `*.template.md` and plain `templates/*.md` for boilerplate a skill emits or fills in at runtime (e.g. `aw-create-plan`'s `plan.md`).

## Edit an existing skill

Edit `skills/<category>/<name>/SKILL.md` in this repo directly, never through the `~/.claude` or `~/.agents` symlinked path.
Writes through symlinks resolve correctly but make it ambiguous which checkout the change lands in, which matters when several worktrees exist.

## Verify a skill is wired up

```bash
readlink ~/.claude/skills/<name>     # → ~/.agents/skills/<name>
readlink ~/.agents/skills/<name>     # → <repo>/skills/<category>/<name>
readlink ~/.claude/agents/<name>.md  # → ~/.agents/agents/<name>.md   (agents only)
readlink ~/.agents/agents/<name>.md  # → <repo>/agents/<name>.md      (agents only)
```

All applicable hops must resolve; if one is missing, the harness does not see the skill or agent.

## Plugins

Plugins (Claude Code hook scripts plus a manifest) live in `plugins/<name>/` and need no build step.
They are distributed through `.claude-plugin/marketplace.json`; the marketplace name is `agent-skills-plugins`, installed with `claude plugin marketplace add mthines/agent-skills`.

### `agent-tasks-hooks`

Claude Code lifecycle hook plugin for the Agent Tasks VS Code extension; details in [`plugins/agent-tasks-hooks/README.md`](../plugins/agent-tasks-hooks/README.md).

- Registers `UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`, and `Notification` hooks.
- Emits NDJSON events to `${CLAUDE_PLUGIN_DATA}/events/<sessionId>.ndjson` from `bin/emit-event.js` (Node.js, always exits 0, 40 ms hard cap).
- Every emitted event carries `schemaVersion: 1`; the extension rejects a known `schemaVersion` that is not `1` and accepts a missing one for backwards compatibility.
- The sentinel file `${CLAUDE_PLUGIN_DATA}/sentinel` controls activation.
- Validate with `claude plugin validate plugins/agent-tasks-hooks`.

### `pr-reviewer-shape-guard`

Reusable GitHub Actions workflow that validates a posted `pr-reviewer` body against the report shape contract from outside the agent.
Logic lives in `scripts/validate-report-shape.mjs`; L1 `G26` guards it.
Details: [`plugins/pr-reviewer-shape-guard/README.md`](../plugins/pr-reviewer-shape-guard/README.md).

### `pr-relevance-memory`

Caller template that wires PR comment-resolution signals into the `reviewer-comment-relevance` LoreKit bucket via `.github/workflows/reviewer-comment-relevance.yml`.
It requires the `LOREKIT_API_KEY` secret.
Details: [`plugins/pr-relevance-memory/README.md`](../plugins/pr-relevance-memory/README.md).

## Packages (Nx workspace)

Packages (buildable code) live in `packages/` and follow the Nx pattern; today that is only `packages/vscode-agent-tasks/`.
It uses Nx 22.4 and pnpm 10.13, and Nx versions follow `gw-tools.git` for cross-repo familiarity.
Commands, architecture, and internals are in [`packages/vscode-agent-tasks/CLAUDE.md`](../packages/vscode-agent-tasks/CLAUDE.md).
Adding a package also requires updating the root `tsconfig.json` references and the `nx.json` release config.

## Evals

The eval harness and how to run each layer: [`scripts/eval/README.md`](../scripts/eval/README.md).
The frozen annotated description with past run history is [`docs/evals.md`](./evals.md); read it, never append to it.
