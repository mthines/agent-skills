---
title: Libraries — Animated core, Moti, Lottie, Rive
impact: MEDIUM
tags:
  - moti
  - lottie
  - rive
  - animated-api
  - decision
---

# Libraries

When Reanimated is not the right tool.
This rule covers the RN core `Animated` API, Moti (declarative Reanimated wrapper), and the two designer-asset runtimes — Lottie and Rive.
Reach here after the decision flow in `SKILL.md` routes you off the Reanimated path.

## Contents

- Decision flow
- RN core `Animated` API
- Moti
- Lottie
- Rive
- Cross-cutting rules for asset runtimes
- Common mistakes

---

## Decision flow

| # | Signal | Tool |
| - | ------ | ---- |
| 1 | Gesture-driven, scroll-driven, interruptible, or performance-critical motion | **Reanimated** ([`reanimated-core.md`](./reanimated-core.md)) |
| 2 | Simple, isolated declarative transition; tiny app; avoiding a dependency | **RN core `Animated`** with `useNativeDriver: true` |
| 3 | You want a Framer-Motion-style `from` / `animate` / `exit` prop API and you are on a Reanimated 3 stack | **Moti** (verify Reanimated-4 compatibility first) |
| 4 | Designer-authored **After Effects** asset, fixed timeline (loader, illustration, success checkmark) | **Lottie** (`lottie-react-native`) |
| 5 | Designer-authored **interactive** asset — state machine, inputs, a mascot reacting to app state | **Rive** (`rive-react-native`) |

---

## RN core `Animated` API

Still bundled and documented; **not** formally deprecated, though the community treats it as legacy next to Reanimated.

- Set `useNativeDriver: true` so the config is serialized to native and stepped on the UI thread — without it, values are computed on the JS thread and jank when JS is busy.
- The native driver animates **only `transform` and `opacity`** (pre-RN-0.85); it cannot drive layout props.
- `Animated.event` works with direct events (`ScrollView#onScroll`) but not with `PanResponder` bubbling events — a weaker gesture story than gesture-handler.

```jsx
const opacity = useRef(new Animated.Value(0)).current;
Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
<Animated.View style={{ opacity }} />
```

Use it for one-off opacity/translate fades in isolation.
Reach for Reanimated for anything the user directly interacts with.

---

## Moti

A declarative, Framer-Motion-style library by `nandorojo`, powered by Reanimated.

```tsx
import { MotiView } from 'moti';

<MotiView
  from={{ opacity: 0, translateY: 12 }}
  animate={{ opacity: 1, translateY: 0 }}
  exit={{ opacity: 0, translateY: 12 }}
  transition={{ type: 'timing', duration: 350 }}
/>
```

- `<MotiView>` / `<MotiText>` / `<MotiImage>`; `AnimatePresence` for mount/unmount; `useAnimationState` for named states with no re-render.
- Best for declarative, state-driven styling and simple enter/exit. For complex chained/gesture motion, drop to raw Reanimated.

> **Compatibility risk (2026).** Moti's last release is `0.30.0` (Jan 2025) and it targets **Reanimated 3**; Reanimated-4 support is an open, unresolved issue.
> Since Expo SDK 54+ ships Reanimated 4, Moti may be broken there or require pinning Reanimated to 3.x.
> **Verify against the app's exact Reanimated version before recommending it; on a Reanimated-4 stack, prefer raw Reanimated.**

---

## Lottie

`lottie-react-native` (current 7.x) plays **After Effects** vector animations exported via Bodymovin.

```jsx
import LottieView from 'lottie-react-native';
<LottieView source={require('./success.json')} autoPlay loop={false} style={{ width: 120, height: 120 }} />
```

- Scrub the timeline by driving the `progress` prop (0–1) with an animated value.
- Best for pre-baked, plays-start-to-finish art: onboarding, success checkmarks, loaders, empty-state illustration.
- Honours a designer-added marker named `reduced motion` — if present, the OS setting auto-plays that segment with no app code.

---

## Rive

`rive-react-native` (v9.x, the stable default; `@rive-app/react-native` Nitro v2 is emerging) is a real-time **interactive** vector runtime.

```jsx
import Rive from 'rive-react-native';
<Rive resourceName="mascot" stateMachineName="State Machine 1" autoplay />
// drive it at runtime: ref.setInputState('State Machine 1', 'isWaving', true)
```

- A **state machine** with boolean / number / trigger **inputs** you drive at runtime — the animation reacts to app state or user input.
- `.riv` files are typically much smaller than the equivalent Lottie JSON.
- Choose Rive over Lottie for interactivity, runtime control, one file that swaps states instead of N Lottie files, or when size matters.
- No built-in reduced-motion hook — gate in app code (jump the state machine to a rest state, or render a poster).

---

## Cross-cutting rules for asset runtimes

- **None of Moti's asset peers, Lottie, or Rive run in Expo Go** — all need a **dev build** (`npx expo prebuild` → EAS/local build).
- **Lazy-load** heavy assets — do not `require()` a large animation at module top level on a startup screen; load on mount or lazy-load the wrapper so Metro does not eager-bundle it.
- **Pause off-screen** — gate `autoPlay` on `useIsFocused()`, and **unmount** (not just hide) heavy animations on leave to free native memory.
- **Reduced-motion** — render a static final frame or poster when Reduce Motion is on. See [`accessibility.md`](./accessibility.md).

---

## Common mistakes

- **Recommending Moti on a Reanimated-4 / Expo-54+ stack without checking.** **Fix:** verify the version; prefer raw Reanimated there.
- **`require()`-ing a big Lottie/Rive asset at the top of a startup screen.** Bloats the startup bundle. **Fix:** lazy-load.
- **Hiding an off-screen Lottie/Rive with `opacity: 0` instead of unmounting.** Keeps native memory + playback alive. **Fix:** unmount on blur.
- **Using RN core `Animated` without `useNativeDriver: true`.** Jank under JS load. **Fix:** enable the native driver, or use Reanimated.
- **Expecting Lottie/Rive to work in Expo Go.** **Fix:** build a dev client.
