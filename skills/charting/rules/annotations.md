---
title: Annotations — Reference Lines, Threshold Bands, Callouts
impact: HIGH
tags:
  - annotations
  - reference-lines
  - thresholds
  - storytelling
  - callouts
---

# Annotations

A chart without annotations leaves the insight to the reader.
Annotations turn a graph into an answer.
Use them whenever there is a meaningful **threshold**, **target**, **event**, or **comparison value** the reader must see.

## Annotation taxonomy

| Type             | What it does                                                | When to use                                                            |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Reference line   | Horizontal or vertical line at a fixed value or date.       | Target, average, baseline, "now" line on time series.                  |
| Threshold band   | Filled band between two values.                             | Acceptable / warning / critical zones (SLOs, blood pressure, etc.).    |
| Target marker    | Single point with an arrow and label.                       | Forecasted milestone, KPI goal.                                        |
| Event marker     | Vertical line at a date with a label.                       | Deploy date, policy change, marketing campaign.                        |
| Annotation arrow | Arrow + caption pointing at a specific point.               | "This is where revenue overtook costs".                                |
| Callout box      | Small label connected to a point.                           | Highlighting an outlier or a record value.                             |

## Hard rules

- **Always label** — an unlabeled reference line is noise.
- **Lower-contrast styling** — annotations support the data; they should not dominate the canvas. Use a thinner stroke, dashed line, or muted color.
- **One annotation per insight** — three thresholds + four event markers + a target turns the chart into a billboard. Cap at 3 annotations per chart unless the chart is dedicated to compliance / SLOs.
- **Position labels outside the plot area** when possible to avoid occluding the data.
- **Keep annotations responsive** — if a label collides on small screens, abbreviate or hide.

## Recharts (web)

```tsx
import { LineChart, Line, ReferenceLine, ReferenceArea, ReferenceDot } from "recharts";

<LineChart data={data}>
  <Line dataKey="latency" stroke="hsl(var(--chart-1))" />

  {/* Target reference line */}
  <ReferenceLine
    y={200}
    stroke="hsl(var(--muted-foreground))"
    strokeDasharray="4 2"
    label={{ value: "Target 200ms", position: "right", fontSize: 11 }}
  />

  {/* Threshold band: critical zone above 500ms */}
  <ReferenceArea y1={500} y2={Infinity} fill="hsl(var(--destructive))" fillOpacity={0.06} />

  {/* Event marker: deploy on March 12 */}
  <ReferenceLine
    x="2025-03-12"
    stroke="hsl(var(--accent-foreground))"
    label={{ value: "v2.4 deploy", position: "insideTopRight", fontSize: 11 }}
  />

  {/* Outlier callout */}
  <ReferenceDot x="2025-03-15" y={812} r={4} fill="hsl(var(--destructive))" label="Incident" />
</LineChart>
```

## ECharts (web)

```ts
option = {
  series: [{
    type: "line",
    data,
    markLine: {
      data: [
        { yAxis: 200, label: { formatter: "Target 200ms" } },
        { xAxis: "2025-03-12", label: { formatter: "v2.4 deploy" } },
      ],
    },
    markArea: {
      data: [[
        { yAxis: 500, itemStyle: { color: "rgba(220,38,38,0.06)" } },
        { yAxis: "max" },
      ]],
    },
    markPoint: {
      data: [{ name: "Peak", type: "max", label: { formatter: "Incident" } }],
    },
  }],
};
```

## Visx (web)

```tsx
<Group>
  {/* threshold band */}
  <Bar x={0} y={yScale(critical)} width={width} height={yScale(0) - yScale(critical)} fill="rgb(220 38 38 / 0.06)" />
  {/* reference line */}
  <Line from={{ x: 0, y: yScale(target) }} to={{ x: width, y: yScale(target) }} stroke="hsl(0 0% 60%)" strokeDasharray="4 2" />
  <Text x={width - 4} y={yScale(target) - 4} fontSize={11} textAnchor="end">Target {target}ms</Text>
</Group>
```

## Mobile (Victory Native XL)

```tsx
<CartesianChart data={data} xKey="date" yKeys={["latency"]}>
  {({ points, chartBounds }) => (
    <>
      <Line points={points.latency} color="#0ea5e9" strokeWidth={2} />
      {/* Threshold band — drawn directly with Skia */}
      <Rect
        x={chartBounds.left}
        y={yScale(500)}
        width={chartBounds.right - chartBounds.left}
        height={yScale(0) - yScale(500)}
        color="rgba(220,38,38,0.06)"
      />
      {/* Reference line */}
      <Line
        p1={{ x: chartBounds.left, y: yScale(target) }}
        p2={{ x: chartBounds.right, y: yScale(target) }}
        color="rgba(0,0,0,0.4)"
        style="stroke"
        strokeWidth={1}
        strokeJoin="round"
      />
    </>
  )}
</CartesianChart>
```

For **gifted-charts**, use `referenceLine1Config`, `secondaryDataConfig`, and `pointerConfig` to mark thresholds and events.

## Storytelling layouts

For dashboards intended to communicate (not just expose), pair the chart with a **lede** above it.

```
[Big number]              +18% YoY
[Sparkline]               ▁▂▂▃▅▇█
[Lede: 1 sentence]        Revenue grew 18% YoY, peaking in Q3.
[Annotated chart]         line + reference line + event markers
```

The lede states the conclusion in words; the chart is the evidence.
This is the "headline + chart" pattern from FT and The Pudding — see `references/galleries-and-examples.md`.

## Anti-patterns

- **Unlabeled reference lines** — the reader has to guess what 200ms means.
- **Color-screaming annotations** — bright red threshold lines fight the data.
- **Too many event markers** — > 5 vertical event lines is a sea of vertical noise.
- **Annotations encoding multiple things at once** — one annotation, one meaning.
- **Annotations rendered on top of axis labels** — keep zIndex sane: data > annotations > axes.

## Checklist

- [ ] Every reference line and threshold band is labeled.
- [ ] Annotations use muted styling (dashed, low-contrast color).
- [ ] ≤ 3 annotations per chart (unless compliance / SLO chart).
- [ ] Event markers do not occlude the underlying line.
- [ ] On small viewports, annotations abbreviate or hide gracefully.
- [ ] The chart has a 1-sentence lede above it for storytelling dashboards.
