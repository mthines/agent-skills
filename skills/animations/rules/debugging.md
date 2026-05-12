---
title: Debugging — Find the Jank, Measure the Fix
impact: HIGH
tags:
  - devtools
  - performance
  - profiling
  - jank
---

# Debugging

The most common animation bug is "it feels janky." That is not a
diagnosis. Open DevTools and turn it into one of three concrete
verdicts:

1. **Frame drops** — the animation is missing frames (the budget is
   16.7 ms at 60 Hz, 8.3 ms at 120 Hz, and you are over it).
2. **Layout / paint thrash** — the animated property is running on the
   main thread instead of the compositor.
3. **Main-thread contention** — the animation is fine, but JS or React
   work elsewhere blocks the renderer.

The diagnosis determines the fix.

## Contents

- The 5-minute Chrome DevTools workflow
- Rendering panel — the live signal
- React DevTools Profiler
- INP — the user-side metric
- When the animation is fine but the page is slow
- Cheap repro for "why is this janky"
- Common verdicts and fixes (table)
- Common mistakes

## The 5-minute Chrome DevTools workflow

1. Open **Performance** panel.
2. Tick **Screenshots** and **Web Vitals**. Optionally turn on the
   **Rendering** panel and enable **Paint flashing** + **Layer borders**.
3. Click **Record**, perform the animation once, **Stop**.
4. Read the **Main** track in the resulting flame chart.

### What to look at

| Track / colour                                  | Meaning                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Frames** strip at the top                     | Each bar is a frame. Red bars are over-budget.                                       |
| **Compositor** track                             | Compositor-only animations run here. Good — main thread is free.                     |
| **Main → Layout** (purple)                      | Layout recalculation. Repeated bars during the animation = animated layout property. |
| **Main → Paint** (green)                        | Paint. Some is fine; continuous green during the animation = repaint per frame.      |
| **Main → Recalculate Style** (purple, smaller)  | Style invalidation. Many in a row = thrashing reads / writes from JS.                |
| **Long Tasks**                                  | > 50 ms blocks. Investigate.                                                         |

The simplest verdict: **purple or green bars during the animated
frames = layout / paint thrash**. Fix by moving to `transform` /
`opacity` (see [`safe-properties.md`](./safe-properties.md)). If the
animated frames show only **Compositor** activity, the animation
itself is fine; jank is from something else on the main thread.

## Rendering panel — the live signal

In DevTools → ⋮ → More tools → **Rendering**:

| Toggle                  | What it shows                                                          |
| ----------------------- | ---------------------------------------------------------------------- |
| **Paint flashing**      | Highlights every region that repainted. Should pulse only on the moved element, not the whole element area. |
| **Layer borders**       | Outlines composited layers in yellow. `will-change` and 3D transforms create layers. |
| **Frame Rendering Stats** | Overlay with live FPS and dropped frames.                            |
| **Core Web Vitals**     | Live INP, LCP, CLS readouts. INP regressions correlate with jank.      |

**Paint flashing during a `transform` animation** = the property is
on the wrong list. Re-check `safe-properties.md`.

## React DevTools Profiler

For React apps, jank is often a re-render in the wrong place. Record
in **React DevTools → Profiler**, look for:

- Commits longer than 16 ms.
- Components rendering every frame that shouldn't be (often a `useState`
  driving a value at 60 Hz; the canonical fix is a ref + `useFrame` for
  R3F, or `useMotionValue` for Motion).

Compose this with the browser Performance trace — React's "Commit" mark
shows up as a slice in the main thread.

## INP — the user-side metric

Animations that fail in the lab pass in production tests because the
slow path runs once, on first interaction. **Interaction to Next Paint
(INP)** is the field metric that catches this. Pull it from Web Vitals
in DevTools or from your RUM dashboard; a regression after an animation
change means the animated property is forcing layout.

A clean animation generally pushes INP **down** (the response feels
immediate); a janky animation pushes it up because the compositor is
contesting with main-thread work.

## When the animation is fine but the page is slow

If the Performance trace shows the animation on the Compositor track
with no main-thread cost, but the user still reports lag:

- **Main-thread JS** is heavy elsewhere. Run a profile during the
  animation and find the long task. Likely culprits: React re-renders
  triggered by the animation state, hydration on a Server Component
  page, third-party scripts.
- **Texture / image decode** during animation start. Defer image work,
  use `loading="lazy"`, or `decoding="async"`.
- **Layout thrash on neighbours.** Animating one card causes 200
  sibling layout recalcs because they observe its size with
  `ResizeObserver`. Detach the observers during the animation.

## Cheap repro for "why is this janky"

A minimal isolation:

```bash
# Throttle the CPU and network in DevTools first, then:
1. Open a private window.
2. Hit the page cold.
3. Trigger the animation once.
4. Record 3 seconds in Performance.
```

Most jank reproduces on a cold load with 4× CPU throttle that does not
appear in a warm dev session. Throttle, repro, then optimise.

## Common verdicts and fixes

| Symptom in DevTools                                      | Fix                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Purple "Layout" bars during the animation                | Animated property is layout-affecting (`width`, `top`, `padding`, …). Move to `transform`. |
| Green "Paint" bars on a large surface                    | Animating `box-shadow`, `background`, `border-radius` — pre-render, animate `opacity`. |
| First frame stutters, rest is smooth                     | Lazy layer promotion. Add `will-change` ms before the animation; remove after.        |
| FPS halves on a Retina monitor                           | `dpr` too high or filter too expensive at native pixel ratio.                         |
| Smooth on desktop, janky on mobile                       | Throttle CPU 4× and repro. Usually: too many composited layers or a heavy `filter`.   |
| Smooth in browser, janky during page load                | Texture / image decode contention. Defer non-critical images.                          |

## Common mistakes

- **Tuning curves before profiling.** You can't easing-curve your way
  out of a layout-thrash bug. **Fix:** profile first, then tune.
- **Profiling on a powerful dev box only.** Misses real-world jank.
  **Fix:** 4× CPU throttle + slow 3G in DevTools.
- **Trusting `console.time` for animation work.** Resolution is too
  coarse and Chrome's optimiser may inline it away. **Fix:** Performance
  panel.
- **Filing the bug as "animation feels slow."** Useless. **Fix:** name
  the verdict (frame drops vs layout thrash vs main-thread contention)
  and attach the trace.
