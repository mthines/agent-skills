---
title: Performance — Measuring & Profiling RN Animations
impact: MEDIUM
tags:
  - performance
  - profiling
  - fps
  - perf-monitor
  - react-native-devtools
---

# Performance

How to prove an RN animation is smooth, and where to look when it is not.
The single most important diagnostic is the **UI-thread vs JS-thread FPS split** — a correctly built Reanimated animation holds frame rate on the UI thread even when the JS thread is saturated.
This rule covers the frame budget, the measurement stack, and how to localize the cause of jank.

## Contents

- Frame budget
- The measurement stack
- Reading the UI-thread / JS-thread split
- Reanimated strict logger
- Deep native profiling
- Common mistakes

---

## Frame budget

- 60 fps → **16.67 ms/frame**.
- 120 fps → **~8.33 ms/frame** on ProMotion / high-refresh Android.
- A frame that overruns the budget is dropped → visible jank.
- For 120 fps on iPhone, enable `CADisableMinimumFrameDurationOnPhone` in `Info.plist`.

---

## The measurement stack

Flipper's bundled integration was deprecated in RN 0.73 and removed from the default template in 0.74.
The current tools:

| Tool | What it gives you | How to open |
| ---- | ----------------- | ----------- |
| **Perf Monitor overlay** | UI-thread FPS + JS-thread FPS (separately), RAM, view count | Dev Menu → "Show Perf Monitor" |
| **React Native DevTools** | JS debugger, console, integrated React DevTools (Components + Profiler) for re-render profiling | Dev Menu, or press `j` in the Metro terminal |
| **Reanimated strict logger** | Flags wrong-thread `.value` reads/writes | `configureReanimatedLogger({ strict: true })` (default) |
| **Xcode Instruments / Android profilers** | Frame timeline, GPU work, hangs | Native IDE |

> React Native DevTools did not ship a frame-timeline/Performance panel as of RN 0.76 — for UI-thread frame timing, use the Perf Monitor overlay and native profilers. Verify panel availability against the project's RN version.

---

## Reading the UI-thread / JS-thread split

This split is the core animation diagnostic:

- **UI-thread FPS drops** → the animation itself is janky: too much UI-thread work, or you are animating layout properties (Yoga recalc every frame). Fix the animation — move to `transform` / `opacity`, cut animated node count.
- **Only JS-thread FPS drops, UI stays high** → your Reanimated / native-driven animation is fine; JS work is blocking (heavy render, list re-layout, JSON parse). A non-native-driver `Animated` animation *would* jank here; a Reanimated one will not. Fix the JS workload, not the animation.

This is why the fix for a "janky animation" is often to move the value off the JS thread (Reanimated shared value on the UI thread) rather than to tune the curve.

---

## Reanimated strict logger

Strict mode (default since Reanimated 3.16) surfaces the single most common Reanimated bug — reading a shared value's `.value` during render or on the wrong thread:

```jsx
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: true }); // call once at app root
```

If you see *"Reading from `value` during component render..."*, the value is being read where it will not be reactive and will block the JS thread — move the read into a worklet / `useAnimatedStyle`.

---

## Deep native profiling

When the Perf Monitor shows a UI-thread drop you cannot explain:

- **iOS:** Xcode Instruments — Time Profiler, Core Animation, **Animation Hitches**, Hangs.
- **Android:** GPU rendering profile, Perfetto / systrace, Android Studio Profiler.

Look for offscreen rendering (large animated `shadowRadius` on iOS — set a `shadowPath` so Core Animation caches it), overdraw, and per-frame layout commits.

---

## Common mistakes

- **Judging smoothness on a dev build / debugger attached.** JS runs slower under debugging. **Fix:** measure on a release build on a real low-end device.
- **Watching only one FPS number.** You cannot localize the cause without the split. **Fix:** read UI-thread and JS-thread FPS separately.
- **Tuning the easing curve to fix jank that is actually JS-thread congestion.** **Fix:** check the split first; move the value to the UI thread.
- **Animating a large `shadowRadius` per frame on iOS.** Offscreen render every frame. **Fix:** set `shadowPath`, or animate `shadowOpacity` / `elevation` discretely.
- **Leaving `strict: false`.** You lose the wrong-thread `.value` warning. **Fix:** keep strict mode on in development.
