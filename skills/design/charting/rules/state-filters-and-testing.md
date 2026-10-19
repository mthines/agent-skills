---
title: State, Filters, Testing, and Export
impact: HIGH
tags:
  - state
  - url-state
  - tanstack-query
  - testing
  - visual-regression
  - export
  - csv
---

# State, Filters, Testing, and Export

Production charts need filter state that survives refresh, data fetching that respects caches, tests that catch regressions, and a way to get the underlying data out.
This rule covers all four since they overlap heavily in practice.

## Contents

- [URL state — the default](#url-state--the-default)
- [Data fetching — TanStack Query](#data-fetching--tanstack-query)
- [Debouncing range / brush input](#debouncing-range--brush-input)
- [Testing — what to test, where](#testing--what-to-test-where)
- [Export and share](#export-and-share)
- [Empty / loading / error state coverage](#empty--loading--error-state-coverage)
- [Anti-patterns](#anti-patterns)
- [Checklist](#checklist)

## URL state — the default

Filter state belongs in the **URL**, not in component state.
A user must be able to copy the link and reproduce exactly what they see.

### Next.js App Router

```tsx
"use client";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { parseAsString, parseAsStringEnum, parseAsInteger, useQueryStates } from "nuqs";

const [{ range, group, page }, setFilters] = useQueryStates({
  range: parseAsStringEnum(["7d", "30d", "90d"] as const).withDefault("30d"),
  group: parseAsString.withDefault("all"),
  page: parseAsInteger.withDefault(1),
});
```

Use [`nuqs`](https://nuqs.47ng.com/) for typed search params with default values, history scrubbing, and SSR safety.
Manual `URLSearchParams` works but loses type safety and shallow-routing semantics.

### What goes in the URL

- Range pickers (`7d / 30d / 90d`)
- Active filters (`status=open&team=billing`)
- Sort + page on tables linked to the chart
- Crossfilter selections from another chart

### What stays in component state

- Tooltip hover index
- Brush drag-in-progress (commit on release)
- UI flags (legend hidden, axis log/linear) — unless they affect the rendered insight

## Data fetching — TanStack Query

Pair URL state with TanStack Query keys so the cache mirrors the URL.

```ts
const { data } = useQuery({
  queryKey: ["revenue", { range, group }],
  queryFn: () => fetchRevenue({ range, group }),
  staleTime: 60_000,
  placeholderData: keepPreviousData,
});
```

- `placeholderData: keepPreviousData` keeps the chart on the previous data while the next fetch is in flight — no flicker, no spinner, no layout shift.
- `staleTime` of 60s prevents the chart from re-fetching on every focus event.
- Memoize the data prop into the chart: `useMemo(() => transform(data), [data])`.

## Debouncing range / brush input

Brushing or dragging a slider must not refetch every frame.

```tsx
const [draftRange, setDraftRange] = useState(range);
const debouncedRange = useDebouncedValue(draftRange, 200);

useEffect(() => {
  setFilters({ range: debouncedRange });
}, [debouncedRange]);
```

- 200 ms is the sweet spot for human input (Doherty threshold-adjacent).
- Update the **draft** state on each event; commit to URL state on debounce.
- For chart brush, commit on `onMouseUp`, not `onChange`.

## Testing — what to test, where

| What                                  | How                                                          |
| ------------------------------------- | ------------------------------------------------------------ |
| Data shaping (group-by, lttb, format) | Unit tests in Vitest / Jest. Pure functions, fast, exhaustive. |
| Component renders without crash       | React Testing Library smoke test.                             |
| Visual regression (layout, palette)   | Storybook + Chromatic / Percy / Loki.                         |
| Interaction (filter, brush, drill)    | Playwright (`/e2e-testing`) — assert URL + visible labels.    |
| Accessibility                         | `@axe-core/react`, Storybook a11y addon.                      |

### Unit tests on data, not pixels

Charts are visual; their **logic** is pure data transformation.
Test the transformer.

```ts
test("groupByMonth aggregates correctly", () => {
  expect(groupByMonth(events)).toEqual([{ month: "2025-01", count: 7 }, …]);
});
```

Do **not** assert SVG geometry in unit tests. It is brittle and tests the chart library, not your code.

### Visual regression — Storybook + Chromatic

Story per chart, per state (loading, empty, error, populated, dark mode). Chromatic diffs the rendered output across PRs.

```ts
// RevenueChart.stories.tsx
export const Populated: Story = { args: { data: fixture } };
export const Empty: Story = { args: { data: [] } };
export const Loading: Story = { args: { isLoading: true } };
export const DarkMode: Story = {
  args: { data: fixture },
  parameters: { theme: "dark" },
};
```

Snapshot threshold should accept tiny anti-aliasing diffs (1–2 px) but reject layout regressions.
Loki and Playwright `toHaveScreenshot` are open-source alternatives to Chromatic.

### Playwright selectors for charts

Charts are bad to select. Follow `/e2e-testing`'s locator ladder, but in practice for charts:

- Add `data-testid` on the chart **container** and the legend chips.
- Assert text content of the chart's title, tooltip, and accessible summary, not SVG geometry.
- For drill-down, assert URL change after click, not visual chart change.

```ts
await page.getByTestId("revenue-chart").click({ position: { x: 200, y: 100 } });
await expect(page).toHaveURL(/range=7d/);
await expect(page.getByText(/Revenue last 7 days/)).toBeVisible();
```

### Accessibility tests

Run axe over each chart story. Common findings:

- Missing `role="img"` and `aria-label`.
- Missing `aria-live` for tooltips.
- Insufficient stroke contrast.

## Export and share

Every chart in an analytics product needs an "export" affordance.

| Action                | Implementation                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Copy share link**   | Build URL from active filters via `nuqs`'s `serialize()`. One-click.                                                          |
| **Download CSV**      | Re-use the same `data` prop the chart consumes. `papaparse` or hand-rolled `\n`-joined string. Headers in row 1.              |
| **Download PNG**      | Web: `dom-to-image-more` or `html-to-image` for SVG charts; ECharts has `getDataURL("png")`. Mobile: Skia's `makeImageSnapshot`. |
| **Download SVG**      | Recharts: read `svgRef.current.outerHTML`. ECharts: `getDataURL("svg")`. Visx: render a hidden full-size SVG and serialize.   |
| **Download PDF**      | See `rules/server-rendering.md` — server-side report.                                                                         |

```ts
function exportToCsv(rows: Row[], filename: string) {
  const headers = Object.keys(rows[0]).join(",");
  const body = rows.map((r) => Object.values(r).map(escapeCell).join(",")).join("\n");
  const blob = new Blob([`${headers}\n${body}`], { type: "text/csv" });
  triggerDownload(blob, filename);
}
```

Always include a **title row** with the active filters (`# range=30d, group=billing`) so the CSV is reproducible.

## Empty / loading / error state coverage

A chart's state matrix:

| State    | Indicator                                                            |
| -------- | -------------------------------------------------------------------- |
| Loading  | Skeleton sized to chart dimensions; `aria-busy="true"`.              |
| Empty    | Title + 1-sentence empty copy + suggested action (link to docs / settings). |
| Error    | `role="alert"`; show error code; "Retry" button.                     |
| Populated| The chart.                                                           |

Cover all four in Storybook stories. Defer the **wording** to `ux` (`rules/ux-writing.md`).

## Anti-patterns

- Filter state in `useState` instead of URL — refresh kills the view.
- TanStack Query without `placeholderData` — chart flashes a spinner on every range change.
- Asserting SVG path geometry in tests — tests the library, not your code.
- One Storybook story per chart with all states crammed together.
- CSV export without filter context in headers.

## Checklist

- [ ] Filter state in URL (`nuqs` or equivalent).
- [ ] TanStack Query keyed on the same params, with `placeholderData`.
- [ ] Range / brush inputs debounced at ~200 ms.
- [ ] Unit tests cover data transformers, not chart pixels.
- [ ] Visual regression set up (Storybook + Chromatic / Loki / Percy).
- [ ] Playwright selects via `data-testid` and asserts URL + text, not SVG.
- [ ] Axe-core run on every chart story.
- [ ] CSV / PNG / SVG / share-link export available.
- [ ] Loading / empty / error states have stories.
