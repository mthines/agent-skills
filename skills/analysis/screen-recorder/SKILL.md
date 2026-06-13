---
name: screen-recorder
description: >
  Records short videos of specific page sections using Playwright's
  `recordVideo` API, plays scripted interactions (hover, click, focus,
  scroll, keypress), crops the output to a target element via `ffmpeg`,
  and saves a `.webm` (or `.mp4` / `.gif`) artifact to
  `.agent/recordings/`. Use when a still screenshot cannot prove the
  change — verifying a View Transition, a Motion `layout` morph, a hover
  stagger, a scroll-driven timeline, an `@starting-style` entry, or any
  multi-frame interaction. Called by the `animations` skill to validate
  a generated animation, by the `ux` skill to capture an interaction the
  reviewer cannot read from code, and by the `reviewer` agent to attach
  evidence to PR comments on motion-heavy diffs. Triggers on "record
  this interaction", "capture this animation", "video of this section",
  "validate the transition visually", "screen recording", "/screen-recorder".
disable-model-invocation: false
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - playwright
    - video
    - recording
    - animation-validation
    - ux-validation
    - visual-regression
    - ffmpeg
    - browser-automation
    - evidence
---

# Screen Recorder

Produces a short `.webm` clip of a specific page section so an agent —
or a reviewer reading a PR — can see motion that a static screenshot
hides.
Not a test suite, not a permanent fixture: every recording is a
throwaway artifact written to `.agent/recordings/` for one-shot visual
review.

> **This `SKILL.md` is a thin index.** Detailed rules live in
> [`rules/*.md`](./rules) and load on demand. Literal Playwright and
> `ffmpeg` boilerplate the skill emits lives in
> [`templates/*.md`](./templates). Do not preload everything — load only
> what the current phase asks for.

---

## When to use

Reach for this skill when **any** of the following is true:

- A diff changes animation, transition, or interactive motion code
  (`@keyframes`, `transition`, `View Transitions`, Motion `layout`,
  `@starting-style`, scroll-driven timelines).
- A still screenshot would not falsify the bug or feature claim — the
  proof requires at least two frames.
- A reviewer asks "what does this look like?" on a PR whose answer is
  a moving image, not a description.
- The `animations` skill has produced an animation and wants visual
  evidence it hits 60 fps and respects `prefers-reduced-motion`.
- The `ux` skill flagged a flow (drag, focus ring, hover reveal,
  expanding nav, modal entrance) where the asserted UX claim is
  about timing, not layout.

Do **not** reach for this skill when:

