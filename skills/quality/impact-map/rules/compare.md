---
title: Compare view — today and after on the same layout
impact: MEDIUM
tags:
  - impact-map
  - compare
---

# Compare view

Phase 4 of `impact-map`, optional. Read when the change alters a flow that already exists, which is the usual case for a plan.
A reader then asks two questions: what happens today, and what happens after. One "after" diagram answers only the second.

Skip it when the change only adds an isolated unit; one diagram is enough.

## Contents

- [What to build](#what-to-build)
- [Same layout rule](#same-layout-rule)
- [Boxes and steps](#boxes-and-steps)
- [The toggle](#the-toggle)
- [Side-by-side table](#side-by-side-table)

## What to build

1. A **Today** diagram and an **After** diagram, in two `<figure>` blocks inside `<div id="viewbox">`.
2. A Today / After **toggle** above them. After is selected first.
3. A **numbered flow** under each diagram: lettered steps that match the step markers drawn on the arrows.
4. A **side-by-side table** after the section: 3 to 6 behaviours, today in one column, after in the next.

Use the page template's optional compare block and the optional table section; delete both when you skip the view.

## Same layout rule

Draw Today and After with the same `viewBox`, the same bands, and the same box positions.
A box that exists in both keeps its coordinates. A box that exists only after appears in Today at the same place, as a `ghost`.
The reader flips the toggle and sees what appears, what changes, and what stays, without searching.

```text
✅ RIGHT — "Hub resolver" is at x=450,y=132 in both views; in Today it is a dashed ghost labelled "not there yet"
❌ WRONG — Today is a smaller diagram with other positions, so the reader must match boxes by name
```

## Boxes and steps

| Mark | Meaning | Class |
| --- | --- | --- |
| Dashed grey box, italic subtitle | Does not exist yet. Today view only | `n ghost` |
| Circle with a letter on an arrow | A step in the numbered flow | `stp` |

1. In Today, boxes the change edits keep `mod`, and unchanged boxes keep `same`, so the colour tells which boxes the change will touch.
2. In Today, a box's subtitle says what it does now; in After it says what it does after.
3. Draw only the edges that exist today in Today. Draw the planned edges in After.
4. Every arrow that carries the story has a step letter. A letter appears once per view, in order, and each has a matching line in that view's flow list.
5. A flow line is one sentence with a concrete value from the code, such as a limit or a table name. Never a guessed number.
6. Alt text on each `<svg>` names the view (`Today: …` / `After: …`).

## The toggle

1. Use **buttons** with `aria-pressed`, and a short inline script that sets the class on `#viewbox`. The template has it; copy it unchanged.
2. Never build the toggle from hidden radio inputs and labels. Clicking a label focuses its input, and the browser scrolls the page to that input. In a long page that jumps to the top.
3. Without script, After stays visible and Today stays hidden; the page must still make sense, so the side-by-side table carries the comparison on its own.

## Side-by-side table

1. Three columns: Behaviour, Today, After.
2. One row per behaviour a reader can observe, such as where reports go, who may send them, or what the person sees. Not one row per file.
3. Today states what the code does now, read at the base commit. After states the planned behaviour, and names the decision number when a decision settles it.
4. Put each Risk on its verdict row's summary line (`.rk`), so it shows without opening the row.
