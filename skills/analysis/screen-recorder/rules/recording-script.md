---
title: Recording Script — Playwright `recordVideo` Boilerplate
impact: HIGH
tags:
  - playwright
  - recordvideo
  - script
  - chromium
---

# Recording Script

The recording is produced by a single-purpose Node.js script generated
from the template at
[`../templates/record.mjs.template`](../templates/record.mjs.template).
This rule covers what the template does, what must not be edited, and
how to substitute its placeholders.

## Contents

- Anatomy of the script
- Hard rules — never edit
- Substitution placeholders (escaping table)
- Selector resolution and the locator ladder
- Bounding-box capture
- Idle hold timing
- Exit codes
- Examples (good + bad)
- Common mistakes

## Anatomy of the script

The template lays out, in order:

1. Imports — `chromium` from `playwright`, `mkdirSync` from `node:fs`,
   `path` helpers, `writeFileSync` for `bbox.json`.
2. Constants — read from environment variables injected by the skill
   (`URL`, `SELECTOR`, `INTERACTION`, `DURATION_MS`, `VIEWPORT_W`,
   `VIEWPORT_H`, `OUT_DIR`, `REDUCED_MOTION`).
3. Chromium launch — `headless: true`, no slow-mo.
4. Context creation — `recordVideo: { dir: OUT_DIR, size: { width, height } }`,
   `reducedMotion: REDUCED_MOTION ? 'reduce' : 'no-preference'`,
   `storageState` if `.browser/auth-state.json` exists.
5. `page.goto(URL, { waitUntil: 'domcontentloaded' })`.
6. Wait for the selector to attach — `page.locator(SELECTOR).waitFor()`.
7. Capture `bbox.json` — bounding box at the moment recording starts.
8. Run the interaction recipe — dispatched by name from
   [`interactions.md`](./interactions.md).
9. Idle hold — keep recording until `DURATION_MS` elapses since
   `page.goto`.
10. Close context (flushes the `.webm`).
11. Resolve the video path — `await page.video().path()`.
12. Print `VIDEO=<absolute path>` as the last stdout line.

## Hard rules — do not edit these in the generated script

- `headless: true` always.
  Headed mode includes the OS window chrome in the recording.
- `chromium` only.
  WebKit and Firefox re-encode CSS `transform` / `filter` differently;
  visual evidence is non-portable.
- One `browser.newContext()` per run.
  A second context produces a second `.webm` and confuses downstream
  cropping.
- One `page.goto()` per run.
  Re-navigation appends frames to the same video.
- `await context.close()` before reading the video path.
  The file is not flushed to disk until the context closes — reading
  the *file content* earlier yields an empty or partial file.
- Obtain the `Video` object via `page.video()` and call `video.path()`
  **before** `context.close()` — on Playwright ≥ 1.46, `page.video()`
  returns `null` after the context is closed, so the path must be
  captured first. The path string is valid immediately; only the
  *file bytes* are guaranteed complete after close.
  Sequence: `const video = page.video()` → `const videoPath = await video.path()`
  → `await context.close()` → verify `statSync(videoPath).size > 0`.

## Substitution placeholders

The template uses `{{NAME}}` placeholders that the skill replaces with
literal JavaScript before writing. Never write a placeholder that
contains user input directly — escape it.

| Placeholder          | Escaping                                              | Notes                                                                |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| `{{URL}}`            | `JSON.stringify(url)`                                 | Quoted JS string. Refuse `javascript:` and `data:` URLs.             |
| `{{SELECTOR}}`       | `JSON.stringify(selector)`                            | Passed to `page.locator()`; supports CSS, `text=`, role-based.       |
| `{{DURATION_MS}}`    | `Number(duration)`                                    | Integer. Cap at 15000.                                               |
| `{{VIEWPORT_W}}`     | `Number(viewport.width)`                              | Integer. Default 1280.                                               |
| `{{VIEWPORT_H}}`     | `Number(viewport.height)`                             | Integer. Default 800.                                                |
| `{{OUT_DIR}}`        | `JSON.stringify(absoluteOutDir)`                      | Must be inside `.agent/recordings/`.                                 |
| `{{REDUCED_MOTION}}` | `JSON.stringify(Boolean(reducedMotion))`              | Maps to `'reduce'` / `'no-preference'`.                              |
| `{{INTERACTION}}`    | A named recipe ID, never raw user code                | Looked up at template runtime — see [`interactions.md`](./interactions.md). |
| `{{KEY}}`            | `JSON.stringify(key)` — e.g. `"Escape"`               | Used in the `press` recipe. Quoted JS string; never raw user input.  |
| `{{TEXT}}`           | `JSON.stringify(text)`                                | Used in the `type` recipe. Quoted JS string; never raw user input.   |
| `{{DEST_SELECTOR}}`  | `JSON.stringify(destSelector)`                        | Used in the `drag-to` recipe. Same escaping rules as `{{SELECTOR}}`. |
| `{{HREF_SELECTOR}}`  | `JSON.stringify(hrefSelector)`                        | Used in the `navigate` recipe. Same escaping rules as `{{SELECTOR}}`. |

