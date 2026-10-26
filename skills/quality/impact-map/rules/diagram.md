# Diagram — one SVG of the system after merge

Phase 4 of `impact-map`.
The diagram shows where the change lands; the decisions say what to worry about; badges connect the two.

## Pick the shape from the PR's kind

| PR kind | Columns, left to right | Example |
| --- | --- | --- |
| Changes a running system | Callers → edge → service(s) → data stores | New API routes, a migration, a hot-path refactor |
| Consolidates or removes units | Entry point → now does the work → removed (folded in), plus a "safety net" band for tests/evals | Deleting skills and folding them into callers |
| Mixed | Use the running-system shape; show removals as dashed struck-through boxes in their column | — |

## Group by service

When the boxes belong to two or more services, stack one full-width band per service, top to bottom in call order, and let the diagram grow taller, never wider.

1. **A service** is a deployable unit: the nearest Nx project, `package.json`, `go.mod`, or `Dockerfile` root above the box's file.
   Browser and server code in one package are two bands, because the network sits between them.
2. **Inside a band, flow top to bottom:** one row per layer (callers → composer → logic → API client), each row headed by a `hdr` label, boxes on a 4-column grid (`x` = 20, 235, 450, 665; width 200).
3. **Label each band** `<SERVICE> · <path>`, plus `· #<n> (context)` when it comes from another PR in the stack.
   A band with no new or changed box is `band ctx` (dashed, no fill).
4. **Edges that cross a band edge are network calls.** Keep their lanes clear of other boxes, and label the protocol once (`HTTP`, `gRPC`, `queue`).
5. **Tests and checks** go in a last `SAFETY NET` band, not inside a service band.
6. One service: no bands; use the column shapes above.

```text
✅ RIGHT — bands "UI · components/ui" and "AGENTS · #24159 (context)"; the one HTTP arrow crosses the boundary
❌ WRONG — columns CALLERS · COMPOSER · THREAD · UI API · AGENTS: layers and services interleaved, the network hop looks like any other arrow
```

Paint in this order: band rects, edges, band labels and row headers, boxes, badges.
Labels after edges matter: their halo cuts any edge running behind them, so a lane may pass a label.
A `band ctx` label also takes `ctx`, so its halo matches the unfilled sheet.

```html
<g class="band"><rect x="8" y="8" width="884" height="416" rx="6"/></g>
<g class="band ctx"><rect x="8" y="440" width="884" height="98" rx="6"/></g>
<!-- edges -->
<text class="band-l" x="20" y="30">UI · components/ui</text>
<text class="band-l ctx" x="20" y="462">AGENTS · #24159 (context)</text>
<text class="hdr" x="20" y="56">CALLERS</text>
<!-- boxes, then badges -->
```

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

## Badges from a pr-reviewer report

With `--findings <report-body.md>`, the diagram is the picture above a `pr-reviewer` report's findings table, and its badges are that table's row numbers.

1. Read the rows of the first `| | Finding | Where |` table in the file: each row is `| <glyph>&nbsp;**<n>** | **<title>** … | [`<file>:<line>`](<url> "<path>") |`.
   No table means no findings: draw no badges, drop the badge legend entry, and use the alt `What changes on merge.`.
2. Run phases 0–2 on the PR as usual, then draw the diagram by the rules above.
   Skip phase 3: the report's table replaces the decisions.
3. Badge the box each finding's `<path>` belongs to with that row's `<n>`, not ①②③. Several numbers on one box sit side by side along its top edge, 22 apart. A finding with no box gets no badge.
4. In the page legend, label the badge entry `Numbered row below` instead of `Decision above`.
5. Build the page as phase 5 does and write it to `.agent/{branch}/impact-map/pr-<n>.html`; never publish it as an Artifact.
6. Render the PNGs with `render-png.mjs` from that page file, open both with the Read tool, and print:

```text
light: <out-dir>/what-changes-light.png
dark:  <out-dir>/what-changes-dark.png
alt:   What changes on merge. 1: <title of finding 1>. 2: <title of finding 2>. …
```

The alt text is one line of plain text with no `"`, `<`, or `>`, and names every badge drawn.

```text
✅ RIGHT — badge 3 on the "Eval cases" box, because row 3's path is evals/verify-first-token-broken/scaffold.sh
❌ WRONG — ①②③ badges numbered by impact-map's own decisions; they no longer match the table
```
