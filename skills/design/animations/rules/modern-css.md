---
title: Modern CSS — Native Features That Replace JS Hacks
impact: HIGH
tags:
  - css
  - starting-style
  - interpolate-size
  - view-transitions
  - scroll-driven
  - baseline
---

# Modern CSS

Four CSS features have reached (or are reaching) Baseline and
collectively retire the most common animation hacks: animating from
`display: none`, animating to `height: auto`, animating between routes
or DOM swaps, and animating tied to scroll position.

Reach for these **before** writing JavaScript.

## Contents

- `@starting-style` — entry animations from hidden / display:none
- `transition-behavior: allow-discrete` — animate `display` and `visibility`
- `interpolate-size: allow-keywords` — animate to `height: auto`
- View Transitions — crossfade or morph between DOM states
- Scroll-driven timelines — `animation-timeline: scroll() / view()`
- Feature detection and fallback strategy

---

## `@starting-style` — entry animations

`@starting-style` defines the styles a transition should animate **from**
the first time an element appears (or returns from `display: none`).
Before this, you had to add the element with one class, force a reflow,
then swap the class — a four-line dance for every fade-in.

```css
.dialog {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 240ms ease-out, transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* The state the transition animates from on first paint. */
@starting-style {
  .dialog {
    opacity: 0;
    transform: translateY(8px);
  }
}
```

Toggle the dialog with regular display logic — the transition fires on
its own:

```html
<dialog class="dialog" open>…</dialog>
```

Baseline across Chrome 117+, Edge 117+, Safari 17.5+, and Firefox
129+.

## `transition-behavior: allow-discrete` — animate display / visibility

`display`, `visibility`, and a handful of other properties are
*discrete*: by default they flip instantly. `transition-behavior:
allow-discrete` tells the browser to defer the flip so the rest of the
transition can play.

```css
.dialog {
  display: block;
  opacity: 1;
  transition:
    opacity 240ms ease-out,
    display 240ms allow-discrete;
}

.dialog[hidden] {
  display: none;
  opacity: 0;
}

@starting-style {
  .dialog { opacity: 0; }
}
```

On show, `display` flips to `block` at 0 % of the duration so the
element is visible while the opacity fades in. On hide, `display` flips
to `none` at 100 % so the element stays visible until the opacity hits
zero.

Pair with `@starting-style` to cover both directions.

## `interpolate-size: allow-keywords` — animate height auto

By default CSS cannot animate `height: 0` → `height: auto` because the
browser cannot interpolate to an intrinsic size. `interpolate-size`
opts in:

```css
:root {
  interpolate-size: allow-keywords;
}

.accordion-content {
  height: 0;
  overflow: hidden;
  transition: height 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.accordion-content.is-open {
  height: auto;
}
```

> **Caveat:** one end of the animation must still be a length or
> percentage. You cannot animate `min-content` ↔ `max-content`.

Browser support is partial — Chromium ships, WebKit and Firefox are
still rolling it out. For broad cross-browser parity, fall back to
FLIP or Motion's `layout` prop (see
[`when-to-use-js.md`](./when-to-use-js.md)). Always feature-detect
with `@supports (interpolate-size: allow-keywords)`.

## View Transitions — DOM swap and page navigation

`document.startViewTransition` snapshots the page before and after a
DOM mutation and crossfades them on the compositor:

```js
if (document.startViewTransition) {
  document.startViewTransition(() => updateDOM());
} else {
  updateDOM(); // graceful fallback
}
```

Customise the transition for specific elements with
`view-transition-name`:

```css
.hero { view-transition-name: hero; }

::view-transition-old(hero),
::view-transition-new(hero) {
  animation-duration: 320ms;
  animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

### Cross-document (MPA / multi-page)

Opt both documents in:

```css
@view-transition {
  navigation: auto;
}
```

A normal `<a href="…">` click between same-origin pages now plays the
transition. Cross-document support is Chromium 126+. Firefox and Safari
still treat it as a regular navigation, which is a safe fallback.

## Scroll-driven timelines

Two timelines, both pure CSS in modern Chromium and Edge. Firefox
ships them only in Nightly (gated by
`layout.css.scroll-driven-animations.enabled` in stable) and Safari
support is still partial — always feature-detect.

### Scroll progress

```css
@supports (animation-timeline: scroll()) {
  .progress-bar {
    animation: fill linear;
    animation-timeline: scroll(root);
    transform-origin: left center;
  }
  @keyframes fill {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
}
```

### Element-in-view

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

Useful `animation-range` values:

| Range                          | Plays while…                                                  |
| ------------------------------ | ------------------------------------------------------------- |
| `entry 0% entry 100%`          | element is entering the viewport                              |
| `cover 0% cover 100%`          | element is anywhere in the viewport                           |
| `exit 0% exit 100%`            | element is leaving the viewport                               |
| `contain 0% contain 100%`      | element is fully visible                                       |

### Fallback for Firefox / Safari

Wrap in `@supports`; outside the supports block, ship a static state.
For richer fallbacks use Motion's `useScroll` hook (covered in
[`when-to-use-js.md`](./when-to-use-js.md)).

## Feature detection — the canonical pattern

```css
@supports (animation-timeline: view()) { /* progressive enhancement */ }
@supports (interpolate-size: allow-keywords) { /* … */ }
```

```js
if (CSS.supports('animation-timeline: view()')) { /* … */ }
if (document.startViewTransition) { /* … */ }
```

**Never** assume support — at least one major engine is still ramping
up on two of the four features above.

## Decision: pure CSS vs JS for entry animations

| Need                                                          | Tool                                       |
| ------------------------------------------------------------- | ------------------------------------------ |
| Fade / slide a modal in on first paint                        | `@starting-style` + `transition-behavior`  |
| Accordion expand / collapse                                   | `interpolate-size` (Chromium) or Motion `layout` (universal) |
| Crossfade DOM swap                                            | View Transitions                           |
| Cross-document navigation animation                           | View Transitions cross-document (Chromium) + JS fallback     |
| Tie animation to scroll position                              | `animation-timeline: scroll()`             |
| Tie animation to element-in-view                              | `animation-timeline: view()`               |

## Common mistakes

- **Forgetting `@starting-style`.** Element pops in without
  transitioning. **Fix:** add the `@starting-style` rule that mirrors
  the resting state.
- **Setting `interpolate-size` on a single element.** It is inherited,
  so per-element use works, but for a project-wide opt-in put it on
  `:root` once.
- **No `@supports` around scroll-driven animations.** Users on Firefox
  see no animation; worse, the keyframes may run with no timeline and
  freeze at the first frame. **Fix:** wrap in `@supports
  (animation-timeline: scroll())`.
- **Calling `document.startViewTransition` without feature detection.**
  Older browsers throw a `ReferenceError`. **Fix:**
  `if (document.startViewTransition)`.
- **Animating into `display: none` without `allow-discrete`.** The
  element disappears at 0 %. **Fix:** add `display` to the transition
  list with `allow-discrete`.
