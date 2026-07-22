---
name: animations-native
description: >
  Authors performant React Native / Expo animations with Reanimated
  and gesture handling with react-native-gesture-handler, running motion
  on the UI thread so it stays at 60/120 fps. Covers worklets, shared
  values, useAnimatedStyle, withTiming/withSpring, layout animations,
  the Gesture API (pan/pinch/drag/swipe), Moti, Lottie, Rive, reduced
  motion, haptics, and UI-thread profiling. Use when building RN motion,
  wiring a gesture, or when an RN animation feels janky. For WEB
  animations (CSS, Motion, View Transitions) use the `animations` skill
  instead. Triggers on "reanimated", "gesture handler", "react native
  animation", "expo animation", "useSharedValue", "withSpring", "moti",
  "swipe gesture", "drag", "pinch to zoom", "/animations-native".
argument-hint: '[brainstorm]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - react-native
    - expo
    - reanimated
    - react-native-gesture-handler
    - animations
    - gestures
    - worklets
    - performance
    - accessibility
    - reduced-motion
    - moti
    - lottie
    - rive
    - haptics
---

# Animations (React Native / Expo)

Produces or reviews React Native animations that hold 60/120 fps by running motion on the **UI thread** via Reanimated worklets, respect the OS Reduce Motion setting, and use the cheapest tool for the job — the Reanimated CSS API first, the worklet/hooks API for interactive motion, gesture-handler for touch, and asset runtimes (Lottie / Rive) only for designer-authored art.

> **This `SKILL.md` is a thin index.** Detailed rules live in
> [`rules/*.md`](./rules) and load on demand.
> This is the **native** sibling of the [`animations`](../animations/SKILL.md) skill — that one owns **web** (CSS, Motion, View Transitions); this one owns **React Native / Expo**.

---

## Core Bet

**Animate `transform` and `opacity`, and drive the value from the UI thread.**
Those are the properties the New Architecture applies to a mounted view without a Yoga layout recalculation — the RN analog of the web "composite-only" rule.
Layout props (`width`, `height`, `top`, `left`, `flex`, `margin`) recompute layout every frame and jank.
Driving the value from the UI thread (a Reanimated shared value, not React `useState`) keeps motion smooth even when the JS thread is busy.
Full property table and the threading model in [`rules/reanimated-core.md`](./rules/reanimated-core.md).

---

## Brainstorm Mode — interaction → feedback

