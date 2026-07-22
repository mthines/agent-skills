---
title: Accessibility — Reduced Motion & Haptics
impact: HIGH
tags:
  - reduced-motion
  - accessibility
  - haptics
  - vestibular
  - prefers-reduced-motion
---

# Accessibility

The mobile analog of the web `prefers-reduced-motion` media query, plus haptics as a feedback channel.
There is no CSS media query on native — you read the OS setting through `AccessibilityInfo` or Reanimated's hook.
This rule covers detecting reduced motion, what Reanimated does automatically, vestibular-safe substitutes, and haptic feedback.

## Contents

- Detecting reduced motion
- What Reanimated does automatically
- Vestibular-safe substitutes
- Haptics as feedback
- Common mistakes

---

## Detecting reduced motion

Two OS toggles map to one RN signal:

- **iOS:** Settings → Accessibility → Motion → **Reduce Motion**.
- **Android:** Settings → Accessibility → **Remove animations**.

Reanimated (synchronous, reflects the setting at app start — does **not** re-render on live change):

```jsx
import { useReducedMotion } from 'react-native-reanimated';
const reduceMotion = useReducedMotion();
```

RN core (async, and re-renders on live change — use this when the screen must react to the toggle flipping while open):

```jsx
useEffect(() => {
  AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
  return () => sub.remove();
}, []);
```

---

## What Reanimated does automatically

Every animation function defaults to `reduceMotion: ReduceMotion.System`, so `withTiming` / `withSpring` **already respect the OS setting** — no extra code for the common case.

- When Reduce Motion is on, Reanimated **snaps to the end state** (not a no-op): `withTiming` / `withSpring` jump to target, `withDecay` returns the current value, `withDelay` skips the delay, `withRepeat` skips infinite/reversed repeats. Exiting and shared-element transitions do not play.
- Override per-animation: `withTiming(1, { reduceMotion: ReduceMotion.Never })` to force motion, `ReduceMotion.Always` to force-disable.
- Set it app-wide with `<ReducedMotionConfig mode={ReduceMotion.System} />` at the root.
- Known caveat: animation completion callbacks may not fire while reduced motion is active — do not gate critical logic on them in that state.

---

## Vestibular-safe substitutes

Reduce Motion means "no motion that creates a sense of physical movement," **not** "no animation." Reduce, do not remove — the user still needs the state-change signal.

| Risky (disable) | Safe substitute |
| --------------- | --------------- |
| Large-scale slide / translate | Opacity cross-fade |
| Zoom / scale | Instant snap to end state |
| Spin / rotate | Color change |
| Parallax, autoplay | Static frame / poster |

WCAG 2.3.3 (Animation from Interactions) backs making non-essential motion disableable.
For Lottie, use the designer's `reduced motion` marker; for Rive, jump the state machine to a rest state or render a poster (see [`libraries.md`](./libraries.md)).

---

## Haptics as feedback

Haptics reinforce a visual state change — they are never a standalone channel.

`expo-haptics` (`npx expo install expo-haptics`):

```jsx
import * as Haptics from 'expo-haptics';
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);              // collision / press
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); // outcome
Haptics.selectionAsync();                                            // selection tick
```

- Fire the haptic **at the instant of the visual state change** — the toggle flips, the card snaps, the drag crosses its threshold.
- Match intensity to context: `Light` / `Soft` for a subtle cue, `Heavy` / `Rigid` for a strong impact.
- **Design for the lowest common denominator.** iOS has a rich Taptic Engine; Android is coarser. On iOS the engine silently no-ops under Low Power Mode or when disabled — so a haptic can never be the only feedback.
- Avoid haptic fatigue — do not attach one to every animation. Reserve full-stack (visual + haptic + sound) for the single most important moment in a flow.
- On bare RN, `react-native-haptic-feedback` covers the same ground synchronously.

---

## Common mistakes

- **Assuming you must hand-code reduced-motion branches for Reanimated.** It respects the OS setting by default. **Fix:** rely on `ReduceMotion.System`; only branch for library assets (Lottie/Rive) and non-Reanimated motion.
- **Using `useReducedMotion()` when the screen must react to a live toggle.** It only reads at app start. **Fix:** add the `AccessibilityInfo` listener.
- **Deleting the transition entirely under reduced motion.** The user loses the state-change signal. **Fix:** cross-fade or snap to the end state.
- **Haptic-only feedback.** Users disable haptics, run Low Power Mode, or cannot perceive vibration. **Fix:** always pair with a visual cue.
- **A haptic on every interaction.** Fatigue. **Fix:** reserve for meaningful moments.
