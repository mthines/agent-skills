---
title: Chart Type Selection — Intent → Chart Taxonomy
impact: HIGH
tags:
  - chart-types
  - taxonomy
  - decision-table
  - data-visualization
---

# Chart Type Selection

Pick the chart from the **intent** of the question, not the shape of the data.
The eight intents below cover the working catalog used by data-to-viz, Atlassian's chart guide, and Berkeley's data-viz library guide.

## Step 1 — Classify the question

Ask: what is the user trying to read off the chart?

| Intent             | The question being answered                                       |
| ------------------ | ----------------------------------------------------------------- |
| **Comparison**     | "Which is bigger / smaller / ranks where?"                        |
| **Composition**    | "What share does each part take of the whole?"                    |
| **Distribution**   | "How are the values spread? Where is the bulk, where are tails?"  |
| **Relationship**   | "Are these two (or three) measures correlated?"                   |
| **Evolution**      | "How is this changing over time?"                                 |
| **Flow**           | "How do quantities move between states?"                          |
| **Geographic**     | "How does this vary by place?"                                    |
| **Hierarchical**   | "How is this nested? Parent → child structure?"                   |

If the user's question matches more than one intent, **split into multiple charts**.
One chart per question.

## Step 2 — Pick the chart

### Comparison

| Situation                                | Chart                       | Notes                                                              |
| ---------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| ≤ 12 categories, ranking matters         | Horizontal bar (sorted)     | Sort descending unless natural order matters (months, severity).   |
| > 12 categories, long names              | Horizontal bar              | Vertical columns rotate labels; horizontal bars do not.            |
| Few categories, exact-value reading      | Dot plot or lollipop        | Less ink than bars; comparable accuracy.                           |
| Two measures per category                | Grouped bar (≤ 3 series)    | More than 3 series → small multiples (one chart per measure).      |
| Comparison vs. a target                  | Bullet chart                | Encode target as a reference line; bar shows actual.               |

Hard rule: **bar/column charts must start the value axis at 0.**

### Composition

| Situation                              | Chart                           | Notes                                                                |
| -------------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| 2–5 parts, total matters               | Pie or donut                    | Hard cap 5 slices. More → switch to bar.                             |
| Many parts                             | Treemap                         | Area encodes value; readable at small sizes.                         |
| Composition over time                  | Stacked area or 100% stacked    | 100% stacked when **shares** matter; absolute stacked when totals do.|
| Composition + ranking                  | Stacked bar (sorted)            | Place largest series at the baseline so it can be read accurately.   |

### Distribution

| Situation                                  | Chart                       | Notes                                                                |
| ------------------------------------------ | --------------------------- | -------------------------------------------------------------------- |
| Single numeric, ≥ 50 points                | Histogram                   | Bin count: Sturges or Freedman–Diaconis; never < 5 or > 50 bins.     |
| Single numeric, summary view               | Box plot                    | Shows quartiles + outliers; combine with strip plot for small N.     |
| Compare distributions across categories    | Box plot (grouped) or violin| Violin shows shape; box plot shows summary. Pick one.                |
| Tiny N (< 30)                              | Strip plot or jittered dots | Histograms lie at small N.                                           |

### Relationship

| Situation                          | Chart                       | Notes                                                                  |
| ---------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| Two numeric, ≤ 5,000 points        | Scatter                     | Encode density with low alpha or hexbin if overplotted.                |
| Two numeric, > 10,000 points       | Hexbin or 2D density        | Scatter overplots and lies.                                            |
| Three numeric                      | Bubble                      | Third measure → point area. Cap area scale to ≤ 5× to avoid distortion.|
| Categorical × categorical          | Heatmap                     | Diverging palette only if the value crosses a meaningful midpoint.     |

### Evolution (time series)

| Situation                          | Chart                       | Notes                                                                  |
| ---------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| Continuous trend                   | Line                        | One series per line; cap at 5 visible series before switching to small multiples. |
| Cumulative or stock-and-flow       | Area                        | Single area only; multiple areas → stacked area or small multiples.    |
| Discrete buckets, few periods      | Column                      | When each period is a distinct measurement, not a continuous flow.     |
| Two end-points, many series        | Slope chart                 | "Before vs after" framing; shows per-series direction.                 |
| Forecast vs actual                 | Line + confidence band      | Band must be visually distinct from the line; do not stack them.       |

### Flow

| Situation                          | Chart                       |
| ---------------------------------- | --------------------------- |
| Stage-to-stage funnel              | Funnel                      |
| Many-to-many flow between states   | Sankey                      |
| Cyclic flow                        | Chord                       |
| Time-windowed flow                 | Alluvial                    |

### Geographic

| Situation                          | Chart                       | Notes                                                                  |
| ---------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| Value per administrative area      | Choropleth                  | Beware area bias (large areas dominate). Pair with population.         |
| Point events                       | Symbol map                  | Cluster at zoomed-out scale.                                           |
| Equal-area requirement             | Hex grid or cartogram       | Choose when administrative-area distortion misleads.                   |

### Hierarchical

| Situation                          | Chart                       |
| ---------------------------------- | --------------------------- |
| Two-level nested totals            | Treemap                     |
| Multi-level nested totals          | Sunburst or icicle          |
| Tree structure (no value encoding) | Tidy tree or dendrogram     |

### Single number / KPI

| Situation                          | Chart                       | Notes                                                                  |
| ---------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| One scalar, headline status        | Big-number tile             | Pair with a delta vs prior period and a tiny sparkline.                |
| Trend at a glance                  | Sparkline                   | No axes, no gridlines; encode latest value with a dot or label.        |
| Progress to a goal                 | Gauge or progress bar       | Linear progress bar > radial gauge for small canvases.                 |

## Step 3 — Special cases

### Mobile

- Prefer charts with **few visual elements**: line, area, big-number, sparkline, simple bar.
- Avoid: heatmap, treemap, sankey, choropleth — too dense for a 4-inch screen.
- Show legends inline (under the data) rather than in a separate panel.

### Real-time / streaming

- Line + windowed buffer; cap visible points and use Canvas rendering.
- Show "last updated" timestamp; align update cadence with the data freshness, not the render loop.

### Forecasts and uncertainty

- Always encode uncertainty: confidence band, error bar, or fan chart.
- Use a hatched or lighter style for the forecast region.

## Anti-patterns to refuse

- 3D bars, 3D pies, exploded pie slices, doughnut charts with very thin rings.
- Pie chart with > 5 slices.
- Dual y-axes to "show correlation".
- Time on a non-time axis (use a real time scale).
- Truncated y-axis on a bar/column chart.
- Categorical palette with > 8 hues — group the long tail.

See `rules/anti-patterns.md` for the full list with fixes.