- A static screenshot is sufficient — capture a still directly (the
  `reviewer` agent's visual pass owns PR-attached screenshots).
- The task is to author a durable Playwright test — use the
  `e2e-testing` skill.
- The input is an existing `trace.zip` — use
  `playwright-trace-analyzer`.
- The input is an existing screen recording (e.g., a user bug report) —
  use `video-analyser`.

---

## Phase 0 — Preflight (mandatory gate)

Before recording anything, verify the environment. **Halt and ask the
user before installing tools.**

Run these checks (read-only):

```bash
# 1. Playwright installed?
command -v npx >/dev/null && npx --no-install playwright --version 2>/dev/null

# 2. Chromium driver available?
npx --no-install playwright install --dry-run chromium 2>/dev/null

# 3. ffmpeg available (cropping + transcoding)?
command -v ffmpeg
```

Decision table:

| State                                          | Action                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Playwright + Chromium + `ffmpeg` all present   | Proceed to Phase 1.                                                    |
| Playwright missing                             | **Halt.** Print install plan, ask permission. See [`rules/preflight.md`](./rules/preflight.md). |
| Playwright present, Chromium driver missing    | **Halt.** Print `npx playwright install chromium`, ask first.          |
| `ffmpeg` missing                               | **Halt.** Print install plan (`brew install ffmpeg`), ask first. Cropping disabled until installed. |
| Target URL is `localhost:*` and not reachable  | **Halt.** Ask the user to start the dev server before recording.       |

Print exact commands; do not run silently.
Full preflight rules: [`rules/preflight.md`](./rules/preflight.md).

---

## Phase 1 — Inputs

Collect, then confirm back to the user before running:

| Input          | Required | Default                              | Notes                                                                 |
| -------------- | -------- | ------------------------------------ | --------------------------------------------------------------------- |
| `url`          | Yes      | —                                    | Full URL or `localhost:<port>/<path>`. Auth handled in Phase 2.       |
| `selector`     | Yes      | —                                    | CSS, `data-testid="..."`, or `role=button[name="..."]`. The crop target. |
| `interaction`  | No       | `idle` (record state only)           | Named recipe or inline script. See [`rules/interactions.md`](./rules/interactions.md). |
| `duration`     | No       | `5000` ms                            | Total recording length. Cap 15 s. Default 5 s gives the `video-analyser` enough I-frames (≈ 10 at the 0.5 s GOP) for its 8-frame default. |
| `viewport`     | No       | `{ width: 1280, height: 800 }`       | The recording canvas — kept large for layout fidelity (responsive breakpoints, container queries). Downscaling happens at the crop stage. |
| `output-name`  | No       | `<selector-slug>-<ts>`               | File slug. `.webm` is always produced; `.mp4` / `.gif` opt-in.         |
| `out-format`   | No       | `webm`                               | One of `webm`, `mp4`, `gif`. Non-`webm` requires `ffmpeg` transcode.   |
| `max-width`    | No       | `768` px                             | Output downscale ceiling. 768 px is the [`video-analyser`](../../analysis/video-analyser/SKILL.md) Pareto knee — UI text stays legible, image tokens stay cheap (~786 tokens/frame on Sonnet). Crops smaller than this are not upscaled. Set `0` to disable downscale. |
| `keyint`       | No       | `15` frames                          | Forced GOP length. At 30 fps this places one I-frame every 0.5 s, so the `video-analyser`'s `select='eq(pict_type,I)'` sampling always lands enough frames for short clips. |
| `reduced-motion` | No     | `false`                              | If `true`, emulate `prefers-reduced-motion: reduce`.                  |

Echo the resolved inputs back as a one-screen summary before Phase 2.

**Caller-specific overrides.** When `caller: reviewer` and `out-format` is unspecified, default to `mp4` (GitHub previews `.mp4` inline). When `caller: animations` and the immediate next step is a `Skill("video-analyser")` invocation, keep `max-width: 768` and `keyint: 15` — they are already analyser-optimal. Pass `max-width: 0` only when a human reviewer has reported text-still-unreadable at 768 px (rare).

---

## Phase 2 — Generate the recording script

Write a single-purpose Node.js script to
`.agent/recordings/<slug>/record.mjs` using the template at
[`templates/record.mjs.template`](./templates/record.mjs.template).
Substitution rules and the interaction recipe catalog are in
[`rules/recording-script.md`](./rules/recording-script.md) and
[`rules/interactions.md`](./rules/interactions.md).

Hard rules:

- Use `chromium.launch({ headless: true })` — never headed, never `webkit`,
  never `firefox` (recording fidelity differs between engines).
- Pass `recordVideo: { dir, size: viewport }` on the **context**, not the
  browser. Playwright emits one `.webm` per page.
- Always `await context.close()` before reading the video path — the file
  is finalised only on context close.
- Cap the script at one page, one context, one recording per run. Multiple
  recordings means multiple runs.

---

## Phase 3 — Run the script

```bash
node .agent/recordings/<slug>/record.mjs
```

Capture stdout / stderr. On non-zero exit, do not crop — surface the
error and stop.

Resolve the produced `.webm` path from the script's stdout (the template
prints `VIDEO=<absolute-path>` as its last line).

---

## Phase 4 — Crop and downscale for the analyser

Use `ffmpeg` to crop the full-viewport `.webm` to the bounding box of
the target element, then downscale to a `max-width`-px-wide output with
a fixed 0.5 s GOP. The script in Phase 2 captures the bbox via
`locator.boundingBox()` and writes it to a sibling `bbox.json`.

