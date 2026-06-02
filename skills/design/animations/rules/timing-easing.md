---
title: Timing and Easing — Durations, Curves, Choreography
impact: HIGH
tags:
  - timing
  - easing
  - cubic-bezier
  - choreography
---

# Timing and Easing

The same animation feels professional or amateur based on two values:
**duration** and **easing curve**. Defaults like `transition: 1s linear`
read as broken; the band below reads as intentional.

## Contents

- Duration (role → range table)
- Easing — name your curves (CSS keywords, production `cubic-bezier`s, `linear()` multi-stop)
- Spring physics — when curves are not enough
- Choreography — sequencing multiple things
- Common mistakes

## Duration

| Role                                                     | Range            |
| -------------------------------------------------------- | ---------------- |
| Hover / button press / focus ring                        | 80 – 160 ms      |
| State transition on a small element (toggle, badge)      | 150 – 250 ms     |
| Card / modal / popover open                              | 200 – 350 ms     |
| Page-section / list reveal                               | 250 – 450 ms     |
| Hero, route transition, splash                           | 350 – 700 ms     |
| Anything longer                                          | Justify it       |

Two design constants:

- **Exits are faster than entrances.** A modal opens in 320 ms and
  closes in 200 ms. The user is already moving on; do not make them
  wait for the close.
- **Asymmetric is okay.** `transition: opacity 240ms ease-out` on the
  in-state, `transition: opacity 160ms ease-in` on the out-state.

## Easing — name your curves

`linear` reads as robotic. Reach for it only when the property is
**continuous in the physical sense** — a progress bar, a scroll-tied
animation, a long carousel auto-advance. For everything else, pick from
the named set.

### CSS keyword cheat sheet

| Keyword            | `cubic-bezier()` equivalent     | Use for                                       |
| ------------------ | ------------------------------- | --------------------------------------------- |
| `linear`           | `(0, 0, 1, 1)`                  | Progress bars, scroll-tied                    |
| `ease`             | `(0.25, 0.1, 0.25, 1)`          | Avoid — too generic; pick a specific one      |
| `ease-in`          | `(0.42, 0, 1, 1)`               | **Exits** (object leaves the screen)          |
| `ease-out`         | `(0, 0, 0.58, 1)`               | **Entrances** (object lands on the screen)    |
| `ease-in-out`      | `(0.42, 0, 0.58, 1)`            | Pass-through transitions, both ends visible   |

### Production curves to keep on hand

| Name                              | `cubic-bezier()`              | Feel                                          |
| --------------------------------- | ----------------------------- | --------------------------------------------- |
| Standard (Material / iOS-ish)     | `(0.2, 0.8, 0.2, 1)`          | Quick start, gentle landing — the safe default |
| Decelerate                        | `(0, 0, 0.2, 1)`              | Pronounced "settle"                            |
| Emphasized decelerate (Material 3) | `(0.05, 0.7, 0.1, 1)`         | Slower start, longer settle — for big hero moves |
| Accelerate (exits)                | `(0.4, 0, 1, 1)`              | Snappy off-screen                              |
| Quad ease-out                     | `(0.25, 1, 0.5, 1)`           | Default for short UI motion                    |

```css
:root {
  --ease-standard:   cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
}

.card {
  transition: transform 240ms var(--ease-standard),
              opacity   240ms var(--ease-decelerate);
}
```

Naming curves makes them auditable across a codebase. A grep for
`cubic-bezier` should turn up the variable, not 47 hand-typed values.

### `linear()` — keyframe-level easing

For curves that no `cubic-bezier` can describe (overshoots, bounces),
modern browsers ship the `linear()` easing function:

```css
.spring {
  transition: transform 600ms linear(
    0, 0.5 25%, 1.1 50%, 0.95 70%, 1
  );
}
```

Each pair is `(value position%)`. The browser interpolates linearly
between them, so a multi-stop `linear()` can approximate spring physics
without JavaScript. Baseline in Chromium and Safari; Firefox 112+.

## Spring physics — when curves are not enough

Springs end at an unknown value (drag-and-release, gesture follow,
chained animations). They are tedious to hand-roll; reach for **Motion**
(see [`when-to-use-js.md`](./when-to-use-js.md)):

```tsx
<motion.div
  animate={{ x: 100 }}
  transition={{ type: 'spring', stiffness: 300, damping: 24 }}
/>
```

| Parameter   | Effect                                                  |
| ----------- | ------------------------------------------------------- |
| `stiffness` | Higher = snappier. UI: 200–500. Soft: 80–150.           |
| `damping`   | Higher = less overshoot. UI: 20–35. Bouncy: 8–15.       |
| `mass`      | Higher = lazier. Default 1; rarely change.              |

## Choreography — sequencing multiple things

When several elements animate together, do not give them all the same
timing. Stagger by ~30–70 % of the duration; vary durations slightly to
avoid a synchronised "wave":

```css
.title { animation: rise 380ms var(--ease-standard) forwards; }
.body  { animation: rise 320ms var(--ease-standard) 80ms forwards; }
.cta   { animation: rise 280ms var(--ease-standard) 160ms forwards; }
```

Title is the slowest and arrives first; CTA is the fastest and arrives
last. The eye follows the lead and the supporting elements catch up.

For lists, stagger via `--index` or Motion's `staggerChildren` — see
[`patterns.md`](./patterns.md) and
[`when-to-use-js.md`](./when-to-use-js.md).

## Common mistakes

- **`linear` for UI motion.** Reads robotic. **Fix:** use `ease-out`
  for entrances, `ease-in` for exits, or a named `cubic-bezier`.
- **Same duration for in and out.** Exits feel slow. **Fix:** shorten
  exits by ~30 %.
- **`transition: all`.** Pays for every property change. **Fix:** list
  the properties explicitly.
- **Hand-typed `cubic-bezier(0.23, 1.12, 0.5, 0.94)` in 14 places.**
  Unauditable. **Fix:** name it (`--ease-…`) and reuse.
- **Animation durations measured in seconds in CSS but milliseconds
  in JS.** Pick one unit per project; ms is the convention in
  animation tooling.
