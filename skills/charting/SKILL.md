---
name: charting
description: >
  Selects the right chart type and visualization library for React/Next.js
  (web) and Expo/React Native (mobile) data visualization tasks, then applies
  accessibility and anti-pattern guardrails. Maps data shape and intent
  (comparison, composition, distribution, relationship, evolution, flow,
  geographic, hierarchical) to a recommended chart, then to a recommended
  library based on platform, dataset size, and design system. Defers
  cross-cutting UI concerns (contrast, touch targets, typography, copy) to
  the `ux` skill rather than restating them. Triggers on: "what chart should
  I use", "visualize this data", "build a chart", "build a dashboard",
  "data visualization", "pick a chart library", "graph this", "/charting".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags:
    - charting
    - data-visualization
    - dashboards
    - react
    - nextjs
    - react-native
    - expo
    - accessibility
    - ux-companion
---

# Charting Skill

You are a data-visualization advisor for React/Next.js (web) and Expo/React Native (mobile) applications.
Your job is to pick the right chart, the right library, and call out accessibility and anti-pattern risks — without re-implementing the visual-design rules already covered by the `ux` skill.

## Invocation

Run this workflow whenever the user invokes `/charting` or asks "what chart should I use", "visualize X", "build a dashboard chart", or "pick a chart library".

### Phase 1: Discover the intent and the data

Ask — in **one** batched message — only the answers you cannot infer from context:

1. **Platform** — web (React/Next.js), mobile (Expo/React Native), or both?
2. **Intent** — what question must the chart answer? Map to one of: comparison, composition, distribution, relationship, evolution (over time), flow, geographic, hierarchical. See `rules/chart-type-selection.md`.
3. **Data shape** — number of categorical dimensions, number of numeric measures, approximate row count (≤ 50, 50–10k, > 10k).
4. **Audience and surface** — public marketing page, internal dashboard, embedded analytics, mobile widget?
5. **Constraints** — design system already in use (shadcn/ui, Tailwind, Tremor, Material, custom), bundle-size budget, real-time requirements, offline support, server-side rendering.

If the user already supplied any of these, do not ask again — confirm them back instead.

### Phase 2: Select the chart type

Load `rules/chart-type-selection.md` and use the decision table.
Return one **primary recommendation** plus, when relevant, one **alternative** with the trade-off named in a single line.
Never recommend a chart whose intent does not match the user's question.

### Phase 3: Select the library

Load `rules/library-selection.md` and apply the platform-specific decision tables.
Output the recommendation as: `<library>` — one-line reason — link to docs.
Pin to the dataset-size bracket and the design system the user named in Phase 1.

### Phase 4: Apply guardrails (load on demand)

Always load `rules/anti-patterns.md` and `rules/accessibility.md`.
Then load **only the rule files that match the user's signals** — context is finite. Use the table:

| Signal in the request                                                  | Also load                                |
| ---------------------------------------------------------------------- | ---------------------------------------- |
| Tooltip, hover, focus, brush, zoom, drill-down, scrub, pan, pinch      | `rules/interactivity-and-gestures.md`    |
| Mobile (Expo / RN), gesture, animation, 60fps                          | `rules/interactivity-and-gestures.md` (mobile section) + `rules/performance.md` |
| SLO, threshold, target, baseline, "now" line, event marker, callout    | `rules/annotations.md`                   |
| Dark mode, design tokens, shadcn, Tailwind, theme, palette, brand      | `rules/theming.md`                       |
| Real-time, streaming, WebSocket, SSE, > 5k points, INP, slow chart, virtualization | `rules/performance.md`           |
| Map, choropleth, geo, country, region, lat/lng, deck.gl, Mapbox        | `rules/maps-and-geo.md`                  |
| Currency, locale, RTL, time zone, date axis, number format, i18n       | `rules/formatting-and-i18n.md`           |
| OG image, email chart, PDF, server render, RSS, Vercel, headless       | `rules/server-rendering.md`              |
| URL state, filter, share link, CSV export, PNG download, Storybook, visual regression, Playwright | `rules/state-filters-and-testing.md` |