The defaults (`max-width: 768`, `keyint: 15`) are tuned for the
[`video-analyser`](../../analysis/video-analyser/SKILL.md) skill's Pareto knee — see
the [Analyser-optimised sizing](./rules/cropping.md#analyser-optimised-sizing)
section for the numbers. Net effect: 768 px wide keeps UI text legible
at ~786 image tokens/frame on Sonnet, and the short GOP guarantees the
analyser's keyframe-first sampling (Step 5a) lands on signal-dense scene
transitions rather than falling back to uniform-time sampling.

Crop command, downscale filter, and format-conversion rules: [`rules/cropping.md`](./rules/cropping.md).

If `ffmpeg` is unavailable, skip cropping with a one-line note and
deliver the uncropped `.webm`.

---

## Phase 5 — Deliver

Print a delivery summary:

```text
Recording: <absolute path>
Format:    <webm | mp4 | gif>
Size:      <KB>
Duration:  <ms>
Viewport:  <w>x<h>
Cropped:   <yes (WxH at X,Y) | no — ffmpeg missing>
URL:       <recorded URL>
Selector:  <selector>
Interaction: <recipe or inline summary>
```

If the caller is another skill (Phase 6 below), return the path only —
no narration.

---

## Phase 6 — Integration callers

This skill is called by four other consumers via `Skill("screen-recorder")`.
Full handshake spec: [`rules/integrations.md`](./rules/integrations.md).

| Caller        | When                                                                              | Required inputs                                |
| ------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| `animations`  | After Phase 7 ("Measure") to attach a clip to the delivery, or when the user asks "show me". | `url`, `selector`, animation name (becomes `output-name`). |
| `ux`          | When a finding is severity Critical / High and concerns timing, motion, focus order, or interaction feedback. | `url`, `selector`, the finding ID.             |
| `reviewer`    | In PR Mode when the diff matches `animations` / `ux` heuristics and the PR author has not attached a recording. | `url`, `selector`, PR number (for the upload path). |
| `storybook`   | When a scaffolded story includes motion or transitions that a still screenshot cannot prove (multi-frame interactions). | `url` (story permalink), `selector`, story name (becomes `output-name`). |

Callers pass inputs in their `Skill()` call body; this skill never asks
the calling skill questions — it falls back to defaults and proceeds, or
fails fast with one explanatory line.

---

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files                                                              |
| ----- | ------------------------------------------------------------------ |
| 0     | [`rules/preflight.md`](./rules/preflight.md)                       |
| 1     | [`rules/interactions.md`](./rules/interactions.md)                 |
| 2     | [`rules/recording-script.md`](./rules/recording-script.md), [`templates/record.mjs.template`](./templates/record.mjs.template) |
| 2/3   | [`rules/interactions.md`](./rules/interactions.md)                 |
| 4     | [`rules/cropping.md`](./rules/cropping.md)                         |
| 6     | [`rules/integrations.md`](./rules/integrations.md)                 |

---

## Core Principles

1. **Throwaway, not test.**
   Recordings live in `.agent/recordings/` and are never checked into git.
   Add `.agent/recordings/` to `.gitignore` if it is not already covered.
2. **One concern per clip.**
   One URL, one selector, one interaction.
   If two animations need verifying, run twice.
3. **Headless Chromium only.**
   Headed mode introduces window-chrome that ruins the crop; other
   engines re-encode `transform` and `filter` differently.
4. **Crop with `ffmpeg`, not with viewport gymnastics.**
   Resizing the viewport to the element bbox changes layout (responsive
   breakpoints, container queries) and lies about what the user sees.
   Record the real viewport, crop after.
5. **Respect `prefers-reduced-motion` explicitly.**
   If the user passes `reduced-motion: true`, the recording must show
   the reduced variant. The `animations` skill calls this skill twice
   (default + reduced) to validate both paths.
6. **No live URLs without consent.**
   Recording staging or production captures real user data into a video
   file. Refuse unless the user has explicitly named the staging /
   production host.

---

## Anti-patterns (one-liners — full lists in linked rules)

- Recording with `headed: true` and submitting the result as evidence
  ([`rules/recording-script.md`](./rules/recording-script.md)).
- Sizing the viewport to the element to "auto-crop" — distorts layout
  ([`rules/cropping.md`](./rules/cropping.md)).
- Skipping `await context.close()` and reading a half-written `.webm`
  ([`rules/recording-script.md`](./rules/recording-script.md)).
- Multiple `page.goto()` calls in one recording — the second navigation
  appends to the same video and confuses the viewer.
- Recording at `localhost:3000` without checking the dev server is up
  ([`rules/preflight.md`](./rules/preflight.md)).
- Hard-coding selectors that drift (`div > div:nth-child(3)`) instead
  of `data-testid` or role
  ([`rules/interactions.md`](./rules/interactions.md)).
- Transcoding to `.gif` for anything over 4 s — the file balloons past
  10 MB ([`rules/cropping.md`](./rules/cropping.md)).
- Committing `.agent/recordings/` into git.

---

## Definition of Done

- [ ] Preflight passed — Playwright, Chromium, and (if cropping
      requested) `ffmpeg` are present.
- [ ] Inputs echoed back and confirmed.
- [ ] `record.mjs` written from the template, no manual edits to the
      Playwright API surface.
- [ ] Script exited 0 and printed `VIDEO=<path>`.
- [ ] `.webm` exists at the printed path and is `> 0 bytes`.
- [ ] If cropping requested, `bbox.json` is non-empty and the cropped
      output exists.
- [ ] Delivery summary printed (or path-only return if called by another
      skill).
- [ ] `.agent/recordings/` is in `.gitignore` (or covered by an existing
      pattern).
