---
name: animations
description: >
  Authors performant web animations CSS-first AND brainstorms the
  right feedback for an interaction via a verb-to-motion catalog.
  Covers GPU-safe properties, modern primitives (@starting-style,
  interpolate-size), View Transitions, scroll-driven timelines,
  state-choreography morphs, React state (Motion, AnimatePresence),
  advanced effects (Liquid Glass, glow, 3D tilt), external engines
  (Lottie, Rive), React Three Fiber, prefers-reduced-motion, AND
  perceived performance (skeleton loaders, optimistic UI, loader
  floor, predictive prefetch, stale-while-revalidate). Use when
  building transitions, hover effects, route changes, when an
  animation feels janky, when deciding what feedback an interaction
  should have, or when the app needs to feel snappier. Triggers on
  "animate this", "fade in", "hover effect", "liquid glass",
  "lottie", "rive", "ideal feedback", "how should X feel",
  "skeleton loader", "perceived performance", "feel faster",
  "optimistic UI", "/animations".
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
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
    - interaction-feedback
    - microinteractions
    - perceived-performance
    - skeleton-loaders
    - optimistic-ui
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

## Brainstorm Mode — interaction → feedback

Use this entry point when the user asks **what** the animation should
be, not **how** to build it. Examples that route here, not to the
technical decision flow below:

- *"What's the ideal feedback when I press this button?"*
- *"How should closing a card feel?"*
- *"What's the natural animation when this toggles?"*
- *"What should happen when a user deletes a row?"*

Procedure:

1. **Run the five-question brainstorm** in
   [`rules/interaction-feedback.md`](./rules/interaction-feedback.md#brainstorm-framework)
   — verb, reversibility, initiator, spatial source, affordance load.
   Answer each in one line before picking a recommendation.
2. **Look up the interaction in the catalog** in the same file. The
   catalog covers discrete actions (button presses, toggles, copy),
   element lifecycle (card open / close, modal, drawer, list add /
   remove), status states (loading, success, error, skeleton),
   continuous gestures (drag, swipe, pinch, pull-to-refresh), and
   navigation (tab, route, accordion, wizard). Each row gives the
   recommended motion, duration band, easing, property to animate,
   and the principle behind the choice.
3. **Pick the intensity rung** (1 — micro-interactions, through 5 —
   hero moments). Rule of thumb: a rung two levels above the stakes
   reads as over-designed.
4. **Apply the direction principle** — motion vector must mirror the
   interaction's semantic verb (opens scale from the trigger; closes
   reverse the open; deletes move *away*; selects move *toward*).
5. **Hand off to the technical workflow below** — the brainstorm
   tells you *what* (e.g. "scale + opacity, 240 ms, anchored origin");
   the workflow tells you *how* (which property, which API, which
   gate).

