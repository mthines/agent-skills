---
title: Formatting and i18n — Numbers, Dates, Currency, RTL
impact: HIGH
tags:
  - i18n
  - formatting
  - intl
  - locale
  - rtl
  - currency
---

# Formatting and i18n

Axis labels, tooltips, and tick formatters lie about units more often than they should.
Use `Intl.*` everywhere. It is built into every JS runtime and is locale-aware for free.

## Numbers — `Intl.NumberFormat`

```ts
const fmt = new Intl.NumberFormat("en-US", {
  notation: "compact",       // "1.2M" instead of "1,200,000"
  maximumFractionDigits: 1,
});
fmt.format(1_234_567);      // "1.2M"
```

Hard rules:

- Use **compact notation** for axis ticks on charts where exact precision is unnecessary.
- Cap `maximumFractionDigits` at 2 for percentages, 1 for compact, 0 for whole counts.
- Memoize the formatter — constructing `Intl.NumberFormat` on every render is wasteful.

```tsx
const fmt = useMemo(() => new Intl.NumberFormat(locale, { notation: "compact" }), [locale]);
<YAxis tickFormatter={fmt.format} />
```

## Currency

```ts
const usd = new Intl.NumberFormat(locale, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
usd.format(1_234_567);   // "$1.2M"
```

- **Never** hard-code "$" — locale + currency code together produce the correct symbol and placement (`$1.2M` vs `1,2 Mio. €`).
- Store amounts in **minor units** (cents) and divide by 100 only at format time.
- For multi-currency dashboards, label every chart with the active currency above the axis.

## Dates — `Intl.DateTimeFormat`

```ts
const dateFmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
dateFmt.format(new Date("2025-03-12"));   // "Mar 12" (en-US), "12 Mar" (en-GB)
```

For chart x-axes:

| Range          | Tick format                                                          |
| -------------- | -------------------------------------------------------------------- |
| ≤ 1 day        | `Intl.DateTimeFormat(loc, { hour: "numeric", minute: "numeric" })`   |
| ≤ 1 week       | `{ weekday: "short", hour: "numeric" }`                              |
| ≤ 3 months     | `{ month: "short", day: "numeric" }`                                 |
| ≤ 2 years      | `{ month: "short", year: "2-digit" }`                                |
| > 2 years      | `{ year: "numeric" }`                                                |

Pick the format from the **visible range**, not the full data range. Memoize per range.

## Relative time

For "12 minutes ago" labels, use `Intl.RelativeTimeFormat`:

```ts
new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-12, "minute");
// "12 minutes ago"
```

## RTL (right-to-left) layout

Right-to-left languages (Arabic, Hebrew, Persian, Urdu) flip the canvas.

- The **container** flips automatically with `dir="rtl"` on `<html>` or a parent.
- Inside the chart, x-axes still go left-to-right by mathematical convention. Verify with native speakers — some teams want a true mirror, others keep the math direction.
- Legends, tooltips, and titles **must** flip — use logical CSS properties (`margin-inline-start` not `margin-left`).
- Tick labels inherit the locale's number format (`٠١٢٣٤٥٦٧٨٩` for Arabic-Indic).
- Recharts and ECharts: pass `dir` aware wrappers on tooltips. Test with `lang="ar"` snapshot.

```tsx
<div dir={locale.startsWith("ar") || locale === "he" ? "rtl" : "ltr"}>
  <ChartContainer>{…}</ChartContainer>
</div>
```

## Pluralization in copy

Chart copy ("3 items", "1 item") needs `Intl.PluralRules` or a translation library (i18next, lingui, FormatJS).

```ts
const plural = new Intl.PluralRules(locale).select(count);
// → "one" | "other"
```

Defer the actual copy to the `ux` skill (`rules/ux-writing.md`) — this rule owns formatting only.

## Time zones

A bug-amplifier on time-series charts.

- **Render charts in the user's local time zone** by default. Pass timestamps to `new Date()` and let `Intl.DateTimeFormat` localize.
- For multi-region dashboards (oncall, financial), allow a time-zone toggle. Store the choice in URL state.
- Store timestamps in UTC in the database. Convert at the edge.
- Label the axis with the active TZ when it is not the user's default ("Europe/Berlin").

```ts
const fmt = new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" });
```

## React-aware locale wiring

```tsx
// LocaleProvider.tsx
const LocaleCtx = createContext<{ locale: string; tz: string }>({ locale: "en-US", tz: "UTC" });

export function useNumberFormatter(opts: Intl.NumberFormatOptions) {
  const { locale } = useContext(LocaleCtx);
  return useMemo(() => new Intl.NumberFormat(locale, opts), [locale, opts]);
}
```

Use `useNumberFormatter` and `useDateFormatter` hooks throughout the chart code; never instantiate `Intl.*` inline.

## Mobile (Expo) specifics

- React Native ships `Intl` since RN 0.74 / Expo SDK 51 with Hermes; older versions need `formatjs` polyfills.
- For older targets, `import "@formatjs/intl-numberformat/polyfill"`.
- `expo-localization` provides `getLocales()` and the active calendar / time zone.

## Accessibility tie-in

Screen readers read whatever string the chart renders.
"$1,234,567" is faster to listen to than "one thousand two hundred thirty-four point five six seven".
Use **compact notation** in screen-reader summaries.

## Anti-patterns

- Hard-coded "$", "€", "1,234" formatting strings.
- `toFixed(2)` for money — locale-blind, no symbol, no grouping.
- Mixing thousand separators (1,234.56 vs 1.234,56) within one chart.
- Treating dates as strings on the x-axis.
- Ignoring `prefers-reduced-data` — dense locale fonts (CJK, Devanagari) ship larger; lazy-load the locale bundle.

## Checklist

- [ ] All numeric formatting routes through `Intl.NumberFormat`.
- [ ] All date formatting routes through `Intl.DateTimeFormat`.
- [ ] Formatters memoized per locale.
- [ ] Currency formatting uses ISO code + locale, not a hard-coded symbol.
- [ ] Money stored in minor units; divided by 100 only at format time.
- [ ] X-axis tick format chosen from the **visible** range, not the full range.
- [ ] RTL layout flips legends, tooltips, and titles via logical properties.
- [ ] Time zone explicit when not the user's default.
- [ ] Locale bundles lazy-loaded for non-default languages.
