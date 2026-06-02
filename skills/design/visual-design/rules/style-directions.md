---
title: Style Directions — Named Taxonomy
impact: HIGH
tags:
  - style-direction
  - taxonomy
  - identity
  - lookup
---

# Style Directions

## Contents

- Decision flow — pick one direction
- The directions (1–10): Minimal, Swiss, Editorial, Brutalist, Neo-Brutalist, Glass, Soft-UI, Terminal, Playful, Retro
- Mixing directions — only with intent
- Common direction collisions to flag

A **named, canonical taxonomy** of visual directions for product UI.
Use it for three purposes: identify the direction an existing component
sits in (or fails to commit to), pick a direction for new work, and check
that recommendations stay inside one direction rather than mixing.

Each entry has a fixed schema: **posture**, **canonical palette**, **type**,
**space & radius**, **signature**, **avoid**, **exemplars**.
Read just the entry you need.

## Decision flow — pick one direction

1. What does the brand voice claim (see `brand-identity.md`)? Confident /
   playful / authoritative / honest / experimental? Map to a direction:

   | Voice                | Default direction          |
   | -------------------- | -------------------------- |
   | Calm, trustworthy    | Minimal or Swiss           |
   | Editorial, premium   | Editorial                  |
   | Bold, opinionated    | Brutalist or Neo-Brutalist |
   | Lush, ambient        | Glass                      |
   | Friendly, tactile    | Soft-UI                    |
   | Engineering, exact   | Terminal                   |
   | Joyful, kid-friendly | Playful                    |
   | Nostalgic            | Retro                      |

2. Where does the product live? Internal tooling → Terminal / Swiss. B2B
   SaaS → Minimal / Swiss / Editorial. Consumer → Playful / Soft-UI / Glass.
   Brand-led marketing → any, but commit harder.
3. **Pick exactly one.** Mixing directions without intent is the #1 reason
   components look generic. Cross-pollinate only deliberately and call it
   out (e.g. "Swiss layout, Editorial type, no decoration").

## The directions

### 1. Minimal

- **Posture:** Restraint. The work is in what you remove. One accent
  colour, generous whitespace, no decorative elements.
- **Palette:** Near-white background, near-black content, one accent
  (often the brand colour at a single 500/600 step). Greys carry hierarchy.
- **Type:** One family, system or geometric sans. 2–3 weights. Tight scale.
- **Space & radius:** Generous space (1.5× a normal scale). Small radius
  (4–8 px) or zero. No shadows.
- **Signature:** Hairline borders (1 px, ~10 % luminance). Subtle
  separators. Type does the work.
- **Avoid:** Gradients, drop shadows, multiple accents, decorative icons.
- **Exemplars:** Linear, Vercel dashboard, Stripe docs.

### 2. Swiss / International Typographic Style

- **Posture:** Grid, hierarchy, asymmetric balance. Type as the protagonist.
- **Palette:** Black, white, one accent (often red, yellow, or blue). No
  gradients. Greys via type weight, not via colour.
- **Type:** Helvetica, Inter, or a geometric grotesque. Aggressive size
  contrast (display 4–8×body).
- **Space & radius:** Strict baseline grid. Zero radius. Generous gutters.
- **Signature:** Numbered sections, oversized numerals, asymmetric splits,
  type that fills the column.
- **Avoid:** Decorative borders, rounded corners, shadows.
- **Exemplars:** Mubi, MoMA, mid-century Swiss posters, modern Vercel
  marketing pages.

### 3. Editorial

- **Posture:** Magazine / book. Mixed-serif and sans. Wide content
  measure. Imagery dominates.
- **Palette:** Warm neutral (ivory / off-white / paper) backgrounds.
  Saturated accent (often a single deep tone — burgundy, ink, forest).
- **Type:** Serif display (Tiempos / GT Sectra / Domaine) for headlines,
  geometric sans for body and UI. Italics used intentionally.
- **Space & radius:** Wide measure (60–75ch). Small radius (4–6 px).
  Subtle paper-like elevation.
- **Signature:** Drop caps, pull quotes, ornaments (rule lines, glyphs),
  thoughtful image cropping.
- **Avoid:** Hard primary colours, neon, plastic shadows.
- **Exemplars:** The New York Times Cooking, Apple Newsroom, Substack
  publications.

### 4. Brutalist

- **Posture:** Raw, structural, anti-design. Things are functional,
  blocky, intentionally unrefined.
- **Palette:** High contrast — black on white, often with one screaming
  accent (chartreuse, hot pink, electric yellow). Or pure monochrome.
- **Type:** Default browser fonts, monospace, or aggressive grotesques.
  Mixed sizes intentional.
- **Space & radius:** Zero radius. Aggressive use of negative space or
  none at all. Borders thick (2–4 px).
- **Signature:** Visible structure (grids exposed), system fonts, raw
  elements, intentional ugliness.
- **Avoid:** Polish, gradients, soft shadows, careful pairing.
- **Exemplars:** Gumroad (2022 redesign), Are.na, early Craigslist as
  reference, Bloomberg Businessweek covers.

### 5. Neo-Brutalist

- **Posture:** Brutalist energy, candy palette. Hard shadows, bold
  borders, flat blocks of saturated colour.
- **Palette:** Pure saturated colours (cyan, magenta, lime, lemon, hot
  pink) on white or cream. No gradients.
