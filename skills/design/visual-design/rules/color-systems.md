---
title: Color Systems — Palette Construction and Roles
impact: HIGH
tags:
  - color
  - palette
  - tokens
  - roles
---

# Color Systems

## Contents

- The four-layer palette (surface, content, accent, semantic)
- Building each layer
- Generating a palette from a single brand colour
- Tokens, not raw hex
- Common palette failures to flag
- When the result still looks generic

This rule covers **palette construction and role hierarchy** — how to
compose a colour system that feels intentional, not assembled. For the
foundational contrast math, dark-mode rules, and "never rely on colour
alone" check, defer to [`/ux/rules/visual-design.md`](../../ux/rules/visual-design.md).

## The four-layer palette

A robust palette has four layers, in this order:

1. **Surface** — the canvas. Background and elevated-surface colours.
   Usually 2–4 values from near-white (or near-black in dark mode) up
   through subtle elevation.
2. **Content** — text, icons, separators. Built from neutrals (or
   chromatic neutrals for character). Usually 3–5 luminance steps.
3. **Accent** — the brand's one (or two) saturated colours used for
   action, focus, and selection. **One primary** is the default; a
   second is allowed only with a clear rationale.
4. **Semantic** — success, warning, error, info. Always present, always
   accessible, always *recognisable* as those meanings (red = error,
   green = success). Customise hue subtly, not radically.

If a value is not classifiable into one of these four layers, it
shouldn't exist as a token. Decoration colours are not a layer.

## Building each layer

### Surface

- **One background** + **2–3 elevated surfaces** (card, popover, modal).
- Each elevation steps **2–5 % luminance** brighter (light mode) or
  brighter (dark mode — see `/ux` dark-mode rules).
- Surfaces should be **near-neutral**, occasionally tinted toward the
  accent for character (e.g. cool grey surfaces in a blue brand).
- Avoid pure white (`#FFF`) and pure black (`#000`) unless the
  direction explicitly calls for it (Brutalist, Swiss). Use `#FAFAFA`,
  `#0A0A0A`, etc.

### Content (neutrals)

A typical content scale, in luminance order:

| Token             | Use                                                        |
| ----------------- | ---------------------------------------------------------- |
| `content.primary` | Headlines, body text — highest contrast on surface         |
| `content.secondary` | Subdued copy, metadata                                  |
| `content.tertiary` | De-emphasised — placeholder, captions                     |
| `content.disabled` | Inactive state — still readable per `/ux` rules           |
| `content.inverse` | Text on dark accent surfaces (white on brand)              |

Define these as a **single neutral hue ramp** (e.g. `slate-900 → slate-400`),
not arbitrary greys. Slight chromatic tint (e.g. cool slate vs warm stone)
is a brand signal — cool = engineering / honest, warm = editorial / human.

### Accent

- **One primary accent**, named after its role (`accent.primary` /
  `brand.500` / `action.default`) — not after the hue (`blue.500` ages
  badly when the brand rebrands).
- Provide **at least 3 steps**: a default, a hover (slightly darker /
  more saturated), and a pressed / active.
- A muted variant for tinted surfaces (e.g. `accent.surface` = the
  accent at 8–12 % alpha for badges, callouts).
- **One focus colour** — usually the accent at full saturation. Focus
  rings are an accessibility-and-identity moment: defer the contrast
  threshold to `/ux/rules/accessibility.md`, but make the *style* of the
  ring a brand signature (offset, double-ring, glow — see
  `signature-details.md`).

#### When two accents are justified

- Data visualisation (categorical comparison).
- Dual-mode product (read mode vs edit mode signalled by colour).
- A clearly secondary action surface (subscribe vs buy, accept vs
  decline) that needs colour distinction beyond hierarchy.

Otherwise, one accent. Two accents without a reason is a tell of a
generic theme.

### Semantic

- **Error** = a red (often slightly desaturated). Pair with an icon.
- **Success** = a green (often slightly desaturated). Pair with an icon.
- **Warning** = an amber or orange. Pair with an icon.
- **Info** = either the brand accent (if blue-ish) or a separate cool blue.

Customise hue **within recognisable bounds**:

- A pink "error" reads as warning, not error.
- A teal "success" reads as info, not success.
- Test by removing the icon and asking "is this still recognisable?".

## Generating a palette from a single brand colour

If the user gives you a single brand hex:

1. **Sample to OKLCH** to reason about luminance and chroma
   independently. Or use a tool the project already has (Tailwind 4
   palette generator, Radix colours, Leonardo).
2. **Build the accent ramp** in luminance steps:
   `100 / 200 / 300 / 400 / 500 (brand) / 600 / 700 / 800 / 900`.
3. **Derive the neutral ramp** from a desaturated version of the same
   hue (1–5 % chroma) so neutrals feel like part of the same family —
   not Bootstrap greys.
4. **Pick one semantic accent per meaning** — red, green, amber, blue.
   Tune each toward the brand's chroma palette so they don't feel
   imported.
5. **Verify contrast pairs** with `/ux/rules/visual-design.md`. Adjust
   luminance, not hue, to fix contrast failures.

## Tokens, not raw hex

Recommend named tokens at every step. A token name encodes a **role**,
not a hue:

```css
/* Good — role-based */
--surface-card: #FAFAFA;
--content-primary: #0A0A0A;
--accent-default: #4F46E5;
--accent-hover: #4338CA;
--focus-ring: var(--accent-default);

/* Bad — hue-based */
--slate-50: #FAFAFA;
--slate-900: #0A0A0A;
--indigo-500: #4F46E5;
```

If the project has hue tokens already (Tailwind defaults, Radix), wrap
them with role aliases at the component level.

## Common palette failures to flag

- **The "Bootstrap 3 of everything" palette** — primary, secondary,
  success, warning, danger, info, all at default saturation. Reads as
  "any-SaaS-product 2014".
- **Neutrals from a different family than the accent.** Tailwind
  `gray-*` next to `indigo-500` — the greys are cool, the indigo is
  warm. They don't belong to each other.
- **Two accents without a rationale.** Picking blue and orange because
  "they're complementary" is a tell. Ask why both exist.
- **Semantic colours used as accents.** Using `success-green` for a
  "subscribe" button — readers will misread it as confirmation of an
  existing state.
- **Surface and elevated-surface within 1 % luminance.** No depth read.
- **No focus colour, or focus colour = the OS default blue ring.** A
  brand signature lost.
- **Decoration colours promoted to tokens.** "Pink we used once on the
  /blog page" should not enter the design system.

## When the result still looks generic

Run this check:

1. Strip the logo.
2. Show the screen to someone who knows the product.
3. Do they recognise it?

If not, the palette is doing too little. The fix is rarely "more
colour". The fix is usually:

- A more **specific** accent (less Tailwind-default, more "this exact
  burgundy").
- A more **specific** neutral (cool slate, warm stone, near-paper).
- A signature focus / selection / hover state (see
  `signature-details.md`).
