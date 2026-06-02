---
title: React State Patterns — Driving Smooth Transitions
impact: HIGH
tags:
  - react
  - state-management
  - motion
  - animate-presence
  - concurrent
---

# React State Patterns

Smooth animations and React's rendering model fight unless you
deliberately keep them apart. The rules below cover where the
animation state lives, when to use refs over `useState`, how to wire
`AnimatePresence`, and how to keep React 18+ concurrent features
(`useTransition`, Suspense, Server Components) from interrupting
mid-animation.

This rule pairs with [`state-choreography.md`](./state-choreography.md)
— that one is about the visual plan; this one is about the React
mechanics that drive it.

## Contents

- Where state lives (the four locations, in priority order)
- Refs over `useState` for 60 fps values
- `AnimatePresence` — modes and exit-aware patterns
- Layout effects — `useLayoutEffect` vs `useEffect`
- Re-render minimisation (stable keys, memo, callback)
- Concurrent features — `useTransition`, `useDeferredValue`, Suspense
- Strict Mode and Motion's double-mount handling
- Server Components and the `'use client'` boundary
- Common mistakes

---

## Where state lives

Pick the lowest level that satisfies the requirement. Hoisting state
unnecessarily forces re-renders on consumers that should not care.

| #  | State location                                | Use when                                                                              |
| -- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1  | **The animating component itself** (`useState`) | The transition is self-contained (a card flipping open).                              |
| 2  | **A parent component**                         | Two sibling components need to react to the same state (a toolbar showing the active tab). |
| 3  | **The URL / route**                            | The state survives reload, deep links, or sharing (gallery → detail view).            |
| 4  | **App-wide context or a store**                | The state is read by many disconnected parts of the tree (theme, layout density).     |

> **Heuristic:** if a single back-button press should "undo" the
> visual state change, the state belongs in the URL. Next.js parallel
> routes and intercepted routes are built for exactly this — open a
> detail view that crossfades with `layoutId`, share the URL, refresh
> to the same view.

## Refs over `useState` for 60 fps values

React state changes trigger reconciliation. At 60 fps that is 60
re-renders per second. Even with `React.memo`, the cost is real.

**Anything that updates every frame goes in a ref** — pointer
position, scroll progress, animated values, drag deltas. Two
practical patterns:

### Plain refs (no library)

```tsx
function MagneticButton() {
  const ref = useRef<HTMLButtonElement>(null);

  function handle(e: React.PointerEvent) {
    const rect = ref.current!.getBoundingClientRect();
    ref.current!.style.setProperty('--tx', `${(e.clientX - rect.left - rect.width / 2) * 0.25}px`);
    ref.current!.style.setProperty('--ty', `${(e.clientY - rect.top - rect.height / 2) * 0.25}px`);
  }

  return <button ref={ref} onPointerMove={handle} className="magnetic" />;
}
```

No state, no re-renders, the CSS variable does the work.

### Motion `useMotionValue` + `useMotionTemplate`

```tsx
import { motion, useMotionValue, useMotionTemplate, useSpring } from 'motion/react';

function Card() {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 24 });
  const sy = useSpring(y, { stiffness: 200, damping: 24 });

  const transform = useMotionTemplate`translate(${sx}px, ${sy}px)`;

  return (
    <motion.div
      style={{ transform }}
      onPointerMove={(e) => { x.set(e.clientX); y.set(e.clientY); }}
    />
  );
}
```

`useMotionValue` is a `MotionValue<T>` that bypasses React entirely —
no re-render when it changes; Motion subscribes natively. Always
prefer it over `useState` when the value updates per frame.

**Never** read `.get()` inline in JSX (`style={{ x: x.get() }}`) — it
captures the value at render time and never updates. Use
`useMotionTemplate` (for string interpolation) or pass the
`MotionValue` directly into `style` (Motion subscribes).

## `AnimatePresence` — modes and patterns

`AnimatePresence` keeps a component in the DOM long enough for its
exit animation to finish.

```tsx
import { AnimatePresence, motion } from 'motion/react';

<AnimatePresence mode="wait">
  {open && (
    <motion.div
      key={open ? 'a' : 'b'}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
    />
  )}
</AnimatePresence>
```

### Mode choice

| `mode`        | Behaviour                                                                                  | Use when                                                |
| ------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| (default)     | Old and new render simultaneously; their animations overlap.                               | Crossfades; lists where order doesn't matter.            |
| `"wait"`      | Old's exit completes before the new mounts.                                                | Page-content swaps where overlap would feel chaotic.     |
| `"popLayout"` | The exiting element is removed from layout immediately (still rendered absolutely on top). | List items where the remaining items should reflow now. |

### The `key` is load-bearing

`AnimatePresence` tracks children by `key`. If the key does not change
between states, no exit / enter animation runs. For toggle-style
states (open / closed), key the conditional child explicitly:

```tsx
<AnimatePresence mode="wait">
  <motion.div key={view} ...>{content[view]}</motion.div>
</AnimatePresence>
```

For lists, the key is the item's stable ID — never the array index.

## Layout effects — `useLayoutEffect` vs `useEffect`

