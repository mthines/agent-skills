---
title: 'Performance — Measure First, Then Optimize'
impact: MEDIUM
tags:
  - performance
  - optimization
  - profiling
---

# Performance

Donald Knuth's full quote: *"Premature optimization is the root of all
evil. Yet we should not pass up our opportunities in that critical 3%."*
The lesson is not "ignore performance" — it's "know which 3% matters
before optimizing." Most code should be optimized for the human reader;
the small fraction that drives the system's performance deserves serious
attention.

## The Two Phases

### Phase 1: While Writing (default mode)

- **Pick the right data structure / algorithm.** This is where you actually
  win. `O(n²)` becomes `O(n)` by using a `Set` or `Map` lookup instead of
  nested loops. Algorithmic wins are orders of magnitude; micro-optimizations
  are single-digit percents.
- **Avoid obvious waste.** Don't fetch data inside a loop that could be
  fetched once outside. Don't recompute values inside hot loops.
- **Use the language's idioms.** `array.includes(x)` may be slightly
  slower than a `for` loop in some engines, but the difference is
  invisible against the cost of "I had to re-read this." Idioms win until
  proven otherwise.
- **Don't over-cache.** Caches add complexity (invalidation, staleness).
  Cache when measurements show it's needed, not preemptively.

### Phase 2: After Profiling (focused mode)

When a real performance problem surfaces:

1. **Measure before changing anything.** Use a profiler, not intuition.
   Programmer intuition about hot paths is famously wrong.
2. **Find the actual bottleneck.** Often it's a single function or a
   single line; rarely is it diffuse across the codebase.
3. **Optimize that bottleneck specifically.** Don't rewrite the whole
   module. Targeted change, measure, verify.
4. **Document the optimization.** Leave a comment explaining what was
   measured and what was tried. Future-you will want to know whether the
   ugly code can be cleaned up.

## Common Algorithmic Wins (do these without measuring)

- **Linear search → hash lookup**: `array.find(x => x.id === id)` becomes
  `byId.get(id)` after one preprocessing step, especially in loops.
- **Repeated work outside the loop**: hoist constants, regex compilation,
  date formatting, etc. out of hot loops.
- **Avoid N+1 queries**: batch database calls. This is almost always a 10×+
  improvement.
- **Lazy / streaming for large data**: don't load 10GB into memory if you
  can stream.

## Common Micro-Optimizations (skip these unless profiled)

- Replacing `forEach` with `for`.
- Inlining short functions.
- `Object.freeze` / `delete` tricks.
- Bitwise operations instead of arithmetic.
- Caching `array.length` in a loop variable.

In modern engines these optimizations are either applied automatically or
their effect is negligible compared to algorithmic factors. Don't pollute
readable code chasing them.

## Memory

- **Don't hold references unnecessarily.** Long-lived objects pinning
  large structures cause leaks. Drop references when done.
- **Watch for accidental retention** in closures, especially in event
  handlers and timers.
- **Streaming over buffering** for large I/O.

## Concurrency

- **Async by default for I/O.** Network, disk, anything that waits.
- **Parallelism for CPU-bound work** (workers, threads), but only after
  measuring serial performance first — concurrency adds complexity and
  often doesn't help if the bottleneck is elsewhere.
- **Beware of race conditions.** A 5% speedup that introduces a heisenbug
  is a net loss.

## Readability vs. Performance: The Default

Until a profile proves otherwise, write for the reader:

```javascript
// Readable
const totalRevenue = orders
  .filter(o => o.status === 'paid')
  .map(o => o.total)
  .reduce((sum, total) => sum + total, 0);

// "Faster" (single loop) — but only worth it if profiling shows this matters
let totalRevenue = 0;
for (let i = 0; i < orders.length; i++) {
  if (orders[i].status === 'paid') totalRevenue += orders[i].total;
}
```

For 99% of code, version one is the right answer. For the 1% in a hot
loop processing millions of records, version two — with a comment
explaining the measurement — is justified.

## When Performance IS the Feature

Some code is performance-critical by nature: render loops, real-time
audio/video, low-latency networking, query engines. In that code:

- Document expected performance characteristics in comments.
- Add benchmarks that fail CI on regression.
- Accept that some readability sacrifices are warranted, but minimize them.

The trick is recognizing when you're in this code — and most code isn't.
