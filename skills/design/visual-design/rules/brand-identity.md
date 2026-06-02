---
title: Brand Identity — Voice to Visual Translation
impact: HIGH
tags:
  - brand
  - identity
  - voice
  - positioning
---

# Brand Identity

## Contents

- What "brand" means here (the four questions)
- Voice → visual translation table
- Adjacency check
- Signature moves — name them, repeat them
- When the brand is undefined
- Anti-patterns

A great component does not just look good — it looks like *this product*
and not another. This rule turns brand voice into visual decisions you can
implement.

## What "brand" means here

For an agent designing a component, "brand" is the **answer to four
questions**:

1. **Voice** — how would the product introduce itself in one sentence?
   ("We're the calm tax tool", "We're the loud, opinionated CRM").
2. **Audience** — who is supposed to feel at home? Developers? Founders?
   Designers? Operations? Consumers?
3. **Adjacency** — what does the product *refuse* to feel like? ("Not a
   bank dashboard", "Not enterprise SaaS", "Not a toy").
4. **Signature move** — what is the one thing the product does visually
   that competitors don't? (Vercel's black-and-white starkness. Linear's
   keyboard-first density. Stripe's pastel gradients on serious type.)

If the user has not answered these for the product, **ask**. Do not
invent a voice. One direct question with three concrete examples is
better than a guessed direction.

## Voice → visual translation table

Use these as defaults, then refine.

| Voice trait                | Translation in palette       | Translation in type            | Translation in space & detail            |
| -------------------------- | ---------------------------- | ------------------------------ | ---------------------------------------- |
| Calm, trustworthy          | Cool neutrals, single accent | One sans, modest scale         | Generous space, hairline borders         |
| Confident, opinionated     | Black + 1 saturated colour   | Heavy weights, big size jumps  | Tight space, decisive edges              |
| Premium, editorial         | Warm neutrals, deep accent   | Serif display + sans body      | Wide measure, paper-like elevation       |
| Friendly, approachable     | Pastel multi-hue             | Rounded sans                   | Large radius, soft shadows               |
| Technical, engineering     | Dark + greens / amber        | Monospace                      | Dense, visible structure                 |
| Playful, expressive        | Bright multi-hue             | Mixed weights, occasional script | Large radius, illustrations, rotation  |
| Honest, no-frills          | High contrast, monochrome    | System fonts                   | Zero or small radius, exposed grid       |
| Ambient, immersive         | Gradient backgrounds         | Light geometric sans           | Glass surfaces, blur, generous radius    |

## Adjacency check

For every visual choice, ask: **"Could a competitor ship this exact
component?"** If yes, the choice is generic. Make one specific move that
forces a "no":

- A *single* signature detail (the offset shadow, the serif headline,
  the monospace label, the dotted divider).
- A *single* unconventional choice that's defensible (the
  numbered-section pattern, the always-visible keyboard hint, the
  oversized numerals).

One per component is usually enough. Two is a lot. Three is noise.

## Signature moves — name them, repeat them

Strong brands repeat the same visual move across many components. Examples:

- **Linear**: monospaced metadata, keyboard hints in every primary
  action, command-palette-as-UI, off-white background that's not pure
  white, type-scale-driven hierarchy.
- **Stripe**: pastel gradient hero with serious type, the curve-line
  illustrations, abundant whitespace around dense tables, the orange-on-
  near-white accent.
- **Notion**: friendly emoji as design elements (not decoration),
  hand-drawn illustrations, the gentle grey separators, type-only
  hierarchy with almost no colour.
- **Vercel**: pure black backgrounds, white type, the geometric grid as a
  graphic element, the deploy-status colour system, monospace for
  metadata.

When designing a new component, ask **"which signature moves of this brand
should appear here?"** A button without any signature move is a generic
button.

## When the brand is undefined

Sometimes the user is creating a new product and no voice exists yet.
Two routes:

1. **Pick a direction and propose three voice options** anchored to it
   (e.g. for "Minimal": "calm and trustworthy", "premium and quiet",
   "engineering-honest"). Let the user pick.
2. **Mood-board as prose.** Write 5–7 sentences describing what the
   product feels like, what it is *not*, and three named brand
   adjacencies ("feels like Linear with a touch of Notion warmth, never
   like Salesforce"). Then translate.

Both routes belong in `direction` mode. `templates/direction-brief.md`
is the output shape.

## Anti-patterns

- **"Vibrant and approachable yet professional and trustworthy"** —
  generic, meaningless, fits everyone. Force a choice.
- **Citing 5+ exemplars in different directions** — the brand can't be
  Linear *and* Notion *and* Stripe *and* Apple. Pick the dominant one.
- **A logo without a system** — one good wordmark does not make a brand
  identity. Make sure the type, palette, and signature details support it.
- **Re-skinning a generic template with new colours** — colour swaps
  alone don't create identity. Push for one structural move that's
  uniquely yours.
