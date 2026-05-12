---
name: animations
description: >
  Authors performant web animations CSS-first. Covers GPU-safe
  properties, CSS variable / @property interactive effects, modern
  entry-exit primitives (@starting-style, transition-behavior,
  interpolate-size), View Transitions, scroll-driven timelines,
  state-choreography morphs (list to stacked cards, collapsing nav,
  grid to detail) with a pre-code planning checklist, React state
  patterns (Motion, AnimatePresence, Server Components), advanced
  effects (Liquid Glass, glow, hover-expand, aurora, 3D tilt),
  external engines (Lottie / dotLottie and Rive), React Three Fiber
  for 3D, and prefers-reduced-motion compliance. Use when building
  transitions, hover effects, fades, staggers, collapsing nav,
  list-to-card morphs, shared-element route changes, glass / glow
  effects, Lottie or Rive assets, 3D scenes, or when an animation
  feels janky. Triggers on "animate this", "fade in", "hover
  effect", "collapse nav", "liquid glass", "lottie", "rive",
  "/animations".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: slash-command
  tags:
    - animations
    - css
    - performance
    - gpu-acceleration
    - accessibility
    - prefers-reduced-motion
    - motion
    - framer-motion-migration
    - react-three-fiber
    - view-transitions
---

# Animations

Produces or reviews web animations that hit 60 fps (or 120 fps on
high-refresh displays), respect user motion preferences, and use the
cheapest tool for the job — CSS first, the Web Animations API for
runtime control, Motion when you need spring physics, gestures, or
shared-layout animations, React Three Fiber when the rendering model
itself needs to be three-dimensional.

> **This `SKILL.md` is a thin index.** Detailed rules live in
> [`rules/*.md`](./rules) and load on demand. Worked recipes live in
> [`references/recipes.md`](./references/recipes.md). Drop-in HTML/CSS
> snippets live in [`templates/`](./templates).

---

## Core Bet

**Animate `transform`, `opacity`, and `filter` only.** Those are the
three properties the browser composites on the GPU without triggering
layout or paint on the main thread. Anything else (`width`, `height`,
`top`, `left`, `margin`, `padding`, `box-shadow`, …) goes through
layout or paint and will jank. Full table in
[`rules/safe-properties.md`](./rules/safe-properties.md).

For properties that *seem* unanimatable — `height: auto`, `display:
none`, list reorders, route changes — modern CSS has native primitives
that re-express them as GPU work. See
[`rules/modern-css.md`](./rules/modern-css.md).

---

## Decision flow

Walk these in order. First match wins.

| #  | Signal                                                                                  | Tool                                                                                  |
| -- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1  | One-shot state change on hover, focus, or class toggle                                   | CSS `transition`                                                                       |
| 2  | Fade in on first paint (modal, popover, dialog)                                          | `@starting-style` + `transition-behavior: allow-discrete` ([`rules/modern-css.md`](./rules/modern-css.md)) |
| 3  | Looping or sequenced keyframes, declarative                                              | CSS `@keyframes` + `animation`                                                         |
| 4  | Animation tied to scroll position or element-in-view                                     | `animation-timeline: scroll()` / `view()` ([`rules/modern-css.md`](./rules/modern-css.md)) |
| 5  | Same-page DOM swap, list reorder, or SPA / MPA route change with a crossfade             | View Transitions API ([`rules/modern-css.md`](./rules/modern-css.md))                  |
| 6  | Accordion / expand-collapse to `height: auto`                                            | `interpolate-size: allow-keywords` (Chromium) or Motion `layout` (universal)           |
| 7  | **State choreography** — list → cards, full nav → icon-only nav, grid → detail view, tab pill | Motion `layout` / `layoutId` ([`rules/state-choreography.md`](./rules/state-choreography.md)) |
| 8  | Spring physics, gestures (drag / pan / pinch), declarative variants                      | Motion ([`rules/when-to-use-js.md`](./rules/when-to-use-js.md))                        |
| 9  | One-shot programmatic animation that needs `pause` / `reverse` / `scrub`                 | Web Animations API (`element.animate`)                                                  |
| 10 | Rendering is 3D, WebGL, particles, shaders, scroll-tied 3D scene                          | React Three Fiber + Drei ([`rules/three-d.md`](./rules/three-d.md))                    |
| 11 | Designer-authored asset (linear playback) — loader, illustration, micro-animation         | Lottie / dotLottie ([`rules/external-engines.md`](./rules/external-engines.md))         |
| 12 | Designer-authored **interactive** asset — animated icon, character, multi-state button     | Rive ([`rules/external-engines.md`](./rules/external-engines.md))                       |

