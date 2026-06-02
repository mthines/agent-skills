---
for: reviewer
lens-version: 1
applies-to: "**/*chart*.tsx, **/*chart*.ts, **/*graph*.tsx, **/*dashboard*.tsx, **/charts/**, **/dataviz/**, **/visualizations/**"
---

# Charting — Review Lens

## Trigger

Fires when the diff touches a chart component, dashboard, or any file importing `recharts`, `victory*`, `nivo`, `visx`, `echarts`, `chart.js`, `d3`, `react-native-svg-charts`, `react-native-gifted-charts`, or `tremor`. Also fires on changes to chart props (data, axes, colors, tooltips). The `ux` skill already covers cross-cutting visual-design concerns — this lens is chart-specific only.

## Checklist

- [ ] Pie charts have ≤ 5 slices; with more, the chart type is wrong — use a bar chart instead.
- [ ] Bar / column charts that express a comparison start the y-axis at 0 — no truncated baselines on comparison charts.
- [ ] No dual y-axes — paired comparisons use small multiples or a normalized axis instead.
- [ ] Categorical palette has ≤ 8 colors; the long tail is grouped as "Other".
- [ ] Color is paired with another encoding (shape, label, position, pattern) — never the sole carrier of meaning (WCAG 1.4.1).
- [ ] No banned chart types: 3D pies, donuts with thin rings, exploded slices, "spaghetti" line charts with > 7 series.
- [ ] Chart container has an accessible name (`aria-label` or `role="img"` + `aria-label`) summarising what the chart shows.
- [ ] Tooltips are reachable via keyboard (focus on data points) — not hover-only.
- [ ] Numbers and dates use `Intl.NumberFormat` / `Intl.DateTimeFormat` with locale and currency — no manual string concatenation or hard-coded `$`/`€`.
- [ ] Library matches dataset-size bracket: Recharts / Nivo / Visx for ≤ 10 k points (SVG); ECharts / uPlot for > 10 k (Canvas); Victory Native XL for mobile high-perf.
- [ ] Empty, loading, and error states exist with explicit microcopy — chart components do not silently render an empty `<svg>`.
- [ ] For evolution data (time series), the chart is line or area — not column with > 30 buckets.

## Severity hints

- **Must-fix**: truncated y-axis on a comparison bar chart; pie chart with > 5 slices; color as sole encoding; chart with no accessible name.
- **Should-fix**: dual y-axes; categorical palette > 8 colors; tooltip hover-only; library mismatched to dataset size.
- **Nice-to-have**: number/date formatting drift; missing empty/error microcopy (defer wording to `ux`); evolution rendered as column instead of line.
