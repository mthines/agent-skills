---
title: Typography Pairing — Personality and Pairing Rules
impact: HIGH
tags:
  - typography
  - type-pairing
  - voice
  - hierarchy
---

# Typography Pairing

## Contents

- The one-family rule
- Pairing rules
- Personality cheat sheet
- Scale construction
- Weight as hierarchy
- Tracking and case
- Tabular numerals
- Web font loading
- Common typography failures to flag
- Type as brand signature

This rule covers **type personality and pairing** — choosing fonts and
combining them so the result feels intentional. For size minimums, line
length, line height, and dynamic-type rules, defer to
[`/ux/rules/visual-design.md`](../../ux/rules/visual-design.md).

## The one-family rule

Default to **one family** until you have a reason to add a second.
Modern UI type families (Inter, Geist, IBM Plex, SF Pro, Roboto Flex)
ship enough weights, widths, and optical sizes to handle display, body,
mono-numerics, and UI without help.

Add a second family only for one of these reasons:

1. **Voice contrast.** Editorial direction wants a serif headline against
   a sans body.
2. **Function.** Code, IDs, numbers, and dense metadata read better in
   monospace.
3. **Brand signature.** The product's signature move *is* a specific
   display font (e.g. Cooper Black for a retro brand, custom variable
   wordmark for a tech brand).

Three families is almost always wrong. Stop.

## Pairing rules

When you do pair, follow these:

1. **Pair across categories, not within.** Serif + sans, sans + mono,
   display + sans body. Two sans-serifs together look like a mistake,
   not a pairing — unless one is a wider grotesque against a narrower
   geometric and the contrast is decisive.
2. **One does the talking, one does the listening.** Display is loud
   and rare. Body is quiet and dense. Don't fight.
3. **Match x-height ratio within ~15 %.** Mismatched x-heights make
   captions look like a different document from headlines.
4. **Match the metric weight.** A 700-weight in one font is not the
   same density as 700 in another. Test side by side.
5. **No more than two families in body content.** Mono inserts inside
   sans body text are fine; alternating sans paragraphs are not.

## Personality cheat sheet

Pick families by what they sound like, not what's trendy.

| Personality        | Sans options                            | Serif options                  | Mono options                       |
| ------------------ | --------------------------------------- | ------------------------------ | ---------------------------------- |
| Calm / neutral     | Inter, Geist, SF Pro, system-ui         | Source Serif, Crimson Pro      | JetBrains Mono, Geist Mono         |
| Confident / sharp  | Söhne, Helvetica Now, Neue Haas Grotesk | GT Sectra, Tiempos Headline    | Berkeley Mono, MD IO               |
| Editorial / warm   | GT America, Plantin Sans                | Tiempos, Domaine, Caslon, EB Garamond | Plantin Mono, IBM Plex Mono  |
| Technical / engineering | IBM Plex Sans, Space Grotesk, Mona  | Roslindale, Lyon            | IBM Plex Mono, Berkeley Mono, Fira Mono |
| Playful / friendly | Nunito, DM Sans, Inter Rounded          | Cooper, Mrs Eaves              | DM Mono, Comic Mono (intentionally) |
| Brutalist / raw    | Helvetica (default), Arial, Times       | Times New Roman                | Courier (default)                  |

When in doubt, **Inter** for sans and **JetBrains Mono** for mono is the
default that won't fail. The signature comes from how you *use* them
(scale, weight contrast, tracking), not from picking a more exotic font.

## Scale construction

Build a type scale, do not list arbitrary sizes.

| Role                 | Web (px)   | iOS (pt)   | Android (sp) | Weight            |
| -------------------- | ---------- | ---------- | ------------ | ----------------- |
| Display              | 40–72      | 34–48      | 32–48        | 700–900           |
| H1                   | 30–40      | 28–34      | 28–32        | 600–800           |
| H2                   | 22–28      | 22–24      | 22–24        | 600–700           |
| H3                   | 18–22      | 18–20      | 18–20        | 600               |
| Body                 | 16         | 17         | 14–16        | 400–500           |
| Caption / meta       | 12–14      | 13         | 12           | 400–500           |
| UI label             | 14         | 15         | 14           | 500–600           |
| Mono / numeric       | match body | match body | match body   | 400–500           |

Pick **one scale ratio** (1.125 / 1.25 / 1.333 / 1.5) and apply it
consistently. The drama of the scale is part of the direction:

- **Minimal / Swiss:** wide ratio (1.5 or 1.618) so display is 4–8 ×
  body. Big contrast, few sizes.
- **Editorial:** moderate ratio (1.333) with a strong display step.
- **Soft-UI / Playful:** narrow ratio (1.125–1.25) so everything feels
  gently varied.
- **Terminal:** narrow ratio (1.125) — density beats hierarchy.

## Weight as hierarchy

Weight contrast often beats size contrast for clarity, and is cheaper:

- Body 400, label 500, heading 600, display 700–800 reads as a clear
  hierarchy even at similar sizes.
- Use one font with **2–3 weights** rather than two fonts at the same
  weight.
- Avoid 100 / 200 weights for body text on light backgrounds — fails
  contrast and looks fragile.

## Tracking and case

These small choices carry a lot of voice:

- **Display:** -1 to -3 % tracking on large sizes. Tight = confident.
- **Body:** 0 % at 16 px; +1 to +2 % below 14 px to compensate.
- **UI labels:** sometimes ALL CAPS + 6–10 % tracking for utility chips
  and small headers (Swiss direction loves this).
- **Sentence case** for buttons and labels by default. Title Case for
  buttons reads dated unless the direction calls for it (Editorial,
  Retro).

## Tabular numerals

For tables, totals, prices, timestamps, and dashboards:

```css
font-variant-numeric: tabular-nums;
```

Or use the typeface's `tnum` OpenType feature. This single property
upgrades dashboards more than most palette decisions.

## Web font loading

A skill for delivery is a skill for design, briefly:

- **Subset** to the characters you use (Latin only if Latin only).
- **Preload** the display font used above the fold.
- **`font-display: swap`** with a tuned fallback (`size-adjust` +
  `ascent-override` to match) so the layout doesn't jump.
- **System fallback** for body in fast-load contexts is honest, not lazy
  (Swiss and Brutalist directions can lean into this).

## Common typography failures to flag

- **Two sans-serifs paired.** No contrast, looks accidental.
- **Three or more families.** Almost always too many.
- **Display font used at body size.** Display fonts have hinting and
  spacing for large sizes — they look brittle at 14 px.
- **Body font used at 72 px.** Body fonts are designed for legibility,
  not drama. They look weak at display sizes.
- **No mono for numbers or IDs.** Misalignment in tables and dashboards.
- **Weight 100–300 body on white.** Often fails contrast (see `/ux`),
  also looks anaemic.
- **`text-transform: uppercase` on long passages.** Reads slowly. Use
  ALL CAPS only on short labels.
- **Inconsistent tracking.** Some headings -2 %, others 0 %, by accident.
- **A scale built by eye, not by ratio.** Drift accumulates.

## Type as brand signature

Some of the strongest brand signatures live in type:

- **Linear:** a slightly off-default monospace for metadata, sans labels
  for UI, and assertive size contrast.
- **Stripe:** serious sans with very generous tracking on display.
- **Vercel:** Geist everywhere, with hard size contrast and tight
  display tracking.
- **Notion:** rounded sans with very modest scale, and emoji as design.
- **Apple:** SF Pro with tight tracking on display, generous on body —
  recognisable in two characters.

If the brand voice is strong, treat type as part of the signature
(see `signature-details.md`).
