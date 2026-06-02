---
title: Performance — Canvas vs SVG, Downsampling, Streaming, INP
impact: HIGH
tags:
  - performance
  - canvas
  - svg
  - lttb
  - downsampling
  - streaming
  - inp
  - frame-budget
---

# Performance

Charts get slow in three places: rendering the DOM/canvas, transforming the data, and handling interaction.
This file gives the thresholds, the techniques, and the libraries to use at each scale.

## Canvas vs SVG — the threshold

| Visible points (per chart) | Renderer       | Why                                                                    |
| -------------------------- | -------------- | ---------------------------------------------------------------------- |
| ≤ 500                      | SVG            | Crisp, accessible, easy to inspect.                                    |
| 500 – 5,000                | SVG (cautious) | Fine for desktops; jank starts on mid-range mobile.                    |
| 5,000 – 50,000             | Canvas         | DOM nodes become the bottleneck; switch to ECharts / uPlot / Visx-Canvas. |
| > 50,000                   | Canvas + WebGL | deck.gl, regl-charts, ECharts WebGL, Plotly.js GL.                     |

SVG is the default for everything else. **Switch only when you measure pain.**

## Downsampling for line charts

When the dataset has more points than pixels of x-axis width, **downsample**.
The standard algorithm is **Largest-Triangle-Three-Buckets (LTTB)** — visually faithful, near-O(N).

```ts
import { lttb } from "downsample";

const target = Math.min(rawData.length, chartWidthInPx);
const sampled = lttb(rawData, target);
<LineChart data={sampled} />
```

Notes:

- Run downsampling on the **server** when possible (`SELECT … FROM gen_series` window or pre-aggregated time buckets).
- For time series, prefer pre-aggregation in the warehouse (1m / 5m / 1h buckets) over LTTB on raw events.
- For client-side, memoize: `useMemo(() => lttb(raw, target), [raw, target])`.

## Time-bucket aggregation

Most "we have 1M points" problems disappear with bucket aggregation in SQL:

```sql
SELECT date_trunc('hour', ts) AS bucket, avg(value) AS avg, max(value) AS max
FROM events
WHERE ts BETWEEN $1 AND $2
GROUP BY 1
ORDER BY 1;
```

A 90-day chart with hourly buckets has 2,160 points — well under the SVG ceiling.

## Streaming and real-time

| Update cadence  | Recommended technique                                                              |
| --------------- | ---------------------------------------------------------------------------------- |
| ≤ 1 update / s  | Re-render with React state. Memoize series transforms.                             |
| 1–10 / s        | Drop-in `uPlot` (Canvas, ~40 kB) or ECharts with `appendData`. Skip React updates. |
| > 10 / s        | uPlot or a custom Canvas / WebGL renderer. Bypass React entirely.                  |

For high-frequency feeds, use a **ring buffer** in a `useRef` and call the chart's imperative `appendData` API.
Re-rendering a 10k-point line chart at 30Hz via React props will pin the main thread.

```ts
const bufferRef = useRef<Point[]>([]);
useEffect(() => {
  const ws = new WebSocket(url);
  ws.onmessage = (e) => {
    const p = JSON.parse(e.data);
    bufferRef.current.push(p);
    if (bufferRef.current.length > 5000) bufferRef.current.shift();
    chartRef.current?.appendData(p);   // imperative, no React render
  };
  return () => ws.close();
}, [url]);
```

### WebSocket vs SSE

- **WebSocket** when you need bidirectional or sub-second updates with backpressure control.
- **Server-Sent Events (SSE)** when the feed is one-way, infrequent (≥ 1s), and you want HTTP/2 multiplexing for free.
- Always **debounce the chart**, not the socket: cap render to 30Hz with `requestAnimationFrame`.

## INP and main-thread work

Charts contribute heavily to **INP (Interaction to Next Paint)**.
Hovering 10,000 SVG nodes yanks the main thread; a click during that hover is then "slow".

### Reduce INP

- Switch to Canvas for > 5,000 visible points (see threshold table).
- Throttle hover via `requestAnimationFrame`, not `setTimeout`.
- Use `React.memo` on sub-components that consume only a slice of the data.
- Move `d3-scale` / `d3-shape` calls inside `useMemo` keyed on the data, not on render.
- Render the chart in a `<Suspense>` boundary so initial paint is not blocked.

### Frame-budget targets

| Surface                    | Target               |
| -------------------------- | -------------------- |
| Web interactions           | INP < 200 ms         |
| Web initial paint          | LCP < 2.5 s          |
| Mobile chart frame (60Hz)  | ≤ 16.6 ms / frame    |
| Mobile chart frame (120Hz) | ≤ 8.3 ms / frame     |

Mobile gestures must run on the UI thread to hit these — see `rules/interactivity-and-gestures.md`.

## Virtualization for many small charts

Dashboards with 50+ charts (one per service, one per metric) crash without virtualization.

- Use `@tanstack/react-virtual` to render only visible chart cards.
- Set fixed dimensions on each chart card so the virtualizer can compute placement.
- Defer heavy chart libs in the off-screen state — pass a static skeleton until the row is in view.

```tsx
const rowVirtualizer = useVirtualizer({
  count: charts.length,
  estimateSize: () => 280,
  getScrollElement: () => parentRef.current,
});
```

## React-specific perf rules

1. **Memoize `data` prop**. Most chart libraries treat it as a referential trigger; a new array on each render forces a full re-layout.
2. **Memoize formatters**. `tickFormatter`, `tooltipContent`, `labelFormatter` should be stable references.
3. **Keep chart components small**. A chart wrapper that also subscribes to filter state will re-render the chart whenever any unrelated state ticks.
4. **Avoid inline objects in props** — `margin={{ top: 20, … }}` recreates on every render. Lift to a constant.

## Bundle-size strategies

| Strategy                                                | Saving          |
| ------------------------------------------------------- | --------------- |
| Per-component imports (`import { LineChart } from "recharts"`) | 40–80 kB        |
| ECharts: `import * as echarts from "echarts/core"` + register only used charts | 60–150 kB       |
| Lazy-load heavy charts (`next/dynamic` with `ssr: false`) | 100–500 kB on initial bundle |
| Drop `d3-array` / `d3-format` re-exports if you only need scales | 5–20 kB         |
| Use Plotly only for 3D / geo                            | 500 kB+         |

## Profiling — what to measure

- **Web**: React DevTools Profiler (commit time per chart), Chrome Performance trace (long tasks, INP). See `/profile-optimizer`.
- **Mobile**: Flipper Performance, Reanimated dev tools, Hermes profiler. Inspect UI-thread frame time, not JS.
- **Streaming**: Network tab for socket message rate, then chart render rate. They should not match — render must be debounced.

## Checklist

- [ ] Visible points ≤ SVG ceiling (5,000) — otherwise switch to Canvas.
- [ ] Time-series data is pre-aggregated in SQL, not downsampled on the client.
- [ ] Streaming feeds use imperative chart APIs and a ring buffer.
- [ ] WebSocket / SSE choice matches update cadence.
- [ ] Hover handlers throttled with `requestAnimationFrame`.
- [ ] Chart `data`, formatters, and `margin` props memoized.
- [ ] Heavy charts lazy-loaded in Next.js with `ssr: false`.
- [ ] Mobile gestures run on UI thread (Reanimated + Skia + Gesture Handler).
- [ ] Many-chart dashboards use `@tanstack/react-virtual`.