**Never substitute a `{{...}}` placeholder with unescaped user input.**
Every recipe placeholder that accepts a string goes through `JSON.stringify()` so
the result is a valid quoted JS string literal.
There is no mechanism for user input to escape the quoted context and inject
arbitrary JS — reject the call if the escaping would fail (e.g. surrogate
pairs that `JSON.stringify` cannot represent).

## Selector resolution

`page.locator(SELECTOR)` accepts all three locator dialects:

- CSS — `.btn-primary`, `[data-testid="submit"]`.
- Text — `text=Open settings`.
- Role — `role=button[name="Open settings"]`.

Prefer in this order: `data-testid` > role > text > raw CSS.
Raw structural CSS (`div > div:nth-child(3)`) drifts the moment markup
changes and is **not** a valid screen-recorder selector — reject and
ask for a stable handle.

## Bounding box capture

After `waitFor()` and before the interaction starts, the template runs:

```js
const bbox = await page.locator(SELECTOR).boundingBox();
if (!bbox) {
  throw new Error(`Selector ${SELECTOR} is not visible — cannot bbox.`);
}
writeFileSync(
  path.join(OUT_DIR, 'bbox.json'),
  JSON.stringify({ x: Math.round(bbox.x), y: Math.round(bbox.y), w: Math.round(bbox.width), h: Math.round(bbox.height) })
);
```

`bbox.json` is consumed by [`cropping.md`](./cropping.md) in Phase 4.
Rounded to integers because `ffmpeg` rejects fractional crops.

## Idle hold (timing the recording)

After the interaction completes, the script must hold until the total
`DURATION_MS` window has elapsed:

```js
const elapsed = Date.now() - navStart;
const remaining = Math.max(0, DURATION_MS - elapsed);
await page.waitForTimeout(remaining);
```

Without the idle hold, the recording cuts the moment the interaction
returns — the viewer sees the input but not the resulting motion.

## Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| 0    | Recording produced, `VIDEO=<path>` printed.         |
| 1    | Pre-recording failure (selector not found, nav error). |
| 2    | Interaction recipe failed.                           |
| 3    | Video file not flushed (assertion: `size > 0`).      |

## Examples

### Good — interaction by recipe name

```js
// Generated from the template — DO NOT edit by hand.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const URL = "http://localhost:3000/services";
const SELECTOR = '[data-testid="services-sidebar"]';
const INTERACTION = "hover";
const DURATION_MS = 5000;
const VIEWPORT = { width: 1280, height: 800 };
const OUT_DIR = "/abs/path/.agent/recordings/services-sidebar-1715500000";

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctxOpts = {
  viewport: VIEWPORT,
  recordVideo: { dir: OUT_DIR, size: VIEWPORT },
  reducedMotion: 'no-preference',
};
if (existsSync('.browser/auth-state.json')) {
  ctxOpts.storageState = '.browser/auth-state.json';
}
const context = await browser.newContext(ctxOpts);
const page = await context.newPage();

const navStart = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded' });

const target = page.locator(SELECTOR);
await target.waitFor({ state: 'visible', timeout: 5000 });

const bbox = await target.boundingBox();
if (!bbox) throw new Error(`${SELECTOR} not visible`);
writeFileSync(path.join(OUT_DIR, 'bbox.json'),
  JSON.stringify({
    x: Math.round(bbox.x), y: Math.round(bbox.y),
    w: Math.round(bbox.width), h: Math.round(bbox.height),
  })
);

// Interaction recipe: hover
await target.hover();

const elapsed = Date.now() - navStart;
await page.waitForTimeout(Math.max(0, DURATION_MS - elapsed));

await context.close();
await browser.close();

const videoPath = await page.video().path();
console.log(`VIDEO=${videoPath}`);
```

### Bad — headed mode

```js
const browser = await chromium.launch({ headless: false });
// Window chrome bleeds into the .webm; useless as evidence.
```

### Bad — calling page.video() after close (Playwright ≥ 1.46)

```js
await context.close();
const videoPath = await page.video().path(); // page.video() returns null after close!
console.log(`VIDEO=${videoPath}`);
// Throws: "Cannot read properties of null (reading 'path')"
```

### Bad — reading file before close

```js
const videoPath = await page.video().path();
console.log(`VIDEO=${videoPath}`);
await context.close();
// File at videoPath is incomplete or zero bytes until after context.close().
// Check statSync(videoPath).size > 0 AFTER close.
```

## Common mistakes

- **Editing the template after substitution.**
  Hand edits drift across runs.
  **Fix:** regenerate from `templates/record.mjs.template`.
- **Recording multiple URLs in one run.**
  The second `goto` extends the video.
  **Fix:** one URL per script; loop at the skill level.
- **Forgetting the idle hold.**
  Animation cuts at the click frame.
  **Fix:** always wait until `DURATION_MS` elapsed since `navStart`.
- **Treating `boundingBox()` as a sync call.**
  It returns a Promise; missing `await` yields `[object Promise]` in
  the JSON file.
  **Fix:** always `await`.
