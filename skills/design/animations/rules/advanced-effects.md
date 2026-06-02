---
title: Advanced Effects — Glass, Glow, Hover-expand, Aurora, 3D Tilt
impact: MEDIUM
tags:
  - liquid-glass
  - glassmorphism
  - glow
  - hover-expand
  - aurora
  - 3d-tilt
---

# Advanced Effects

The visual treatments that lift a UI from "fine" to "memorable":
Apple's Liquid Glass material, animated glow on focus, hover-to-expand
search bars and dock magnification, drifting aurora backgrounds, and
3D pointer tilt cards. Each pattern below is GPU-friendly when built
the way this file describes — and a frame-dropping liability when
built the obvious way.

## Contents

- Liquid Glass / Glassmorphism (Apple iOS 26 / macOS Tahoe vibe)
- Animated glow (without animating `box-shadow`)
- Hover-to-expand (search bar, dock magnification, chip with label)
- Aurora / animated gradient mesh background
- 3D pointer tilt
- Common mistakes

---

## Liquid Glass / Glassmorphism

Apple's **Liquid Glass** (iOS 26 / macOS Tahoe) is a refractive
translucent material with specular highlights and edge light-bending.
On the web you cannot reproduce true refraction without SVG
displacement maps (Chromium-only), but you can hit the visual register
with `backdrop-filter` + a thin inner highlight + careful borders.

### Baseline glass (universal)

```css
.glass {
  background: rgb(255 255 255 / 0.55);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgb(255 255 255 / 0.3);
  border-radius: 1rem;
  box-shadow:
    0 8px 32px rgb(0 0 0 / 0.12),
    inset 0 1px 0 rgb(255 255 255 / 0.5);
}
```

`saturate(180%)` is the trick that makes glass feel premium — it
boosts the chroma of whatever sits behind, mimicking the way real
glass intensifies colour.

### Liquid Glass (high-fidelity, Chromium-only refraction)

```css
.liquid-glass {
  background:
    /* Specular highlight along the top edge */
    linear-gradient(180deg, rgb(255 255 255 / 0.22) 0%, transparent 30%),
    rgb(255 255 255 / 0.45);
  backdrop-filter: blur(24px) saturate(180%);
  border-radius: 1.25rem;
  border: 1px solid rgb(255 255 255 / 0.35);
  box-shadow:
    0 10px 40px rgb(0 0 0 / 0.18),
    inset 0 1px 0 rgb(255 255 255 / 0.6),
    inset 0 -1px 0 rgb(0 0 0 / 0.08);
}
```

For true light-bending refraction (the Apple effect), apply an SVG
`<feDisplacementMap>` filter via `backdrop-filter: url(#liquid)` — but
only Chromium supports SVG filters as `backdrop-filter` inputs. Safari
and Firefox will fall back to the baseline blur, which is fine.

### Dark theme

```css
.glass-dark {
  background: rgb(20 20 30 / 0.6);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgb(255 255 255 / 0.08);
  box-shadow:
    0 8px 32px rgb(0 0 0 / 0.4),
    inset 0 1px 0 rgb(255 255 255 / 0.06);
}
```

### Performance and accessibility caveats

`backdrop-filter` is the most expensive paint on the modern web. It
rasterises the area behind the element every frame the element
re-renders. Hard rules:

- **One or two glass surfaces per viewport**, never a full screen of
  them. Glass is for chrome (nav, modal, toast), not body text.
- **Never animate `backdrop-filter` itself**. To animate the glass,
  animate `transform` / `opacity`. Set `will-change: backdrop-filter`
  only briefly during an interactive transition.
- **Avoid stacking glass on glass.** Each layer compounds the paint.
- **Always provide a contrast fallback:**

```css
@media (prefers-contrast: more) {
  .glass {
    background: white;
    backdrop-filter: none;
    border: 1px solid black;
    box-shadow: none;
  }
}
```

