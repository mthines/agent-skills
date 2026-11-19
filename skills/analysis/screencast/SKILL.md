---
name: screencast
description: >
  Records reviewable browser videos — a cursor, click ring, and step captions drawn on the page,
  dead waits cut, H.264 mp4 out, a per-step timings file and contact sheet beside it — for a scripted
  scene list (with animated highlights that point at what to look at, and long waits sped up), a test
  runner's raw Playwright video, or a Chrome tab driven by another tool (recorded over the DevTools
  protocol). Triggers on "record this interaction", "screen recording", "make a video of",
  "highlight it in the video", "/screencast".
disable-model-invocation: false
argument-hint: '<recording.json> [--narrate] | finish <raw.webm>... --out <id>.mp4 | capture start|step|stop --out <id>.mp4'
license: MIT
metadata:
  author: mthines
  version: '2.2.0'
  workflow_type: applied
  tags: [playwright, video, recording, evidence, ffmpeg]
---

# screencast

Scripts do the work; this file lists only what differs from a plain Playwright `recordVideo` + `ffmpeg` job.

| Script | Use |
| --- | --- |
| [`scripts/record.mjs`](./scripts/record.mjs) `<recording.json>` | Scripted scenes (caption + `click`/`hover`/`type`/`press`/`scroll`/`wait`/`highlight`/`waitFor`/`ensure` steps, `fastForward` per scene); schema in the file header. Run from a directory where `playwright` resolves |
| [`scripts/overlay.js`](./scripts/overlay.js) | A test runner's own recording: `context.addInitScript({ path })`, then `window.__rec.step(label)` per step |
| [`scripts/finish.mjs`](./scripts/finish.mjs) `<raw.webm>... --out <id>.mp4` | Any raw video(s) + sibling `<stem>.timings.json` → the outputs below. `--crop x,y,w,h`, `--max-width 768` for `video-analyser`, `--no-trim` |
| [`scripts/capture.mjs`](./scripts/capture.mjs) `launch [--port 9222] \| disconnect \| start --url <part> \| step "<label>" \| stop` `--out <id>.mp4` | A Chrome tab another tool drives (claude-in-chrome): streams its frames over the DevTools protocol through a relay that keeps one connection to Chrome, then runs `finish.mjs` on stop. `disconnect` closes that connection. `launch` opens a separate Chrome with a DevTools port, for when remote debugging at chrome://inspect is off. Usage and exit codes in the file header |

```bash
node "${CLAUDE_SKILL_DIR}/scripts/finish.mjs" spec-1-1.webm spec-1-2.webm --out .agent/feat-x/.aw-tester/recordings/spec-1.mp4
```

## Outputs (the contract other skills read)

`<id>.mp4`, `<id>.timings.json` (`steps: [{ label, start, end, result }]` in output seconds), and `<id>.sheet.png` (one frame per step), side by side.
Standalone runs write to `.agent/{branch}/recordings/`; a caller such as `aw-tester` keeps its own directory.

## Deviations from the default

1. **Read `<id>.sheet.png` before any upload or claim.** You cannot watch a video; the sheet is how you check it shows what you say it shows.
2. **Record at 1x.** Playwright video ignores `deviceScaleFactor`: a 2x page lands in a corner of the frame. Upscale in ffmpeg if needed.
3. **Hide the overlay in screenshots:** `page.screenshot({ style: '#__screencast{display:none!important}' })`, so evidence images show only the app.
4. **A runner writes timings as it goes:** `{ label, start, end, result }` per step, seconds from `newPage()`; several launches → pass every segment to `finish.mjs` in order, and it joins them and offsets their timings.
5. **A failed recording is a `notes` line, never a failed check.**
6. **Chrome driver (claude-in-chrome):** no `recordVideo`, so record with `capture.mjs`, never `gif_creator`: a GIF gets one frame per tool call and is ~20× larger than the mp4.
   It needs Chrome's remote debugging on once (chrome://inspect/#remote-debugging), and the user clicks **Allow** once per Chrome session: the first `start` prints `connecting to Chrome` and waits, and later ones reuse the relay's connection. `--wait 600` when you start it before asking. Chrome paints only while the page changes and its window is visible, so the video starts at the first frame after `start`, and `stop` exits `6` if none came.
   `start` injects `overlay.js` into the tab and every later navigation, and `capture.mjs step "<label>"` draws that label as the bottom caption: never inject the overlay or call `__rec.step` yourself.
   When `step` prints `caption not drawn`, the page blocked the script (a strict CSP); the video has no caption for that step, so say so in `notes`.
   Write each label as what the viewer should notice, in the product's words ("The list keeps only slow requests"), not "Click Filter".
   Exit `6` (no debugging, no matching tab, no frames) → fall back to `gif_creator`, convert the GIF (`ffmpeg -i x.gif -movflags +faststart -vf "scale=1280:-2,format=yuv420p" -c:v libx264 -crf 28 -an x.mp4`), and add a `notes` line.
7. **Point at the target with `highlight`, not a longer caption.** A caption leaves the viewer searching the frame for a small button. `{ "highlight": "<selector>", "label": "<≤ 8 words>", "side": "right" }` dims the page, pulses an outline on the target, and draws a callout with an arrow. Chain highlights (the next one glides) and end with `{ "unhighlight": true }` before a click that moves the layout.
   `"grow": "<text>"` widens the target to its nearest ancestor containing that text, so a whole card is framed from its heading. Wait ~800 ms after a click before you highlight.
   Point only at what is on screen: a callout naming a control the frame does not show reads as a bug.
   ```json
   { "highlight": "role=heading[name=\"Criteria\"]", "grow": "Every criterion scores" },
   { "highlight": "role=button[name=\"Improve configuration\"]", "label": "New: Agent0 improves these", "side": "left" },
   { "unhighlight": true }
   ```
8. **Wait on a signal, and fast-forward the wait.** A fixed `wait` either cuts the answer off or wastes minutes. Use `{ "waitFor": "<selector of the finished state>", "timeout": 600000 }` (default 30 s), and `{ "ensure": "<selector>", "orClick": "<selector>" }` to open a collapsible that remembers its state between runs.
   A wait that keeps animating (a spinner, a streaming answer) is not cut as dead time, so give its scene `"fastForward": 6`: it is squeezed into 6 s with a "Sped up" badge (`fastLabel` changes the text), and later scenes and their narration move up by the time saved.
   A fast-forwarded scene cannot have a `say` line (`record.mjs` and `finish.mjs` exit `2` under `--narrate`): speak over the scene before it. Never point `waitFor` at "no spinner"; point it at what the finished state shows.
9. **Narration is opt-in** (`--narrate`): each step's `say` line, spoken with macOS `say` or `SCREENCAST_TTS="<cmd with {text} and {out}>"`. Never by default — reviewers watch muted.

Exit codes: `2` bad arguments, `3` ffmpeg missing, encoding failed, or the mp4 failed its sanity check, `4` `playwright` does not resolve, `5` `--narrate` with no voice, `6` `capture.mjs` found no DevTools endpoint, tab, or frames.
