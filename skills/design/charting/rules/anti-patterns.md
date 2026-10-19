---
title: Charting Anti-Patterns — Named, with Fixes
impact: HIGH
tags:
  - anti-patterns
  - misleading
  - data-integrity
---

# Charting Anti-Patterns

Each anti-pattern below has a **name**, a **why** (which principle or perceptual rule it breaks), and a **fix** the agent can apply directly.
When reviewing a chart, cite the anti-pattern by name and supply the fix — do not just describe the problem.

## 1. Truncated y-axis on bar / column charts

**Why**: Bar length encodes the value. Truncating the baseline makes a 2% difference look like a 10× difference. The eye reads area, not annotation.

**Fix**: Start the value axis at 0 for any bar/column chart.
For line charts, truncating is permitted **only** if the baseline is annotated and the truncation does not change the reader's conclusion.

```tsx
// Bad — Recharts
<YAxis domain={[90, 100]} />

// Good — anchored at 0
<YAxis domain={[0, "auto"]} />
```

## 2. Dual-axis correlation theatre

**Why**: Two independent y-axes can be tuned to manufacture any "correlation" the author wants. The reader is invited to see causation that is not in the data.

**Fix**: Replace with **small multiples** (one chart per measure, shared x-axis), an **indexed line chart** (rebase both series to 100 at t₀), or two stacked panels with synced cursors.

## 3. Pie chart abuse

**Why**: Humans estimate angle and area worse than length. Pie charts with > 5 slices are unreadable; 3D pies and exploded slices are worse.

**Fix**:

- ≤ 5 slices, sorted, label each with %.
- > 5 slices → **horizontal bar chart**.
- Never 3D, never exploded, never doughnuts with rings thinner than the label.

## 4. Rainbow categorical palette

**Why**: A rainbow palette implies an ordinal relationship that does not exist between categories. It also fails colorblind users.

**Fix**: Use a categorical palette of ≤ 8 distinct hues with similar lightness (Tableau 10, ColorBrewer Set2). Group the long tail as "Other".

## 5. Time on a non-time axis

**Why**: Treating dates as discrete strings on the x-axis loses the spacing that makes a trend legible.

**Fix**: Use a real time scale (`scaleTime` in D3/Visx, `type="number"` with `domain` in Recharts, `xAxis: { type: 'time' }` in ECharts). Gaps in the data must show as gaps on the axis.

## 6. Chart-junk — 3D, gradients, drop shadows

**Why**: Data-ink ratio. Anything that does not encode data subtracts from the chart.

**Fix**: Flat 2D, single fill per series, no shadows. Highlights belong on the **focused** point only.

## 7. Multiple-line spaghetti

**Why**: > 5 lines in one chart cross and overlap; readers cannot follow any single series.

**Fix**: Cap to 5 lines. Beyond that, switch to **small multiples** (one mini-line per series) or a **slope chart** (start vs. end only).

## 8. Misleading aspect ratios

**Why**: Stretching a line chart wide flattens the trend; squashing it tall exaggerates volatility.

**Fix**: Aim for a banking-to-45° aspect ratio (Cleveland's rule) — average slope segments approach 45°. In practice: width ≈ 1.6–2× height for trend lines.

## 9. Overplotting on scatter plots

**Why**: With > 5,000 points, scatter plots become solid blobs that hide the structure.

**Fix**: Reduce alpha (`opacity={0.2}`), switch to a **hexbin** or **2D density** plot, or sample/aggregate before plotting.

## 10. Stacked bars when you mean grouped bars

**Why**: Stacking is for **part-of-whole**. Comparing categories series-by-series is harder when each series sits on a different baseline.

**Fix**:

- Want absolute totals per category? Stacked bar.
- Want to compare each series across categories? **Grouped** bar (or small multiples for > 3 series).

## 11. Big-number tile without context

**Why**: A single number ("$1.2M") with no comparison is meaningless. Is that good? Bad?

**Fix**: Pair the value with a **delta vs. prior period** ("+18%") and an inline **sparkline** of the trend. Use color + arrow + sign for the delta.

## 12. Axis labels that lie about units

**Why**: A "Revenue" axis without "$" or "M" forces the reader to infer the unit; some will infer wrong.

**Fix**: Always include unit and magnitude in the axis title or tick labels (`$ (millions)`, `Requests/sec`, `°C`).
For RN charts and crowded mobile screens, prefer **abbreviated tick labels** (`$1.2M`, `2.4k`) over absolute integers.

## 13. Chartjunk legends

**Why**: Legends placed far from the data force the reader's eye to ping-pong.

**Fix**: For ≤ 3 series, **direct labelling** at the end of each line beats a legend. For > 3 series, place the legend adjacent to the chart, not below it on mobile.

## 14. Unsorted bar charts

**Why**: When ranking is the question, alphabetical ordering hides the answer.

**Fix**: Sort bars descending by value unless the categorical order is meaningful (months, severity, alphabet for a directory listing).

## 15. Geographic charts that lie by area

**Why**: A choropleth of "votes per state" makes Wyoming look more important than New Jersey because Wyoming is bigger.

**Fix**: Use a **cartogram** or **hex-grid map**, or normalize to a per-capita metric.

## 16. Using the wrong chart for the question

**Why**: A pie chart cannot answer a comparison question; a line chart cannot answer a composition question. The chart is a UI for a question — pick the chart that answers **this** question.

**Fix**: Re-run `rules/chart-type-selection.md` from the question, not the data.

## 17. No empty / loading / error state

**Why**: A blank canvas is the worst possible failure mode — users do not know whether the data is loading, empty, or broken.

**Fix**: Implement three explicit states:

- **Empty** — title + short copy + (optional) call-to-action.
- **Loading** — skeleton sized to the chart's final dimensions; `aria-busy="true"`.
- **Error** — `role="alert"`, retry button, error code.

Copy belongs to `ux` (`rules/ux-writing.md`); the requirement that the states exist belongs here.

## 18. Mobile charts that ignore the canvas

**Why**: Charts authored for a 1280-px web viewport break on a 375-px phone — labels overlap, touch targets shrink, gridlines disappear.

**Fix**: Author mobile charts in **`Chart.native.tsx`** files separate from web; rotate or abbreviate labels; remove minor gridlines; bump tick label size to ≥ 12 pt.

## How to cite

When you flag an anti-pattern in a review, write:

```
[Anti-pattern: <name>]
Why: <one sentence>
Fix: <code or config change>
```

For example:

```
[Anti-pattern: Truncated y-axis on bar chart]
Why: The 90–100 domain on `<YAxis>` exaggerates a 2% change into a visual 5×.
Fix: Set `<YAxis domain={[0, "auto"]} />`.
```
