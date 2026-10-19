---
title: Chart Accessibility — Chart-Specific A11y
impact: HIGH
tags:
  - accessibility
  - wcag
  - aria
  - colorblind
  - screen-reader
---

# Chart Accessibility

This file owns **chart-specific** accessibility only.
For cross-cutting visual-design and microcopy concerns (contrast ratios, touch-target minimums, typography, label copy), invoke the `ux` skill instead of restating its rules.

## Defer to `ux`

Do not duplicate. When the user's chart has any of these concerns, point them at `ux`:

| Concern                                  | Owner |
| ---------------------------------------- | ----- |
| Color contrast ratios (text vs. background, UI-component contrast) | `ux` (`rules/visual-design.md`, `rules/accessibility.md`) |
| Touch-target sizing for legends, tooltips, interactive points       | `ux` (`rules/touch-and-interaction.md`)                    |
| Typography (axis label size, tick label size, title hierarchy)      | `ux` (`rules/visual-design.md`)                            |
| Microcopy (chart titles, axis labels, empty/error states)           | `ux` (`rules/ux-writing.md`)                               |
| Platform conventions (Apple HIG / Material Design 3 chart guidance) | `ux` (`rules/platform-specific.md`)                        |

## Own here — chart-specific rules

### 1. Color is never the only encoding (WCAG 1.4.1 — Use of Color)

**Why**: ~8% of men and ~0.5% of women have some color-vision deficiency. Color-only encoding fails them and fails black-and-white printing.

**Apply**:

- Pair color with **shape** (markers), **pattern** (line dash), **direct labels**, or **position**.
- For categorical series, prefer **color + line style** (solid / dashed / dotted) on line charts.
- For diverging palettes, use a **colorblind-safe** scale: ColorBrewer's `RdBu`, `PuOr`, or `BrBG`.
- For sequential, use **viridis**, **cividis**, or `YlGnBu` — perceptually uniform.

```tsx
// Bad — color-only
<Line dataKey="us" stroke="red" />
<Line dataKey="eu" stroke="green" />

// Good — color + dash + endpoint label
<Line dataKey="us" stroke="hsl(var(--chart-1))" strokeDasharray="0" />
<Line dataKey="eu" stroke="hsl(var(--chart-2))" strokeDasharray="4 2" />
<LabelList dataKey="eu" position="right" />
```

### 2. Provide a text alternative (WCAG 1.1.1 — Non-text Content)

Every chart must have a programmatic text alternative.

**Web — choose the strongest one your library supports**:

- A `role="img"` wrapper with a meaningful `aria-label` summarizing the data trend.
- A visually hidden `<table>` rendering the same data — best for screen-reader users.
- An `aria-describedby` paragraph that summarizes the takeaway (e.g. "Revenue grew 18% YoY, peaking in Q3.").

```tsx
<div role="img" aria-labelledby="chart-title" aria-describedby="chart-desc">
  <h3 id="chart-title">Quarterly revenue 2025</h3>
  <p id="chart-desc" className="sr-only">
    Revenue grew from $1.2M in Q1 to $1.8M in Q4, peaking at $2.0M in Q3.
  </p>
  <BarChart … />
</div>
```

**React Native — use platform a11y props**:

```tsx
<View
  accessible
  accessibilityRole="image"
  accessibilityLabel="Quarterly revenue 2025"
  accessibilityHint="Revenue grew from 1.2 million in Q1 to 1.8 million in Q4."
>
  <VictoryChart … />
</View>
```

### 3. Keyboard navigation across data points (WCAG 2.1.1)

Web charts that expose tooltips on hover **must** also expose them on keyboard focus.

- Provide focusable elements per data point (`tabIndex={0}`).
- Update an `aria-live="polite"` region with the focused point's value.
- Nivo and ECharts ship this; Recharts/Visx require manual wiring.

### 4. Screen-reader-friendly data tables

For complex charts (heatmap, treemap, sankey), pair the visual with a **sortable data table** rendered in `sr-only` markup or a "View as table" toggle.
This is the most reliable a11y mechanism for non-trivial visualizations.

### 5. Motion and animation (WCAG 2.3.3 / 2.2.2)

- Respect `prefers-reduced-motion`. Set animation durations to `0` when the user has the system setting enabled.
- Loading shimmers must not flash > 3× per second (WCAG 2.3.1).
- Auto-rotating carousels of charts: do not. Allow the user to control the cadence.

```tsx
const reduce = useReducedMotion();
<Bar … animationDuration={reduce ? 0 : 600} />
```

### 6. Color-blindness verification

Run every categorical or diverging palette through one of:

- A simulator extension (Chromatic Vision Simulator, Colorblindly).
- Storybook a11y-addon's color-blindness filter.
- Figma's "Color blind" accessibility view.

Reject the palette if two adjacent series collapse to the same value under deuteranopia or protanopia.

### 7. Contrast for chart strokes and fills (WCAG 1.4.11 — Non-text Contrast)

Chart strokes, marker outlines, and gridlines that **convey meaning** must have ≥ 3:1 contrast against their background.
Decorative gridlines and minor ticks are exempt.
Defer the actual ratio math to `ux` — but flag the requirement here.

### 8. Empty, loading, and error states

A chart skeleton with no labels is inaccessible. Each state needs:

- A title and an empty-state description ("No revenue data for this period.").
- A loading indicator with `aria-busy="true"` on the container.
- An error state that announces the problem via `role="alert"`.

Defer the **wording** of these states to `ux` (`rules/ux-writing.md`).

### 9. Sonification (optional, advanced)

For data-dense or financial charts, consider **sonification** — mapping data points to tones so screen-reader users can perceive trends.
Examples: Highcharts Sonification module, Chartability.
Treat it as an enhancement, not a replacement for points 1–8.

## Quick a11y checklist (paste into reviews)

- [ ] Color is paired with shape, pattern, or direct label.
- [ ] Categorical palette has ≤ 8 hues and is colorblind-safe.
- [ ] Chart container has `role="img"` (web) / `accessibilityRole="image"` (RN) plus a meaningful label and description.
- [ ] Tooltips work on keyboard focus, not only mouse hover (web).
- [ ] A data-table fallback exists for heatmaps, treemaps, and sankeys.
- [ ] Animation honors `prefers-reduced-motion`.
- [ ] Empty / loading / error states have copy and an `aria-live` or `role="alert"` channel.
- [ ] Cross-cutting concerns (contrast, touch targets, typography, copy) routed to the `ux` skill.
