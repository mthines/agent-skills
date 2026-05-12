---
title: Patterns — Fade, Stagger, Slide, Scale, Scroll
impact: HIGH
tags:
  - patterns
  - fade
  - stagger
  - scroll-driven
  - keyframes
---

# Patterns

The five animation shapes that cover ~90 % of UI work. Each one is
GPU-cheap when implemented with the snippets below.

## Contents

- Fade in / out
- Stagger (a sequence of fades or slides)
- Slide
- Scale (entrances, button press)
- Scroll-driven
- View Transitions (page or DOM swap)
- Common mistakes

For **from-to morphs** (list → stacked cards, full nav → icon-only
nav, grid → detail view), see
[`from-to-morphs.md`](./from-to-morphs.md) — those require Motion
`layout` / `layoutId` or View Transitions, not the recipes below.

## 1 — Fade in / out

```css
.fade-in {
  opacity: 0;
  transition: opacity 200ms ease-out;
}
.fade-in.is-visible {
  opacity: 1;
}
```

For elements that need to disappear from the tab order while invisible:

```css
.fade-out {
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease-out, visibility 0s linear 200ms;
  visibility: hidden;
}
.fade-out.is-visible {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
  transition: opacity 200ms ease-out, visibility 0s linear 0s;
}
```

The `visibility` transition with a delay equal to the opacity duration on
the **out** side keeps the element clickable while it fades in and
removes it from the accessibility tree after it fades out.

## 2 — Stagger (a sequence of fades or slides)

Two clean approaches. Pick by ergonomics, not performance — both run on
the compositor.

### A — `nth-child` (fixed list size)

```css
.list > * {
  opacity: 0;
  transform: translateY(8px);
  animation: rise 320ms ease-out forwards;
}
.list > *:nth-child(1) { animation-delay:   0ms; }
.list > *:nth-child(2) { animation-delay:  60ms; }
.list > *:nth-child(3) { animation-delay: 120ms; }
.list > *:nth-child(4) { animation-delay: 180ms; }

@keyframes rise {
  to { opacity: 1; transform: translateY(0); }
}
```

### B — `--index` custom property (any list size)

In the markup, set the index inline:

```html
<ul class="list">
  <li style="--index: 0">…</li>
  <li style="--index: 1">…</li>
  <li style="--index: 2">…</li>
</ul>
```

In CSS:

```css
.list > * {
  --stagger: 60ms;
  opacity: 0;
  transform: translateY(8px);
  animation: rise 320ms ease-out forwards;
  animation-delay: calc(var(--index) * var(--stagger));
}
```

If the runtime supports `sibling-index()` (a 2024+ CSS function in modern
Chromium), skip the inline style:

```css
.list > * {
  animation-delay: calc((sibling-index() - 1) * 60ms);
}
```

> **Stagger rule of thumb:** delay = 30–70 % of duration. Tighter than
> 30 % reads as simultaneous; looser than 70 % feels sequential and slow.

## 3 — Slide

```css
.drawer {
  transform: translateX(-100%);
  transition: transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.drawer.is-open {
  transform: translateX(0);
}
```

Always slide via `transform`, never `left` / `right`. The named easing
curve (`cubic-bezier(0.2, 0.8, 0.2, 1)`) gives a quick start and gentle
landing — closer to material motion than `ease-out` alone.

## 4 — Scale (entrances, button press)

```css
.popover {
  transform: scale(0.96);
  opacity: 0;
  transform-origin: top center;
  transition: transform 180ms ease-out, opacity 180ms ease-out;
}
.popover.is-open {
  transform: scale(1);
  opacity: 1;
}
```

`transform-origin` matters: scaling from the centre looks like growth;
scaling from a corner looks like reveal. Match it to the spatial source
(the button that opened the popover).

Button press:

```css
.button {
  transition: transform 80ms ease-out;
}
.button:active {
  transform: scale(0.97);
}
```

Keep press feedback under 100 ms — anything longer feels laggy.

## 5 — Scroll-driven

Two timelines, both pure-CSS in modern Chromium / Edge (Firefox
flagged at time of writing — feature-detect with `@supports`):

### Tied to page scroll

```css
@supports (animation-timeline: scroll()) {
  .progress-bar {
    animation: fill linear;
    animation-timeline: scroll(root);
  }
  @keyframes fill {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
}
```

### Tied to element visibility (in-view)

```css
@supports (animation-timeline: view()) {
  .card {
    opacity: 0;
    transform: translateY(16px);
    animation: rise linear both;
    animation-timeline: view();
    animation-range: entry 0% entry 100%;
  }
  @keyframes rise {
    to { opacity: 1; transform: translateY(0); }
  }
}
```

`animation-range: entry 0% entry 100%` runs the animation while the
element enters the viewport.
Other useful ranges: `cover`, `exit`, `contain`.

### Fallback for older browsers

Use `IntersectionObserver` to add a class — see
[`templates/scroll-fade.html`](../templates/scroll-fade.html).

## 6 — View Transitions (page or DOM swap)

For an SPA route change or a list reorder, wrap the DOM mutation in a
view transition. The browser snapshots the before / after states and
crossfades them on the compositor:

```js
if (document.startViewTransition) {
  document.startViewTransition(() => updateDOM());
} else {
  updateDOM(); // graceful fallback
}
```

Customise the transition for specific elements with `view-transition-name`:

```css
.hero { view-transition-name: hero; }

::view-transition-old(hero),
::view-transition-new(hero) {
  animation-duration: 320ms;
  animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

Cross-document view transitions ship in Chromium 126+; same-document
support is broad. Always feature-detect (`if (document.startViewTransition)`)
before calling.

## Common mistakes

- **Stagger delay > duration.** The animation feels broken — items
  appear long after the first arrives. **Fix:** delay ≈ 30–70 % of
  duration.
- **`transform-origin` left at default for scale entrances.** A modal
  growing from the page centre is jarring when triggered from a button
  in the corner. **Fix:** anchor `transform-origin` to the source.
- **Forgetting `forwards` on entrance keyframes.** Element snaps back to
  its starting state after the animation ends. **Fix:** add
  `animation-fill-mode: forwards` (or shorthand `animation: rise 320ms
  ease-out forwards`).
- **No `@supports` guard around scroll-driven animations.** Users on
  Safari or Firefox stable see no animation at all. **Fix:** wrap in
  `@supports (animation-timeline: scroll())`; ship a graceful baseline
  state outside the guard.
