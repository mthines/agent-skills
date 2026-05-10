---
title: Theming — Design Tokens, Dark Mode, Cross-Platform
impact: HIGH
tags:
  - theming
  - design-tokens
  - dark-mode
  - shadcn
  - tailwind
  - reanimated
---

# Theming

Charts must read colors from the **app's design tokens**, not from hard-coded hex values.
This makes dark mode, theme switching, and brand updates a single-file change.
The standard targets are: shadcn/ui CSS variables (web), Tailwind tokens, and React Native theme context.

## Web — shadcn/ui chart tokens

shadcn ships five chart color tokens by default: `--chart-1` … `--chart-5`.
Define them in `globals.css` for both light and dark themes.

```css
@layer base {
  :root {
    --chart-1: 12 76% 61%;
    --chart-2: 173 58% 39%;
    --chart-3: 197 37% 24%;
    --chart-4: 43 74% 66%;
    --chart-5: 27 87% 67%;
  }
  .dark {
    --chart-1: 220 70% 50%;
    --chart-2: 160 60% 45%;
    --chart-3: 30 80% 55%;
    --chart-4: 280 65% 60%;
    --chart-5: 340 75% 55%;
  }
}
```

Read them in chart code:

```tsx
<Line dataKey="revenue" stroke="hsl(var(--chart-1))" />
<Line dataKey="cost"    stroke="hsl(var(--chart-2))" />
```

Hard rule: **never hard-code chart colors.** Even one-off charts should reference a token; otherwise dark mode silently breaks.

## Web — extending the categorical palette

For > 5 categorical series, extend tokens in pairs (light + dark). Stop at 8 — anything more is a perceptual failure (see `rules/anti-patterns.md`).

```css
:root {
  /* … chart-1..5 … */
  --chart-6: 142 76% 36%;
  --chart-7: 215 28% 17%;
  --chart-8: 25 95% 53%;
}
```

Group the long tail as "Other" rather than introducing chart-9 onward.

## Web — diverging and sequential palettes

For heatmaps and choropleths, define **scales**, not categorical colors.

```css
:root {
  --heat-low:  217 91% 60%;   /* blue */
  --heat-mid:  0 0% 96%;      /* near-white */
  --heat-high: 0 84% 60%;     /* red */
}
```

Read in chart code via `interpolateRgb` or per-library scale helpers (`d3-scale-chromatic`).

## Web — dark mode specifics

- Recompute axis label / tick / gridline colors against the **current background**, not a fixed neutral.
- shadcn convention: `--muted-foreground` for axis labels, `--border` for gridlines.
- For Recharts: pass `stroke={"hsl(var(--muted-foreground))"}` to `<XAxis>`, `<YAxis>`, `<CartesianGrid>`.
- Detect theme changes with `next-themes` or `useTheme()` and re-render the chart container.

```tsx
<XAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: "hsl(var(--muted-foreground))" }} />
<CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
```

## Web — Tremor integration

Tremor reads its palette from `colors` props rather than CSS variables. Map shadcn tokens once:

```tsx
const tremorColors = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
<AreaChart data={data} categories={["a", "b"]} colors={tremorColors as unknown as Color[]} />
```

Or extend `tailwind.config.ts` to expose those tokens to Tremor's color list.

## Mobile — Expo / React Native theme tokens

There is no CSS-variable equivalent in RN. Use a theme context + a typed token map.

```tsx
// theme.ts
export const lightTheme = {
  chart: ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
  axis: "#525252",
  grid: "#e5e5e5",
  background: "#ffffff",
};
export const darkTheme = {
  chart: ["#38bdf8", "#34d399", "#fbbf24", "#f87171", "#a78bfa"],
  axis: "#a3a3a3",
  grid: "#262626",
  background: "#0a0a0a",
};
```

Consume via `useColorScheme` (Expo) or a dedicated theme provider:

```tsx
const scheme = useColorScheme();
const t = scheme === "dark" ? darkTheme : lightTheme;
<Line color={t.chart[0]} />
```

For Reanimated-driven theme transitions, store color values in `useSharedValue` and animate via `withTiming`.
Reanimated supports interpolating colors with `interpolateColor`.

## Mobile — Skia + token color

Skia's `Paint` accepts color strings directly:

```tsx
<Rect color={t.chart[0]} … />
```

For animated theme switches, use `useDerivedValue` to compute the active color from a shared `theme` value.

## Cross-platform color naming

Keep the **token names** identical across web and mobile so chart code is portable.

| Concept            | Web (CSS var)              | Mobile (theme key)     |
| ------------------ | -------------------------- | ---------------------- |
| Series 1–5         | `--chart-1` … `--chart-5`  | `chart[0]` … `chart[4]`|
| Axis label color   | `--muted-foreground`       | `axis`                 |
| Gridline color     | `--border`                 | `grid`                 |
| Background         | `--background`             | `background`           |
| Destructive / red  | `--destructive`            | `destructive`          |

This is the bridge that lets a shared `Chart.tsx` component on RN-Web stay readable.

## Anti-patterns

- **Hard-coded hex in chart props** — breaks dark mode, breaks rebrand.
- **Different palette per chart** — categorical inconsistency confuses readers across a dashboard.
- **Using `--primary` for chart series** — `--primary` is the brand CTA; charts need their own palette so the brand color does not collide with a series.
- **Ignoring `prefers-color-scheme`** — dark-mode users see washed-out charts.
- **Re-rendering the chart on every theme tick** — debounce theme changes; one render per change is enough.

## Checklist

- [ ] All chart colors are tokens, not hex.
- [ ] Light + dark palettes both defined.
- [ ] Axis labels and gridlines use `--muted-foreground` / `--border` (web) or theme equivalents (mobile).
- [ ] Categorical palette ≤ 8 hues.
- [ ] Diverging / sequential scales defined separately from categorical.
- [ ] Mobile theme tokens mirror web token names.
- [ ] Theme transitions interpolate, not flash.
