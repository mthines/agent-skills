---
title: Visual Hierarchy — Focal Point, Scan Path, Drama
impact: HIGH
tags:
  - hierarchy
  - focal-point
  - scan-path
  - composition
---

# Visual Hierarchy

## Contents

- The one-focal-point rule
- Scan path — the 3-stop rule
- Drama through contrast
- Breathing room
- Alignment and rhythm
- Visual weight balance
- Density posture
- Common hierarchy failures to flag
- Cross-references

This rule covers **aesthetic hierarchy** — guiding the eye for impact,
not just for accessibility readability. `/ux` covers structural
hierarchy (semantic headings, focus order, ARIA landmarks). Both are
required; this one is about whether the component feels designed or
assembled.

## The one-focal-point rule

Every component should have **one focal point** the eye lands on first.
Two co-equal focal points compete; the result reads as cluttered or
indecisive.

To find it, ask: **"If the user only saw this for half a second, what
should they remember?"** That's the focal point. Make one of the
following do the work to elevate it:

- **Size.** Largest type on the page (display, hero stat, hero image).
- **Weight.** Heaviest weight relative to the surroundings.
- **Colour.** The only saturated thing on a neutral canvas.
- **Position.** Top-left in LTR scan, dead-centre in deliberate
  composition.
- **Negative space.** The thing surrounded by the most breathing room.
- **Contrast.** The highest luminance contrast against the surface.

**Use 1–2 devices to elevate the focal point. Not all six.** Stacking
all elevation tricks is what makes hero sections feel desperate.

## Scan path — the 3-stop rule

After the focal point, design the **2nd and 3rd stops** explicitly.
A good component has a clear scan path:

1. **Stop 1 (focal):** what is this and why care.
2. **Stop 2:** the proof / the supporting detail.
3. **Stop 3:** the action.

A card UI is almost always: image / title → metadata → CTA. A dashboard
KPI is: large number → label → trend / delta. A pricing tier is:
plan name → price → CTA → feature list.

Each stop should be **clearly different** from the next in at least one
dimension (size, weight, colour, alignment, distance) so the eye knows
to move on.

## Drama through contrast

"Drama" is the deliberate size and weight gap between focal point and
body. Most generic UI fails because the gap is too small. Push it:

| Direction        | Display-to-body ratio | Why                                              |
| ---------------- | --------------------- | ------------------------------------------------ |
| Editorial        | 3–6 ×                 | Magazine pacing                                  |
| Swiss            | 4–8 ×                 | Typography as the protagonist                    |
| Minimal          | 2–3 ×                 | Restraint — drama via space, not size            |
| Brutalist        | 6–10 ×                | Aggressive scale jumps                           |
| Terminal         | 1–1.5 ×               | Density over drama                               |
| Soft-UI / Playful| 1.5–2.5 ×             | Gentle scale, friendliness over impact           |

If your card title is 18 px and your body is 16 px, **you have no
hierarchy** — that's not subtle, that's flat. Either raise the title
or lean on weight contrast (600 vs 400).

## Breathing room

White space is the cheapest way to make a component feel premium.
Two patterns:

1. **Internal padding.** Generous padding inside containers (1.25–2 ×
   what feels first-correct). Hero stats with `padding: 48px` feel
   important. Hero stats with `padding: 16px` feel cramped.
2. **External separation.** The space *between* sibling components.
   Group related items tightly (8–12 px) and separate groups generously
   (24–48 px). The eye reads grouped items as one thing.

The "Squint test": squint at the component until the type blurs. You
should still see **distinct blocks of content** separated by visible
white space. If everything blurs into one grey mass, increase spacing
between groups.

## Alignment and rhythm

- **Pick one alignment grid.** Left-aligned (default), centred (rare,
  intentional), or asymmetric (Swiss). Mixing alignment without reason
  reads as accidental.
- **One vertical rhythm.** Body text on an 8 px (or 4 px) baseline.
  Heading line-heights tuned to align to that baseline ±1 unit.
- **Numbers right-aligned** in tables. Always. Currency symbols
  left-aligned to their column.
- **Icons and adjacent text on the same optical baseline** — not the
  same `vertical-align: middle` (which often looks off because icon
  glyph boxes differ).

## Visual weight balance

The composition is balanced when the visual weights on left and right
(or top and bottom) feel equivalent — not symmetric, but equivalent.

- A heavy graphic on the left balances a column of dense type on the
  right.
- A small bright accent balances a large neutral area (a single red dot
  balances a paragraph of grey type).
- A heavy display headline at the top balances generous space below.

If the component feels "tipped" to one side, add weight to the lighter
side (a small element with strong contrast goes a long way) or remove
weight from the heavier side.

## Density posture

Different directions tolerate different density. Pick one **density
posture** per component and hold it:

- **Sparse.** Hero sections, pricing, marketing surfaces. 1–3 things
  per screen.
- **Comfortable.** Most app UI. Dashboards, settings, list views with
  generous row height (52–64 px).
- **Dense.** Power-tool UI. Linear, tax software, IDE-adjacent
  products. Row heights 28–36 px, multiple columns of metadata.

Mixing density (sparse hero on top of dense table on the same screen)
is fine and often necessary — just make the transition explicit
(a visible separator, a switch in surface colour, a section header).

## Common hierarchy failures to flag

- **No focal point.** Five things shouting at the same volume.
- **Two focal points.** Title and CTA both at display weight + brand
  accent — the eye flips between them.
- **Flat scale.** All sizes within 4 px of each other; no drama.
- **Heading and body at the same weight.** Hierarchy collapses to
  size, which usually isn't enough.
- **Centred body paragraphs.** Reads slowly; usually a tell of a
  template.
- **Tight outer padding, loose inner spacing.** Card content packed
  against the card edge while its children float in space.
- **Group spacing ≈ inter-group spacing.** Squint test fails; no
  groups visible.
- **Misaligned baselines.** Icon-text pairs that look off by 1–2 px.
- **Density whiplash.** Sparse padding above and below a dense table
  without a transition cue.
- **Symmetric layout used as a default.** Symmetry is loud and
  static — fine for Editorial centred compositions, unfortunate for
  most app UI.

## Cross-references

- Mechanics of focus order, semantic structure, and headings → `/ux/rules/accessibility.md`.
- Spacing scale defaults (4 px / 8 px units) → `/ux/rules/visual-design.md`.
- Motion choreography for hierarchy (stagger, hero-element transitions)
  → `Skill("animations")`.