- **Type:** Bold geometric sans (Inter, Space Grotesk, Archivo).
  Heavy weights.
- **Space & radius:** Medium radius (8–12 px). 2–4 px black borders. Hard
  black drop shadows offset 4–8 px (no blur).
- **Signature:** Hard offset shadows, thick black outlines, candy colour
  blocks, slight rotation on hover.
- **Avoid:** Soft shadows, gradients, muted palette, subtle hover states.
- **Exemplars:** Gumroad (current), many indie SaaS landing pages
  2022–2024, "Brutalism reskin" Tailwind component libraries.

### 6. Glass / Aurora

- **Posture:** Translucent surfaces over ambient blurred backgrounds.
  Depth via blur, not shadow.
- **Palette:** Cool gradient backgrounds (aurora, dawn). Surfaces are
  semi-transparent whites or near-blacks with backdrop blur.
- **Type:** Geometric sans, often slightly condensed. Light to medium
  weights.
- **Space & radius:** Generous radius (12–20 px). Soft, large radii on
  containers.
- **Signature:** `backdrop-filter: blur(...)`, ambient gradient blobs,
  inset highlights, subtle 1 px translucent borders on top of glass.
- **Avoid:** Hard shadows, opaque surfaces, hard borders, system fonts.
- **Exemplars:** Apple visionOS, Arc browser, modern Apple marketing
  pages.

### 7. Soft-UI (Neumorphism-adjacent, not pure)

- **Posture:** Tactile, rounded, friendly. Surfaces look pressable.
- **Palette:** Warm low-saturation pastels. Background and surface within
  10 % luminance of each other.
- **Type:** Rounded sans (Nunito, DM Sans, SF Pro Rounded). Medium weights.
- **Space & radius:** Large radius (12–24 px). Generous padding.
- **Signature:** Dual shadows (light highlight top-left, soft shadow
  bottom-right) on key surfaces — used sparingly, not on every element.
  Subtle inner highlight.
- **Avoid:** Pure neumorphism (everything embossed = unreadable),
  hard borders, high contrast, monospace.
- **Exemplars:** Headspace, Calm, recent fintech onboarding (Revolut,
  N26 lite mode).

### 8. Terminal / Monospace

- **Posture:** Developer-native. Monospace, dense, information-rich.
- **Palette:** Dark background (warm black, not pure #000). Greens /
  ambers / cool greys for content. One accent for action.
- **Type:** Monospace throughout (Berkeley Mono, JetBrains Mono, IBM Plex
  Mono). Occasional grotesque for headlines.
- **Space & radius:** Tight space. Small or zero radius. Visible cell
  borders sometimes.
- **Signature:** Caret cursors, ASCII rules, command-bar UI, syntax-style
  colour coding for status, structured logs as native UI.
- **Avoid:** Sans-serif body, rounded corners, decorative imagery.
- **Exemplars:** Vercel CLI output as UI, Warp terminal, Linear's
  command palette, GitHub CLI.

### 9. Playful

- **Posture:** Joyful, expressive, illustrated. Movement implied even in
  still UI.
- **Palette:** Bright, multi-hue. 3–5 accent colours used freely. Hand-
  picked, not generated.
- **Type:** Rounded sans, occasional display-script for moments of voice.
  Mixed weights deliberate.
- **Space & radius:** Large radius (16–28 px). Generous space.
- **Signature:** Custom illustrations, mascots, micro-animations, slight
  rotation on cards, emoji used as design elements (not just chrome).
- **Avoid:** System fonts, monochrome, zero radius, restraint.
- **Exemplars:** Notion's marketing, Mailchimp, Duolingo, Figma's empty
  states.

### 10. Retro / Vaporwave / Y2K

- **Posture:** Nostalgic period reference, applied with intent.
- **Palette:** Period-specific. 80s: hot pink + cyan + black. 90s: warm
  beige + maroon + forest. Y2K: chrome + iridescent + bubblegum.
- **Type:** Period-correct — Times New Roman + Verdana for Y2K, Helvetica
  for 70s, geometric pixel for 8-bit, Cooper Black for 70s display.
- **Space & radius:** Period-correct. Y2K: 8–12 px radius with chrome
  bevel. 80s: zero radius, hard lines.
- **Signature:** Period chrome, scanlines, halftone, pixel borders,
  bitmapped icons.
- **Avoid:** Modern conventions that break the period illusion (smooth
  gradients in pixel art, etc.).
- **Exemplars:** Are.na (slight), early Glossier, Frank Ocean's Blonde
  site, indie game landing pages, Telfar.

## Mixing directions — only with intent

A deliberate mix can produce signature work:

- **Swiss layout + Editorial type** — premium B2B with magazine soul.
- **Minimal palette + Neo-Brutalist shadows** — calm UI with one moment
  of voice on the CTA.
- **Terminal density + Soft-UI palette** — friendly dev tools.

If you propose a mix, **name both directions and the reason**. Otherwise
the result reads as drift, not voice.

## Common direction collisions to flag

- "Minimal with a glowy gradient hero" → the hero is fighting the rest.
- "Brutalist with rounded corners and soft shadows" → not brutalist,
  just generic.
- "Neo-Brutalist drop shadow on a glassmorphic card" → two contradictory
  depth metaphors.
- "Editorial serif headline over a synthwave hero" → period collision.
- "Playful palette in a tax-software dashboard" → tone-context mismatch.
