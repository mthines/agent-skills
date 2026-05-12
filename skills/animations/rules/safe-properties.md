---
title: Safe Properties — What the GPU Will Composite
impact: HIGH
tags:
  - performance
  - gpu
  - compositor
  - will-change
---

# Safe Properties

The browser turns CSS into pixels through four stages: **Style → Layout →
Paint → Composite**. Each stage is more expensive than the one after it.
The cheapest property to animate is one that only re-runs Composite, which
the GPU handles on its own thread, off the main thread.

The list of properties that fall into that bucket is short. Memorise it.

## Contents

- The compositor list (table)
- Substitution table
- `will-change` — when, how, and how briefly
- Forcing a layer when you must
- Common mistakes

## The compositor list

| Property                                                  | Stage         | Notes                                                                                      |
| --------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `transform` (`translate`, `scale`, `rotate`, `skew`, 3D)  | **Composite** | Cheapest. Use for movement, scale, rotation. Use 3D variants (`translate3d`, `translateZ(0)`) when you need to force layer promotion. |
| `opacity`                                                 | **Composite** | Fades. Free.                                                                               |
| `filter` (`blur`, `brightness`, `drop-shadow`, …)         | Composite     | Cheap but GPU memory grows with element size — blur on a hero image is not free.           |
| `backdrop-filter`                                         | Composite     | Same caveat — expensive on large surfaces.                                                 |
| `clip-path` (with `path()` / `polygon()`)                 | Composite     | Usually composited; falls back to paint if the browser cannot accelerate the shape.        |
| `color`, `background-color`                               | Paint         | Avoid animating in hot paths. Acceptable for one-shot transitions on small surfaces.       |
| `box-shadow`                                              | Paint         | Expensive. Animate a layered pseudo-element with `opacity` instead.                        |
| `border-radius`                                           | Paint         | Avoid in loops.                                                                            |
| `width`, `height`, `top`, `left`, `right`, `bottom`       | **Layout**    | Triggers reflow. Use `transform: scale()` / `translate()` instead.                         |
| `margin`, `padding`                                       | **Layout**    | Same.                                                                                      |
| `font-size`                                               | Layout        | Same.                                                                                      |
| Most other properties                                     | Layout/Paint  | Default-deny: assume layout cost unless this table says otherwise.                         |

> **Why only three properties get a green flag:** `transform`, `opacity`,
> and `filter` are guaranteed to neither affect nor be affected by normal
> document flow, so the browser can promote the element to its own
> compositor layer and animate it on the GPU thread without re-running
> Style, Layout, or Paint on the main thread.

## Substitution table

When the obvious property is on the layout list, substitute:

| Want to animate           | Don't                          | Do                                                                                     |
| ------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| Position                  | `top` / `left`                 | `transform: translate(x, y)` (or `translate3d` to force a layer)                       |
| Size                      | `width` / `height`             | `transform: scale(s)` — text inside scales too; pair with `transform-origin`           |
| Show / hide               | `display: none` toggle         | `opacity: 0` + `pointer-events: none` (keeps it in the layout, animates the fade)      |
| Collapse / expand height  | `height: 0 → auto`             | `grid-template-rows: 0fr → 1fr` on a wrapper, or FLIP (see `when-to-use-js.md`)        |
| Coloured glow             | Animated `box-shadow`          | Pseudo-element with the shadow + animate its `opacity`                                 |
| Border thickness          | `border-width`                 | Inset `box-shadow` on a static border, animate `opacity` of an overlay                 |
| Reorder a list            | Reflow on `flex-direction`     | FLIP via WAAPI (`element.animate`)                                                     |

## `will-change` — when, how, and how briefly

`will-change` is a hint that tells the browser "promote this element to its
own compositor layer because I'm about to animate it." That promotion
costs GPU memory, so the browser is allowed to ignore the hint, and
overusing it backfires.

### The three rules

1. **One or two elements per page maximum.** Each promoted layer costs
   memory.
2. **Add it just before the animation starts, remove it when the
   animation ends.** Not on hover. Not statically in CSS.
3. **Never `will-change: all` or `will-change: transform, opacity,
   filter` together** — name only the property you'll actually animate.

### Correct usage

```css
/* Default — no will-change. */
.card { transition: transform 200ms ease-out; }

/* Set just before the animation runs. */
.card.is-about-to-animate { will-change: transform; }
```

```js
card.classList.add('is-about-to-animate');
// Trigger the animation
card.classList.add('is-flipping');
card.addEventListener('transitionend', () => {
  card.classList.remove('is-about-to-animate');
  card.classList.remove('is-flipping');
}, { once: true });
```

### Bad pattern — sprayed in CSS

```css
/* Bad — every card gets a permanent compositor layer. */
.card { will-change: transform; }
```

This pins memory for every card, whether or not it ever animates. On a
list of 200 cards, that is hundreds of MiB of GPU memory.

### Acceptable shorthand — hover-scoped, single element

```css
/* Acceptable: scopes will-change to the brief hover window. */
.button:hover { will-change: transform; }
.button     { transition: transform 150ms ease-out; }
.button:hover { transform: scale(1.02); }
```

Use this only on elements the user actively interacts with, and only one
or two per viewport.

## Forcing a layer when you must

If profiling shows the first frame of an animation stutters because the
layer is promoted lazily, use a one-time GPU hint inside the keyframes
themselves rather than `will-change`:

```css
@keyframes slideIn {
  from { transform: translate3d(-100%, 0, 0); }
  to   { transform: translate3d(0, 0, 0); }
}
```

`translate3d` (or any 3D transform) is enough to trigger layer promotion
on the legacy compositor implementations without paying the
`will-change` cost permanently. Modern Chromium and WebKit usually
promote automatically, so try `translate(x, y)` first and only swap to
`translate3d` if you measure a regression.

## Common mistakes

- **Animating `transform` and `top` together.** The `top` change drags
  the animation back onto the main thread. **Fix:** convert `top` to a
  `translateY` and animate only `transform`.
- **`transition: all` everywhere.** Pays for every animatable property,
  including layout properties you didn't think about. **Fix:** name the
  properties — `transition: transform 200ms, opacity 200ms`.
- **Animating `box-shadow` for a glow.** Repaint cost grows with element
  area. **Fix:** stack a pseudo-element with the shadow pre-rendered,
  animate its `opacity`.
- **`will-change: transform` on every list item.** Memory blowup. **Fix:**
  scope it to the item being hovered, or remove entirely.
- **2D `translate` on a freshly created element that stutters on the
  first frame.** Layer promotion is lazy. **Fix:** use `translate3d` or
  add `will-change: transform` for the duration of the animation only.
