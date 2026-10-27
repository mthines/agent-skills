---
title: Motion profile — measure an animated change's frames, re-renders, and reduced-motion handling
impact: MEDIUM
tags:
  - ui-verify
  - animations
  - performance
  - reduced-motion
---

# Motion profile

When the PR adds or edits motion, measure each changed animation in the browser: frame times under CPU throttling, React commits per frame, animated properties, layout shift, and whether it still moves under `prefers-reduced-motion: reduce`.
[`scripts/motion-probe.js`](../scripts/motion-probe.js) measures in the page; [`scripts/grade-motion.mjs`](../scripts/grade-motion.mjs) turns the numbers into findings with fixed thresholds.
**It never changes the verdict from Step 4** — its findings travel in a separate `motion:` block, like the adversarial pass.

## Contents

- [Inputs](#inputs)
- [Step 1: Pick the targets](#step-1-pick-the-targets)
- [Step 2: Measure](#step-2-measure)
- [Step 3: Grade and return](#step-3-grade-and-return)
- [Driver capabilities](#driver-capabilities)

## Inputs

| Line | Value |
| --- | --- |
| `Motion files:` | the `files` array from `is-motion-diff.mjs`'s JSON (Step 4d of [`runner.md`](./runner.md)) |
| `Aw-Target file:` / `Specs file:` | the Step 3 files |
| `Profile specs:` | ids of the specs whose `result` is `pass` |
| `Playwright bin:` | `.agent/{branch}/.aw-tester/playwright-bin`, written by `aw-tester`. Playwright driver only. |
| `Output dir:` | `.agent/{branch}/.ui-verify/motion/` |

## Step 1: Pick the targets

1. For each motion file, read its added hunks and name the user action that starts each animation (open a drawer, hover a card, switch a tab, load a list).
2. Match each action to a passing spec whose route reaches it; a target with no passing route is listed as `skipped (no passing spec reaches it)`.
3. Write `<output dir>/plan.md`: one line per target, `MP-NN · Spec-N · <trigger> · settle <ms>`, where settle is the animation's duration from the diff plus 300 ms (1 500 ms for a loop or an unknown duration).
   Cap: 6 targets, most-used surface first.

```text
✅ RIGHT — MP-01 · Spec-2 · click "Filters" (drawer slides in, 250 ms) · settle 550
❌ WRONG — MP-01 · Spec-2 · scroll around the page for a while   (no single trigger, nothing to time)
```

## Step 2: Measure

**Playwright driver.**

1. Copy [`templates/motion-profile.spec.ts.template`](../templates/motion-profile.spec.ts.template) to `<output dir>/motion.spec.ts`; keep everything above its `TARGETS` marker unchanged and replace the worked example with one `test()` per plan line, reusing the spec route's locators for `reach`.
2. Write `<output dir>/playwright.config.ts`: `testDir: '.'`, `testMatch: 'motion.spec.ts'`, `workers: 1`, `timeout: 60_000`, `reporter: 'line'`, `outputDir: './test-results'`.
3. Link `aw-tester`'s install when the repo has none, exactly as [`adversarial.md` § Step 3](./adversarial.md#step-3-run-the-probes) item 3 does; with neither, return `motion: skipped (no playwright install)` — never install into the project.
4. Export `MP_OUT`, `MP_BASE_URL`, `MP_PROBE` (absolute path of `scripts/motion-probe.js`), `MP_STORAGE_STATE`, `MP_BYPASS_NAME`, `MP_BYPASS_ENV` (the env var **name**), then run `"$(cat "<Playwright bin>")" test --config "<output dir>/playwright.config.ts"`.

Each target runs twice — motion allowed, then reduced motion — at 4× CPU slowdown, and appends both results to `<output dir>/results.jsonl`.

**Chrome driver.** Per target: walk the route in-session, inject the probe with `javascript_tool` (the contents of `scripts/motion-probe.js`), call `__motionProbe.start()`, perform the trigger, wait the settle time, then append `{"id","spec","pass":"no-preference","cpu_throttle":1, ...__motionProbe.stop()}` as one line of `results.jsonl`.
Run the motion-allowed pass only; see [Driver capabilities](#driver-capabilities).

## Step 3: Grade and return

```bash
node <this skill>/scripts/grade-motion.mjs "<output dir>/results.jsonl"
```

Return its `motion:` block verbatim, then one line per skipped target.
Never re-judge a threshold, drop a finding, or add one the script did not emit: the script is the oracle.

| `kind` | Severity | Means |
| --- | --- | --- |
| `render-per-frame` | high | React commits on ≥ 0.3 of the frames — the animation is driven through React state |
| `reduced-motion-ignored` | high | something still moves under `prefers-reduced-motion: reduce` |
| `jank` | high | p95 frame time over twice the median at 4× CPU |
| `layout-property` | medium | `width`, `height`, `top`, `left`, `margin`, or similar is animated |
| `long-frame` | medium | an animation frame over 100 ms |
| `layout-shift` | medium | CLS over 0.1 during the animation |
| `paint-property` | low | a paint-only property (`box-shadow`, `background`) is animated |

A target whose trigger produced no motion is `status: not-exercised` — report it, never count it as a pass.

## Driver capabilities

| Measurement | Playwright | Chrome |
| --- | --- | --- |
| frame times, long frames, CLS, animated properties, style writes | yes | yes |
| CPU throttling | 4× | none — results say `cpu: 1x` |
| React commits | yes (probe installs before React loads) | only when the React DevTools extension is installed; otherwise `react.available: false` and `render-per-frame` cannot fire |
| reduced-motion pass | yes | no — every target reports `reduced_motion: not checked` |

Never work around a missing capability with page scripts; report what was not measured.
