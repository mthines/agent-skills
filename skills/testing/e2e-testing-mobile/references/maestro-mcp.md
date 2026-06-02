---
title: Maestro MCP — Reference
impact: HIGH
tags:
  - maestro
  - mcp
  - claude
  - reference
  - flow-generation
  - heal-loop
---

# Maestro MCP — Reference

## Contents

- [What it is](#what-it-is)
- [Setup](#setup)
- [Tool surface](#tool-surface)
- [Invocation patterns](#invocation-patterns)
- [Comparison with `@playwright/mcp`](#comparison-with-playwrightmcp)
- [MaestroGPT and AI test analysis](#maestrogpt-and-ai-test-analysis)
- [Sources](#sources)

## What it is

Maestro MCP is the Model Context Protocol server that lets an agent
(Claude Code, Cursor, etc.) drive a Maestro session — list devices,
launch apps, query the on-screen accessibility tree, and emit or
patch flows — without leaving the chat.

It is the mobile counterpart to `@playwright/mcp`.
Same concept; different runtime.

Source-of-truth integration write-up:
[Very Good Ventures — Maestro MCP + Claude](https://verygood.ventures/blog/maestro-mcp-claude-mobile-ui-test-automation/).

## Setup

```jsonc
// .mcp.json (project-scoped, committable) or ~/.claude.json (user-scoped).
{
  "mcpServers": {
    "maestro": {
      "command": "npx",
      "args": ["-y", "@mobile-dev-inc/maestro-mcp@latest"]
    }
  }
}
```

After config, restart the agent harness so it picks up the MCP server.
Verify with the harness's MCP listing UI.

## Tool surface

Grouped by category.
Names follow the upstream MCP server; check the harness for the exact
namespacing in your environment.

### Device + app

| Tool                    | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `list_devices`          | List booted simulators / emulators / connected devices.    |
| `launch_app`            | Cold-start an installed app by `appId`.                     |
| `stop_app`              | Force-stop the app.                                         |
| `clear_state`           | Wipe app data on the booted device.                         |

### Inspection

| Tool                    | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `view_hierarchy`        | Return the OS accessibility tree of the current screen.      |
| `inspect_element`       | Return attributes for a single element by `testID` / text.   |
| `screenshot`            | Capture a screenshot (use sparingly — token cost).           |

### Action

| Tool                    | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `tap`                   | Tap an element by `id`, `text`, or anchor.                    |
| `input_text`            | Type into the focused field.                                  |
| `swipe`                 | Directional swipe.                                            |
| `scroll`                | Scroll within a scrollable.                                   |
| `press_key`             | Hardware-style key.                                           |
| `open_link`             | Open a deep link.                                             |

### Flow lifecycle

| Tool                    | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `run_flow`              | Execute a `.yaml` flow against the booted device.            |
| `lint_flow`             | Parse a flow and report syntax / lookup errors.               |
| `record_flow`           | Begin a Studio-style recorder session.                        |

The exact tool names and parameter shapes may shift release-to-release.
Always use the harness's tool listing as the source of truth at run
time, and treat this table as a discovery aid.

## Invocation patterns

These mirror the `Planner / Generator / Healer` shapes from
`@playwright/mcp` — same loop, different runner.

### Exploratory pass (analogous to Planner)

```
Use the maestro MCP. Boot the iOS simulator, launch com.example.fit,
walk through "start a workout from the home screen", and write a
Markdown spec to specs/workout/start-workout.md.
```

### Emit (analogous to Generator)

```
Use the maestro MCP. Read specs/workout/start-workout.md, walk the
flow on the booted simulator picking testID-first locators, and emit
.maestro/workout/start-workout.yaml.
```

### Heal (analogous to Healer)

```
Use the maestro MCP. The flow .maestro/workout/start-workout.yaml is
failing on the "tapOn id: start-workout" step. Inspect the current
view hierarchy, propose a fix or a testID source diff, and re-run.
```

The user reviews any source diff before it is applied — the
`testID` decision is owned by the source, not the test.

## Comparison with `@playwright/mcp`

| Concern                          | Playwright MCP                              | Maestro MCP                                 |
| -------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Target                           | Browser pages                               | iOS / Android apps                          |
| Tree                             | DOM accessibility tree                      | OS accessibility tree                       |
| Primary selector                 | `getByRole`                                 | `id:` (`testID`)                            |
| Build artefact                   | None — runs against a URL                   | `.app` / `.apk` from the EAS `e2e` profile  |
| Dominant cost                    | Per-step accessibility-tree snapshot        | Build minutes + Cloud minutes               |
| Healer cap                       | 3 attempts                                  | 3 attempts (same convention)                |

The two skills are orthogonal — use both in a hybrid app, sequentially.

## MaestroGPT and AI test analysis

In addition to the MCP server, Maestro ships two AI features
out-of-band:

- **MaestroGPT** — a hosted assistant trained on Maestro that emits
  flows from natural-language descriptions. Useful for one-off drafts;
  prefer the MCP loop for repeatable, repo-scoped work.
- **AI test analysis** — Maestro Cloud's failure-clustering view that
  groups runs by likely root cause. Read it before opening
  `confidence(analysis)` on a CI-only failure.

Neither is a replacement for the spec-first loop in this skill.

## Sources

- [Maestro MCP + Claude write-up — Very Good Ventures](https://verygood.ventures/blog/maestro-mcp-claude-mobile-ui-test-automation/)
- [Maestro AI test analysis](https://docs.maestro.dev/maestro-flows/workspace-management/ai-test-analysis)
- [Maestro on GitHub](https://github.com/mobile-dev-inc/Maestro)
