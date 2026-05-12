---
title: Playwright CLI — Iteration Loop
impact: HIGH
tags:
  - storybook
  - playwright
  - cli
  - iteration
  - storage-state
---

# Playwright CLI

The iteration loop uses Playwright's CLI directly against the running
Storybook URL.
It is **not** the test runner (`npm run test-storybook` /
`storybook test`) — that one is for CI.
Playwright CLI is for the agent's "did this story render at all"
check, and for capturing intermediate screenshots while a play
function is being debugged.

## Prerequisites

- Storybook is running locally (or is reachable on a network URL).
- Playwright is installed (`npx playwright --version` returns a
  version).
  If not, halt and ask permission to install:
  `npm i -D @playwright/test && npx playwright install`.
- If the URL is auth-gated, a `storageState.json` from
  [`rules/auth.md`](./auth.md) is on disk.

## Story URL shape

Storybook serves each story at a deterministic URL.
Pick the form that matches the workflow step:

| URL                                                                            | Use when                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `http://localhost:6006/?path=/story/<id>--<variant>`                            | A human is going to look — full Storybook chrome.         |
| `http://localhost:6006/iframe.html?id=<id>--<variant>&viewMode=story`           | Headless screenshot or `<canvas>` content only.           |
| `http://localhost:6006/iframe.html?id=<id>--<variant>&viewMode=story&args=…`    | Override `args` on the fly (`Playground` story tuning).   |

The `<id>` is the lower-kebab form of `meta.title`.
Example: `"Components/Button"` + story `Default` →
`components-button--default`.

## Commands

### Headless screenshot — deterministic

```bash
npx playwright screenshot \
  --browser=chromium \
  --viewport-size=1280,720 \
  --color-scheme=light \
  --full-page \
  --wait-for-timeout=500 \
  "http://localhost:6006/iframe.html?id=components-button--default&viewMode=story" \
  .agent/storybook/.snapshots/button-default.png
```

The four determinism flags are non-negotiable:

| Flag                          | Why                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `--viewport-size=1280,720`    | Storybook defaults vary by builder; lock it so a baseline taken locally matches CI.        |
| `--color-scheme=light`        | Many themes flip on `prefers-color-scheme`. Lock to light unless the story is dark-only.   |
| `--wait-for-timeout=500`      | Lets fonts settle. Cheaper than a full `networkidle` wait, and Storybook is already local. |
| `--full-page` (or omit)       | Pick one and stick with it across the loop — switching mid-run invalidates baselines.      |

Add `--storage-state=<path>` if the URL is auth-gated.

### Live, headed iteration (debug)

```bash
npx playwright open \
  --browser=chromium \
  "http://localhost:6006/iframe.html?id=components-button--default&viewMode=story"
```

This is the fastest way to confirm a brand-new story renders and to
read the Storybook Actions panel for `fn()` spy output.
Never run headed in CI — it requires a display server.

### Record selectors

```bash
npx playwright codegen \
  --browser=chromium \
  "http://localhost:6006/iframe.html?id=components-form--playground&viewMode=story"
```

`codegen` produces selector candidates as the user clicks.
Walk those candidates through the locator ladder in
[`rules/interaction-tests.md`](./interaction-tests.md) — codegen often
picks brittle CSS paths that should be replaced with `getByRole` etc.

## Iteration loop

The agent runs this loop while iterating on a play function:

1. **Detect the script name** before spawning Storybook. Many repos
   use `dev`, `storybook:dev`, `sb`, or a workspace-scoped command:
   ```bash
   jq -r '.scripts | to_entries[] | select(.value | test("storybook (dev|start)|start-storybook|storybook$")) | .key' package.json
   ```
   If the query returns nothing, halt and ask the user for the right
   script name — do not guess.
2. Start Storybook in the background using the detected script
   (`$STORYBOOK_SCRIPT`):
   `nohup npm run "$STORYBOOK_SCRIPT" >/tmp/storybook.log 2>&1 &`.
3. Wait for the dev URL to come up
   (`curl -fsSL http://localhost:6006/iframe.html >/dev/null` returns 0).
   Cap the wait at 60 seconds; tail `/tmp/storybook.log` and surface
   the error on timeout.
4. Edit the `.test.stories.tsx` file.
5. Take a screenshot via Playwright CLI.
6. Inspect the screenshot; on failure, fix the locator or the source.
7. Re-run.

Cap the loop at **two iterations** before escalating.
If the story still does not render after the second round, invoke
`confidence(bug-analysis)` instead of running a third — a third
round almost always means the premise (selector, story id, auth) is
wrong, not the implementation.

### Iteration ergonomics

Save each iteration to its own path so the user can scrub the loop
after the fact:

```text
.agent/storybook/.snapshots/iteration-1/<story-id>.png
.agent/storybook/.snapshots/iteration-2/<story-id>.png
```

After each iteration, log one line stating what changed since the
previous screenshot — selector, source diff, args override. The
screenshot alone is not the evidence; the screenshot **plus the diff
hypothesis** is. Without the hypothesis, a third round of "try
again" is indistinguishable from a fourth.

### Flake-source checklist (run before iterating)

The three biggest flake sources in Storybook iteration are CSS
animations, dynamic content, and theme drift.
Eliminate each at Phase 0 — they cost nothing to set up and prevent
hours of false-positive screenshot diffs.
Copy-paste snippets for each fix live in
[`references/flake-cookbook.md`](../references/flake-cookbook.md);
load it only when at least one story has flaked or the user asked
for deterministic snapshots.

| Source              | Fix                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| CSS animations      | `parameters: { chromatic: { pauseAnimationAtEnd: true } }` and add a global decorator that disables CSS transitions during tests (`* { animation: none !important; transition: none !important }`). |
| Font loading        | Add a global decorator that awaits `document.fonts.ready` before rendering the story.            |
| Dynamic timestamps  | Wrap `new Date()` callers in a clock mock — `mockdate` set to a fixed ISO string in `preview.tsx`. |
| Theme flip          | Lock `--color-scheme=light` (above) and pin the theme decorator to a single value during tests.  |
| Random IDs          | Pin `Math.random` via a deterministic seed in `preview.tsx` if the component uses it transitively.|

## Snapshot mode vs vision

Playwright CLI's `screenshot` command renders pixels — that is its
job.
For interaction verification (does clicking X call Y?), do not bother
with screenshots; the Storybook test runner asserts on the canvas DOM,
which is cheaper and more reliable than diffing pixels.

Use screenshots only when:

- The user explicitly asked for a visual diff.
- A reviewer agent or PR needs evidence.
- A motion / transition test cannot be captured statically — in which
  case use [`screen-recorder`](../../screen-recorder/SKILL.md), not
  raw Playwright `screenshot`.

## Background process hygiene

The skill starts Storybook in the background to iterate quickly.
Track the PID and clean up on exit:

```bash
nohup npm run storybook >/tmp/storybook.log 2>&1 &
echo $! > /tmp/storybook.pid

# … iterate …

kill "$(cat /tmp/storybook.pid)" 2>/dev/null || true
rm -f /tmp/storybook.pid
```

Never leave Storybook running after the skill finishes.

## Validation checklist

- [ ] Playwright installed (do not install silently — ask).
- [ ] Storybook URL reachable before any Playwright call.
- [ ] If auth-gated, `--storage-state=<path>` is passed.
- [ ] Headed mode (`playwright open`) used only locally, never in CI.
- [ ] Screenshots, when produced, land under
      `.agent/storybook/.snapshots/` (and that directory is
      gitignored).
- [ ] Iteration loop capped at two rounds before escalation.
- [ ] Background Storybook process is killed before the skill exits.
