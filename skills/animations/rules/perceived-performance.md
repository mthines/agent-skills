---
title: Perceived Performance — Cheat the Eye, Win the Wait
impact: HIGH
tags:
  - perceived-performance
  - skeleton-loaders
  - optimistic-ui
  - latency
  - rail
  - doherty-threshold
  - progressive-loading
  - prefetch
---

# Perceived Performance

Real latency is what the network and CPU give you.
Perceived latency is what the user *feels*.
The two are decoupled — and the gap is where animation earns its keep.
A 1200 ms request that acknowledged at 80 ms, drew a shape-matched skeleton at 120 ms, and cross-faded into content at 1200 ms reads as "snappy".
The same 1200 ms request with a blank screen until 1200 ms reads as "broken".

This rule covers the eight techniques that close that gap without making the system any faster:

1. **Acknowledge input immediately** (Doherty Threshold).
2. **Draw the shape of the answer first** (skeleton loaders).
3. **Apply the change before the server confirms it** (optimistic UI).
4. **Floor the spinner** (minimum visible duration).
5. **Reveal content progressively, not atomically** (LQIP, streamed HTML, font-display).
6. **Predict the next click and fetch before it happens** (hover / focus / viewport prefetch).
7. **Cache the last good answer and refresh in the background** (stale-while-revalidate).
8. **Choose the right wait pattern for the wait duration** (the ladder below).

## Contents

