---
title: Gestures — react-native-gesture-handler + Reanimated
impact: HIGH
tags:
  - gesture-handler
  - gestures
  - pan
  - pinch
  - drag
---

# Gestures

`react-native-gesture-handler` recognizes touch gestures on the **native/UI thread** and hands their values to Reanimated worklets, so drag, pinch, and swipe run at full frame rate without crossing the bridge.
This rule covers setup, the gesture APIs (builder and the v3 hook API), composition, the Reanimated integration, ScrollView coexistence, and the canonical patterns.

## Contents

- Version & three API generations
- Setup — `GestureHandlerRootView`
- Gestures & callbacks
- Composition — race / simultaneous / exclusive
- Reanimated integration — the canonical draggable
- ScrollView coexistence
- `Pressable` vs `PanResponder` vs gesture-handler
- Common patterns
- Common mistakes

---

## Version & three API generations

Do not conflate these — they coexist in the ecosystem:

| Generation | API | Status (2026) |
| ---------- | --- | ------------- |
| **Legacy handlers** | `<PanGestureHandler>`, `useAnimatedGestureHandler` | **Deprecated — never write new code with these.** |
| **Builder API** | `Gesture.Pan()` + `<GestureDetector>` | **Deprecated but fully supported.** Works on v2 and v3; what most existing code and tutorials use. The pragmatic baseline. |
| **Hook API** | `usePanGesture({...})` + `<GestureDetector>` | **New recommended API**, introduced in gesture-handler **v3.0** (2026, New-Architecture-only). |

Teach the **builder API** by default (maximum compatibility — v2 and v3), and reach for the **hook API** when the project is on gesture-handler v3+ and starting fresh.
Both attach to the same `<GestureDetector>` and drive the same Reanimated shared values; only the surface differs.
**Do not mix builder-API and hook-API gestures inside one composition.**

Install (Expo): `npx expo install react-native-gesture-handler`, then `npx expo prebuild` for a dev build.

---

## Setup

Wrap the app root once, as close to the true root as possible:

```jsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function App() {
  return <GestureHandlerRootView style={{ flex: 1 }}>{/* app */}</GestureHandlerRootView>;
}
```

Gestures silently receive no touches outside it (especially on Android and inside iOS modals), and gesture relations only work between gestures under the same root.
Expo Router auto-wraps the app in `GestureHandlerRootView` in recent SDKs — verify per SDK before adding a second one.

---

## Gestures & callbacks

Base gestures (builder → hook name):

`Gesture.Pan()` → `usePanGesture`, `Gesture.Tap()` → `useTapGesture`, `Gesture.LongPress()` → `useLongPressGesture`, `Gesture.Pinch()` → `usePinchGesture`, `Gesture.Rotation()` → `useRotationGesture`, `Gesture.Fling()` → `useFlingGesture`, `Gesture.Hover()` → `useHoverGesture`, `Gesture.Native()` → `useNativeGesture`, `Gesture.Manual()` → `useManualGesture`.

Callback lifecycle (builder API):

| Callback | Fires when |
| -------- | ---------- |
| `.onBegin` | Touches start, before activation. |
| `.onStart` | Gesture is recognized / activated. |
| `.onUpdate` | Every frame while active (absolute values, e.g. `translationX`). |
| `.onChange` | Like `onUpdate` but the event carries per-frame deltas (`changeX`, `changeY`). |
| `.onEnd` | Gesture ends after being active. |
| `.onFinalize` | Always fires last, activated or not (cleanup). |

The **hook API renames** two: `onStart` → `onActivate`, `onEnd` → `onDeactivate`, and replaces the old `success` boolean with an inverted **`canceled`** property on the event (`canceled: true` ≡ `success: false`).

```jsx
const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => { /* like */ });
const longPress = Gesture.LongPress().minDuration(500).onStart(() => {});
const pinch     = Gesture.Pinch().onUpdate((e) => { scale.value = base.value * e.scale; });
```

Gesture objects must be stable across renders — hoist them or wrap in `useMemo`.

---

## Composition

| Combinator | Behaviour | Canonical use |
| ---------- | --------- | ------------- |
| `Gesture.Race(a, b)` | First to activate wins; others cancel. | Mutually-exclusive alternatives. |
| `Gesture.Simultaneous(a, b)` | All active at once. | Pinch + rotate + pan on a photo. |
| `Gesture.Exclusive(a, b)` | Later activates only if the earlier *fails*. | Single-tap vs double-tap (single only fires if double fails). |

