---
title: Reanimated Core — Worklets, Hooks, Animations, Layout
impact: HIGH
tags:
  - reanimated
  - worklets
  - shared-values
  - layout-animations
  - ui-thread
---

# Reanimated Core

The engine for React Native animations.
Reanimated runs animation logic on the **UI thread** as *worklets*, so motion stays at 60/120 fps even when the JS thread is busy.
This rule covers install, the threading model, the core hooks, the animation functions, layout animations, and the RN equivalent of the web "composite-only" rule.

## Contents

- Version & install (Reanimated 4 vs 3, Babel plugin, Expo)
- Two APIs: CSS (state-driven) vs worklet/hooks (gesture/scroll/complex)
- Threading model — JS thread vs UI thread, `scheduleOnRN` / `scheduleOnUI`
- Core hooks — `useSharedValue`, `useAnimatedStyle`, `useDerivedValue`, `useAnimatedReaction`, `useAnimatedScrollHandler`
- Animation functions — `withTiming`, `withSpring`, `withDecay`, `withSequence`, `withDelay`, `withRepeat`
- Timing, easing & platform personality
- Layout animations — `entering` / `exiting` / `layout`
- Cheap vs expensive properties (the composite-only analog)
- Common mistakes

---

## Version & install

- **Reanimated 4** (GA July 2025, current 4.6.x) is **New Architecture (Fabric) only** — it dropped Old Architecture support entirely.
- If the app is still on the Old Architecture, stay on **Reanimated 3** (last old-arch line, maintenance-only).
- Worklet machinery was extracted into a standalone **`react-native-worklets`** package that Reanimated 4 depends on.

Expo (managed):

```bash
npx expo install react-native-reanimated react-native-worklets
npx expo prebuild   # v4 needs New-Arch native code; use a dev build, not Expo Go
```

Babel — the plugin is **`react-native-worklets/plugin`** and **must be listed last**:

```js
// babel.config.js
module.exports = {
  presets: ['babel-preset-expo'],           // managed Expo auto-includes the worklets plugin
  plugins: ['react-native-worklets/plugin'], // bare/CLI: add explicitly, keep LAST
};
```

The deprecated `react-native-reanimated/plugin` still works but should be migrated.
Reset the Metro cache after Babel changes: `npm start -- --reset-cache`.

---

## Two APIs — pick the cheaper one

Reanimated 4 exposes two layers. Walk this first.

| Signal | API |
| ------ | --- |
| State-controlled, self-contained motion (pulse, entrance, hover/press state, a value tied to React state) | **CSS API** (v4-only) — `animationName` / `transitionProperty` style props. Less code, explicit tracked properties. |
| Gesture-driven, scroll-driven, screen transition, or orchestrating several derived values | **Worklet / hooks API** (v3 + v4) — `useSharedValue` + `useAnimatedStyle`. The recommended path for anything interactive. |

CSS animation (v4):

```jsx
<Animated.View
  style={{
    animationName: { from: { transform: [{ scale: 0.8 }] }, to: { transform: [{ scale: 1 }] } },
    animationDuration: '300ms',
    animationTimingFunction: 'ease-out',
  }}
/>
```

CSS transition (v4) — fires when a referenced style value changes:

```jsx
<Animated.View style={{ opacity, transitionProperty: 'opacity', transitionDuration: 250 }} />
```

Everything below is the worklet/hooks API.

---

## Threading model

- **JS thread** — React render, business logic, state.
- **UI thread** — view rendering; where Reanimated runs worklets.
- A **worklet** is a function marked `'worklet';` that runs on the UI thread.
  Reanimated's Babel plugin auto-workletizes hook callbacks and gesture callbacks, so you rarely write the directive by hand.
- **Shared values** (`useSharedValue`) are the JS↔UI bridge and synchronize across threads automatically.

Cross-thread calls (Reanimated 4 names; old names in parentheses are deprecated aliases):

