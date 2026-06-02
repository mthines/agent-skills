---
title: Accessibility — prefers-reduced-motion and Motion Safety
impact: HIGH
tags:
  - accessibility
  - prefers-reduced-motion
  - wcag
  - vestibular
---

# Accessibility

Animation is sensory output. For users with vestibular disorders,
photosensitive epilepsy, ADHD, or low vision, decorative motion can
cause nausea, headaches, seizures, or simply make the page unusable.
The OS preference `prefers-reduced-motion` is the user telling the
browser they want less of it.

Honour it.

## Contents

- The minimum bar (global `@media` safety net)
- WCAG 2.3.3 — Animation from Interactions
- Reduce, do not remove (which motions to drop, which to keep)
- JavaScript-driven motion (vanilla, Motion, R3F)
- Focus, keyboard, and screen readers
- Photosensitive epilepsy — WCAG 2.3.1
- Common mistakes

> **Layout morphs need extra care.** A list-to-stacked-cards or full-to-collapsed-nav
> animation travels much further than a fade and is the riskiest case
> for vestibular users. Its dedicated accessibility section lives in
> [`from-to-morphs.md`](./from-to-morphs.md#accessibility--the-rules-for-big-morphs):
> `<MotionConfig reducedMotion="user">` at the root, focus
> preservation, `aria-live` announcements, `aria-label` when text
> disappears, and pointer-event gating during the transition.

## The minimum bar

Every project ships at least one `@media (prefers-reduced-motion:
reduce)` block. If you have animations, you have this block.

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This is a **safety net**, not the final answer. The `!important` reset
above kills every animation site-wide, which is correct as a baseline
but unkind to micro-feedback (a button press confirmation, a focus ring
transition). Override the cases where motion is essential or where a
short fade is safer than an instant snap.

## WCAG 2.3.3 — Animation from Interactions

> "Motion animation triggered by interaction can be disabled, unless the
> animation is essential to the functionality or the information being
> conveyed."

Concretely, if your animation is triggered by hover, click, focus,
scroll, or drag, it must be possible to disable it. The
`prefers-reduced-motion` query is the canonical mechanism. Long
auto-playing motion (carousels, parallax) additionally needs a
pause/stop control (WCAG 2.2.2).

## Reduce, do not remove

When the user prefers reduced motion, **replace** the animation with a
faster, lower-amplitude version rather than removing feedback entirely.
Removing feedback hurts comprehension; reducing it respects the
preference without breaking interaction.

```css
.modal {
  transform: translateY(16px);
  opacity: 0;
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1),
              opacity   240ms ease-out;
}
.modal.is-open { transform: translateY(0); opacity: 1; }

@media (prefers-reduced-motion: reduce) {
  .modal {
    /* Drop the slide; keep the fade. Fade is generally vestibular-safe. */
    transform: none;
    transition: opacity 120ms linear;
  }
}
```

### Motions that should be reduced

- Parallax and scroll-tied translation.
- Any movement > 20 % of viewport in any direction.
- Spinning, rotation, bouncing.
- Background video, looping gradients, particle systems.
- Long crossfades on large surfaces.
- Auto-playing carousels.

### Motions that are usually safe to keep

- Opacity-only fades under ~200 ms.
- Colour transitions.
- Short focus-ring or border-radius transitions.
- A 1–2 px button press feedback.

When in doubt, fade.

## JavaScript-driven motion

Check the preference from JS before starting a long animation:

```js
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function showCard(card) {
  if (reduceMotion.matches) {
    card.classList.add('is-visible');
    return;
  }
  card.animate(
    [
      { transform: 'translateY(8px)', opacity: 0 },
      { transform: 'translateY(0)',   opacity: 1 },
    ],
    { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
  );
}

reduceMotion.addEventListener('change', () => {
  // Optional: respond live if the user toggles the OS setting.
});
```

For libraries: **Motion** (the rebranded Framer Motion, imported from
`motion/react`) exposes a `useReducedMotion()` hook:

```tsx
import { useReducedMotion, motion } from 'motion/react';

function Card() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      transition={{ duration: reduce ? 0.12 : 0.32 }}
    />
  );
}
```

For React Three Fiber, gate the `useFrame` loop with the same hook
(see [`three-d.md`](./three-d.md)). Use the library hooks; do not
rebuild the gate.

## Focus, keyboard, and screen readers

- Animations must never trap focus. Focus order before, during, and
  after an animation must be identical.
- Decorative motion gets `aria-hidden="true"` on the animated element
  if it has no semantic content (e.g. a spotlight overlay).
- Live regions (`aria-live`) update the moment the change happens;
  fade-in animations on the visible text do not delay screen-reader
  announcement.
- Avoid `display: none` mid-animation — screen readers may skip the
  element. Use `opacity: 0; pointer-events: none; visibility: hidden`
  with a delayed `visibility` transition (see `patterns.md`).

## Photosensitive epilepsy — WCAG 2.3.1

> "Web pages do not contain anything that flashes more than three times
> in any one second period."

Flashing red is the highest risk. If you have a celebration or
notification animation, run it past a flash analyser (PEAT) before
shipping. The default `prefers-reduced-motion` block above does not
catch this — flashing is a separate hazard.

## Common mistakes

- **Shipping animations without any `prefers-reduced-motion` block.**
  WCAG 2.3.3 violation; nausea risk. **Fix:** add the global safety net
  at minimum.
- **`animation: none !important` for everyone.** Strips important
  feedback. **Fix:** swap to a short fade instead of stripping.
- **Checking `prefers-reduced-motion` once at load time.** Doesn't
  respond if the user toggles it. **Fix:** keep the `MediaQueryList`
  reference and listen for `change`.
- **Animating into `display: none`.** Screen readers can lose the
  element mid-transition. **Fix:** delayed `visibility: hidden` on the
  out-state.
- **Parallax with no reduced-motion fallback.** A top vestibular
  offender. **Fix:** disable the translation entirely under
  `prefers-reduced-motion`.
