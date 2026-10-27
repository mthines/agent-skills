---
for: pr-reviewer
lens-version: 1
applies-to: "**/*.css, **/*.scss, **/*.module.css, **/*animation*.ts, **/*animation*.tsx, **/*transition*.ts, **/*transition*.tsx, **/motion/**, **/animations/**"
---

# Animations — Review Lens

## Trigger

`pr-reviewer` auto-loads this lens when [`scripts/is-motion-diff.mjs`](./scripts/is-motion-diff.mjs) prints `MOTION_DIFF: yes` for the reviewed diff — added `@keyframes`, `transition:`, `animation:`, a motion library import (Motion, GSAP, React Spring, Reanimated, Lottie, Rive, R3F), `startViewTransition`, `requestAnimationFrame`, or a Tailwind `animate-*` class. `--with animations` also loads it. Static CSS without motion is out of scope; apply the perceived-performance items only to loaders, skeletons, and optimistic UI the diff touches.

## Checklist

- [ ] Animated properties are limited to `transform`, `opacity`, and `filter` — no `width`, `height`, `top`, `left`, `margin`, `padding`, or `box-shadow` animation (these trigger layout/paint and jank).
- [ ] Per-frame values (scroll, pointer, progress, spring) never go through React state or props: no `setState` inside `requestAnimationFrame`, `scroll`, `pointermove`, or `onUpdate` — use CSS, a Motion value (`useMotionValue` / `useTransform` / `useScroll`), a Reanimated shared value, or a ref writing `style.transform`.
- [ ] Animation config passed as props (`variants`, `transition`, `animate` objects) is defined at module scope or memoised, and keys stay stable, so a parent re-render neither re-renders nor restarts the animation (no `key={Date.now()}`).
- [ ] Every `requestAnimationFrame` / `setInterval` loop and every scroll or pointer listener is cleaned up on unmount, listeners are `{ passive: true }`, and no frame interleaves a layout read (`getBoundingClientRect`, `offsetHeight`) with a style write.
- [ ] JS-driven motion (Motion, GSAP, WAAPI, rAF, Reanimated) honours reduced motion in JS — `useReducedMotion()`, `<MotionConfig reducedMotion="user">`, `matchMedia('(prefers-reduced-motion: reduce)')`, or Reanimated `ReduceMotion.System`; the CSS media query never reaches it.
- [ ] Motion that autoplays or loops longer than 5 s has a pause control (WCAG 2.2.2), and nothing flashes more than 3 times per second (WCAG 2.3.1).
- [ ] `will-change` is scoped — added before the animation, removed after — not left globally on a hot element (the optimisation reverses if always on).
- [ ] `@media (prefers-reduced-motion: reduce)` block exists for every non-essential animation and is tested (either disable or reduce to a 1-frame state change).
- [ ] Animation duration sits in the 150–500 ms band for UI feedback; durations >500 ms are reserved for narrative / scroll-driven sequences and justified inline.
- [ ] Easing is named (`ease-out`, `cubic-bezier(...)`, or a Motion preset) — not `linear` unless the motion is genuinely constant-velocity (rotation, marquee).
- [ ] SPA / MPA route changes and same-page DOM swaps use the View Transitions API — not manual fade hacks with `setTimeout` and double-render.
- [ ] State morphs (list ↔ cards, full nav ↔ icon-only nav, grid ↔ detail) use Motion `layout` / `layoutId` — never animated `width` / `height` / `top` / `left` directly.
- [ ] Entry-from-hidden animations (modal, popover, dialog) use `@starting-style` + `transition-behavior: allow-discrete` — not `display: none` ↔ `display: block` with `setTimeout`.
- [ ] Hover-revealed effects (glow, glass) animate a pseudo-element's `opacity` — not the host's `box-shadow` or `backdrop-filter` (both are paint-heavy).
- [ ] Lottie / Rive assets are lazy-loaded (dynamic import), paused when off-screen (`IntersectionObserver`), and fall back to a static poster under `prefers-reduced-motion`.
- [ ] React Three Fiber scenes dispose geometries, materials, and textures on unmount (manual `.dispose()` or `<Suspense>` with `<Resource>`); no `useFrame` runs without an `enabled` gate.
- [ ] Loaders (spinner / skeleton) have a **200 ms minimum visible duration** and a **sub-200 ms skip** — no flash-and-glitch on fast networks.
- [ ] Skeletons match the **final content shape and dimensions** (no card-grid placeholder rendered as text bars; no `aspect-ratio` mismatch); shimmer/pulse animates `transform` or `opacity` only, in the 0.6 – 1.0 band, cycle ≥ 1.2 s, gated under `prefers-reduced-motion`.
- [ ] Optimistic-UI mutations have a **visible rollback animation** on server rejection (same shape reversed + inline error tint) — never a silent snap-back.
- [ ] Above-the-fold images have a dominant-colour / blurhash / LQIP placeholder and reserved dimensions; below-the-fold images use `loading="lazy"` + `decoding="async"`. `font-display: swap;` or `optional;` — never `block;`.

## Severity hints

- **Must-fix**: animating layout properties (width/height/top/left/margin); a per-frame value driven through React state; no `prefers-reduced-motion` branch (CSS or JS) on a non-trivial animation; an uncancelled rAF loop or listener; R3F scene leaking GPU resources; silent optimistic-UI rollback; `font-display: block;` shipped.
- **Should-fix**: unstable animation-config props or keys; layout read interleaved with a style write; `will-change` left globally; manual fade hacks instead of View Transitions; state morph via direct layout property animation; `box-shadow` / `backdrop-filter` on hover; sub-200 ms spinner flash; skeleton shape mismatches final content (CLS on swap); shimmer animates `background-position`.
- **Nice-to-have**: easing as `linear` without justification; duration outside the 150–500 ms band; missing lazy-load on Lottie / Rive; no prefetch-on-hover for high-traffic links; missing dominant-colour placeholder on heroes.