| Direction | Reanimated 4 | Deprecated alias |
| --------- | ------------ | ---------------- |
| Run a worklet on the UI thread from JS | `scheduleOnUI(fn, ...args)` | `runOnUI(fn)(...args)` |
| Call a plain JS function from a worklet | `scheduleOnRN(fn, ...args)` | `runOnJS(fn)(...args)` |

The v4 form passes arguments inline (`scheduleOnRN(setOpen, true)`), not as a second call.
Any React state setter, navigation call, or other non-worklet JS invoked from inside a worklet **must** go through `scheduleOnRN` — calling it directly crashes.
`scheduleOnRN` crosses the thread boundary, so never call it every frame; only on discrete events (`onEnd`, threshold crossed).

---

## Core hooks

```jsx
// useSharedValue — the animatable primitive.
const offset = useSharedValue(0);
// Writing from the JS thread is async: reading offset.value on the next line shows the OLD value.

// useAnimatedStyle — a style object driven by shared values. Pass ONLY to Animated.* components.
const style = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
return <Animated.View style={[styles.box, style]} />;
// NEVER mutate a shared value inside this callback — it loops.

// useDerivedValue — a reactive shared value computed from others.
const doubled = useDerivedValue(() => offset.value * 2);

// useAnimatedReaction — prepare() picks what to watch; react() runs the side-effect (both on UI thread).
useAnimatedReaction(
  () => offset.value,
  (current, previous) => { if (current !== previous) { /* ... */ } },
);
// Do NOT mutate the watched value inside react() — infinite loop.

// useAnimatedScrollHandler — drive a shared value from scroll position.
const scrollY = useSharedValue(0);
const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });
return <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} />;
```

---

## Animation functions

Assign the return value to `sv.value`, or return it from `useAnimatedStyle`.

| Function | Use |
| -------- | --- |
| `withTiming(to, { duration, easing })` | Duration + easing curve. Default `duration: 300`, `easing: Easing.inOut(Easing.quad)`. |
| `withSpring(to, config)` | Physics; the right choice for gesture releases and interruptible motion. |
| `withDecay({ velocity, deceleration, clamp, rubberBandEffect })` | Friction-based fling from a release velocity. |
| `withSequence(...anims)` | Run animations in order. |
| `withDelay(ms, anim)` | Delay before starting. |
| `withRepeat(anim, reps, reverse)` | Repeat; non-positive `reps` = infinite; `reverse: true` alternates. |

`withSpring` config (the two modes are mutually exclusive):

- **Physics-based:** `stiffness` (default `900`), `damping` (default `120`), `mass` (default `4`).
- **Duration-based (more predictable):** `duration` (default `550`) + `dampingRatio` (default `1`; `1` = no overshoot, `< 1` bouncy, `> 1` overdamped).
- Setting `duration` / `dampingRatio` overrides `stiffness` / `damping`.

```jsx
offset.value = withSpring(0, { duration: 400, dampingRatio: 0.8 });
```

---

## Timing, easing & platform personality

The verb→motion, duration-band, intensity-ladder, and direction reasoning is **platform-agnostic** — read it from the shared [`interaction-feedback` rule](../../animations/rules/interaction-feedback.md) in the `animations` skill.
The native-specific conventions:

- **Duration bands carry over:** micro ≤ 100 ms, standard 200–300 ms, large 350–500 ms. Below 100 ms reads as a jump; above 500 ms drags.
- **Ease-out for entrances, ease-in for exits; exits ~30 % faster.** `Easing.linear` only for indeterminate spinners.
- **Springs for anything gesture-driven or interruptible** (sheets, cards, dismissible rows) — a spring continues smoothly when a gesture hands off, a bezier restarts from zero velocity and looks wrong.
- **iOS personality** is spring-driven, deferential, reversible (slide up to dismiss reverses slide down). **Android / Material 3** is more expressive and choreographed; match its emphasized easing `cubic-bezier(0.2, 0, 0, 1)` and duration tokens (short 50–200 ms, medium 250–400 ms, long 450–600 ms) when the app targets Material.
- Adapt the *feel* to the platform, keep the *brand* consistent. Use platform-default navigation/gesture motion (users have muscle memory); unify only bespoke in-content animation.

