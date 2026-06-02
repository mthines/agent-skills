---
title: Chrome Optimization Patterns — Worked Examples
impact: MEDIUM
tags:
  - reference
  - chrome
  - main-thread
  - long-tasks
  - patterns
---

# Chrome Optimization Patterns

Worked examples mapped to the signals in
[`rules/chrome-trace-analysis.md`](../rules/chrome-trace-analysis.md). Load
this file when you need a concrete code change for a specific Chrome trace
finding.

## Contents

- Yielding inside a long task with `scheduler.yield()`
- Splitting a sync long task into chunks
- Streaming JSON parse off the main thread
- Code-splitting a route
- Avoiding layout thrash
- Eliminating forced reflows
- Lazy-loading images and iframes
- Replacing polling with event-driven updates

---

## Yielding inside a long task with `scheduler.yield()`

**Signal.** A single sync function dominates a > 100ms task, and the work
is divisible.

### Before

```ts
async function processAll(items: Item[]) {
  for (const item of items) {
    expensiveProcess(item);
  }
}
```

### After

```ts
const yieldToMain = () =>
  'scheduler' in window && 'yield' in (window.scheduler as any)
    ? (window.scheduler as any).yield()
    : new Promise((r) => setTimeout(r, 0));

async function processAll(items: Item[]) {
  for (const item of items) {
    expensiveProcess(item);
    if (performance.now() % 50 < 1) await yieldToMain();
  }
}
```

The task becomes a sequence of < 50ms chunks. INP improves because input
is handled in the gaps.

---

## Splitting a sync long task into chunks

**Signal.** Two distinct pieces of work serialised in one task.

### Before

```ts
function onSave() {
  renderChart();   // 120ms
  renderMap();     // 90ms
}
```

### After

```ts
async function onSave() {
  renderChart();
  await new Promise((r) => setTimeout(r, 50)); // breathing room for input
  renderMap();
}
```

Two short tasks beat one long one for INP and frame budget.

---

## Streaming JSON parse off the main thread

**Signal.** A `JSON.parse` of a multi-MB response shows up as a single
sync `FunctionCall` event.

```ts
// worker.ts
self.onmessage = async (e) => {
  const res = await fetch(e.data.url);
  const data = await res.json();
  self.postMessage(data);
};

// main thread
const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
w.postMessage({ url: '/api/events' });
w.onmessage = (e) => onLoaded(e.data);
```

The parse cost moves off the main thread entirely. Use `transfer` for
`ArrayBuffer` payloads to avoid copy.

---

## Code-splitting a route

**Signal.** `EvaluateScript` of 200+ ms for a chunk that contains an
admin-only route.

```tsx
const Admin = React.lazy(() => import('./routes/Admin'));

function Routes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Switch>
        <Route path="/admin" component={Admin} />
        {/* ... */}
      </Switch>
    </Suspense>
  );
}
```

Followed by preloading on the link's `pointerenter`:

```tsx
<Link
  to="/admin"
  onPointerEnter={() => import('./routes/Admin')}
>
  Admin
</Link>
```

---

## Avoiding layout thrash

**Signal.** Many `Layout` events under one task — typically a read/write
loop on the DOM.

### Before

```ts
items.forEach((el) => {
  el.style.width = `${el.offsetWidth + 10}px`; // forced sync layout per element
});
```

### After

```ts
const widths = items.map((el) => el.offsetWidth); // batched reads
items.forEach((el, i) => {
  el.style.width = `${widths[i] + 10}px`;          // batched writes
});
```

Read all geometry first, then write. Use `requestAnimationFrame` if the
loop is long enough to span a frame.

---

## Eliminating forced reflows

**Signal.** A specific `Recalculate Style` or `Layout` event fired
synchronously by JS that just read `.offsetTop` or `.getBoundingClientRect`.

Move geometry reads into `IntersectionObserver` or `ResizeObserver` —
they batch and run off the synchronous path:

```ts
const ro = new ResizeObserver((entries) => {
  for (const e of entries) updateLayout(e.contentRect);
});
ro.observe(target);
```

---

## Lazy-loading images and iframes

**Signal.** `Image Decode` and `ParseHTML` heavy on initial load.

```html
<img src="/hero.avif" loading="lazy" decoding="async" width="1200" height="800" alt="..." />
<iframe src="..." loading="lazy"></iframe>
```

Combined with a CDN that serves modern formats, this is often the cheapest
LCP / TBT win on a content-heavy page.

---

## Replacing polling with event-driven updates

**Signal.** Many small `setTimeout`/`setInterval` callbacks in the trace,
each cheap individually but adding to TBT in aggregate.

### Before

```ts
setInterval(() => fetch('/status').then(updateUI), 2000);
```

### After

```ts
const es = new EventSource('/status/stream');
es.onmessage = (e) => updateUI(JSON.parse(e.data));
```

Or WebSocket / Server-Sent Events / `BroadcastChannel`. The main thread
wakes only when there is something to do.