The full catalog and brainstorm framework live in
[`rules/interaction-feedback.md`](./rules/interaction-feedback.md).

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
| A     | Brainstorm feedback (when entry is "what?") | [`rules/interaction-feedback.md`](./rules/interaction-feedback.md) | If the user describes an *interaction* (verb), the five brainstorm questions are answered and the catalog row selected before moving to Phase 0. If the user describes an *animation primitive* (e.g. "fade in"), skip Phase A. |
| B     | Manage perceived performance (when there's a wait) | [`rules/perceived-performance.md`](./rules/perceived-performance.md) | If the animation surrounds an async wait — fetch, route change, route load, image decode, optimistic mutation — the wait-duration ladder is consulted (p75-measured, not local-dev "felt fast"), the right pattern is chosen (no loader, skeleton, spinner, progress bar, or async-out), the 200 ms loader floor and sub-200 ms skip are in place, and skeletons match the final content shape. Skip Phase B if there is no wait. |
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
| 7.5   | Record evidence (optional) | [`screen-recorder` skill](../../analysis/screen-recorder/SKILL.md)                       | For non-trivial animations (View Transitions, Motion `layout`, scroll timelines, state-choreography morphs) **or** when the user asks "show me", invoke `Skill("screen-recorder")` twice — once with `reduced-motion: false`, once with `reduced-motion: true` — passing `url`, `selector`, `interaction`, `output-name`, and `caller: "animations"` on both calls. Default `max-width: 768` and `keyint: 15` are already analyser-optimal — do not override unless a human reviewer needs higher fidelity. Skip silently if the skill is not installed. Caller handshake in [`screen-recorder` Phase 6](../../analysis/screen-recorder/rules/integrations.md). |
| 7.6   | Analyse and iterate    | [`video-analyser` skill](../../analysis/video-analyser/SKILL.md)                            | Feed the recordings from Phase 7.5 into `Skill("video-analyser")` to validate the animation contract end-to-end. The analyser returns structured findings (errors, UI state at key frames, recommended next steps). If a finding contradicts the animation contract (jank, missing reduced-motion branch, dropped focus ring, unintended layout flash), apply the fix and return to Phase 7.5. Cap the loop at 3 iterations — escalate via `Skill("confidence", analysis)` on the 4th. Full record → analyse → iterate procedure: [`rules/record-and-iterate.md`](./rules/record-and-iterate.md). Skip silently if `video-analyser` is not installed. |

---

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | [`rules/interaction-feedback.md`](./rules/interaction-feedback.md)                                                                                   |
| B     | [`rules/perceived-performance.md`](./rules/perceived-performance.md)                                                                                 |
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
8. **Brainstorm before you pick.** When the question is *"what feedback
   should this interaction have?"*, run the five-question brainstorm in
   [`interaction-feedback.md`](./rules/interaction-feedback.md) first —
   the verb, the reversibility, the initiator, the spatial source, the
   affordance load. Skipping straight to "fade or slide?" loses the
   reasoning that makes the choice defensible.
9. **Cheat the eye when you can't beat the clock.** Real latency is
   physics; perceived latency is design. Acknowledge input under
   100 ms (Doherty Threshold), draw the shape of the answer before
   it arrives (skeleton loaders that *match* the final layout),
   apply reversible changes optimistically, floor sub-200 ms loaders
   (or skip them entirely), and prefetch on intent. The same 1.2 s
   request reads as snappy or broken depending on what happens in
   the gap. See
   [`rules/perceived-performance.md`](./rules/perceived-performance.md).

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
- Picking the animation shape before answering the five brainstorm
  questions ([`interaction-feedback.md`](./rules/interaction-feedback.md)) —
  you end up with a fade where a slide was needed, a spring where a
  curve was needed, or hero-grade motion on a toggle.
- Asymmetric open/close that uses different *shapes* (modal opens with
  scale, closes with slide) — pick one shape, run it in reverse, and
  make the exit ~30 % faster.
- Spinner that flashes for under 200 ms on a fast network — reads as a
  glitch, not as speed. Use the loader floor + sub-200 ms skip in
  [`perceived-performance.md`](./rules/perceived-performance.md).
- Skeleton that doesn't match the final content shape (three text bars
  as the placeholder for a card grid) — the swap causes layout shift
  and reads as the page relaunching
  ([`perceived-performance.md`](./rules/perceived-performance.md)).
- Optimistic UI without a rollback animation — the state pops on click,
  silently snaps back on server rejection, and the user blames themselves
  ([`perceived-performance.md`](./rules/perceived-performance.md)).
- Atomic image loading with no dominant-colour or blurhash placeholder —
  blank box, then full image slams in and shifts the layout
  ([`perceived-performance.md`](./rules/perceived-performance.md)).

---

## Composes with

- **`/visual-design`** — motion personality is a brand signal (a Brutalist
  hard-press vs a Soft-UI gentle lift), and the easing / duration choices
  belong inside a chosen **style direction**. When designing a new
  component's motion from scratch, run `/visual-design` first to commit to
  a direction, then return here for the mechanics. When auditing motion
  that feels off, ask whether the issue is mechanical (jank, GPU, easing
  curve — this skill) or signature (the wrong *kind* of motion for the
  brand — `/visual-design/rules/signature-details.md` covers hover / press
  / focus as signature moves).
- **`/ux`** — `prefers-reduced-motion`, focus-visible during transitions,
  and motion-triggered vestibular concerns are accessibility-floor checks
  owned by `/ux/rules/accessibility.md`.
- **`/screen-recorder`** — multi-frame interactions cannot be proven from
  a still. Invoke for any Critical / High finding that depends on timing.

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
