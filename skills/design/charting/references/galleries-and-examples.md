---
title: Galleries and Examples — External References
impact: MEDIUM
tags:
  - galleries
  - examples
  - references
  - external-links
---

# Galleries and Examples

Link to these instead of pasting boilerplate code into your answers.
A canonical example with its own runnable code is better than any snippet you can paste.

## Contents

- [Chart-type chooser galleries](#chart-type-chooser-galleries)
- [Web — React / Next.js examples](#web--react--nextjs-examples)
- [Mobile — Expo / React Native examples](#mobile--expo--react-native-examples)
- [Accessibility references](#accessibility-references)
- [Inspiration and critique](#inspiration-and-critique)

## Chart-type chooser galleries

Use these to **pick a chart** before recommending a library.

| Resource                                                                          | Use for                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [data-to-viz.com](https://www.data-to-viz.com/)                                   | Decision tree from data shape → chart, with caveats per type.      |
| [The Data Visualisation Catalogue](https://datavizcatalogue.com/)                 | A–Z catalog with "anatomy", "use" and "common errors" per chart.   |
| [Atlassian — Essential Chart Types](https://www.atlassian.com/data/charts/essential-chart-types-for-data-visualization) | Quick "when to use" pages with examples.                           |
| [FlowingData — Chart-type flowchart](https://flowingdata.com/2009/01/15/flow-chart-shows-you-what-chart-to-use/) | Andrew Abela's classic four-pillar (comparison/composition/distribution/relationship) flowchart. |
| [Berkeley Library — Choosing a Chart Type](https://guides.lib.berkeley.edu/data-visualization/type) | Short, neutral "comparison vs trend vs distribution" guide.        |

## Web — React / Next.js examples

Pull working code from these. Cite the URL; copy the integration delta only.

### shadcn / Tailwind ecosystems

| Resource                                                  | What you'll find                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| [shadcn/ui — Charts](https://ui.shadcn.com/charts)        | Copy-paste blocks for area, bar, line, pie, radar, radial.            |
| [Tremor — Components](https://tremor.so/docs/components/) | Dashboard primitives: KPI cards, tables, filters, area/bar/donut.     |
| [Tremor blocks](https://blocks.tremor.so/)                | Whole dashboard layouts, free for non-commercial use.                  |
| [PostHog Tremor + shadcn example](https://github.com/PostHog/posthog-shadcn-charts-example) | Real-world repo combining shadcn/ui with Tremor charts.               |

### Direct library docs

| Resource                                                  | What you'll find                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Recharts — Examples](https://recharts.org/en-US/examples)| Per chart-type playgrounds with editable JSX.                          |
| [Apache ECharts — Examples](https://echarts.apache.org/examples/) | 200+ examples; includes large-data, real-time, geo, 3D.                |
| [Visx — Gallery](https://airbnb.io/visx/gallery)          | D3-primitives-in-React patterns; pull-and-modify code.                 |
| [Nivo — Components](https://nivo.rocks/components/)       | Live-editable storybook per chart, accessibility built in.             |
| [Plotly.js — Plotly Chart Studio](https://plotly.com/chart-studio/) | Reference for 3D, geo, statistical viz only.                           |

## Mobile — Expo / React Native examples

| Resource                                                                                     | What you'll find                                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Victory Native XL — Docs and examples](https://commerce.nearform.com/open-source/victory-native/) | Skia-based examples; line, bar, area, scatter, donut.                  |
| [Victory Native XL — GitHub](https://github.com/FormidableLabs/victory-native-xl)            | Source + example app under `example/`.                                 |
| [react-native-gifted-charts — Docs](https://gifted-charts.web.app/)                          | Live demos for bar, line, area, pie, donut, stacked-bar with controls. |
| [react-native-chart-kit — Examples](https://github.com/indiespirit/react-native-chart-kit#chart-style-object) | Lightweight chart kit; minimal config.                                 |
| [Skia + Expo — animated line chart tutorial](https://www.youtube.com/watch?v=JR1wRAB90Kk)    | End-to-end build of an animated line chart with Skia + Reanimated.     |

## Accessibility references

For chart-specific accessibility checks. For cross-cutting concerns, route to the `ux` skill.

| Resource                                                                                                              | Use for                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Smashing Magazine — Accessibility-First Approach to Chart Visual Design](https://www.smashingmagazine.com/2022/07/accessibility-first-approach-chart-visual-design/) | Long-form: color, patterns, end-caps, screen-reader fallbacks.  |
| [Section508.gov — Making Color Usage Accessible](https://www.section508.gov/create/making-color-usage-accessible/)    | Federal guidance; overlap with WCAG 1.4.1.                       |
| [Flourish — 3 ways to make your charts more accessible](https://flourish.studio/blog/accessible-chart-design/)        | Practical: alt text patterns, table fallback, color choices.    |
| [Highcharts Accessibility module](https://www.highcharts.com/docs/accessibility/accessibility-module)                  | Reference implementation: keyboard nav + sonification.           |
| [Chartability](https://chartability.fizz.studio/)                                                                     | Test rubric for chart accessibility (10+ heuristics).            |
| [WCAG 2.2 — Use of Color (1.4.1)](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)                      | Source for "color is never the only encoding".                  |
| [WCAG 2.2 — Non-text Content (1.1.1)](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)              | Source for "chart needs a text alternative".                    |

## Inspiration and critique

Use these when the user wants a portfolio of well-judged, real-world charts — or wants to learn what not to do.

| Resource                                                                                              | What you'll find                                                       |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Observable — Plot examples](https://observablehq.com/@observablehq/plot-gallery)                     | Modern grammar-of-graphics examples; useful for chart vocabulary.      |
| [The Pudding](https://pudding.cool/)                                                                  | Long-form data essays; instructive layouts and chart annotation.       |
| [Financial Times Visual Vocabulary](https://github.com/Financial-Times/chart-doctor/tree/main/visual-vocabulary) | FT's chart-type chooser, distilled into a single poster.               |
| [Datylon — Bad Data Visualization Examples](https://www.datylon.com/blog/bad-data-visualization-examples) | 27 named anti-patterns with critiques.                                 |
| [FlowingData — Bad chart examples](https://flowingdata.com/category/visualization/ugly-visualization/)| Long-running blog series on misleading or broken charts.               |
