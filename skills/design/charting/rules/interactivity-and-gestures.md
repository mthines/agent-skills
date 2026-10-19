---
title: Interactivity and Gestures — Tooltips, Brush, Zoom, UI-Thread Mobile
impact: HIGH
tags:
  - interactivity
  - tooltips
  - brush
  - zoom
  - gestures
  - reanimated
  - skia
  - ui-thread
---

# Interactivity and Gestures

Charts answer questions; **interactivity** lets the reader ask follow-ups.
This file covers desktop interactions (hover, focus, brush, zoom, drill-down) and **mobile gestures that must run on the UI thread**.

## Contents

- [Web — interaction patterns](#web--interaction-patterns)
- [Mobile (Expo / React Native) — gestures on the UI thread](#mobile-expo--react-native--gestures-on-the-ui-thread)
- [Accessibility for interactive charts](#accessibility-for-interactive-charts)
- [Quick checklist](#quick-checklist)

## Web — interaction patterns

### 1. Tooltips: hover and focus, never just hover

Hover-only tooltips fail keyboard users (WCAG 2.1.1).

```tsx
// Recharts — Tooltip works on focus and hover by default; verify the wrapper is focusable
<g tabIndex={0} role="figure" aria-label="…">
  <ChartContainer>
    <BarChart data={data}>
      <Tooltip content={<CustomTooltip />} />
    </BarChart>
  </ChartContainer>
</g>
```

Pair the tooltip with an `aria-live="polite"` region that announces the focused point's value to screen readers.

### 2. Brush — range selection on a time axis

Use brush when the user must zoom into a sub-range without losing the global context.

- Place the brush **below** the main chart, mirroring the same series.
- Selection must be reflected in URL state — see `rules/state-filters-and-testing.md`.
- Provide `Reset` and `Last 7d / 30d / 90d` shortcuts; brush alone is too fiddly for trackpads.

```tsx
<ResponsiveContainer height={300}>
  <LineChart data={data}>
    <Brush dataKey="date" height={24} onChange={onRangeChange} />
    <Line dataKey="value" />
  </LineChart>
</ResponsiveContainer>
```

### 3. Zoom and pan

- Zoom **only on time-series and scatter** charts. Bar charts do not benefit.
- Always offer a zoom-out / reset control. A trapped user never recovers.
- Sync zoom across linked panels via shared state (Zustand, URL searchParams).

### 4. Drill-down and click-through

A click on a category bar should:

1. Update URL state (e.g. `?category=auth`).
2. Replace the chart with the next-level view (or open a side panel).
3. Provide a breadcrumb to return.

Do not collapse a click-through into a hover preview — users need a stable, linkable URL.

### 5. Crossfilter

Multiple charts on the same dashboard share a filter context.
Click a slice in chart A → all other charts re-filter.

- Implement with one shared store, not per-chart props drilling.
- Show the active filter as a **dismissible chip** above the dashboard.
- Apply the filter to the data **before** passing to each chart, not via chart-side `visible` flags.

### 6. Click-through to underlying records

For analytics dashboards, every chart point should be inspectable.
Provide a "View underlying rows" link in the tooltip footer that opens a filtered table.

## Mobile (Expo / React Native) — gestures on the UI thread

The single biggest mistake on mobile charts is running gesture handlers on the **JS thread**.
Each gesture event then crosses the bridge, the JS thread blocks on rendering, and the chart drops frames.
The fix is: **all gesture detection, all interpolation, and all chart drawing run on the UI thread.**

### Stack

| Layer                | Library                                 | Thread          |
| -------------------- | --------------------------------------- | --------------- |
| Gesture detection    | `react-native-gesture-handler`          | UI thread       |
| Animated values      | `react-native-reanimated` shared values | UI thread       |
| Drawing              | `@shopify/react-native-skia`            | UI thread       |
| Chart library        | `victory-native` (XL) or `gifted-charts` (Skia path) | UI thread       |

This trio (Skia + Reanimated + Gesture Handler) is the only path to consistent 60fps charts on mid-range Android.

### Hard rules

- **Use `Gesture.Pan()`, `Gesture.Pinch()`, `Gesture.Tap()` from Gesture Handler** — never `onTouch*` props from React Native core (those run on the JS thread).
- **Mutate shared values inside worklets** — never `setState` inside a gesture callback. State updates re-render React; shared values do not.
- **Read shared values directly in Skia draws** via `useDerivedValue`. Skia subscribes on the UI thread.
- **Bridge to JS only at gesture end**, and only when JS state needs to know (e.g. updating URL, persisting filter). Use `runOnJS(callback)(payload)` from inside a worklet.
- **`useAnimatedReaction`** is the right primitive for "when this shared value crosses a threshold, do X on JS".
- **No `Animated.event` from RN core** — that is the legacy API and bridges every frame on Android Paper.

### Pan-to-scrub pattern (Victory Native XL)

```tsx
import { Canvas, useFont } from "@shopify/react-native-skia";
import { CartesianChart, useChartPressState } from "victory-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue, runOnJS } from "react-native-reanimated";

export function ScrubLine({ data, onPointHover }: Props) {
  // chartPressState is a shared value updated on the UI thread by the chart
  const { state, isActive } = useChartPressState({ x: 0, y: { value: 0 } });

  // optional bridge to JS — fires only when the active index changes
  useAnimatedReaction(
    () => state.x.value.value,
    (current, prev) => {
      if (current !== prev) runOnJS(onPointHover)(current);
    },
  );

  return (
    <CartesianChart
      data={data}
      xKey="date"
      yKeys={["value"]}
      chartPressState={state}
    >
      {({ points }) => <Line points={points.value} animate={{ type: "timing" }} />}
    </CartesianChart>
  );
}
```

Notes:

- `useChartPressState` returns Reanimated shared values; the active index is updated inside a worklet.
- `useAnimatedReaction` is the only place we cross the bridge, and only on changes.
- The chart's `Line` reads the same shared values via `points` and redraws on the UI thread.

### Pinch-to-zoom on a time axis (Skia)

```tsx
const scale = useSharedValue(1);
const savedScale = useSharedValue(1);

const pinch = Gesture.Pinch()
  .onUpdate((e) => {
    "worklet";
    scale.value = clamp(savedScale.value * e.scale, 1, 10);
  })
  .onEnd(() => {
    "worklet";
    savedScale.value = scale.value;
  });

return (
  <GestureDetector gesture={pinch}>
    <Canvas style={{ width, height }}>
      <ZoomedLine data={data} scale={scale} />
    </Canvas>
  </GestureDetector>
);
```

`scale` is read inside `ZoomedLine` via `useDerivedValue` — Skia reads it on the UI thread, no bridge crossing per frame.

### Haptics on threshold cross

When a scrub crosses a meaningful value (target, average, threshold), fire a short haptic.

```tsx
import * as Haptics from "expo-haptics";

useAnimatedReaction(
  () => state.y.value.value > target,
  (above, prev) => {
    if (above && !prev) runOnJS(Haptics.selectionAsync)();
  },
);
```

Cap haptics to **one per logical event** — never one per frame.

### What to avoid on mobile

- **`onTouch*` JSX props** — JS thread, drops frames during heavy data updates.
- **`Animated.timing` from RN core** — legacy; use Reanimated's timing.
- **`setState` in `PanResponder`** — re-renders the React tree on every move event.
- **Re-creating chart data on every render** — memoize with `useMemo(() => transform(raw), [raw])`. Each rerender invalidates worklet captures.
- **JS-driven autoplay loops** — use Reanimated's `useFrameCallback` if you need a per-frame hook on the UI thread.

## Accessibility for interactive charts

Defer cross-cutting touch-target and contrast rules to the `ux` skill.
Chart-specific:

- Keyboard arrows must move focus across data points (web).
- Tooltips must announce via `aria-live="polite"` on focus change.
- On mobile, expose the focused point's value through `accessibilityValue` so VoiceOver / TalkBack reads "1.2 million, March".
- Provide a "View as table" toggle for any chart whose interaction does not work with assistive tech.

## Quick checklist

- [ ] Tooltip works on keyboard focus, not only hover (web).
- [ ] Brush selection is reflected in URL state.
- [ ] Zoom has a reset control.
- [ ] Crossfilter operates on shared store, not prop-drilling.
- [ ] Mobile gestures use Gesture Handler, not `onTouch*`.
- [ ] Mobile interpolation uses Reanimated shared values, not `setState`.
- [ ] Skia draws read shared values via `useDerivedValue` (UI thread).
- [ ] Bridge to JS only at gesture end via `runOnJS`.
- [ ] Haptics capped to one per logical event.