```jsx
const photo = Gesture.Simultaneous(pan, pinch, rotation);
const taps  = Gesture.Exclusive(doubleTap, singleTap);
<GestureDetector gesture={photo}><Animated.View style={style} /></GestureDetector>
```

Hook-API equivalents: `useSimultaneousGestures()`, `useExclusiveGestures()`, `useCompetingGestures()` (the Race equivalent).

---

## Reanimated integration — the canonical draggable

Gesture callbacks are **automatically workletized** — access shared values directly, no `'worklet'` directive needed.
They run on the UI thread, so drag stays at frame rate.

```jsx
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withDecay } from 'react-native-reanimated';

const offset = useSharedValue(0);

const pan = Gesture.Pan()
  .onChange((e) => { offset.value += e.changeX; })          // follow the finger
  .onFinalize((e) => {
    offset.value = withDecay({ velocity: e.velocityX, rubberBandEffect: true, clamp: [minX, maxX] });
  });

const style = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

<GestureDetector gesture={pan}>
  <Animated.View style={[styles.card, style]} />
</GestureDetector>
```

Snap-back instead of fling: `.onFinalize(() => { offset.value = withSpring(0); })`.
To call React state from a gesture (e.g. remove an item after a swipe), wrap it: `scheduleOnRN(removeItem, id)` (`runOnJS` on v3).

---

## ScrollView coexistence

A `Pan` inside a `ScrollView` steals the scroll unless you gate activation:

- `.activeOffsetX([-10, 10])` — don't activate the pan until horizontal movement passes the threshold.
- `.failOffsetY([-10, 10])` — fail the pan if the finger moves vertically first, letting the ScrollView scroll.

This is the standard recipe for a horizontally-swipeable row inside a vertical list.

---

## `Pressable` vs `PanResponder` vs gesture-handler

| Need | Use |
| ---- | --- |
| Plain tap / press / hover / focus state | RN core **`Pressable`** — runs on the JS thread, fine for buttons. |
| Legacy JS-thread drag | **`PanResponder`** — superseded; avoid in new code. |
| Continuous, high-frame-rate, interruptible, or Reanimated-driven motion; multiple coordinated gestures | **gesture-handler** — native-thread recognition, real composition, ScrollView coexistence. |

gesture-handler v3 also ships a native `Touchable` button (native press feedback, no JS re-render); the old `RectButton` / `BorderlessButton` are deprecated.

---

## Common patterns

| Pattern | Gesture | Technique |
| ------- | ------- | --------- |
| Swipe-to-dismiss | `Pan` | Track `translateX`; on end, past threshold → `withTiming` off-screen + `scheduleOnRN` to remove, else `withSpring(0)`. |
| Bottom sheet | `Pan` | Drive `translateY`; snap to points with `withSpring`; `activeOffsetY` to coexist with inner scroll. |
| Pinch-to-zoom | `Pinch` (often `Simultaneous` with `Pan`) | `scale.value = base * e.scale`; commit base in `onEnd`; rubber-band past bounds. |
| Double-tap-to-like | `Tap().numberOfTaps(2)` | Animate a heart; `scheduleOnRN(setLiked, true)`; compose with single-tap via `Exclusive`. |
| Draggable | `Pan` | Accumulate `changeX/Y` (or store start offset in `onStart`); apply via `useAnimatedStyle`. |

---

## Common mistakes

- **Forgetting `GestureHandlerRootView`.** Gestures silently dead. **Fix:** wrap the root once.
- **Calling `setState` directly in a callback.** Crashes (callbacks are worklets). **Fix:** `scheduleOnRN` / `runOnJS`.
- **A `Pan` swallowing list scroll.** **Fix:** `.activeOffsetX` / `.failOffsetY`.
- **Recreating gesture objects each render.** Broken recognition. **Fix:** `useMemo` or hoist.
- **Mixing builder-API and hook-API gestures in one composition.** **Fix:** pick one surface per composition.
- **Using the legacy `<PanGestureHandler>` / `useAnimatedGestureHandler`.** **Fix:** builder API (`Gesture.Pan()`) or the v3 hook API.