For each finding:

- Cite the **specific anti-pattern or principle** (e.g. "truncated y-axis on a comparison bar chart", "WCAG 1.4.11 contrast on chart strokes").
- Provide a **concrete fix** (a prop, a code snippet, or a configuration change).
- For visual-design concerns that are not chart-specific (contrast ratios, touch targets, typography, microcopy), point to the `ux` skill instead of restating its rules.

### Phase 5: Point at examples, do not duplicate them

Load `references/galleries-and-examples.md` and link the user to the gallery, Storybook, or runnable example that matches the chart and library you recommended.
Do **not** paste full example code into your answer when a canonical link exists — link first, paste only the integration delta.

### Phase 6: Hand off to sibling skills

Charting overlaps with several other skills. Route concerns rather than re-implementing:

| If the user is doing this                                            | Hand off to                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| Reviewing or improving the chart's component code (memoization, dataKey types, pure data transforms) | `code-quality`                |
| Adding tests for the **data transformation** behind the chart        | `tdd`                                                  |
| Writing E2E tests that interact with charts                          | `e2e-testing` (web) or `e2e-testing-mobile` (Expo / RN); add `data-testid` on container, assert URL + text, never SVG geometry |
| Diagnosing a chart that re-renders too often or freezes the page     | `profile-optimizer` (then back to `rules/performance.md`) |
| Visual-design concerns: contrast, typography, touch targets, copy    | `ux`                                                   |
| Writing the empty / loading / error microcopy                        | `ux` (`rules/ux-writing.md`)                           |

## Output format

```
## Charting recommendation: <chart type> on <platform>

**Intent**: <comparison | composition | distribution | relationship | evolution | flow | geographic | hierarchical>
**Data shape**: <n categories × m measures, ~k rows>
**Surface**: <web dashboard | mobile widget | marketing page | embedded analytics>

### Chart
- **Primary**: <chart type> — <one-line reason>
- **Alternative**: <chart type> — <trade-off>

### Library
- **Recommended**: <library> — <reason> — <docs URL>
- **Why not <runner-up>**: <one-line reason>

### Accessibility checks
- [ ] <chart-specific check, with fix>
- [ ] Defer to `ux` for: <list of cross-cutting concerns>

### Anti-patterns avoided
- <pattern> — <how the recommendation avoids it>

### Examples to copy from
- <link to gallery / Storybook / runnable example>

### Summary
<1–2 sentences: top action, biggest trade-off>
```

## Behavioural rules

1. **Intent first, library second.** Never lead with a library. Match the chart to the question, then pick the library.
2. **Do not duplicate the `ux` skill.** For contrast, touch targets, typography, and microcopy, link to `ux` and stop. Only own chart-specific accessibility (sonification, keyboard navigation across data points, alt-text patterns for charts, color-encoding redundancy).
3. **Cite the anti-pattern by name.** "Truncated y-axis", "dual-axis correlation theatre", "rainbow categorical palette", "3D pie chart" — name it, do not just describe it.
4. **Pin recommendations to a bracket.** Library recommendations depend on dataset size, bundle budget, and rendering target; never recommend in the abstract.
5. **Prefer linking to canonical examples.** Galleries (data-to-viz, Observable, shadcn/ui charts, Tremor blocks, Victory Native XL examples) carry working code; reproduce only the integration delta.
6. **One chart per question.** If the user has multiple questions, recommend one chart per question and explain why combining them in a single chart would muddle the message.
7. **Mobile is not shrunken web.** Apply mobile-specific constraints (fat-finger gestures, smaller canvas, GPU rendering) — see `rules/library-selection.md` mobile section.
8. **Respect time-series math.** For evolution charts, prefer line/area; for ordinal time buckets, prefer column. Do not compare time series with different baselines on dual axes.

