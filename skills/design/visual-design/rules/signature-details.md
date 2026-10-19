---
title: Signature Details — The 5% That Makes It Yours
impact: HIGH
tags:
  - signature
  - details
  - identity
  - polish
---

# Signature Details

## Contents

- Where signature lives (10 dimensions)
- Concrete moves per dimension (border / shadow / hover / focus ring / selection / dividers / icons / numerics / empty states)
- How to choose 1–3 moves
- Stripping test
- Common signature failures to flag

A component is 95 % conventional and 5 % signature. The 5 % is what
makes a card feel like a Linear card and not a Notion card. Without it,
the component looks like a Tailwind UI screenshot.

This rule enumerates the dimensions where signature lives and gives
concrete moves per dimension. **Pick 1–3 signature moves per
component family**, repeat them across the system, and don't add more.

## Where signature lives

There are ten dimensions where a brand's signature can sit. Use them
as a checklist when designing or auditing.

1. **Border / radius** — radius value and posture (sharp, gentle,
   pillow, asymmetric).
2. **Border weight & style** — hairline, 2 px, dotted, dashed,
   double-ring, none.
3. **Shadow / elevation** — soft and ambient, hard and offset, inset,
   glow, none.
4. **Hover / pressed** — the motion or transform on hover (lift,
   press, glow, rotate, no change).
5. **Focus ring** — the offset, doubling, glow, or colour of the focus
   ring. Often the most under-used signature.
6. **Selection / active state** — how an item shows it's selected
   (left border accent, full background tint, underline, bracket).
7. **Dividers & rules** — hairline, dotted, none, ornament glyphs,
   pattern fills.
8. **Icon style** — outlined, filled, duotone, hand-drawn, monospace
   glyphs (no icons at all is a valid choice).
9. **Numeric & ID treatment** — monospaced, tabular, large-with-unit,
   coloured.
10. **Empty / loading state** — skeleton, illustration, sentence, ASCII
    spinner, brand voice.

## Concrete moves per dimension

### Border / radius

| Direction      | Posture                                                        |
| -------------- | -------------------------------------------------------------- |
| Minimal        | 4–8 px, consistent, hairline borders only                      |
| Swiss          | 0 px radius, structural borders                                |
| Editorial      | 4–6 px, paper-edge feel, light hairline                        |
| Brutalist      | 0 px, 2–4 px black borders                                     |
| Neo-Brutalist  | 8–12 px radius, 2–4 px black borders                           |
| Glass          | 16–24 px, 1 px translucent inset border                        |
| Soft-UI        | 16–28 px, no visible border                                    |
| Terminal       | 0 px or 2 px, mono-cell borders                                |
| Playful        | 16–28 px, sometimes irregular per side                         |
| Retro Y2K      | 8–12 px with chrome bevel                                      |

Mixing radius values across a system is the #1 reason it looks unfinished.

### Shadow / elevation

- **Soft ambient** — `0 4px 16px -4px rgba(0,0,0,0.08)`. Default modern,
  fine but unmemorable.
- **Hard offset** (Neo-Brutalist) — `4px 4px 0 0 #000` — no blur.
- **Inset** — used for pressed surfaces or input wells.
- **Glow** — coloured shadow at low alpha (`0 0 40px var(--accent)`).
  Memorable on the right brand, kitsch on the wrong one.
- **No shadow** — borders + space carry depth. Minimal, Swiss, Brutalist.
- **Coloured shadow tied to the accent** — a strong signature when used
  on key surfaces only (Stripe, Vercel preview cards).

### Hover / pressed

A good hover state is a brand signal:

- **Lift** — translate up 1–2 px + soften shadow. Default polite move.
- **Press** — translate down 1 px or invert offset shadow.
  Neo-Brutalist core move.
- **Glow** — accent-coloured shadow appears.
- **Underline** — animated underline from left for links. Editorial,
  Minimal.
- **Background tint** — surface shifts 2–4 % luminance.
- **Rotate** — 0.5–1 ° rotation. Playful only.
- **No change** — only fine for hyper-Brutalist directions.

Pick one move and repeat across all interactive elements.

### Focus ring

Most products inherit the OS focus ring. A custom focus ring is one of
the cheapest signature wins:

- **Double-ring** — `box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent)`.
  Crisp, accessible, branded.
