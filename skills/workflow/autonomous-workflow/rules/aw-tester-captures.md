---
title: 'aw-tester — captures, auto-capture, and video'
impact: HIGH
tags:
  - aw-tester
  - screenshots
  - video
---

# aw-tester — captures, auto-capture, and video

Part of the [`aw-tester`](../templates/aw-tester.agent.md) agent definition. Read when a spec has a `CAPTURE` step, or the invocation passed `--auto-capture` or `--record-video`.

## Contents

- [Capture steps (documentation screenshots)](#capture-steps-documentation-screenshots)
- [Auto-capture (always-on documentation screenshots)](#auto-capture-always-on-documentation-screenshots)
- [Record video (one `.webm` per spec)](#record-video-one-webm-per-spec)

## Capture steps (documentation screenshots)

A `CAPTURE "<label>" [fullPage]` flow step emits a `page.screenshot(...)` at that
point in the generated spec — a deliberate documentation artifact, not a debug
snapshot. It is neither an action nor an assertion: it resolves no locator and
can never fail the spec.

```ts
// CAPTURE "dashboard with new widget"      →
await page.screenshot({
  path: '.agent/<branch>/.aw-tester/captures/spec-1-dashboard-with-new-widget.png',
  fullPage: false,   // true when the step said `fullPage`
});
```

- Create `.agent/<branch>/.aw-tester/captures/` before the run.
- Name each file `<spec-id>-<slug-of-label>.png` (lowercase, non-alphanumerics
  → `-`), so re-runs overwrite deterministically.
- Wrap each screenshot so a write failure is swallowed into a run note, never a
  test failure — a broken capture must not turn a green spec red.
- List every capture that wrote in the verdict's `captures:` array (see schema).
- Captures are exempt from bail: emit them in step order, so a capture before
  the first red step in a `--bail-on-first-red` run is still recorded.

## Auto-capture (always-on documentation screenshots)

When the invocation passed `--auto-capture`, take a **full-page** screenshot
automatically — *in addition to* any explicit `CAPTURE` steps — at two points,
per the [spec-run contract § Auto-capture](./spec-run-contract.md#auto-capture-a-run-option).
`ui-verify run`/`verify` pass this flag by default; the executor's Phase 4 hot
loop does not, so fast iteration stays screenshot-free.

1. **Final state of every spec** — after the spec's last flow step, whether it
   passed or failed. Name it `<spec-id>-auto-final.png`.
2. **After each `WHEN` that navigated** — a URL change or full page load. Name it
   `<spec-id>-auto-<seq>.png` (`seq` from `1`). **Dedupe**: skip when
   `page.url()` is unchanged since the last auto-capture, so several assertions
   on one screen never reshoot it.

```ts
// end of Spec 1, with --auto-capture           →
await page.screenshot({
  path: '.agent/<branch>/.aw-tester/captures/spec-1-auto-final.png',
  fullPage: true,
});
```

- `AUTO_CAPTURE_CAP = 30` per run. On reaching it, stop auto-capturing and add
  `notes: auto-capture cap (30) reached — <N> further states not shot`. This
  bounds a large PR — a spec with hundreds of assertions never yields hundreds
  of files.
- Same write-failure discipline as `CAPTURE`: wrap each `page.screenshot(...)` so
  a failed write is a `notes` line, never a red spec.
- List each auto-capture in the verdict's `captures:` array with `auto: true`.
- Per-assertion capture is **not** a mode — the two triggers above already cover
  every distinct visual state; a spec wanting a specific intermediate frame adds
  an explicit `CAPTURE` step.

## Record video (one `.webm` per spec)

When the invocation passed `--record-video`, record each spec per the
[spec-run contract § Record video](./spec-run-contract.md#record-video-a-playwright-run-option).
`ui-verify run`/`verify` pass this flag on the Playwright driver; the executor's
Phase 4 hot loop does not.

- **Grammar spec.** Give each spec its own context (this overrides the
  one-context-per-batch rule above) and save its video when the context closes:

  ```ts
  // per spec, with --record-video
  const context = await browser.newContext({
    ...contextOptions,
    recordVideo: { dir: '.agent/<branch>/.aw-tester/recordings/.raw', size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  // … the spec's steps …
  const video = page.video();
  await context.close();                       // the video is finalized on close
  await video?.saveAs('.agent/<branch>/.aw-tester/recordings/spec-1.webm').catch(() => {});
  await video?.delete().catch(() => {});
  ```

- **Intent spec.** Set `video` in `probe-in.json` (a `.webm` path) only on the
  launches that grade the spec — the replay launch, each commit launch, and the
  final probe — naming them `<spec-id>-<seq>.webm`; never on an exploratory
  probe. After the spec, join the segments when `ffmpeg` is on `PATH`, else keep
  them:

  ```bash
  # concat resolves list entries against the list file's directory, so write basenames
  (cd "$AW_DIR/recordings" && ls spec-1-*.webm | sort -V | sed "s/.*/file '&'/") > "$AW_DIR/recordings/spec-1.txt"
  ffmpeg -loglevel error -f concat -safe 0 -i "$AW_DIR/recordings/spec-1.txt" -c copy "$AW_DIR/recordings/spec-1.webm" \
    && rm "$AW_DIR"/recordings/spec-1-*.webm "$AW_DIR/recordings/spec-1.txt"
  ```

- A save that fails is a `notes` line, never a red spec. Delete `recordings/.raw/`
  when the run ends.
- List each saved video in the verdict's `recordings:` array.
