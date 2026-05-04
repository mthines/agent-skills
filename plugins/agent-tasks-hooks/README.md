# agent-tasks-hooks

A Claude Code plugin that emits privacy-safe lifecycle hook events for the
[Agent Tasks](https://github.com/mthines/agent-skills/tree/main/packages/vscode-agent-tasks)
VS Code extension. Hook events drive sub-second session-state transitions in
the Sessions panel — replacing a 15-second polling tick with immediate updates
at natural lifecycle boundaries.

## What it does

Registers five Claude Code lifecycle hooks:

| Hook | Session panel transition |
|------|--------------------------|
| `UserPromptSubmit` | → `running` |
| `Stop` | → `needs-input` |
| `SessionStart` | → `running` |
| `SessionEnd` | → `idle` |
| `Notification` | refresh (no state change) |

Each hook fires `bin/emit-event.js`, which writes a single NDJSON line to
`${CLAUDE_PLUGIN_DATA}/events/<sessionId>.ndjson`. The VS Code extension's
`HookEventWatcher` watches that directory and feeds events into
`SessionsProvider` as an override layer on top of the existing JSONL polling
fallback.

## Privacy guarantees

The hook script emits **only** `{event, sessionId, cwd, ts}`. It never reads
or emits:
- Prompt content
- Response or transcript content
- Tool call inputs or outputs
- Any field beyond the four listed above

## Installation

The Agent Tasks VS Code extension handles installation automatically on first
activation (with a consent modal). To install manually:

```bash
claude plugin marketplace add mthines/agent-skills --scope user
claude plugin install agent-tasks-hooks@agent-skills-plugins --scope user
```

## Opt-out

Toggle `agentTasks.hooks.enabled` to `false` in VS Code Settings
(**Preferences: Open Settings (UI)** → search "Agent Tasks"). This deletes
the sentinel file so the hook script silently no-ops on every subsequent
invocation — the plugin stays installed but produces no output.

To fully uninstall:

```bash
claude plugin uninstall agent-tasks-hooks@agent-skills-plugins --scope user
```

## Sentinel-file mechanism

The hook script checks for a sentinel file at
`${CLAUDE_PLUGIN_DATA}/sentinel` before doing any work. The VS Code extension
writes this file when the `agentTasks.hooks.enabled` setting is `true`. If the
sentinel is absent (extension not installed, extension uninstalled, or opt-out
toggled), the script exits 0 immediately — making an orphaned plugin
completely harmless.

## Safety

- The hook script **always exits 0**. `UserPromptSubmit` and `Stop` hooks can
  block Claude on non-zero exit; this script will never do that.
- Execution is hard-capped at ~50ms. If reading stdin or writing the event
  file takes longer than 40ms, the script skips the write and exits 0.
- All I/O is wrapped in `try/catch`. Disk full, permission errors, and
  malformed stdin are all handled silently.

## JSONL polling fallback

The existing JSONL-based session polling in the Agent Tasks extension remains
fully functional when this plugin is not installed or when `agentTasks.hooks.enabled`
is `false`. Hooks are an augmentation layer, not a replacement.
