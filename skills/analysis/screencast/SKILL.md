---
name: screencast
description: >
  Records reviewable browser videos — a cursor, click ring, and step captions drawn on the page,
  dead waits cut, H.264 mp4 out, a per-step timings file and contact sheet beside it — for a scripted
  scene list or a test runner's raw Playwright video. Triggers on "record this interaction",
  "screen recording", "make a video of", "/screencast".
disable-model-invocation: false
argument-hint: '<recording.json> [--narrate] | finish <raw.webm>... --out <id>.mp4'
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: applied
  tags: [playwright, video, recording, evidence, ffmpeg]
---

# screencast

Scripts do the work; this file lists only what differs from a plain Playwright `recordVideo` + `ffmpeg` job.

| Script | Use |
| --- | --- |
| [`scripts/record.mjs`](./scripts/record.mjs) `<recording.json>` | Scripted scenes (caption + `click`/`hover`/`type`/`press`/`scroll`/`wait` steps); schema in the file header. Run from a directory where `playwright` resolves |
| [`scripts/overlay.js`](./scripts/overlay.js) | A test runner's own recording: `context.addInitScript({ path })`, then `window.__rec.step(label)` per step |
| [`scripts/finish.mjs`](./scripts/finish.mjs) `<raw.webm>... --out <id>.mp4` | Any raw video(s) + sibling `<stem>.timings.json` → the outputs below. `--crop x,y,w,h`, `--max-width 768` for `video-analyser`, `--no-trim` |

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
6. **Chrome driver (claude-in-chrome):** no `recordVideo`; record with `gif_creator` and attach the GIF instead of an mp4.
7. **Narration is opt-in** (`--narrate`): each step's `say` line, spoken with macOS `say` or `SCREENCAST_TTS="<cmd with {text} and {out}>"`. Never by default — reviewers watch muted.

Exit codes: `2` bad arguments, `3` ffmpeg missing, encoding failed, or the mp4 failed its sanity check, `4` `playwright` does not resolve, `5` `--narrate` with no voice.
