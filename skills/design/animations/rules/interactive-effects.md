---
title: Interactive Effects — CSS Variables, @property, Cursor Tracking
impact: HIGH
tags:
  - css-variables
  - custom-properties
  - cursor-tracking
  - hover
  - houdini
---

# Interactive Effects

CSS custom properties (`--var`) plus `@property` registration turn the
style engine into a one-way data bus: JavaScript writes one variable per
animation frame, CSS reads it from any descendant and drives gradients,
transforms, colours, or filters off it.
The element does not re-render its DOM; the browser composites the new
paint or transform on the GPU.

The cursor-tracking spotlight, animated gradients, magnetic buttons, and
gyroscope-tilt cards are all the same recipe.

## Contents

- The recipe (CSS variable + rAF-gated JS handler)
- `@property` — when a variable must animate
- Hover-only variant — no JavaScript
- Magnetic button (pointer pulls the element)
- Common mistakes

## The recipe

1. **Declare** the variable(s) on the target element with a default value.
2. **Read** the pointer / scroll / sensor value in JavaScript at most once
   per `requestAnimationFrame` tick.
3. **Write** it back with `el.style.setProperty('--x', value)`.
4. **Consume** it inside the element's CSS — typically inside a
   `background`, `transform`, `filter`, or pseudo-element.

```css
.spotlight {
  --x: 50%;
  --y: 50%;
  background:
    radial-gradient(
      circle 16rem at var(--x) var(--y),
      hsl(0 0% 100% / 0.18),
      transparent 60%
    ),
    hsl(220 14% 12%);
}
```

```js
const el = document.querySelector('.spotlight');
let frame = 0;
el.addEventListener('pointermove', (event) => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--x', `${event.clientX - rect.left}px`);
    el.style.setProperty('--y', `${event.clientY - rect.top}px`);
    frame = 0;
  });
});
```

Drop-in HTML is in [`templates/cursor-spotlight.html`](../templates/cursor-spotlight.html).

### Why `requestAnimationFrame`?

`pointermove` fires faster than the screen refreshes (hundreds of times
per second on a 240 Hz mouse). Setting CSS variables on every event burns
CPU. The `requestAnimationFrame` gate coalesces all pointer samples into
**one update per frame** — visually identical, an order of magnitude
cheaper.

## `@property` — when a variable must animate

Unregistered custom properties animate **discretely**: a `transition` on
`--angle` from `0deg` to `360deg` snaps at the midpoint instead of
sweeping. Registering the property gives the browser a type and turns
the same transition into a smooth interpolation:

```css
@property --angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}

.gradient-ring {
  background: conic-gradient(from var(--angle), magenta, cyan, magenta);
  transition: --angle 1200ms linear;
}
.gradient-ring:hover {
  --angle: 360deg;
}
```

The same trick lets you transition between gradients, between colour
stops, or between any numeric variable:

```css
@property --shimmer {
  syntax: '<percentage>';
  inherits: false;
  initial-value: 0%;
}

.button {
  background: linear-gradient(120deg, #222 var(--shimmer), #444 calc(var(--shimmer) + 20%), #222 calc(var(--shimmer) + 40%));
  transition: --shimmer 600ms ease-out;
}
.button:hover {
  --shimmer: 100%;
}
```

### Syntax cheat sheet

| `syntax`             | Use for                          |
| -------------------- | -------------------------------- |
| `<number>`           | Unitless scalars                 |
| `<length>`           | px / rem / em                    |
| `<percentage>`       | Position / size stops            |
| `<length-percentage>`| Anything that takes either       |
| `<angle>`            | `deg`, `rad`, `turn`             |
| `<time>`             | `ms`, `s`                        |
| `<color>`            | Interpolated in OKLab by default |
| `<image>`            | Crossfade between gradients      |

`@property` is Baseline in modern browsers (Chromium 85+, Safari 16.4+,
Firefox 128+) so it ships without a polyfill in most projects.

## Hover-only variant — no JavaScript

Pure-CSS cursor tracking is not a shipped feature in any browser yet
— the `:hover` and `pointer-events` model cannot expose the cursor's
coordinates to CSS. The JS path above (one `pointermove` listener,
rAF-gated, two CSS variable writes) is the correct answer.

The pseudo-cursor case where you can stay in CSS: **scroll-tied** value
changes, via `animation-timeline: scroll()`, can drive a CSS variable
without any JS at all.

## Magnetic button (pointer pulls the element)

```css
.magnetic {
  --tx: 0px;
  --ty: 0px;
  transform: translate(var(--tx), var(--ty));
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

```js
const el = document.querySelector('.magnetic');
const strength = 0.25; // 0 = no pull, 1 = full

el.addEventListener('pointermove', (event) => {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  el.style.setProperty('--tx', `${(event.clientX - cx) * strength}px`);
  el.style.setProperty('--ty', `${(event.clientY - cy) * strength}px`);
});

el.addEventListener('pointerleave', () => {
  el.style.setProperty('--tx', '0px');
  el.style.setProperty('--ty', '0px');
});
```

`transition` on `transform` smooths the snap-back; the live drag is
near-instant because each update lands inside one frame.

## Common mistakes

- **Setting CSS variables inside the raw `pointermove` handler.** Wastes
  CPU on every sub-frame sample. **Fix:** gate with
  `requestAnimationFrame` (see recipe above).
- **Animating a custom property that isn't registered.** Transition
  snaps. **Fix:** add an `@property` block with the correct `syntax`.
- **Querying `getBoundingClientRect()` inside the hot handler.** Forces
  a synchronous layout on every move. **Fix:** cache the rect on
  `pointerenter` and refresh on `resize` / `scroll`.
- **Cursor variables on `body`.** Every descendant repaints. **Fix:**
  scope them to the smallest element that actually consumes them.
- **Setting many variables to drive one effect.** Each `setProperty`
  call is cheap but not free. **Fix:** prefer one variable plus
  `calc()` to two variables.