If two rows match, pick the lower-numbered one — it has fewer
dependencies. **GSAP and other `requestAnimationFrame`-only libraries
are not in this decision flow:** Motion's hybrid engine covers the
same ground at a smaller bundle size and runs on the compositor when
the animation is composite-only.

---

## Workflow

For any animation task — author or review — walk these phases:

| Phase | Name                  | Rule file                                                                       | Gate                                                                                                       |
| ----- | --------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 0     | Choose the property    | [`rules/safe-properties.md`](./rules/safe-properties.md)                        | Animated property is `transform`, `opacity`, or `filter`. If not, justify with a layout-thrash measurement. |
| 1     | Choose the pattern     | [`rules/patterns.md`](./rules/patterns.md)                                      | Pattern (fade, stagger, slide, scale) matches the user signal.                                              |
| 2     | Reach for modern CSS   | [`rules/modern-css.md`](./rules/modern-css.md)                                  | If the need is "entry from hidden", "height auto", "DOM swap", or "scroll-tied", a CSS-only path exists.    |
| 3     | Wire interactivity     | [`rules/interactive-effects.md`](./rules/interactive-effects.md)                | If a pointer / scroll / sensor drives a value, it flows through a CSS variable; consider `@property` for typed interpolation. |
| 4     | Time it                | [`rules/timing-easing.md`](./rules/timing-easing.md)                            | Duration is in the 150–500 ms band for UI; easing is named, not `linear` (unless intentional).             |
| 5     | Decide CSS vs JS vs 3D | [`rules/when-to-use-js.md`](./rules/when-to-use-js.md), [`rules/three-d.md`](./rules/three-d.md) | Decision flow above is followed; Motion / R3F is opt-in, not default.                                       |
| 5.5   | Choreograph state morphs | [`rules/state-choreography.md`](./rules/state-choreography.md)                | Planning checklist run first; chosen tool (Motion `layout`, `layoutId`, or View Transitions) matches the cataloged change set. Never animate layout properties directly. |
| 5.6   | Wire React state         | [`rules/react-state.md`](./rules/react-state.md)                              | State location decided (component / lifted / URL / context); 60 fps values held in refs or `useMotionValue`; `AnimatePresence` mode picked; Strict Mode and Server Component boundaries respected. |
| 5.7   | Add advanced effects     | [`rules/advanced-effects.md`](./rules/advanced-effects.md)                    | If the design calls for glass, glow, hover-expand, aurora, or 3D tilt, the cheap pattern is used (pseudo-element + opacity, not animated `box-shadow` / `backdrop-filter`); fallbacks for `prefers-contrast` and `prefers-reduced-motion` are in place. |
| 5.8   | External engines         | [`rules/external-engines.md`](./rules/external-engines.md)                    | If the asset is designer-authored (Lottie / dotLottie or Rive), the runtime is lazy-loaded, paused off-screen, and gated on `prefers-reduced-motion` with a static poster fallback. |
| 6     | Respect motion prefs     | [`rules/accessibility.md`](./rules/accessibility.md)                          | `@media (prefers-reduced-motion: reduce)` block is present and tested. For state morphs, see the dedicated accessibility section in [`rules/state-choreography.md`](./rules/state-choreography.md). |
| 7     | Measure                | [`rules/debugging.md`](./rules/debugging.md)                                    | Animation hits 60 fps in DevTools Performance; no purple Layout / green Paint bars during the frame.       |
| 7.5   | Record evidence (optional) | [`screen-recorder` skill](../screen-recorder/SKILL.md)                       | For non-trivial animations (View Transitions, Motion `layout`, scroll timelines, state-choreography morphs) **or** when the user asks "show me", invoke `Skill("screen-recorder")` twice — once with `reduced-motion: false`, once with `reduced-motion: true` — passing `url`, `selector`, `interaction`, `output-name`, and `caller: "animations"` on both calls. Default `max-width: 768` and `keyint: 15` are already analyser-optimal — do not override unless a human reviewer needs higher fidelity. Skip silently if the skill is not installed. Caller handshake in [`screen-recorder` Phase 6](../screen-recorder/rules/integrations.md). |
| 7.6   | Analyse and iterate    | [`video-analyser` skill](../video-analyser/SKILL.md)                            | Feed the recordings from Phase 7.5 into `Skill("video-analyser")` to validate the animation contract end-to-end. The analyser returns structured findings (errors, UI state at key frames, recommended next steps). If a finding contradicts the animation contract (jank, missing reduced-motion branch, dropped focus ring, unintended layout flash), apply the fix and return to Phase 7.5. Cap the loop at 3 iterations — escalate via `Skill("confidence", bug-analysis)` on the 4th. Full record → analyse → iterate procedure: [`rules/record-and-iterate.md`](./rules/record-and-iterate.md). Skip silently if `video-analyser` is not installed. |

