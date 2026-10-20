# Diagram — one SVG of the system after merge

Phase 4 of `impact-map`.
The diagram shows where the change lands; the decisions say what to worry about; badges connect the two.

## Pick the shape from the PR's kind

| PR kind | Columns, left to right | Example |
| --- | --- | --- |
| Changes a running system | Callers → edge → service(s) → data stores | New API routes, a migration, a hot-path refactor |
| Consolidates or removes units | Entry point → now does the work → removed (folded in), plus a "safety net" band for tests/evals | Deleting skills and folding them into callers |
| Mixed | Use the running-system shape; show removals as dashed struck-through boxes in their column | — |

## Grammar

| Mark | Meaning | CSS class |
| --- | --- | --- |
| Blue box | New in this PR | `n new` |
| Amber box | Changed existing code | `n mod` |
| Grey box | Unchanged, shown for context | `n same` |
| Dashed red box | Exposed on merge: a caller that can reach new code now, or a safety net that did not run | `n risk` |
| Dashed grey box, struck title | Removed | `n gone` |
| Dashed arrow | Exists, but not called yet | `e … dash` |
| Black circled number | The decision about this box | `bdg` |

Rules:

1. **≤ 14 boxes.** Merge siblings that share a fate ("Environments + variables API", "holistic-analysis + 3 agents").
2. **Box text:** a title of ≤ 4 words and a subtitle of ≤ 7 words that says what changed (`+2 columns, index rebuilt`), never what the component is.
3. **Draw only edges that carry the story.** Callers into new code, changed code into changed data, removed units into what absorbed them.
4. **Badge** the top-right corner of each box a decision is about, at the box's corner coordinates (`cx = x + width`, `cy = y`).
5. **Caption** states the one-sentence claim: what runs on merge and what is built but uncalled.

## Skeleton

Copy into the page's `<figure>`.
Columns sit on a 900-wide `viewBox`; rows are 46–56 tall with ≥ 10 between them.

```html
<svg viewBox="0 0 900 300" role="img" aria-label="<the caption, in full>">
  <defs>
    <marker id="a-new" class="mk-new" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker>
    <!-- a-mod, a-same, a-risk: same shape, classes mk-mod / mk-same / mk-risk -->
  </defs>
  <text class="hdr" x="20" y="16">CALLERS</text>
  <!-- edges first, so boxes paint over their ends -->
  <path class="e risk" d="M170,133 L200,128" marker-end="url(#a-risk)"/>
  <!-- boxes -->
  <g class="n risk"><rect x="20" y="110" width="150" height="46" rx="3"/>
    <text class="t" x="32" y="129">API clients</text><text class="s" x="32" y="145">admins, machine tokens</text></g>
  <!-- badges last -->
  <g class="bdg"><circle cx="170" cy="110" r="10"/><text x="170" y="114">1</text></g>
</svg>
```

Title baseline is `y + 19`, subtitle `y + 35` for a 46-tall box (`y + 23` / `y + 40` for 56).
