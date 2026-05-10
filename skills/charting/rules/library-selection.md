---
title: Library Selection — Web (React/Next) and Mobile (Expo/RN)
impact: HIGH
tags:
  - libraries
  - react
  - nextjs
  - react-native
  - expo
  - decision-table
---

# Library Selection

Recommend a library only after the chart type and platform are known.
Pin every recommendation to a **dataset-size bracket** and a **design-system context** — recommendations in the abstract are wrong by default.

## Web — React / Next.js

### Decision table

| Need                                                                | Default                | Why                                                                                                          |
| ------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| shadcn/ui or Tailwind dashboard, common chart types                 | **shadcn charts**      | Recharts under the hood; tokens match shadcn; copy-paste blocks at [ui.shadcn.com/charts](https://ui.shadcn.com/charts). |
| SaaS / analytics dashboard, polished defaults, Tailwind             | **Tremor**             | High-level dashboard primitives on Recharts; KPI cards + filters out of the box.                             |
| Generic React chart, ≤ 5,000 points, common chart types             | **Recharts**           | SVG, declarative JSX API, large ecosystem; the safe default when nothing else applies.                       |
| Large datasets (> 10,000 points), real-time, dense dashboards       | **Apache ECharts**     | Canvas + WebGL backend; handles 100k+ points; rich built-in interactions.                                    |
| Custom / brand-specific visualization, low-level control            | **Visx**               | D3 primitives wrapped in React components; build exactly the chart you need.                                 |
| Accessibility-first SVG defaults, animations                        | **Nivo**               | ARIA + keyboard nav out of the box; SVG, Canvas, and HTML renderers.                                         |
| Anything 3D, geo-mapping, scientific viz                            | **Plotly.js**          | Built-in 3D, maps, statistical plots; large bundle — accept the cost for these use cases only.               |

### Server vs. client rendering (Next.js)

- All major chart libraries listed above need the DOM. Render in **client components** only.
- For SSR pages, render a static placeholder (skeleton, dimensions matched) on the server and hydrate the chart on the client.
- For App Router, mark the component `"use client"`; do not import chart libs in server components.

### Bundle-size brackets (gzipped, full library import — tree-shaking helps)

| Library      | Approx gzipped | Notes                                                          |
| ------------ | -------------- | -------------------------------------------------------------- |
| Recharts     | ~120 kB        | Tree-shakes per chart type.                                    |
| Tremor       | ~150 kB        | Bundles Recharts; copy-paste lowers cost.                      |
| Visx         | ~15–60 kB      | Per-component imports; you only ship what you use.             |
| Nivo         | ~80–500 kB     | Per chart type; some are heavy (Sankey, Geo).                  |
| ECharts      | ~250 kB        | Use `echarts/core` + per-chart imports; do not ship the full bundle. |
| Plotly.js    | ~700 kB        | Use `plotly.js-basic-dist-min` if you only need core types.    |

### When to pick what — quick rules

1. **Default to shadcn charts or Tremor** if the app is shadcn/Tailwind. Stop there for ≥ 80% of dashboards.
2. **Use Recharts directly** when you need a chart type that shadcn/Tremor doesn't ship.
3. **Reach for Visx** only when the brief is custom and you have time to build.
4. **Switch to ECharts** the moment you cross ~10,000 points or need streaming.
5. **Use Plotly.js** only for 3D, scientific, or full geo workflows; otherwise its bundle is wasted.

## Mobile — Expo / React Native

### Decision table

| Need                                                                | Default                       | Why                                                                                                          |
| ------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Performance + animation; complex charts; modern stack               | **Victory Native XL**         | Skia + Reanimated + Gesture Handler; rewritten in TS; maintained by Nearform.                                |
| Beautiful defaults out of the box, common chart types               | **react-native-gifted-charts**| SVG + Skia; great animations; covers bar, line, area, pie, donut, stacked.                                   |
| Simple metric tile, minimal dependencies                            | **react-native-chart-kit**    | Lightweight; good for one-off line / bar / pie inside a screen.                                              |
| Custom drawing, no Skia in the project                              | **react-native-svg + custom** | Hand-rolled SVG with `d3-shape`; total control; more code.                                                   |
| Mature wrapper around native MPAndroid/iOS chart libs               | **react-native-charts-wrapper** | Native-rendered, very fast; heavier setup; not Expo Go-friendly.                                            |

### Expo compatibility

- **Expo SDK 51+** supports `@shopify/react-native-skia` in dev clients. Victory Native XL and gifted-charts (Skia path) require a development build, **not Expo Go**.
- For Expo Go, prefer **react-native-chart-kit** or **gifted-charts** in its SVG-only mode.
- New Architecture (Fabric / TurboModules): Victory Native XL and Skia are first-class; verify chart-kit and chart-wrapper compatibility before adopting on a Fabric app.

### Mobile-specific constraints

- **Touch targets and gestures** — defer to the `ux` skill (44pt iOS / 48dp Android minimum). Charts are not exempt.
- **Canvas size** — never render a chart smaller than 280 × 160 pt on a phone. If smaller, use a sparkline.
- **GPU rendering** — prefer Skia-backed libraries for any chart with > 200 points or animation; SVG-only paths jank on mid-range Android.
- **Server-rendered apps** — Next.js / web SSR rules do not apply on RN; hydration is not a concern.

## Cross-platform considerations

- For codebases that share a UI layer across web and mobile (React Native Web), keep chart code in **platform-specific files** (`Chart.web.tsx`, `Chart.native.tsx`). Sharing a single chart implementation across both is a long, expensive trap.
- If the team must pick one library that works on both, **accept the trade-off**: Victory has had a unified API historically, but Victory Native XL is RN-only. There is no maintained library that is best-in-class on both surfaces.

## Tie-breakers

When two libraries fit, break the tie in this order:

1. **Already in the dependency tree.** A library you ship today beats a marginally better library you have to add.
2. **Design-system fit.** Does it match shadcn/Tremor / Material / your tokens with no override gymnastics?
3. **Accessibility.** Out-of-the-box ARIA, keyboard nav, screen-reader summaries (Nivo wins on web; gifted-charts wins on mobile for OOTB a11y).
4. **Bundle size on web** / **frame budget on mobile**.
5. **Maintenance signal.** Last commit, open issues, GitHub stars trend over the last 12 months.

## Output template

Always state the recommendation as:

```
Library: <name>
Reason: <one sentence pinned to dataset size + design system>
Docs: <URL>
Why not <runner-up>: <one-sentence trade-off>
```

Do not recommend more than two libraries in a single answer; the runner-up exists to clarify the trade-off, not to hedge.