- **Offset solid** — `outline: 2px solid var(--accent); outline-offset: 2px`.
- **Inset** — focus ring sits inside the element (works on dense tables).
- **Glow** — coloured shadow at low alpha. Avoid combining with default
  outline (double ring conflict).

Always defer **contrast threshold** to `/ux/rules/accessibility.md`.
This rule chooses the *style* and *posture*; `/ux` enforces the
*minimum*.

### Selection / active state

How an item declares itself "the one":

- **Left accent border** — 2–4 px coloured border on the left edge.
  Linear / IDE classic.
- **Full background tint** — surface shifts to `accent.surface` at
  8–12 % alpha.
- **Bracket / chevron** — a small chevron or bracket glyph appears.
  Terminal direction.
- **Underline** — for tab-like surfaces.
- **Bold weight increase** — text shifts from 400 → 600.

Combining 2 cues is fine (tint + bold). Combining 4 is loud.

### Dividers and rules

- **Hairline** — 1 px at low-luminance neutral. Modern default.
- **Dotted** — 1 px dotted. Editorial, retro warmth.
- **No divider** — space and weight do the work. Premium move.
- **Ornament glyph** — a centred `❦` or `⸻` (Editorial direction only).
- **Numbered section markers** — `01 / Introduction` as a leading
  divider. Swiss / Editorial signature.

### Icon style

- **All outlined** (consistent stroke weight) — friendly, modern, default.
- **All filled** — assertive, dense, often used at small sizes.
- **Duotone** — Phosphor-style, two-tone — distinctive when used
  consistently.
- **Custom illustrations** — branded but expensive to maintain.
- **No icons** — Brutalist, Editorial, type-only directions. Underrated.

Don't mix outlined and filled in the same surface. `/ux/rules/visual-design.md`
covers this from the consistency angle; this rule covers it as a
signature decision.

### Numeric & ID treatment

- **Tabular numerals** for every number in a table — `font-variant-numeric: tabular-nums`.
- **Monospace for IDs / hashes** — `SHA: 8a3f...e021` reads correctly
  only in mono.
- **Large stat + small unit** — `42 ms` with the `ms` at 0.5–0.7×
  numeric size. Signature dashboard move.
- **Coloured numbers** — green for positive delta, red for negative.
  Pair with sign or arrow (see `/ux/rules/visual-design.md` —
  never colour alone).

### Empty and loading states

- **Skeleton** — generic, fine, unmemorable. `/animations` covers
  motion mechanics.
- **Illustration** — Playful / Soft-UI. Expensive.
- **Sentence** — "No invoices yet. Send your first one →" — voice
  carries identity.
- **ASCII spinner** — Terminal direction.
- **Brand-voiced** — "We're warming up the engines..." — depends
  heavily on the brand voice (see `brand-identity.md`).

## How to choose 1–3 moves

1. Start from the **direction** (`style-directions.md`) — it constrains
   most defaults.
2. Pick **one move that defines depth**: shadow style, no shadow, glow,
   inset.
3. Pick **one move that defines interactivity**: hover, focus ring,
   selection state.
4. Optional: pick **one ornamental move**: divider style, numeric
   treatment, icon style.

Repeat these moves across every component in the system. The signature
is what's **consistent**, not what's spectacular on one screen.

## Stripping test

For any component, do the **strip test**:

1. Remove the logo / wordmark.
2. Show the screen to someone who knows the product.
3. Ask "is this ours?"

If no, the signature is too thin. Promote one of your repeating moves
into this component. If yes, you're done.

## Common signature failures to flag

- **Default OS focus ring** — a wasted signature opportunity.
- **Default Material elevation 1–24 ladder** unmodified — looks
  generic across half the web.
- **Tailwind UI defaults shipped as the product** — every shadow at
  `shadow-sm`, every radius at `rounded-lg`, every focus at
  `ring-2 ring-blue-500`. Reads as template.
- **A signature move used only on the marketing page** — the product
  surface inside the app reverts to defaults. The signature must live
  in the dense product UI, where users actually spend time.
- **Three different signature moves competing.** A glow, a hard
  shadow, and a rotation on hover. Pick one.
- **Inconsistent radius across siblings.** `4 / 8 / 12 / 16` randomly
  applied. Lock to two values, max.
