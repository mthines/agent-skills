---
title: When to Use JS — WAAPI, Motion, and 3D
impact: HIGH
tags:
  - web-animations-api
  - waapi
  - motion
  - framer-motion
  - flip
---

# When to Use JS

Default: CSS. Reach for JavaScript only when CSS cannot express the
animation, or expresses it badly.

## Contents

- Decision flow (CSS → WAAPI → Motion → FLIP → R3F)
- Web Animations API — `element.animate`
- Motion — declarative API, springs, variants, layout, exit, scroll
- React Server Components — `'use client'` boundary
- FLIP — the vanilla escape hatch
- `requestAnimationFrame` directly
- Tailwind users — `tw-animate-css`
- Common mistakes

The de-facto JS option is **Motion** ([motion.dev](https://motion.dev)) —
the library formerly known as Framer Motion, rebranded after Framer
spun the library out as an independent project. The npm package is now
`motion`; the React import path is `motion/react`. For raw, library-free control, the **Web
Animations API** (`element.animate`) is everywhere and runs on the
compositor for `transform` / `opacity` / `filter`.

## Decision flow

| #  | Question                                                                                                                  | Pick                                                                  |
| -- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1  | Can a `transition` or `@keyframes` express it?                                                                            | **CSS.** Stop here.                                                   |
| 2  | Is it a one-shot programmatic animation with no need for spring physics, gestures, or shared layout?                       | **Web Animations API** (`element.animate`)                            |
| 3  | Do you need a **layout animation** — element morphs between two layouts, shared element between routes, list reorder?      | **Motion** `layout` + `layoutId` (and `AnimatePresence` for exits)    |
| 4  | Do you need **gestures** (drag, pan, pinch), **spring physics**, or **declarative variants** across many components?       | **Motion**                                                            |
| 5  | Do you need to animate a layout property the long way without Motion (`height: auto` etc.)?                                | **FLIP via WAAPI** (or migrate to Motion `layout`)                    |
| 6  | Are you rendering **3D, WebGL, or particles**?                                                                            | **React Three Fiber** + **Drei** ([`rules/three-d.md`](./three-d.md)) |
| 7  | Everything else                                                                                                           | Back to CSS.                                                          |

If two rows match, pick the lower-numbered one — it has fewer
dependencies.

## Web Animations API — `element.animate`

Same model as CSS keyframes, but you keep the `Animation` object and
control it from JS. Runs on the compositor when the keyframes only
touch `transform` / `opacity` / `filter`:

```js
const anim = card.animate(
  [
    { transform: 'translateY(8px)', opacity: 0 },
    { transform: 'translateY(0)',   opacity: 1 },
  ],
  {
    duration: 320,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    fill: 'forwards',
  },
);

anim.pause();
anim.reverse();
anim.currentTime = 160;
await anim.finished;
```

Use it for: one-shot programmatic animations, scrubbing, sync between
several animations, or wherever a CSS keyframe declaration would work
but you need a JS handle.

### Composite modes

For animations that should stack on top of existing transforms instead
of replacing them, set `composite: 'add'`:

```js
card.animate(
  [{ transform: 'rotate(5deg)' }, { transform: 'rotate(0deg)' }],
  { duration: 200, composite: 'add' },
);
```

## Motion — when you reach for the library

Motion ships a hybrid engine: when a keyframe set is animatable via the
Web Animations API or `ScrollTimeline`, Motion uses them (compositor,
120 fps, jank-resistant when the main thread is busy); when it needs
spring physics, gesture tracking, interruptible keyframes, or shared
layout, it falls back to a `requestAnimationFrame` loop. The mini
`animate()` is ~2.6 KB; the full hybrid `animate()` is ~18 KB.

### Install

```bash
npm install motion
```

If you have an existing project on `framer-motion`, the upgrade to
`motion@^12` is a package + import-path swap. There are no API-level
breaking changes for typical usage. New code should always import from
`motion/react`.

### Declarative API (React)

```tsx
import { motion } from 'motion/react';

export function Card() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
    />
  );
}
```

### Spring physics

```tsx
<motion.div
  animate={{ x: 100 }}
  transition={{ type: 'spring', stiffness: 300, damping: 24 }}
/>
```

Springs are the right choice when motion ends at an unknown value
(e.g. dragged-and-released positions) or when easing curves feel
mechanical. Tune `stiffness` (snappier as it goes up) and `damping`
(less overshoot as it goes up).

### Variants — keep choreography DRY

```tsx
const container = {
  hidden:  { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden:  { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

<motion.ul variants={container} initial="hidden" animate="visible">
  {items.map((i) => (
    <motion.li key={i.id} variants={item}>
      {i.label}
    </motion.li>
  ))}
</motion.ul>
```

`staggerChildren` is the cleanest stagger in the ecosystem — no
per-child `animation-delay` arithmetic.

### Layout animations

The `layout` prop tells Motion to detect layout changes and animate
between them using FLIP under the hood:

```tsx
<motion.div layout className="card" />
```

`layoutId` shares the animation across two components that mount and
unmount:

```tsx
{selected && (
  <motion.div layoutId="active-pill" className="pill" />
)}
```

This produces a smooth "morph" from the unselected pill to the selected
one — useful for tabs, navigation, and detail-view transitions.

### Exit animations

```tsx
import { AnimatePresence, motion } from 'motion/react';

<AnimatePresence>
  {open && (
    <motion.div
      key="dialog"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
    />
  )}
</AnimatePresence>
```

`AnimatePresence` keeps the element in the DOM until its exit animation
finishes. Without it, the element unmounts immediately and no exit
animation plays.

### Scroll-driven (React)

```tsx
import { useScroll, useTransform, motion } from 'motion/react';

const { scrollYProgress } = useScroll();
const scale = useTransform(scrollYProgress, [0, 1], [1, 1.2]);

<motion.section style={{ scale }} />
```

Motion uses native `ScrollTimeline` where available and falls back to
JS, so the same code works in every browser.

### React Server Components

`motion/react` components are Client Components — mark the file with
`'use client'` (Next.js) or import them inside a Client boundary.
Static decorations and page chrome should stay in Server Components;
only push interactivity into the Client island.

```tsx
// app/ui/animated-pill.tsx
'use client';
import { motion } from 'motion/react';
export function AnimatedPill(props) { /* … */ }
```

## FLIP — the vanilla escape hatch

If you do not want a dependency and you need to animate a layout
property (height auto, grid reflow, list reorder, accordion expand),
FLIP gives you Motion's `layout` prop in hand-rolled form:

```js
// FIRST — measure before the change.
const first = el.getBoundingClientRect();

// LAST — mutate; getBoundingClientRect commits the new layout synchronously.
mutateDOM();
const last = el.getBoundingClientRect();

// INVERT — calculate the transform that maps last back to first.
const dx = first.left - last.left;
const dy = first.top  - last.top;
const sx = first.width  / last.width;
const sy = first.height / last.height;

// PLAY — animate from the inverted position to identity.
el.animate(
  [
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
    { transform: 'translate(0, 0) scale(1, 1)' },
  ],
  { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
);
```

For a same-page DOM swap (route change, list reorder crossfade),
**View Transitions** ([`rules/modern-css.md`](./modern-css.md)) ships
the same effect in half the code and runs entirely on the compositor.

## `requestAnimationFrame` directly

Reach for raw `rAF` only when you need to drive a value that no CSS
property can express and no animation API exposes — Canvas redraws
synced to scroll, per-frame physics over a CSS variable, or sensor
input.

```js
function tick(now) {
  // Update a CSS variable, redraw a canvas, advance physics, etc.
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

Avoid `setInterval` for animation — its 4 ms minimum is wrong relative
to the display, and it keeps running when the tab is hidden.
`requestAnimationFrame` aligns to the display refresh and pauses
automatically when the tab is hidden.

## Tailwind users

Tailwind v4 shipped CSS-first configuration. For pre-built animation
utilities, use `tw-animate-css` (the shadcn/ui-blessed successor to
`tailwindcss-animate`):

```bash
npm install tw-animate-css
```

```css
@import "tailwindcss";
@import "tw-animate-css";
```

Use Tailwind classes for the simple stuff (`animate-fade-in`,
`animate-slide-in-bottom`), and Motion for anything stateful, shared,
or gesture-driven.

## Common mistakes

- **Replacing a CSS transition with WAAPI for no reason.** Adds JS for
  no benefit. **Fix:** use WAAPI only when you need its control surface.
- **Importing from `framer-motion` in new code.** The package is
  unmaintained. **Fix:** install `motion` and import from `motion/react`.
- **Forgetting `fill: 'forwards'` on a one-shot WAAPI animation.** The
  element snaps back at the end. **Fix:** set `fill: 'forwards'`, or
  commit the final styles with `anim.commitStyles()`.
- **Layout animations on `box-shadow` / `border-radius` changes.**
  Those repaint every frame. **Fix:** keep paint-stable properties
  outside the layout transition.
- **Putting `motion.*` components in a Server Component.** Build error
  or runtime hang. **Fix:** mark the file `'use client'` (Next.js) or
  import inside a Client boundary.
