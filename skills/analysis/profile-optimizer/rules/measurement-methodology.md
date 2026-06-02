---
title: Measurement Methodology — Frame the Question Before Reading the Profile
impact: HIGH
tags:
  - methodology
  - metrics
  - core-web-vitals
  - inp
  - tbt
---

# Measurement Methodology

A profile is data, not a verdict. Before extracting hotspots, decide which
metric matters and what target the work is being measured against. Without
that, "the app feels slow" turns into an unranked pile of suggestions.

## The four-question frame

Answer all four before moving to Phase 2.

| # | Question                                                  | Why it matters                                                                                       |
| - | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1 | **What user-visible event are we optimising?**            | "Page load" vs "click → response" vs "scroll smoothness" require different metrics and tools.        |
| 2 | **What is the baseline number?**                          | A fix from 1200ms → 950ms is meaningful; from 80ms → 60ms is invisible. Read it directly from the profile. |
| 3 | **What is the target?**                                   | Core Web Vitals "good" thresholds, a competitor benchmark, or a feel-test. Without a target, you cannot stop. |
| 4 | **Was the recording representative?**                     | Profiles taken on an unthrottled M2 lie about field reality. CPU 4× / network Slow 4G is the floor. |

If the user did not specify, infer from the profile shape (long tasks during
load → LCP/TBT; long tasks during interaction → INP; many small tasks during
scroll → frame budget) and **state your inference** before continuing.

## Pick the right metric

| Scenario                                 | Primary metric                       | Threshold (mobile, "good")      | Tool                              |
| ---------------------------------------- | ------------------------------------ | ------------------------------- | --------------------------------- |
| Initial page load                        | LCP, TBT                             | LCP ≤ 2.5s, TBT ≤ 200ms         | Chrome trace, Lighthouse          |
| User clicks / keypresses / drags         | INP (Interaction to Next Paint)      | INP ≤ 200ms                     | Chrome trace, web-vitals lib      |
| Scroll smoothness                        | Frame rate / dropped frames          | ≤ 5% dropped frames at 60fps    | Chrome trace (Frames track)       |
| Specific React tree update               | Commit duration / actualDuration     | < 16ms (frame budget)           | React Profiler export             |
| Bundle / JS execution cost               | Script evaluation time, parse time   | Total < 350ms on mid-tier mobile | Chrome trace, Coverage panel      |
| Server response                          | TTFB                                 | ≤ 800ms                         | Network panel, server traces      |

Pick **one primary** metric. Secondary metrics are evidence, not goals.

## What "qualified" means

A qualified decision is one where you can answer **all** of:

- [ ] The metric being optimised is named.
- [ ] The current value is read off the profile (not estimated).
- [ ] The target value is stated.
- [ ] The proposed fix has an estimated ms saving from the profile data.
- [ ] The verification method is specified (re-profile, run Lighthouse, web-vitals
      reading, etc.).

If any item is empty, you do not have a qualified decision yet — go back to
Phase 2.

## Anti-patterns

| Anti-pattern                                                     | Fix                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| "Reduce re-renders" with no count or duration                    | Quote the count and the percentage of commit time it represents                    |
| Optimising a 5ms render in a 240ms commit                        | The other 235ms is the story — find it                                             |
| Using LCP-style thinking on an INP problem                       | Re-read Phase 1; the metric drives the analysis                                    |
| Trusting unthrottled desktop traces for mobile field performance | Re-record with `4× CPU slowdown` + `Slow 4G` and re-read                            |
| Reporting % improvement without absolute ms                      | Always quote both: "230ms → 90ms (61% faster)"                                      |

## Examples

### Good — INP investigation framing

> Optimising INP for the "Save" button click on the editor page. Baseline
> from the trace: 412ms (long task between `pointerup` and next paint).
> Target: ≤ 200ms (Core Web Vitals "good"). Recording: CPU 4× throttle,
> production build. Verification: re-record with the same throttling and
> read the new INP value from the trace.

### Bad — vague framing

> The app is slow. Let's add `useMemo` to expensive components.

Why bad: no metric, no number, no target, no verification, and a fix
suggestion before any analysis.