- **Verify text contrast** over the worst-case background. Glass on a
  busy photo can drop body text below WCAG AA. Bake a translucent
  solid tint into the gradient if needed.

## Animated glow

Animating `box-shadow` directly repaints the entire bounding rectangle
every frame. **Stack a pseudo-element with the shadow pre-rendered and
animate its `opacity` instead** — composite-only, GPU-cheap, scales to
hundreds of elements.

```css
.glow { position: relative; }

.glow::after {
  content: '';
  position: absolute;
  inset: -2rem;
  border-radius: inherit;
  background:
    radial-gradient(closest-side, hsl(220 100% 70% / 0.5), transparent 70%);
  opacity: 0;
  transition: opacity 240ms ease-out;
  pointer-events: none;
  z-index: -1;
}

.glow:hover::after,
.glow:focus-visible::after { opacity: 1; }
```

`pointer-events: none` keeps the glow from intercepting clicks;
`z-index: -1` puts it behind the element's own background.

### Colour-shifting glow with `@property`

```css
@property --glow-hue {
  syntax: '<angle>';
  inherits: false;
  initial-value: 220deg;
}

.glow {
  --glow-hue: 220deg;
  transition: --glow-hue 800ms linear;
}
.glow:hover { --glow-hue: 320deg; }

.glow::after {
  background:
    radial-gradient(closest-side, hsl(var(--glow-hue) 100% 70% / 0.5), transparent 70%);
}
```

Registering `--glow-hue` with `@property` is what lets it interpolate
smoothly — unregistered custom properties would snap. See
[`interactive-effects.md`](./interactive-effects.md).

## Hover-to-expand

### Search bar that grows on focus

```css
.search {
  width: 2.5rem;
  transition: width 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.search:focus-within,
.search:hover { width: 16rem; }
```

`width` is layout-bound, but with a single element whose neighbours
do not reflow (`position: absolute`, or rightmost in a row), the cost
is one element wide and acceptable.

If surrounding elements need to reflow around it, switch to **Motion
`layout`** on the parent and let FLIP handle the reflow — see
[`state-choreography.md`](./state-choreography.md).

### Dock magnification (pure CSS with `:has()`)

A row of icons where the hovered one and its immediate neighbours
scale up:

```css
.dock { display: flex; gap: 0.25rem; }

.dock-item {
  width: 3rem; height: 3rem;
  transform-origin: bottom center;
  transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.dock:has(.dock-item:hover) .dock-item:hover {
  transform: scale(1.6);
}
.dock:has(.dock-item:hover) .dock-item:hover + .dock-item,
.dock:has(.dock-item:hover) .dock-item:has(+ .dock-item:hover) {
  transform: scale(1.3);
}
```

For **true proximity-based magnification** (smooth distance falloff,
multiple neighbour rings), drive `--mouse-x` from JS and have each
item compute its own scale via `calc()`. The variable + rAF pattern
is in [`interactive-effects.md`](./interactive-effects.md).

