---
title: '@playwright/mcp Tool Catalog'
impact: MEDIUM
tags:
  - playwright-mcp
  - tools
  - reference
  - browser-automation
---

# `@playwright/mcp` Tool Catalog

## Contents

- [Why this exists](#why-this-exists)
- [Tools by category](#tools-by-category)
- [Modes — snapshot vs vision](#modes--snapshot-vs-vision)
- [Persistent session strategies](#persistent-session-strategies)
- [Sources](#sources)

## Why this exists

The official `@playwright/mcp` server exposes **40+ tools**.
Knowing the catalog stops the agent from re-implementing browser actions
in `browser_run_code` when a typed tool already exists.

## Tools by category

### Navigation

| Tool                    | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `browser_navigate`      | Go to a URL.                                         |
| `browser_navigate_back` | History back.                                        |
| `browser_navigate_forward` | History forward.                                  |
| `browser_wait_for`      | Wait for a selector, URL, or load state.             |

### Interaction

| Tool                    | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `browser_click`         | Click by element ref id from the snapshot.          |
| `browser_type`          | Type into a focused input.                          |
| `browser_press_key`     | Keyboard key press (`Enter`, `Tab`, `Escape`).      |
| `browser_select_option` | Pick from a `<select>`.                             |
| `browser_drag`          | Drag-and-drop by source / target ref.               |
| `browser_hover`         | Hover an element.                                   |
| `browser_file_upload`   | Set files on an `<input type=file>`.                |

### Page analysis

| Tool                | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `browser_snapshot`  | Accessibility-tree snapshot. Returns ref ids per element. |
| `browser_screenshot`| Pixel screenshot. Snapshot mode usually does not need it. |
| `browser_console`   | Read console messages.                                   |
| `browser_network`   | Inspect requests / responses.                            |

### Storage and state

| Tool                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `browser_get_cookies` | Read cookies.                                        |
| `browser_set_cookies` | Set cookies.                                         |
| `browser_storage`     | Local / session storage read and write.              |
| `browser_save_state`  | Save `storageState.json`.                            |

### Tab management

| Tool                | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `browser_tab_list`  | List open tabs.                                      |
| `browser_tab_new`   | Open a tab.                                          |
| `browser_tab_close` | Close a tab.                                         |
| `browser_tab_select`| Switch to a tab by id.                               |

### Verification

| Tool                          | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `browser_verify_visible`      | Assert an element is visible.                        |
| `browser_verify_text`         | Assert text content.                                 |
| `browser_verify_url`          | Assert current URL.                                  |
| `browser_verify_console_clean`| Assert no console errors.                            |

### Devtools (opt-in via `--caps`)

| Tool                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `browser_trace_start` | Start a Playwright trace.                            |
| `browser_trace_stop`  | Stop and save a trace.                               |
| `browser_video`       | Record a video of the session.                       |
| `browser_pdf`         | Save the page as PDF (`--caps=pdf`).                 |

### Escape hatch

| Tool                | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `browser_run_code`  | Execute arbitrary Playwright script. Last resort.    |

Prefer typed tools.
Reach for `browser_run_code` only when no typed tool fits the action.

## Modes — snapshot vs vision

Snapshot mode (default) returns the accessibility tree.
Each element has a `ref` id; interaction tools take the `ref`.

Vision mode is opt-in:

```bash
npx @playwright/mcp --caps=vision
```

Vision tools accept pixel coordinates.
Use only when the assertion is pixel-shaped — see
[`rules/token-budget.md`](../rules/token-budget.md).

## Persistent session strategies

Three strategies the server supports:

1. **Persistent profile (default).**
   The browser data is stored locally per workspace.
   Sessions persist across MCP restarts.
2. **Isolated mode (`--isolated`).**
   Ephemeral sessions per run.
   Pair with `--storage-state path` to load saved auth.
3. **Shared context (`--shared-browser-context`).**
   One browser context shared across HTTP clients.

For agent-driven flows, the default plus a `storageState.json` produced by
`tests/seed.spec.ts` is the right setup.

## Sources

- [microsoft/playwright-mcp on GitHub](https://github.com/microsoft/playwright-mcp)
- [Playwright MCP getting started](https://playwright.dev/docs/getting-started-mcp)