- [The principles](#the-principles)
- [The wait-duration ladder](#the-wait-duration-ladder) — pick the right pattern for the wait length
- [Skeleton loaders](#skeleton-loaders) — design rules, shimmer discipline, when not to
- [Optimistic UI](#optimistic-ui) — apply now, reconcile later
- [The loader floor](#the-loader-floor) — minimum visible duration and the sub-200 ms skip
- [Progressive loading](#progressive-loading) — images, fonts, streamed content
- [Predictive prefetch](#predictive-prefetch) — hover, focus, viewport, intent
- [Stale-while-revalidate](#stale-while-revalidate) — instant cached, refresh behind
- [Common mistakes](#common-mistakes)
- [Examples](#examples)

---

## The principles

Five research-backed thresholds drive every recommendation below.

| Threshold                         | Value           | Source                                                                | What it means                                                                                                                                       |
| --------------------------------- | --------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Response acknowledgment**       | ≤ 100 ms        | Nielsen, *Usability Engineering* (1993); RAIL (Google)                | The user perceives the system as reacting "to their action". Past 100 ms the cause-and-effect link breaks.                                          |
| **Doherty Threshold**             | ≤ 400 ms        | Doherty & Thadhani, IBM (1982)                                        | The user stays in flow. Past 400 ms attention drifts and productivity drops measurably.                                                             |
| **Frame budget (RAIL Animation)** | 16.7 ms / frame | RAIL (Google)                                                         | An animation that misses this budget janks. See [`debugging.md`](./debugging.md).                                                                   |
| **Skeleton → content**            | ≥ 200 ms        | Material Design, *Progress and activity* (2023)                       | A skeleton or spinner that flashes for under 200 ms reads as a glitch. Either skip it or floor it.                                                  |
| **Abandonment**                   | ~ 10 s          | Nielsen, *Response Times: The 3 Important Limits* (1993, rev. 2014)   | Past 10 s the user disengages — switches tabs, retries, leaves. Long jobs need a progress bar or an out (cancel, "we'll email you when it's done"). |

The over-arching principle: **the user's clock starts at their action, not at your `fetch()`**.
Anything you can do between `onClick` and the network response — pressed-state animation, skeleton paint, optimistic update — buys you free milliseconds against the perception clock.

---

## The wait-duration ladder

Pick the pattern by **expected wait time**, not by what the framework defaults to.
Measure the p75 of the actual wait on production traffic before deciding — local-dev "feels instant" is not data.

| Expected wait      | Pattern                                                                                        | Why                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **< 100 ms**       | Nothing. Just the press-state animation.                                                       | The user perceives this as instant. A spinner here is noise.                                                                                 |
| **100 – 300 ms**   | Press-state animation + content swap. **No spinner, no skeleton.**                             | A 200 ms spinner flash reads as broken. Let the press state hold the gap.                                                                    |
| **300 ms – 1 s**   | Skeleton matching the content shape, OR a `200 ms`-floored spinner inline.                     | Long enough to need a placeholder, short enough that a structural skeleton beats a meaningless spinner.                                      |
| **1 – 3 s**        | Skeleton + a progress indicator (indeterminate bar at top, or shimmer).                        | Past 1 s the user starts wondering if it's still working. The shimmer is the "yes" signal.                                                   |
| **3 – 10 s**       | Determinate progress bar with a label ("Uploading… 4 of 12 files").                            | The user needs to *measure* the wait. Indeterminate spinners past 3 s are anxiety-inducing.                                                  |
| **> 10 s**         | Either: streamed partial output, a cancellable progress bar with ETA, or an async pattern ("we'll notify you"). | Past 10 s synchronous waits are abandoned. Async-out is honest.                                                                              |

If the wait crosses a threshold *during* the request (e.g. it usually returns at 250 ms but sometimes at 2 s), pick the **upper-bound** pattern.
A user who sometimes sees a skeleton and sometimes sees nothing reads it as flicker.

---

## Skeleton loaders

A skeleton is a low-fidelity placeholder that reserves space for the content that's about to arrive.
Done well, the user's eye lands on roughly the right region *before* the content paints — so the eventual swap feels like a refinement instead of a build-up.

### Design rules

1. **Match the shape of the answer, not the framework's default.** A list-of-cards skeleton shows three card-sized rectangles, not three rounded paragraphs. A profile-header skeleton has an avatar circle, a name bar, and a sub-bar — in roughly the final sizes.
2. **Reserve the final dimensions.** The skeleton should occupy the same width / height as the loaded content so the swap does not cause layout shift. CLS during a skeleton → content swap is doubly bad: the eye registers the placeholder *and* the jump.
3. **Stay subtle — neutral grey, low contrast.** Skeletons should signal "loading" without competing with the chrome around them. A common default is `oklch(0.92 0 0)` (light) or `oklch(0.25 0 0)` (dark); pulse / shimmer at low opacity.
4. **Animate the *transition into the skeleton*, not the skeleton itself.** The skeleton can hold still (or shimmer slowly — see below) once visible. Fade *the skeleton in* over 80 – 120 ms so the swap from "nothing" to "skeleton" is not a hard cut.
5. **Use a shimmer or pulse only past 1 s of expected wait.** A shimmer in the 300 ms – 1 s band is decoration; in the 1 – 3 s band it's the "still alive" signal. Shimmer cycle: 1.2 – 1.6 s, `linear`, looping. Pulse: opacity 1 → 0.6 → 1 over 1.4 s, `ease-in-out`. Both via `transform` (`translateX` on a gradient layer) or `opacity` only — never `background-position` on the host. See [`safe-properties.md`](./safe-properties.md).
6. **Cross-fade out, do not pop.** When the content arrives, cross-fade `opacity` from skeleton (1 → 0) and content (0 → 1) over 200 – 280 ms. Do not scale-in the content — that reads as "fake polish". See the `Skeleton → content` row in [`interaction-feedback.md`](./interaction-feedback.md#status--feedback-states).
7. **Honour `prefers-reduced-motion`.** Drop the shimmer / pulse; keep the static skeleton, keep the cross-fade reduced to a near-instant swap. See [`accessibility.md`](./accessibility.md).

### Skeleton vs spinner — pick once

| Use a skeleton when…                                                                  | Use a spinner when…                                                              |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The content has a known, repeatable shape (lists, cards, tables, profile headers).    | The wait is a single in-place action (button submit, save, copy).                |
| The wait is 300 ms – 3 s.                                                              | The wait is unbounded or unknown.                                                |
| The view is a *full* loading state (route change, tab content first paint).            | The view is mostly loaded and one region is updating.                            |
| The user just navigated and there's nothing on screen yet.                             | The chrome is intact and the user is waiting for a specific operation.           |

Mixing the two — a skeleton with a spinner overlaid on top — almost always reads as redundant.
Pick one.

### When *not* to use a skeleton

- **Sub-300 ms waits.** The skeleton flashes and looks like a glitch.
- **Content with no consistent shape** (search results that may be 0–50 items of varying types). A skeleton lies about what's coming; use a generic "Searching…" affordance instead.
- **Modal / inline edits.** The user's attention is on a specific control; a skeleton elsewhere on the page distracts. Hold the chrome, swap only the edited region with a cross-fade.

### Anti-pattern — the spinning-skeleton

Animating the skeleton with the same intensity as a hero motion: rotation, scale, multi-axis shimmer.
A skeleton is a *placeholder*, not a *performance*.
Shimmer that's loud enough to read as "content" trains the user to mistake the placeholder for the answer.

---

## Optimistic UI

The cheapest perceived-performance trick is to skip the wait entirely:
**apply the change in the UI on click, send the request in the background, reconcile on response.**

Apply when the operation is:

- **High-success-rate** (> ~99 % in production). A like, a checkbox toggle, a row reorder, an inline edit.
- **Reversible.** If the server rejects, you can undo without data loss.
- **Local to one user's view.** Not a global counter, not a multi-user sync.

Do *not* apply when the operation is:

- **High-stakes financial** (payments, transfers, irreversible deletes). The user wants to *see* the system acknowledge before they trust it.
- **Server-validated** (username uniqueness, coupon codes). The optimistic state lies until the server speaks.
- **Visible to other users in real-time.** Reconciling a multi-user state after a rollback is a UX bug factory.

### The pattern

```tsx
async function toggleLike(postId: string) {
  setLiked((prev) => !prev);                // 1. apply in the UI immediately
  setCount((prev) => prev + (liked ? -1 : 1));
  try {
    await api.toggleLike(postId);           // 2. fire-and-trust
  } catch (err) {
    setLiked((prev) => !prev);              // 3. revert on failure
    setCount((prev) => prev + (liked ? 1 : -1));
    showToast("Couldn't update — try again");
  }
}
```

**Animation contract for optimistic UI:**

- The state change animates *as if it succeeded*. A like turns red on `onClick`, not on `onResponse`.
- On revert, animate the change *out* over 200 – 280 ms — same shape, reversed — and follow with a brief inline error tint (see [`interaction-feedback.md`](./interaction-feedback.md#status--feedback-states) — "Inline error").
- Never *silently* revert. The user must see why their action did not stick, or they'll repeat it.
- Reconciled values from the server (e.g. the canonical like count) cross-fade over the optimistic value — do not snap. The snap looks like a bug.

### React Query / SWR

Both libraries have first-class optimistic-update primitives.
Use them — `useMutation` with `onMutate` for React Query, `useSWRMutation` with `populateCache` for SWR — instead of hand-rolling.
The libraries handle rollback, race conditions, and stale invalidation.
A hand-rolled version usually loses a corner case.

---

## The loader floor

A spinner or skeleton that appears for under 200 ms reads as **broken**, not as fast.
The fix is a **minimum visible duration**: if the request returns *before* the floor, hold the loader until the floor expires, then swap.

### Implementation

```tsx
import { useEffect, useState } from "react";

const LOADER_FLOOR_MS = 200;

function useLoaderFloor(isLoading: boolean) {
  const [shouldShow, setShouldShow] = useState(false);
  const [shownAt, setShownAt] = useState<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      setShouldShow(true);
      setShownAt(Date.now());
      return;
    }
    if (shownAt === null) return;
    const elapsed = Date.now() - shownAt;
    const remaining = Math.max(0, LOADER_FLOOR_MS - elapsed);
    const id = setTimeout(() => setShouldShow(false), remaining);
    return () => clearTimeout(id);
  }, [isLoading, shownAt]);

  return shouldShow;
}
```

Pair the floor with a **delay floor** (also known as "the sub-200 ms skip"):
do not show the loader at all if the request *might* complete under 200 ms.
Start a `setTimeout(() => setShouldShow(true), 200)` on mount; if the response arrives before the timeout fires, cancel it and skip the loader entirely.

The combined effect:

| Actual wait      | What the user sees                                                  |
| ---------------- | ------------------------------------------------------------------- |
| 0 – 200 ms       | Nothing (just the press-state animation).                            |
| 200 – 400 ms     | Loader appears at 200 ms, held until 400 ms, then swap.              |
| 400 ms – 3 s     | Loader appears at 200 ms, holds until the response, then swap.      |
| > 3 s            | Loader plus a "still working" affordance (progress bar, ETA, cancel). |

Same pattern applies to skeletons.
The numbers above are the conservative defaults — tune to the p75 of your actual wait distribution.

---

## Progressive loading

Atomic loading ("nothing, then everything") is the worst-case for perception.
Progressive loading reveals the answer in layers — each layer paid for incrementally — so the user sees something useful long before the last byte arrives.

### Images

| Technique                                  | When to use                                                                                       | Animation                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Dominant color**                         | Always. Pick the average colour of the image; render the placeholder as a solid block.            | Cross-fade `opacity` over 200 ms when the full image decodes.                                                   |
| **LQIP (low-quality image placeholder)**   | Above-the-fold imagery, hero shots, OG previews.                                                  | Blur the LQIP via `filter: blur(20px)`; cross-fade to the full image and animate `filter: blur(0px)` over 280 ms. |
| **Blurhash / ThumbHash**                   | Image galleries, CMS-driven content with many thumbnails.                                         | Same as LQIP. Blurhash is ~20 bytes; ship in the API response, decode on the client.                            |
| **Native `loading="lazy"` + `decoding="async"`** | Always for below-the-fold imagery.                                                            | Browser handles the swap; pair with a dominant-colour CSS background to avoid layout flash.                     |

Reserve image dimensions explicitly (`width` + `height` attributes, `aspect-ratio` CSS) so the placeholder reserves the final size.
A late-arriving image that pushes content down is the #1 cause of CLS.

### Fonts

- `font-display: swap;` — show a fallback font immediately, swap when the web font loads. Default behaviour for most font hosts; verify on production traffic.
- For brand-critical typography where the swap is jarring, use `font-display: optional;` — render with fallback if the web font isn't cached, never swap mid-view.
- Pair with a metrics-matched fallback (`@font-face` with `size-adjust`, `ascent-override`, `descent-override`) so the fallback occupies the same layout box as the web font. Eliminates the FOUT layout shift.

### Streamed content (Server Components, RSC, Suspense)

React 18+ supports streaming HTML.
Wrap the slow region in `<Suspense fallback={<Skeleton />}>` — the rest of the page renders synchronously, the slow region resolves in the background.
The skeleton inside `fallback` follows all the rules above.

The animation contract:

- The skeleton appears as part of the first paint, not as a separate "step". No fade-in delay relative to the surrounding chrome.
- When the streamed chunk lands, cross-fade the skeleton out over 200 – 280 ms — same as any other skeleton swap.
- Stagger multiple streamed regions by 40 – 80 ms so they do not all flash at once. The eye reads sequential reveals as "the page is building up"; simultaneous reveals as "the page just appeared".

---

## Predictive prefetch

The cheapest request is the one that's already in cache by the time the user clicks.

| Trigger                       | Pattern                                                                                                  | Use for                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Pointer hover (300 ms+)**   | On `pointerenter`, schedule the prefetch after a 150 ms delay so a passing hover does not fire it.       | Links, cards, list rows — anything that's clickable.                     |
| **Pointer-down (mousedown)**  | Prefetch on `pointerdown`. Buys ~50 – 100 ms between the press and the click commit.                     | Primary CTAs, navigation links. Faster than hover but only fires on intent. |
| **Keyboard focus**            | On `focus` of an `<a>` or button, prefetch.                                                              | Keyboard-driven flows, accessibility — pairs with hover for parity.      |
| **Viewport (IntersectionObserver)** | Prefetch links / images / data 200 px before they enter the viewport.                              | Long lists, feeds, infinite scroll.                                      |
| **Intent (next route in flow)** | Prefetch the most likely next route on page load.                                                       | Checkout flows, wizards — anywhere the next step is statistically determined. |

Next.js (`<Link prefetch>`), Astro (`<ViewTransitions />`), and Remix (`<Link prefetch="intent">`) ship this out of the box.
Use the framework primitive — do not hand-roll.

**Don't** prefetch:

- On mobile data networks (`navigator.connection?.saveData === true`, or `navigator.connection?.effectiveType === "2g" | "slow-2g"`). Respect Save-Data.
- Below-the-fold links on first paint. Wait for an idle callback (`requestIdleCallback`) so prefetch doesn't compete with the initial load.
- High-cost mutations or anything with side effects. Prefetch is `GET`-only.

---

## Stale-while-revalidate

The user opens a tab. The cached answer renders instantly; the network refresh happens in the background; if the data has changed, the view updates in place with a cross-fade.

`stale-while-revalidate` is both an HTTP header (`Cache-Control: max-age=60, stale-while-revalidate=600`) and a data-fetching pattern (SWR, React Query's `staleTime` + `refetchOnMount`).

**Animation contract:**

- Render the stale data immediately, with no loading affordance.
- If the revalidation returns identical data: do nothing.
- If the revalidation returns different data: cross-fade the changed rows / values over 200 – 280 ms. **Don't blanket-fade the whole view** — that reads as "everything reloaded", even though nothing has.
- If the revalidation fails: keep showing the stale data, optionally with a subtle "Offline — last updated 2 min ago" affordance. Failing loudly during a background refresh is the wrong default.

The user perceives this as "instant".
The system is doing as much work as before; you've just hidden the work behind a useful first paint.

---

## Common mistakes

- **Spinner under 200 ms.** Flash and gone — reads as a glitch. **Fix:** the 200 ms floor + sub-200 ms skip, or no loader at all.
- **Skeleton on a 150 ms request.** Same flash, same glitch read. **Fix:** measure the p75 wait; if it's under 300 ms, do not draw a placeholder at all — let the press-state animation hold the gap.
- **Skeleton that doesn't match the content shape.** Three rounded paragraphs as the placeholder for a card grid. The eye lands in the wrong region, and the swap to the real content jumps. **Fix:** the skeleton's dimensions and layout must mirror the final content.
- **Loud shimmer.** Shimmer at near-full-contrast on a fast network reads as "this is the content". **Fix:** opacity range 0.6 – 1.0, never 0 – 1.0; cycle ≥ 1.2 s; mute under `prefers-reduced-motion`.
- **Optimistic UI without rollback animation.** The state pops on click, then snaps back on server rejection with no acknowledgment. The user blames themselves. **Fix:** animate the revert with the same shape, reversed, plus an inline error tint.
- **Optimistic UI on high-stakes ops.** "Payment sent ✓" before the server has confirmed. Wrecks trust the moment the rollback fires. **Fix:** reserve optimistic UI for high-success-rate, reversible, single-user actions.
- **Cross-fading the entire page on a partial-content refresh.** A SWR background refresh that changes one row blanket-fading everything. **Fix:** diff and animate only the changed regions.
- **Prefetching on every hover, no debounce.** Mouse trail across a long list of links fires 50 prefetches in 200 ms — wastes bandwidth and CPU. **Fix:** 150 ms debounce on `pointerenter`; cancel pending prefetches when the pointer leaves.
- **Atomic image load with no placeholder.** Above-the-fold image renders as blank, then full-quality slams in and shifts the layout. **Fix:** dominant colour or blurhash placeholder + reserved dimensions.
- **`font-display: block`.** Invisible text for up to 3 s while the web font loads. **Fix:** `font-display: swap;` with a metrics-matched fallback.
- **Indeterminate spinner past 3 s.** "Still working?" anxiety, then abandonment. **Fix:** at 1 s, swap to a progress bar with a label; at 10 s, offer an async out.

---

## Examples

### Good — skeleton matched to card grid, faded in, cross-faded out

```tsx
import { motion, AnimatePresence } from "motion/react";

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="aspect-[3/4] rounded-xl bg-neutral-200 animate-pulse" />
      ))}
    </div>
  );
}

function CardGrid({ items }: { items?: Card[] }) {
  return (
    <AnimatePresence mode="wait">
      {items === undefined ? (
        <motion.div
          key="skeleton"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <CardGridSkeleton />
        </motion.div>
      ) : (
        <motion.div
          key="content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
        >
          {/* real grid */}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

Six rectangles at the final aspect ratio, neutral grey, low-amplitude pulse (Tailwind's `animate-pulse` is `opacity 1 → 0.5 → 1` over 2 s — within the rules).
Skeleton fades in over 120 ms, cross-fades to content over 240 ms.
The content does not scale-in.

### Good — optimistic like with reverted-state animation

```tsx
async function toggleLike(post: Post) {
  const wasLiked = post.liked;
  setLiked(!wasLiked);
  try {
    await api.toggleLike(post.id);
  } catch {
    setLiked(wasLiked);
    setErrorTint(true);
    setTimeout(() => setErrorTint(false), 600);
  }
}
```

```css
.heart {
  transition: color 160ms ease-out, transform 160ms ease-out;
}
.heart[data-liked="true"] {
  color: var(--accent-red);
  transform: scale(1.1);
}
.heart[data-error="true"] {
  background: rgba(239, 68, 68, 0.3);
  transition: background 600ms ease-out;
}
```

The like fires on click. On server rejection, the state reverts with the same animation curve and a brief red tint announces "that didn't stick".

### Good — loader floor with sub-200 ms skip

```tsx
function useDelayedLoader(isLoading: boolean) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShow(false);
      return;
    }
    const id = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(id);
  }, [isLoading]);

  return show;
}
```

Sub-200 ms requests never trigger the loader.
Past 200 ms, pair with a separate "minimum visible duration" so the loader, once shown, holds for at least another 200 ms.

### Bad — skeleton that doesn't match the layout

```tsx
{loading && (
  <div>
    <div className="h-4 w-1/2 bg-gray-200" />
    <div className="h-4 w-2/3 bg-gray-200" />
    <div className="h-4 w-1/3 bg-gray-200" />
  </div>
)}
{!loading && <CardGrid items={cards} />}
```

Three text bars as the placeholder for a card grid.
When the real grid lands, the layout jumps from `~60 px` of text to `~600 px` of cards.
CLS regression plus a "did the page just relaunch?" beat.

### Bad — loud shimmer

```css
@keyframes shimmer {
  from { background-position: -200px 0; }
  to   { background-position: 200px 0; }
}
.skeleton {
  background: linear-gradient(90deg, #fff 0%, #ddd 50%, #fff 100%);
  background-size: 200px 100%;
  animation: shimmer 0.6s linear infinite;
}
```

Three problems: animates `background-position` (paint-heavy, see [`safe-properties.md`](./safe-properties.md)); shimmers from white-to-grey-to-white (way too high contrast for a placeholder); cycle is 600 ms (too fast — reads as anxious).

**Fix:** translate a gradient layer via `transform`, opacity in the 0.6 – 1.0 band, cycle 1.4 s.

```css
.skeleton {
  position: relative;
  overflow: hidden;
  background: var(--skeleton-base);
}
.skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
  transform: translateX(-100%);
  animation: shimmer 1.4s linear infinite;
}
@keyframes shimmer {
  to { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton::after { animation: none; }
}
```

`transform` only, opacity-bounded gradient, slow cycle, reduced-motion gated.

---

## Cross-references

- [`interaction-feedback.md`](./interaction-feedback.md) — the "Status & feedback states" table is the catalog for **single-element** loading affordances (button submit, inline success, inline error). This rule covers **page-** and **region-** level perceived-performance patterns.
- [`timing-easing.md`](./timing-easing.md) — durations and easing curves. The 200 ms loader floor and 240 ms cross-fade defaults below come from the bands in that rule.
- [`safe-properties.md`](./safe-properties.md) — skeleton shimmer must animate `transform` or `opacity` only, never `background-position`.
- [`accessibility.md`](./accessibility.md) — `prefers-reduced-motion` gates the shimmer / pulse; keep the static skeleton.
- [`react-state.md`](./react-state.md) — optimistic UI state should live where the user clicked (component or lifted), not in URL or context.
