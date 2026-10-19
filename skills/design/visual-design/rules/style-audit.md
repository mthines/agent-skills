---
title: Style Audit — Generic-AI-App Check
impact: HIGH
tags:
  - audit
  - review
  - checklist
  - identity
---

# Style Audit

## Contents

- The generic-AI-app score (low / medium / high)
- The 12-point identity checklist
- Top-3 fixes — how to pick
- The strip test (final check)
- What the audit is **not** for
- Worked snippet — the bottom of a review report

Use this rule during `review` mode. It produces the **generic-AI-app
score** (`low | medium | high`) and the **top-3 fixes** list at the
end of the report. Run it after the per-concern reviews
(`color-systems`, `typography-pairing`, `visual-hierarchy`,
`signature-details`).

## The generic-AI-app score

"Generic AI-app" is the dominant 2024–2026 aesthetic: dark mode with
purple-blue gradient hero, glassmorphic card, Inter typography, soft
shadow, `rounded-2xl`, a Tailwind indigo CTA. It is everywhere. It is
fine. It is not identity.

Score the target on the **12-point identity checklist** below.
Each `yes` is one point. Total → score:

| Total points | Score    | Meaning                                                  |
| ------------ | -------- | -------------------------------------------------------- |
| 10–12        | `low`    | Distinctive. Signature reads. Recognisable without logo. |
| 6–9          | `medium` | Some identity, drift in others. Targeted polish needed.  |
| 0–5          | `high`   | Reads as generic template / AI-app default.              |

## The 12-point identity checklist

For each, mark yes / no with evidence.

1. **Direction committed.** Does the component sit clearly inside one
   named direction from `style-directions.md` (or a *deliberate* mix
   of two)? Yes / no.
2. **Single primary accent.** Is there exactly one primary accent
   colour (with a defensible exception)? Yes / no.
3. **Specific accent hue.** Is the accent something other than
   Tailwind-default blue / indigo / emerald at `500`? Yes / no.
4. **Neutrals tinted to the accent family.** Cool greys with cool
   accent, or warm with warm? Yes / no.
5. **Type contrast > 2 ×.** Is the display-to-body ratio at least 2 ×
   (or stronger as the direction demands)? Yes / no.
6. **Type weight hierarchy.** Are at least 2 weights used to create
   hierarchy, not size alone? Yes / no.
7. **Custom focus ring.** Is the focus ring branded (offset, double,
   accent colour) rather than the OS / Tailwind default? Yes / no.
8. **One repeating signature move.** Can you name one move (shadow
   style, hover transform, divider, selection state) that repeats
   across siblings? Yes / no.
9. **Radius locked to 1–2 values.** No `4 / 8 / 12 / 16 / 24` drift.
   Yes / no.
10. **Numbers and IDs respect their nature.** Tabular numerals in
    tables, monospace for IDs, large-number-small-unit for stats.
    Yes / no.
11. **One clear focal point.** A reader can identify what the
    component wants them to see first. Yes / no.
12. **Empty / loading / error voice.** Is at least one of these
    states written with the brand's voice, not generic Lorem? Yes / no.

## Top-3 fixes — how to pick

After the checklist, list **the three changes** that would lift the
score the most. Choose by this priority order:

1. **Direction commitment.** If `#1` is no, fix this first. Nothing
   else compounds without it.
2. **Signature move.** If `#7` or `#8` are no, propose one move
   that's cheap and high-impact (custom focus ring, hover transform,
   selection cue).
3. **Hierarchy drama.** If `#5` or `#11` are no, push the scale and
   focal point. Cheap, transformative.
4. **Accent specificity.** If `#3` is no, propose a more specific
   accent (not Tailwind 500).
5. **Token discipline.** If `#9` is no, lock the radius and audit
   spacing.

Only escalate to deeper changes (typography family swap, palette
rebuild) when the cheap wins are exhausted.

## The strip test (final check)

Before finishing the report:

1. Imagine the wordmark removed.
2. Could a regular user of the product identify it from this
   component alone?
3. If no, your top-3 fixes should include at least one signature move
   that solves this.

## What the audit is **not** for

- **WCAG findings.** Defer to `/ux/rules/accessibility.md` and
  `/ux/rules/visual-design.md`.
- **Touch-target failures.** Defer to `/ux/rules/touch-and-interaction.md`.
- **Microcopy quality.** Defer to `/ux/rules/ux-writing.md`.
- **Dark-pattern detection.** Defer to `/ux/rules/dark-patterns.md`.

Do not duplicate those findings here. A complete UI review should run
both `/ux` and `/visual-design` and let the user merge them.

## Worked snippet — the bottom of a review report

```
### Generic-AI-app score: medium (7/12)

Yes:
- Direction committed (Minimal)
- Single primary accent
- Neutrals tinted to accent family
- Type contrast 3×
- Type weight hierarchy (400 / 600)
- Radius locked (4 px on all surfaces)
- Tabular numerals in the data table

No:
- Accent is Tailwind `indigo-500` — generic
- Focus ring is OS default
- No repeating signature move
- Focal point unclear — title and CTA compete
- Empty state is "No data."

### Top 3 fixes

1. **Adopt a specific accent.** Move from `indigo-500` to a brand-
   specific hue (proposal: `#4338CA` shifted to OKLCH `0.50 0.18 280`
   — slightly more violet, less generic). Cite: `color-systems.md`.
2. **Brand the focus ring.** Replace OS outline with a 2 px accent
   ring at 2 px offset. Sample provided below. Cite:
   `signature-details.md`.
3. **Resolve focal competition.** Drop the CTA from display weight to
   body-bold; keep the title as the only display-weight element.
   Cite: `visual-hierarchy.md`.
```