---

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | [`rules/safe-properties.md`](./rules/safe-properties.md)                                                                                             |
| 1     | [`rules/patterns.md`](./rules/patterns.md)                                                                                                           |
| 2     | [`rules/modern-css.md`](./rules/modern-css.md)                                                                                                       |
| 3     | [`rules/interactive-effects.md`](./rules/interactive-effects.md), [`templates/cursor-spotlight.html`](./templates/cursor-spotlight.html)              |
| 4     | [`rules/timing-easing.md`](./rules/timing-easing.md)                                                                                                 |
| 5     | [`rules/when-to-use-js.md`](./rules/when-to-use-js.md), [`rules/three-d.md`](./rules/three-d.md)                                                     |
| 5.5   | [`rules/state-choreography.md`](./rules/state-choreography.md)                                                                                       |
| 5.6   | [`rules/react-state.md`](./rules/react-state.md)                                                                                                     |
| 5.7   | [`rules/advanced-effects.md`](./rules/advanced-effects.md)                                                                                           |
| 5.8   | [`rules/external-engines.md`](./rules/external-engines.md)                                                                                           |
| 6     | [`rules/accessibility.md`](./rules/accessibility.md)                                                                                                 |
| 7     | [`rules/debugging.md`](./rules/debugging.md)                                                                                                         |
| 7.5/7.6 | [`rules/record-and-iterate.md`](./rules/record-and-iterate.md)                                                                                     |
| —     | [`references/recipes.md`](./references/recipes.md) (worked examples — load when the user asks "what does X look like end-to-end?")                   |

---

## Core Principles

1. **Composite-only.** `transform` and `opacity` map to GPU compositing.
   Everything else costs frames.
2. **`will-change` is a scalpel.** Apply just before the animation,
   remove right after; never on idle elements; never on more than a
   handful of nodes at once.
3. **Variables flow, classes toggle.** Per-pointer or per-frame values
   live in CSS custom properties; lifecycle states live in classes.
4. **`@property` unlocks animation.** Unregistered custom properties
   animate discretely (snap). Registered ones interpolate smoothly.
5. **Prefer the platform.** `@starting-style`, `interpolate-size`,
   View Transitions, and scroll-driven timelines have retired most of
   the JS hacks that previously required Motion or hand-rolled `rAF`
   loops. Reach for the library only when the platform cannot express
   the animation.
6. **Reduce, do not remove.** With `prefers-reduced-motion: reduce`,
   replace motion with a fade or near-instant state change — never strip
   feedback entirely.
7. **Measure before optimising.** A perceived jank can be a 200 ms image
   decode, not the animation. Open Performance, capture, look at the
   frame chart before tuning.

---

## Anti-patterns (one-liners — full lists in the linked rules)

- Animating `width`, `height`, `top`, `left`, `margin`, or `padding`
  ([`safe-properties.md`](./rules/safe-properties.md)).
- `will-change: transform` left on a hero element permanently
  ([`safe-properties.md`](./rules/safe-properties.md)).
- `transition: all` — pays for every property change, opts you into
  layout-property animations by accident.
- `linear` easing on UI motion — looks robotic; use `ease-out` or a
  named `cubic-bezier`
  ([`timing-easing.md`](./rules/timing-easing.md)).
- Animating an unregistered custom property and being surprised it
  snaps instead of interpolating
  ([`interactive-effects.md`](./rules/interactive-effects.md)).
- Reaching for a 25 KB library before trying CSS, View Transitions, or
  the Web Animations API
  ([`when-to-use-js.md`](./rules/when-to-use-js.md)).
- Importing from `framer-motion` in new code — the package is
  unmaintained. Use `motion` instead.
- Putting 60 fps state in React `useState`, especially inside R3F
  ([`three-d.md`](./rules/three-d.md)).
- Forgetting `prefers-reduced-motion` and shipping vestibular harm
  ([`accessibility.md`](./rules/accessibility.md)).

---

## Definition of Done

- [ ] The animated property is `transform`, `opacity`, or `filter` — or
      a `@property`-registered custom property that drives one of those.
- [ ] No `will-change` is left on an idle element.
- [ ] Easing and duration match the role (UI motion 150–500 ms with a
      named easing curve; entrances may diverge from exits for
      asymmetry).
- [ ] If JavaScript is involved, the library is **Motion** (not
      `framer-motion`, not GSAP) — or no library at all.
- [ ] `@media (prefers-reduced-motion: reduce)` reduces motion to a
      fade or instant state change.
- [ ] DevTools Performance shows the animation thread running on the
      compositor (`Compositor` row activity, no purple Layout / green
      Paint bars during the animated frames).
- [ ] Keyboard focus and screen-reader behaviour are unchanged by the
      animation.