---

## Layout animations

Props on `Animated.*` components — UI-thread-driven, no manual measurement.

```jsx
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

<Animated.View entering={FadeIn} exiting={FadeOut} layout={LinearTransition} />
```

- **Entering / exiting presets:** `FadeIn(Up|Down|Left|Right)`, `SlideIn*`, `ZoomIn*`, `BounceIn*`, `Flip*`, and their `*Out` counterparts.
- **Chainable modifiers:** `.duration(ms)`, `.delay(ms)`, `.easing(fn)`, `.springify()`, `.withInitialValues({...})`, `.withCallback(finished => {})`.
- **`layout={LinearTransition}`** animates position + size when a component's layout changes (`LinearTransition` is the current name for the old `Layout`).
- **`itemLayoutAnimation`** on `Animated.FlatList` animates item reorders.
- Define layout-animation builders outside the component or in `useMemo` so they are not recreated each render.

These are the performant path for list add/remove and reflow — reach for them instead of animating `height`.

---

## Cheap vs expensive properties

The RN analog of the web "animate `transform` / `opacity` / `filter` only" rule is **"animate non-layout properties only."**

| Cheap (no layout pass) | Expensive (forces a Yoga layout recalc every frame) |
| ---------------------- | --------------------------------------------------- |
| `transform`: `translateX/Y`, `scale`, `rotate` | `width`, `height` |
| `opacity` | `top`, `left`, `right`, `bottom` |
| `backgroundColor` (a paint change — still cheaper than layout) | `margin`, `padding`, `flex`, `flexBasis` |

The New Architecture has a fast path that applies `transform` / `opacity` directly to the mounted view with no layout recalculation.
Prefer `scale` over animating `width` / `height`; prefer `translateX` over `left`.
Keep animated component counts modest: roughly ≤ 100 on low-end Android, ≤ 500 on iOS.

> **2026 caveat.** RN 0.85 introduced an experimental Shared Animation Backend that lets the core `Animated` API drive layout props with the native driver.
> It is opt-in and experimental — the `transform` / `opacity`-first rule remains the baseline.

---

## Examples

### Good — a draggable that springs back, all on the UI thread

```jsx
const offset = useSharedValue(0);
const style = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
// offset is driven by a gesture (see rules/gestures.md); on release: offset.value = withSpring(0);
return <Animated.View style={[styles.card, style]} />;
```

### Bad — animating a layout property and re-rendering per frame

```jsx
// Recomputes Yoga layout every frame AND re-renders React on every value change.
const [width, setWidth] = useState(100);
useEffect(() => { const id = setInterval(() => setWidth((w) => w + 1), 16); return () => clearInterval(id); }, []);
<View style={{ width }} />
```

`width` forces a layout pass and `useState` re-renders the tree 60×/s.
Use `transform: [{ scaleX }]` driven by a shared value instead.

---

## Common mistakes

- **Reading `sv.value` during render.** It is a side-effect and blocks the JS thread until the UI thread returns it. **Fix:** read only inside worklets / `useAnimatedStyle` / `useEffect`. Reanimated's strict logger flags this.
- **Calling `setState` directly from a worklet.** Crashes. **Fix:** wrap it in `scheduleOnRN` (`runOnJS` on v3).
- **Mutating a shared value inside `useAnimatedStyle` or `useAnimatedReaction`'s `react()`.** Infinite loop. **Fix:** only read there; write from events.
- **Animating `width` / `height` / `flex` / `top` / `left`.** Layout thrash. **Fix:** `transform` + `opacity`, or a layout animation for reflow.
- **Forgetting the Babel plugin, or not putting it last.** Worklets silently fail. **Fix:** `react-native-worklets/plugin` last, then clear the Metro cache.
- **Recreating layout-animation builders / gesture objects each render.** **Fix:** hoist or `useMemo`.