### Chip / pill with collapsing label

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 9999px;
}
.chip .label {
  max-width: 0;
  overflow: hidden;
  white-space: nowrap;
  transition: max-width 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.chip:hover .label,
.chip:focus-visible .label { max-width: 12rem; }
```

`max-width` clips the label as it expands. For variable label widths
where you want each chip to size to its actual content, use Motion
`layout` on each chip — see
[`state-choreography.md`](./state-choreography.md).

## Aurora / animated gradient mesh

A subtle drifting background. Two `@property`-registered angles drive
overlapping conic gradients:

```css
@property --aurora-1 { syntax: '<angle>'; inherits: false; initial-value:   0deg; }
@property --aurora-2 { syntax: '<angle>'; inherits: false; initial-value: 180deg; }

.aurora {
  --aurora-1: 0deg;
  --aurora-2: 180deg;
  background:
    conic-gradient(from var(--aurora-1) at 30% 30%,
      hsl(280 80% 50% / 0.6), hsl(200 80% 50% / 0.6), hsl(280 80% 50% / 0.6)),
    conic-gradient(from var(--aurora-2) at 70% 70%,
      hsl(320 80% 50% / 0.5), hsl(260 80% 50% / 0.5), hsl(320 80% 50% / 0.5));
  background-blend-mode: screen;
  filter: blur(40px);
  animation: drift 32s linear infinite;
}

@keyframes drift {
  to { --aurora-1: 360deg; --aurora-2: 540deg; }
}

@media (prefers-reduced-motion: reduce) {
  .aurora { animation: none; }
}
```

The `filter: blur(40px)` softens the gradient seams. Keep the surface
small (a hero band, not the whole page) — large blurred surfaces are
GPU-memory expensive.

## 3D pointer tilt

Card that tilts following the cursor, with a specular highlight that
tracks the same coordinates:

```css
.tilt {
  --tilt-x: 0deg;
  --tilt-y: 0deg;
  --x: 50%;
  --y: 50%;
  position: relative;
  transform-style: preserve-3d;
  transform: perspective(800px) rotateX(var(--tilt-x)) rotateY(var(--tilt-y));
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.tilt::after {
  content: '';
  position: absolute; inset: 0;
  background:
    radial-gradient(circle 12rem at var(--x) var(--y),
      rgb(255 255 255 / 0.35), transparent 60%);
  mix-blend-mode: overlay;
  opacity: 0;
  transition: opacity 240ms ease-out;
  pointer-events: none;
  border-radius: inherit;
}
.tilt:hover::after { opacity: 1; }

@media (prefers-reduced-motion: reduce) {
  .tilt { transform: none !important; transition: none; }
  .tilt::after { display: none; }
}
```

```js
const el = document.querySelector('.tilt');
let frame = 0;

el.addEventListener('pointermove', (event) => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;   // 0..1
    const py = (event.clientY - rect.top)  / rect.height;
    el.style.setProperty('--tilt-x', `${(py - 0.5) * -10}deg`);
    el.style.setProperty('--tilt-y', `${(px - 0.5) *  10}deg`);
    el.style.setProperty('--x', `${px * 100}%`);
    el.style.setProperty('--y', `${py * 100}%`);
    frame = 0;
  });
});

el.addEventListener('pointerleave', () => {
  el.style.setProperty('--tilt-x', '0deg');
  el.style.setProperty('--tilt-y', '0deg');
});
```

The `transition: transform 240ms` smooths the snap-back on
`pointerleave`. During an active drag, the CSS variable updates land
inside one frame, so the live tilt feels direct.

### Accessibility

- 3D tilt is **purely decorative**. The reduced-motion block kills
  the transform; the glare disappears.
- Never depend on tilt for affordance — the card must remain usable
  and identifiable without it.
- Keyboard users do not get tilt (there's no pointer position).
  Provide an equivalent focus-state visual (e.g. ring + scale).

## Common mistakes

- **Glass on a body-text container.** Contrast tanks. Glass is for
  chrome (nav, modal, toast), never paragraphs of text.
- **Animating `backdrop-filter`.** Per-frame rasterisation of the
  background. **Fix:** animate the element's `opacity` or `transform`.
- **Animating `box-shadow` directly.** Repaints the bounding rect
  every frame. **Fix:** pseudo-element with the shadow + `opacity`
  transition.
- **Aurora with unregistered custom properties.** Snaps instead of
  drifts. **Fix:** register the angles with `@property`.
- **3D tilt with no reduced-motion fallback.** Vestibular hazard.
  **Fix:** kill the transform under the media query.
- **`:has()` selector chains on huge DOMs.** Style-invalidation
  cost balloons. **Fix:** scope `:has()` to the smallest container.
- **No `prefers-contrast: more` fallback for glass.** Users with
  low vision see washed-out chrome. **Fix:** swap to a solid
  background with a hard border under the media query.