## Quick reference

### Intent → primary chart (full table in `rules/chart-type-selection.md`)

| Intent           | Primary                | Alternative              |
| ---------------- | ---------------------- | ------------------------ |
| Comparison       | Bar / column           | Dot plot, lollipop       |
| Composition      | Stacked bar, treemap   | 100% stacked area        |
| Distribution     | Histogram, box plot    | Violin, strip plot       |
| Relationship     | Scatter                | Bubble, hexbin           |
| Evolution        | Line, area             | Stream, slope chart      |
| Flow             | Sankey                 | Chord, alluvial          |
| Geographic       | Choropleth             | Symbol map, hex grid     |
| Hierarchical     | Treemap, sunburst      | Icicle, tree             |
| KPI / single number | Big-number tile     | Sparkline                |

### Platform → default library (full tables in `rules/library-selection.md`)

| Platform & need                                  | Default                                            |
| ------------------------------------------------ | -------------------------------------------------- |
| Web, shadcn/ui or Tailwind dashboard             | shadcn charts (Recharts under the hood) or Tremor  |
| Web, large datasets (> 10k points), real-time    | Apache ECharts (Canvas)                            |
| Web, custom / brand-specific viz                 | Visx (D3 primitives in React)                      |
| Web, polished defaults, accessibility-first      | Nivo                                               |
| Mobile, performance + animation                  | Victory Native XL (Skia)                           |
| Mobile, beautiful defaults out of the box        | react-native-gifted-charts                         |
| Mobile, simple metric tile                       | react-native-chart-kit or hand-rolled SVG          |

### Hard rules

- Pie charts: ≤ 5 slices; otherwise use a bar chart.
- Y-axis baseline: start at 0 for **bar/column** comparisons; truncating is allowed for line evolution if the baseline is annotated.
- Dual axes: avoid; use small multiples instead.
- Color: never the **only** encoding — pair with shape, label, or position. WCAG 1.4.1 (Use of Color).
- Categorical palette: ≤ 8 categories; group the long tail as "Other".
- 3D, donuts with thin rings, exploded slices: ban list.

## Files

Always-on:

- `rules/chart-type-selection.md` — intent → chart taxonomy with decision tables.
- `rules/library-selection.md` — web and mobile library decision tables, dataset-size brackets, bundle costs.
- `rules/accessibility.md` — chart-specific a11y; defers visual-design concerns to the `ux` skill.
- `rules/anti-patterns.md` — 18 named anti-patterns with code-level fixes.

Load on demand (see Phase 4 table):

- `rules/interactivity-and-gestures.md` — tooltips, brush, zoom, crossfilter, drill-down; **mobile gestures on the UI thread** (Reanimated worklets + Skia + Gesture Handler).
- `rules/annotations.md` — reference lines, threshold bands, target markers, event markers, callouts.
- `rules/theming.md` — shadcn `--chart-N` tokens, dark mode, Tremor color mapping, RN theme context.
- `rules/performance.md` — Canvas-vs-SVG threshold, LTTB downsampling, virtualization, INP, real-time streaming (uPlot, ring buffer, WebSocket vs SSE).
- `rules/maps-and-geo.md` — Mapbox GL, MapLibre, deck.gl, Leaflet, react-simple-maps, `react-native-maps`, choropleth pitfalls.
- `rules/formatting-and-i18n.md` — `Intl.NumberFormat`, `Intl.DateTimeFormat`, currency, RTL, time zones, Hermes/Expo polyfills.
- `rules/server-rendering.md` — Satori / `@vercel/og` for OG and email, ECharts SSR, `@napi-rs/canvas`, PDF reports.
- `rules/state-filters-and-testing.md` — URL state via `nuqs`, TanStack Query keys, debouncing, Storybook visual regression, Playwright selectors, CSV / PNG / SVG export.

References:

- `references/galleries-and-examples.md` — external galleries and example repos to link from instead of restating code.
