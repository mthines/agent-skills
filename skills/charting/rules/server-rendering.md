---
title: Server Rendering — Static Charts for Email, OG, PDF
impact: HIGH
tags:
  - ssr
  - server-rendering
  - satori
  - og-image
  - email
  - pdf
  - vercel-og
---

# Server Rendering for Charts

Most chart libraries (Recharts, Tremor, Visx, ECharts in default mode) need the DOM and cannot render on the server.
But the product still needs static charts for **email**, **PDF**, **Open Graph images**, and **server-side reports**.
Pick the right rendering path per surface.

## Decision table

| Surface                                       | Renderer                                   | Output       |
| --------------------------------------------- | ------------------------------------------ | ------------ |
| Open Graph image (social cards, link unfurls) | **Satori** (`@vercel/og` on Vercel, or `satori` direct) | PNG (raster) |
| Email body (Mailchimp, Resend, SendGrid)      | **Satori** to PNG, or pre-rendered SVG → PNG | PNG embed    |
| PDF report                                    | **Puppeteer / Playwright** rendering React, or **react-pdf** with chart-as-image | PDF          |
| Server-rendered HTML (RSS, scrapers, plain HTML) | **ECharts SSR** (`echarts.init(null, null, { renderer: "svg", ssr: true })`) | Inline SVG   |
| Static export (Next.js `output: "export"`)    | Pre-render to SVG at build time            | Inline SVG   |
| Vercel Functions / Workers (no DOM)           | Satori, or `@napi-rs/canvas` for Canvas    | PNG / SVG    |

## Satori — the default for OG images and email

[Satori](https://github.com/vercel/satori) renders JSX → SVG, no DOM, no headless browser, in milliseconds.
On Vercel, use the `@vercel/og` package. Off-Vercel (Cloudflare Workers, Lambda), use `satori` + `@resvg/resvg-js` to convert SVG → PNG.

```tsx
// app/api/og/chart/route.tsx — Next.js App Router (Vercel)
import { ImageResponse } from "next/og";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const data = await fetchSeries(url.searchParams.get("range") ?? "30d");

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", padding: 48, background: "white", width: "100%", height: "100%" }}>
        <div style={{ fontSize: 28, color: "#525252" }}>Revenue (30d)</div>
        <div style={{ fontSize: 72, fontWeight: 700 }}>${formatCompact(data.total)}</div>
        <Sparkline points={data.points} width={1024} height={400} />
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
```

Notes:

- Satori supports a **subset** of CSS — flexbox layout, basic typography, SVG primitives. **No** Canvas, **no** real chart library inside.
- Build the chart as **plain SVG** with hand-written `<path>`, `<circle>`, `<rect>`. `d3-shape` works (it returns path strings); React components that emit SVG primitives work.
- Pre-compute scales server-side before generating the path.
- Cache the result aggressively — OG images change rarely. Set `Cache-Control: public, max-age=3600`.

### Sparkline as plain SVG

```tsx
function Sparkline({ points, width, height }: { points: number[]; width: number; height: number }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - ((v - min) / (max - min)) * height;
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  return (
    <svg width={width} height={height}>
      <path d={d} fill="none" stroke="#0ea5e9" strokeWidth={3} />
    </svg>
  );
}
```

## ECharts server-side SVG

When you need a **real** chart library on the server (full axes, tooltips → captions, complex layouts), use ECharts in SSR mode.

```ts
import * as echarts from "echarts";

const chart = echarts.init(null, null, {
  renderer: "svg",
  ssr: true,
  width: 800,
  height: 400,
});

chart.setOption({ /* full ECharts option */ });
const svg = chart.renderToSVGString();
chart.dispose();
return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
```

The output is a self-contained SVG you can inline in HTML, embed in email, or convert to PNG via Resvg.

## node-canvas for raster output

When you need PNG and Satori's CSS subset is too restrictive, use **`@napi-rs/canvas`** (Skia-based, fast, zero dependencies on system libs in Node 18+).

```ts
import { createCanvas } from "@napi-rs/canvas";

const canvas = createCanvas(1200, 630);
const ctx = canvas.getContext("2d");
// draw chart imperatively
return new Response(await canvas.encode("png"), { headers: { "Content-Type": "image/png" } });
```

`chart.js` ships an SSR adapter (`chartjs-node-canvas`) that uses node-canvas under the hood — fastest path if Chart.js is your client library.

## Email-specific rules

- Email clients (Outlook desktop especially) do **not** render SVG reliably. Always send **PNG**.
- Inline `<img src="cid:chart">` with the PNG embedded as an attachment, not a remote URL — corporate proxies block remote images.
- Provide an `alt` attribute that summarizes the chart (`alt="Revenue grew 18% in March, peaking at $1.8M"`).
- Width: 600 px max for the body, 2× density (1200 px source). Most clients clamp at 600 px.

## PDF reports

Two paths:

1. **Puppeteer / Playwright + your real chart library** — pixel-perfect, slow, needs a headless browser. Best for high-fidelity reports.
2. **`@react-pdf/renderer` + chart-as-image** — render the chart to PNG via Satori or ECharts, embed as `<Image>` in the PDF. Faster, sufficient for most reports.

For multi-chart PDFs, render charts in parallel (`Promise.all` over PNG jobs), then assemble the PDF.

## Cache and revalidate

OG images and email charts are usually deterministic for a given input.
Cache the rendered output keyed on the input parameters (`?range=30d&series=revenue`).
On Vercel, `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` is a safe default.

## Anti-patterns

- Trying to render Recharts / Tremor / Nivo on the server. They need the DOM. Stop.
- Embedding raw HTML+JS chart code in email — clients strip JS and most CSS.
- Inlining 300 kB SVG charts in OG images — Satori has a 16 MB limit but ratelimits at the network layer.
- Serving uncached OG endpoints — every social-card render hits your API.
- Hand-rolling chart math (scales, ticks) when `d3-scale` / `d3-array` are tree-shakeable and Satori-compatible.

## Checklist

- [ ] Each non-DOM surface (OG, email, PDF, RSS) has a server-render path.
- [ ] OG / email charts use Satori (`@vercel/og`) or ECharts SSR.
- [ ] Email charts render to PNG, not SVG.
- [ ] PDFs use Puppeteer **or** `@react-pdf/renderer` + image, not "render Recharts on server".
- [ ] Output cached with explicit `Cache-Control`.
- [ ] Chart code in server routes uses **only** SVG primitives or ECharts SSR — no DOM library imports.
- [ ] Alt text describes the chart's takeaway, not its shape.