`useEffect` fires **after** the browser paints. `useLayoutEffect`
fires synchronously after the React commit but **before** paint.
Anything that *measures the DOM and then mutates a style before the
user can see the intermediate state* must use `useLayoutEffect`.

### When to reach for `useLayoutEffect`

- Reading layout (`getBoundingClientRect`) and writing a style that
  needs to land in the same frame (manual FLIP).
- Imperatively starting an animation that depends on measured layout.
- Synchronously syncing scroll position to a CSS variable on mount.

If you can avoid measuring DOM (Motion's `layout` prop does this for
you), avoid `useLayoutEffect` — it blocks paint.

```tsx
useLayoutEffect(() => {
  const rect = ref.current!.getBoundingClientRect();
  ref.current!.style.transform = `translateY(${-rect.height}px)`;
  // Force reflow, then animate back.
  requestAnimationFrame(() => {
    ref.current!.style.transition = 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    ref.current!.style.transform = '';
  });
}, []);
```

## Re-render minimisation

Animation components are sensitive to re-renders that change props,
even if the new props are visually identical.

1. **Stable keys.** Never `key={Math.random()}` or `key={index}` in a
   list that animates. Use the item's ID.
2. **`React.memo`** on motion components that take animatable props
   from a parent that re-renders frequently.
3. **`useCallback`** for handlers passed to motion components, so the
   prop reference is stable across renders.
4. **`useMemo`** for `variants` objects — they look static but
   reference equality matters.
5. **Don't reconstruct `transition` objects inline:**

```tsx
// Bad — new object every render.
<motion.div transition={{ duration: 0.3 }} />

// Good — stable reference.
const transition = { duration: 0.3 };
<motion.div transition={transition} />
```

In practice, with React 19's auto-memoising compiler, items 2–5 are
less load-bearing. Item 1 (stable keys) is mandatory regardless.

## Concurrent features

React 18+ ships features that can defer or interrupt renders. They
interact with animations in predictable ways.

### `useTransition` — keep input responsive during a heavy state change

```tsx
const [isPending, startTransition] = useTransition();

function open(id: string) {
  startTransition(() => setActive(id));
}
```

The state update inside `startTransition` is marked non-urgent.
React can interrupt it for higher-priority work (keystrokes). For
animations: the morph kicks off on the next paint regardless, so
`useTransition` is mostly invisible. Use it when the **content** that
animates in is expensive to render (a long list, a heavy component).

### `useDeferredValue` — keep a derived view in sync without blocking

```tsx
const query = useDeferredValue(input);
const results = useMemo(() => search(query), [query]);
```

Lets the input animate smoothly while the filtered list catches up.

### Suspense — animate around loading boundaries

```tsx
<AnimatePresence mode="wait">
  <Suspense fallback={<Skeleton key="skeleton" />}>
    <Detail key={id} />
  </Suspense>
</AnimatePresence>
```

The skeleton exit-animates out while the detail enter-animates in.
Skeletons should fade, never bounce — keep their motion minimal so
the real content lands smoothly.

## Strict Mode and Motion's double-mount

React Strict Mode mounts every component twice in development. Motion
12+ handles this internally — animations don't re-trigger on the
second mount. If you see a flash, check:

- You are not animating in `useEffect` with no cleanup.
- `AnimatePresence` keys are stable.
- You are on `motion` (the rebranded package), not legacy
  `framer-motion`.

## Server Components and the `'use client'` boundary

`motion/react` components are Client Components. They must live in
a file marked `'use client'` (Next.js / React Server Components).

```tsx
// app/ui/animated-card.tsx
'use client';
import { motion } from 'motion/react';
export function AnimatedCard(props: Props) { /* … */ }
```

Best practice: keep static content (text, images) in Server
Components and import small Client-Component "islands" for the
animated parts. The boundary minimises the JS shipped to the browser.

### Shared layout animations across routes

For `layoutId` to morph between two routes in Next.js App Router,
both routes must share the **same React tree across the
navigation** — that means the `motion.*` elements live in a
shared `layout.tsx`, not in the page itself. Per-route page
components can crossfade via View Transitions.

## Common mistakes

- **Storing pointer or scroll position in `useState`.** 60 re-renders
  per second. **Fix:** ref + CSS variable, or `useMotionValue`.
- **Reading `motionValue.get()` inline in JSX.** Captures the value
  once at render. **Fix:** pass the `MotionValue` directly into
  `style`, or use `useMotionTemplate`.
- **`AnimatePresence` with no `key` on the child.** Exit animation
  never runs. **Fix:** explicit `key={state}`.
- **`useEffect` for measure-then-animate.** The user sees a flash of
  the intermediate state. **Fix:** `useLayoutEffect`, or let Motion's
  `layout` prop measure for you.
- **Reconstructing `variants` / `transition` objects every render.**
  Motion has to re-resolve. **Fix:** `useMemo` or module-level
  constants.
- **`'use client'` missing on a file with `motion.*`.** Build error
  or runtime hang. **Fix:** mark the file, or import the component
  from one that is marked.
- **`layoutId` across two routes that don't share a parent.** Morph
  never starts. **Fix:** put the `motion` element in a shared
  `layout.tsx`, or use View Transitions cross-document.
- **Importing from `framer-motion`.** The package is unmaintained.
  **Fix:** `motion` + `motion/react`.
