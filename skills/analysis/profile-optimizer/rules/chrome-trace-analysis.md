---
title: Chrome Trace Analysis — Reading a DevTools Performance Export
impact: HIGH
tags:
  - chrome-devtools
  - trace-event
  - long-tasks
  - main-thread
  - call-tree
---

# Chrome Trace Analysis

Extract long tasks, the call stack inside them, and the layout/paint cost
from a Chrome DevTools Performance trace. The goal: **measured culprits
mapped to specific functions or scripts**, not generic "main thread is busy"
statements.

## Anatomy of the trace

A trace is `{ traceEvents: [...], metadata }`. Each event:

```text
{
  name:  "RunTask" | "FunctionCall" | "Layout" | "v8.compile" | ...,
  cat:   "devtools.timeline,blink.user_timing,...",
  ph:    "X" | "B" | "E" | "I" | "i" | ...,   // phase
  ts:    <microseconds since trace start>,
  dur:   <microseconds, only for ph: X>,
  pid:   <process id>,
  tid:   <thread id>,
  args:  { data: { url, functionName, scriptId, ... } }
}
```

Phases:

| Phase | Meaning                              | Use                                            |
| ----- | ------------------------------------ | ---------------------------------------------- |
| `X`   | Complete event with `dur`            | The common case — a single span                |
| `B`/`E` | Begin / End pair                   | Older format; pair them by `name` + `tid`      |
| `I`/`i` | Instant                            | Single-point markers                           |
| `M`   | Metadata                             | Process / thread names                          |

## Extraction recipe (jq)

```bash
# Long tasks (> 50ms) on the main thread, sorted by duration
jq '.traceEvents
    | map(select(.ph == "X" and .dur > 50000 and (.cat | contains("devtools.timeline"))))
    | map({name: .name, dur_ms: (.dur / 1000), ts_ms: (.ts / 1000), data: .args.data})
    | sort_by(-.dur_ms)[0:10]' trace.json

# Total Blocking Time approximation
# Sum of (dur - 50ms) for tasks > 50ms on the main thread, after FCP
jq '.traceEvents
    | map(select(.ph == "X" and .dur > 50000 and (.cat | contains("devtools.timeline"))))
    | map((.dur / 1000) - 50)
    | add' trace.json

# Top JS functions by self-time (approximation: FunctionCall events)
jq '.traceEvents
    | map(select(.name == "FunctionCall" and .ph == "X"))
    | group_by(.args.data.functionName)
    | map({fn: .[0].args.data.functionName, total_ms: ([.[].dur] | add) / 1000, count: length})
    | sort_by(-.total_ms)[0:15]' trace.json

# Layout / Recalculate Style cost
jq '.traceEvents
    | map(select(.name == "Layout" or .name == "UpdateLayoutTree" or .name == "ParseHTML"))
    | group_by(.name)
    | map({name: .[0].name, total_ms: ([.[].dur] | add) / 1000, count: length})' trace.json
```

For very large traces, prefer `jq --stream` or extract the events you need
to a smaller intermediate file first.

## What to look for, in order

Walk the trace in this order:

| # | Signal                                                                 | Meaning                                                            | Common cause                                                |
| - | ---------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1 | Long tasks > 50ms (red triangle in DevTools)                           | The main thread was blocked beyond a frame budget                  | Big sync work, parse/compile, layout thrash                 |
| 2 | A single task > 200ms                                                  | Definitely a UX problem (INP, long input delay)                    | Synchronous JSON.parse, heavy `useEffect`, sync XHR         |
| 3 | Many `Layout` events under one task                                    | Forced synchronous layout / "layout thrash"                        | Read-write-read DOM pattern in a loop                        |
| 4 | `EvaluateScript` taking 100s of ms early in the trace                  | Bundle is too big or ships too much non-critical code              | Import the world; missing code-splitting                    |
| 5 | `v8.compile` / `v8.parseOnBackground` heavy                            | Source size or eval'd code is large                                | Inline `<script>`, `eval`, big bundle                       |
| 6 | A single `FunctionCall` dominating a task                              | One function does too much work                                    | Hand-rolled diff, big array map/filter, regex on long string |
| 7 | Repeated identical `FunctionCall` chains                               | Loop-bound work duplicated each iteration                          | Per-row work that could batch / memoise                     |
| 8 | `Recalculate Style` spikes after each render                           | CSS selectors expensive or frequent attribute writes               | Universal selectors, style writes per element               |

## Map function → file

`args.data.functionName` is often `""`, `<anonymous>`, or minified.

1. Look at sibling `args.data.url` and `args.data.lineNumber` —
   `webpack:///./src/foo.tsx:120` resolves directly.
2. If sourcemaps are available, run them through `source-map-explorer` or
   load the `.map` files manually.
3. If only minified names are present, recognise patterns: `t.map`, `t.filter`,
   tight loops on identifiers ≤ 2 chars usually point to bundler output.
4. Fall back to grepping the codebase for the literal name when meaningful.

Quote the file path and line range in the report.

## Correlate with the React profile (if both are available)

When the user provides both, line them up by wall-clock time:

1. The trace's `ts` is microseconds from trace start.
2. The React profile's `commitData[].timestamp` is ms from profile start.
3. If recordings overlap, find the trace task that *contains* a React
   commit window — the work inside that task is the work React did.

This converts a React finding ("this commit took 230ms") into a Chrome
finding ("inside that commit, `Array.prototype.map` accounted for 180ms")
— a much more actionable result.

## Examples

### Good — finding

> Three long tasks > 100ms on the main thread between `ts=4200ms` and
> `ts=5800ms`. Largest: 264ms. Inside it, `FunctionCall` for
> `parseEvents` (`src/api/parser.ts:88`) accounts for **231ms (88%)** —
> `JSON.parse` on a 4 MB response in a single sync block. Estimated fix
> saving: ~200ms by streaming the parse with a worker, or 250ms by paginating
> the response server-side. Verification: re-record after fix and read TBT
> + the parse function's total time.

### Bad — finding

> The main thread is busy. Move things to a worker.

Why bad: no measurement, no scope, no source location.

## Common mistakes

- Treating `RunTask` itself as the root cause. **Fix:** open the call stack
  and find the inner `FunctionCall` / `Layout` / `EvaluateScript` event.
- Reading microseconds as milliseconds (factor 1000 wrong). **Fix:** always
  divide `ts` and `dur` by 1000 in jq.
- Missing the `disabled-by-default-v8.cpu_profiler` events that contain
  the real CPU samples. **Fix:** if the trace was saved with that
  category enabled, also examine `Profile` and `ProfileChunk` events.
- Confusing `Layout` (geometry) with `Recalculate Style` (selector
  matching). **Fix:** they have different fixes — name them correctly.