When the question is **what** the motion should be (not **how** to build it), the reasoning is platform-agnostic and already lives in the `animations` skill.
Read the five-question brainstorm and the verb→motion catalog in [`../animations/rules/interaction-feedback.md`](../animations/rules/interaction-feedback.md) — verb, reversibility, initiator, spatial source, affordance load, plus the intensity ladder and direction principle.
The duration bands and easing conventions carry straight over to native; the native-specific spring/personality notes are in [`rules/reanimated-core.md`](./rules/reanimated-core.md#timing-easing--platform-personality).
Then hand off to the decision flow below for the mechanics.

---

## Decision flow

Walk in order. First match wins.

| # | Signal | Tool |
| - | ------ | ---- |
| 1 | State-controlled, self-contained motion (pulse, entrance, a value tied to React state) | Reanimated **CSS API** (`animationName` / `transitionProperty`) ([`reanimated-core.md`](./rules/reanimated-core.md)) |
| 2 | Enter / exit / reorder of a component or list item | Reanimated **layout animations** (`entering` / `exiting` / `layout`) ([`reanimated-core.md`](./rules/reanimated-core.md)) |
| 3 | Gesture-driven, scroll-driven, or interruptible motion | Reanimated **worklet/hooks API** + **gesture-handler** ([`gestures.md`](./rules/gestures.md)) |
| 4 | Simple isolated fade with no dependency budget | RN core **`Animated`** + `useNativeDriver: true` ([`libraries.md`](./rules/libraries.md)) |
| 5 | Framer-Motion-style declarative props on a Reanimated 3 stack | **Moti** (check Reanimated-4 compatibility) ([`libraries.md`](./rules/libraries.md)) |
| 6 | Designer-authored After Effects asset, fixed timeline | **Lottie** ([`libraries.md`](./rules/libraries.md)) |
| 7 | Designer-authored interactive asset (state machine, inputs) | **Rive** ([`libraries.md`](./rules/libraries.md)) |

If two rows match, pick the lower-numbered one — it has fewer dependencies.

---

## Workflow

For any RN animation task — author or review — walk these phases.

| Phase | Name | Rule file | Gate |
| ----- | ---- | --------- | ---- |
| A | Brainstorm feedback (entry is "what?") | [`../animations/rules/interaction-feedback.md`](../animations/rules/interaction-feedback.md) | If the user describes an *interaction* (a verb), the five questions are answered and a catalog row picked before mechanics. Skip if they describe a primitive ("fade this in"). |
| 0 | Choose the property & thread | [`rules/reanimated-core.md`](./rules/reanimated-core.md) | Animated property is `transform` / `opacity` (or `backgroundColor`); the value is a shared value on the UI thread, not React state. |
| 1 | Pick the API | [`rules/reanimated-core.md`](./rules/reanimated-core.md), [`rules/libraries.md`](./rules/libraries.md) | Decision flow above is followed; CSS API / layout animation preferred over hand-rolled worklets when it fits. |
| 2 | Wire gestures (if interactive) | [`rules/gestures.md`](./rules/gestures.md) | `GestureHandlerRootView` present; callbacks drive shared values; state setters go through `scheduleOnRN` / `runOnJS`; ScrollView coexistence handled. |
| 3 | Time it | [`rules/reanimated-core.md`](./rules/reanimated-core.md#timing-easing--platform-personality) | Duration 100–500 ms; ease-out entrances, ease-in exits; springs for gesture-driven / interruptible motion. |
| 4 | Respect Reduce Motion | [`rules/accessibility.md`](./rules/accessibility.md) | Reanimated respects the OS setting by default; library assets (Lottie/Rive) and non-Reanimated motion are gated; motion is reduced, not removed. |
| 5 | Add haptics (high-stakes only) | [`rules/accessibility.md`](./rules/accessibility.md) | Haptic fires at the visual state change, paired with a visual cue, never haptic-only. |
| 6 | Measure | [`rules/performance.md`](./rules/performance.md) | Perf Monitor shows the animation holding on the UI thread; UI-thread and JS-thread FPS read separately; strict logger clean. |

---

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files |
| ----- | ----- |
| A | [`../animations/rules/interaction-feedback.md`](../animations/rules/interaction-feedback.md) |
| 0–1, 3 | [`rules/reanimated-core.md`](./rules/reanimated-core.md) |
| 1, 4–7 (libraries) | [`rules/libraries.md`](./rules/libraries.md) |
| 2 | [`rules/gestures.md`](./rules/gestures.md) |
| 4–5 | [`rules/accessibility.md`](./rules/accessibility.md) |
| 6 | [`rules/performance.md`](./rules/performance.md) |

---

## Core Principles

1. **UI thread or bust.** Animation values live in shared values on the UI thread. A value in React `useState` re-renders per frame and janks.
2. **Non-layout properties only.** `transform` and `opacity` skip the Yoga layout pass; `width` / `height` / `flex` / position do not.
3. **Prefer the declarative layer.** The Reanimated CSS API and layout animations express most state-driven and reflow motion with less code than hand-rolled worklets — reach for worklets when the motion is gestural or orchestrated.
4. **Gestures are worklets.** gesture-handler callbacks run on the UI thread; anything touching React state must cross back via `scheduleOnRN` (`runOnJS` on v3).
5. **Springs for physical motion.** Gesture releases and interruptible motion use `withSpring` / `withDecay`; deterministic choreography uses `withTiming` + easing.
6. **Reduce, do not remove.** Reanimated respects Reduce Motion by default; for library assets and custom motion, substitute a cross-fade or snap — never strip the state-change signal.
7. **Measure the split.** UI-thread vs JS-thread FPS localizes jank: a UI-thread drop is the animation, a JS-thread-only drop is unrelated React work.
8. **Match the platform's motion personality.** iOS is spring-driven and deferential; Material 3 is expressive and choreographed. Adapt the feel, keep the brand.

---

## Anti-patterns (one-liners — full lists in the linked rules)

- Animating `width` / `height` / `flex` / `top` / `left` instead of `transform` ([`reanimated-core.md`](./rules/reanimated-core.md)).
- Holding a per-frame animation value in React `useState` ([`reanimated-core.md`](./rules/reanimated-core.md)).
- Reading `sharedValue.value` during render ([`reanimated-core.md`](./rules/reanimated-core.md)).
- Calling `setState` directly from a gesture / worklet instead of `scheduleOnRN` ([`gestures.md`](./rules/gestures.md)).
- Forgetting `GestureHandlerRootView` — gestures silently dead ([`gestures.md`](./rules/gestures.md)).
- Using the legacy `<PanGestureHandler>` / `useAnimatedGestureHandler` in new code ([`gestures.md`](./rules/gestures.md)).
- Recommending Moti on a Reanimated-4 / Expo-54+ stack without checking compatibility ([`libraries.md`](./rules/libraries.md)).
- `require()`-ing a heavy Lottie/Rive asset at a startup screen's top level ([`libraries.md`](./rules/libraries.md)).
- Haptic-only feedback, or a haptic on every interaction ([`accessibility.md`](./rules/accessibility.md)).
- Deleting a transition under Reduce Motion instead of substituting a fade ([`accessibility.md`](./rules/accessibility.md)).
- Judging smoothness on a debug build with the debugger attached ([`performance.md`](./rules/performance.md)).

---

## Composes with

- **[`animations`](../animations/SKILL.md)** — the web sibling. It owns CSS, Motion, View Transitions, and the shared brainstorm / verb→motion catalog this skill references. Use it for web targets; use this for React Native / Expo.
- **[`/visual-design`](../visual-design/SKILL.md)** — motion personality is a brand signal. Commit to a style direction there, then return here for the mechanics.
- **[`/ux`](../ux/SKILL.md)** — Reduce Motion, touch-target sizing, and gesture affordances are accessibility-floor checks owned by `/ux`.

---

## Definition of Done

- [ ] The animated property is `transform`, `opacity`, or `backgroundColor` — not a layout property.
- [ ] The animation value is a Reanimated shared value on the UI thread, not React state.
- [ ] Any state update from a gesture / worklet goes through `scheduleOnRN` (`runOnJS` on v3).
- [ ] `GestureHandlerRootView` wraps the root if gestures are used.
- [ ] Duration is 100–500 ms with ease-out entrances / ease-in exits, or a spring for gesture-driven motion.
- [ ] Reduce Motion is respected (Reanimated default, or an explicit substitute for library assets).
- [ ] Any haptic is paired with a visual cue, fired at the state change.
- [ ] Perf Monitor shows the animation holding frame rate on the UI thread on a release build.
