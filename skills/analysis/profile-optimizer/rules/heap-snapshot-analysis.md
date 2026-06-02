---
title: Heap Snapshot Analysis — Diagnosing Memory Leaks and Heavy Baselines
impact: HIGH
tags:
  - chrome-devtools
  - memory
  - heap-snapshot
  - leak
  - retainer
---

# Heap Snapshot Analysis

Reason about JavaScript memory issues from `.heapsnapshot` files. The goal:
**name the constructor (and ideally the source) responsible for retained
bytes**, distinguish a *leak* (objects survive an open/close cycle) from a
*heavy baseline* (large but normal), and propose a fix tied to a measured
delta — not a guess.

## When this rule applies

| Symptom                                                | Right capture                              | Right tool             |
| ------------------------------------------------------ | ------------------------------------------ | ---------------------- |
| "Memory grows over time / on every navigation"         | 3 heap snapshots (baseline → action → cleanup) | `heap-diff` script       |
| "What's currently using all this memory?"              | 1 heap snapshot                            | `heap-summary` script    |
| "Where does this single click allocate from?"          | `.heaptimeline` (allocation instrumentation) | DevTools tree           |
| "Long session, slow growth, no clear reproducer"       | `.heapprofile` (allocation sampling)       | DevTools tree (sampled) |

This rule covers the snapshot path. The timeline / profile paths are
DevTools-driven; the snapshot path is fully scriptable, which is why it's
the lever this skill leans on.

## Anatomy of a heap snapshot

A `.heapsnapshot` is JSON with this shape:

```text
{
  "snapshot": {
    "meta": {
      "node_fields": ["type","name","id","self_size","edge_count","detachedness"],
      "node_types":  [["hidden","array","string","object","code","closure", ...]],
      ...
    },
    "node_count": 7647888,
    "edge_count": 20950271
  },
  "nodes":   [<int>, <int>, ...],   // flat: 6 ints per node, total = node_count * 6
  "edges":   [<int>, <int>, ...],   // flat: 3 ints per edge
  "strings": [<str>, <str>, ...]    // referenced by node `name` and edge `name_or_index`
}
```

Per-node fields (typical 6-field layout):

| Field          | Meaning                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `type`         | Index into `node_types[0]`. Common: `object`, `closure`, `native`, `string`, `code`, `array`, `hidden`. |
| `name`         | Index into `strings`. For `object`/`closure` this is the constructor / function name. |
| `id`           | Stable across snapshots — useful when correlating before/after. |
| `self_size`    | Bytes occupied by this object (excluding referenced children). |
| `edge_count`   | Number of outgoing edges (used to walk into `edges` array). |
| `detachedness` | Non-zero if the DOM node is detached from the document. **Smoking gun for DOM leaks.** |

Real-world snapshots from a single page are routinely 200–800 MB on disk
and 5–20 M nodes. Don't try to load via `jq` for whole-file analysis — use
the scripts.

## Phase order for a memory diagnosis

Walk these in order. Don't skip a phase.

| #  | Phase                          | Output                                                                |
| -- | ------------------------------ | --------------------------------------------------------------------- |
| 0  | Capture validation             | Confirm 1 or 3 snapshots; refuse single-snapshot leak diagnoses       |
| 1  | Baseline summary               | Total MB, node count, top constructors (run `heap-summary`)            |
| 2  | Diff (if 2+ snapshots)         | Top growers / shrinkers by Δsize and Δcount (run `heap-diff`)         |
| 3  | Constructor → source           | Map suspect constructor names back to source files                     |
| 4  | Retainer reasoning             | For each suspect: what holds it? Closure? Listener? Detached DOM?      |
| 5  | Report                         | Use the standard report template                                       |

## Phase 0 — Capture validation

Refuse to diagnose a leak from a **single** snapshot. A single snapshot only
shows what's currently in memory; it cannot distinguish "always was large"
from "grew because of a leak".

| User says                | What you need                                |
| ------------------------ | -------------------------------------------- |
| "Memory is growing"      | At least 2 snapshots, ideally 3               |
| "It's high right now"    | 1 snapshot is enough — phrase as baseline analysis, not leak diagnosis |
| "After action X it grows"| 3 snapshots: idle, after-N-iterations-of-X, after-cleanup |

Sanity-check the gap: snapshots taken **< 30 s apart** with no action are
not useful for slow growth — they capture idle GC churn (compiled code
eviction, transient buffers) that swamps real signal. Ask for snapshots
further apart or bracketing a specific action.

If only 2 snapshots and the user said "growing slowly", proceed but state
the time gap and caveat the conclusion accordingly.

## Phase 1 — Baseline summary

Run the `heap-summary` script:

```bash
node --max-old-space-size=4096 \
  $SKILL_DIR/scripts/heap-summary.mjs \
  <snapshot.heapsnapshot> [topN=25]
```

Replace `$SKILL_DIR` with the actual skill path (e.g.
`~/.claude/skills/profile-optimizer` or `<repo>/skills/profile-optimizer`).
Raise `--max-old-space-size` for snapshots > ~700 MB on disk.

Read off:

- **Total self_size**: typical SPA page is 50–120 MB. > 200 MB is high and
  worth investigating regardless of growth.
- **By node type**: `native` dominating means lots of DOM/Web API objects;
  `code` dominating means large compiled JS; `string` dominating means big
  text retained.
- **Top constructors by total self_size**: the named bytes — what your
  app and its libraries allocated.

Common constructor names you'll see and what they mean:

| Name                          | What it is                                                                |
| ----------------------------- | ------------------------------------------------------------------------- |
| `system / JSArrayBufferData`  | Typed-array buffers (canvases, WebGL, audio, decoded images, WASM)        |
| `system / ExternalStringData` | Strings stored outside the v8 heap — often source code, large literals    |
| `system / Context`            | v8 closure contexts — every closure variable env. High counts → closure-heavy code |
| `Object`                      | Plain JS objects (`{}`)                                                   |
| `Array`                       | Plain JS arrays                                                           |
| `Attr`, `NodeList`, `DOMTokenList`, `CSSStyleRule`, `SVGCircleElement`, `KeyframeEffect`, etc. | DOM and CSSOM. High counts here for an SPA usually means many cached/detached DOM trees. |
| `EventListener`, `V8EventListener` | Bound event listeners. Track these closely for leak hypotheses.        |
| Single-letter (`t`, `rg`, `n.<computed>`) | Minified app code. Resolve via sourcemaps if available.            |

## Phase 2 — Diff

Run the `heap-diff` script:

```bash
node --max-old-space-size=4096 \
  $SKILL_DIR/scripts/heap-diff.mjs \
  <before.heapsnapshot> <after.heapsnapshot> [topN=30]
```

Read the **Top growers** table. For each row:

- `Δ_size_mb` > 0 AND `Δ_count` > 0 → real growth in object count
- `Δ_size_mb` > 0 AND `Δ_count` ≈ 0 → existing objects got bigger (often
  arrays accumulating items, strings concatenating)
- `Δ_size_mb` ≈ 0 AND `Δ_count` > 0 → many small objects added, watch
  out for cumulative cost
- Top shrinkers are usually `code` (compiled-code eviction) or transient
  caches — not the leak

A constructor that grows by N×K objects where K is the number of times the
user repeated the action is the canonical leak signature: every iteration
allocated K instances and none were freed.

## Phase 3 — Constructor → source

Once you have a suspect constructor, map it back to source:

1. **App-named class** (e.g. `CheckRuleChart`, `QueryBuilder`): grep the
   codebase for `class <name>` or `function <name>`.
2. **Single-letter / minified** (e.g. `rg`, `t`, `n.<computed>`): if the
   trace was saved with `enhancedTraceVersion: 1` and embedded sourcemaps
   (Chrome 124+), use the embedded sourcemap to resolve. Otherwise look at
   the bundle output and grep the bundled chunk near that name.
3. **Anonymous closures**: open the snapshot in DevTools → Memory panel →
   load file → inspect retainer chain. Closures show their captured
   variables.
4. **Native objects** (`Attr`, `EventListener`, etc.): the leak is in JS
   code that is *retaining* these — the constructor itself is just the
   victim. Move to Phase 4.

## Phase 4 — Retainer reasoning

For app-level leaks the retainer chain almost always looks like one of
these patterns. Reason from the constructor outward:

| Pattern                          | Signature                                                                  | Fix direction                                                              |
| -------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Listener on `window`/`document`** | `EventListener` count grows with each action; never shrinks                 | `removeEventListener` on cleanup; `AbortController` for `addEventListener` |
| **Detached DOM**                 | `Attr`/`HTMLElement`/`SVG*` count grows; `detachedness != 0` on nodes      | Drop the JS reference holding the detached subtree (often a closure)        |
| **Closure over large state**     | `system / Context` size grows; specific app constructor count grows in lock-step | Hoist captured values out, or recreate the closure with narrower scope     |
| **Subscription / observer**      | Subscription/observable instances grow                                      | Unsubscribe on unmount / on action complete                                  |
| **Caches without bounds**        | `Map`/`Object` growth; one or two named arrays grow huge                   | Add eviction (LRU, max size, TTL)                                            |
| **React effect with stale deps** | Component instance count grows; old fiber nodes retained                    | Fix dep array; cleanup function in `useEffect`                               |

Open the snapshot in Chrome DevTools (Memory panel → load file) for the
**Retainers** view if any of these patterns are unclear from the
constructor delta alone — the script gives you bytes, but the GUI gives
you the retainer path.

## Phase 5 — Report

Same template as the perf rules (`templates/analysis-report.md`), with
slot guidance:

- **Primary metric**: `total_self_size` delta between snapshots, OR steady-state
  total if it's a baseline analysis.
- **Baseline / target**: e.g. "before: 192 MB, after-action: 240 MB,
  after-cleanup: 235 MB. Target: cleanup brings the page back within 5 MB
  of baseline."
- **Top hotspots**: top constructors by Δsize, with object counts.
- **Root causes**: pattern from Phase 4 + source location.
- **Verification plan**: re-record the same 3 snapshots after the fix; the
  cleanup snapshot should now match baseline.

## Examples

### Good — leak finding from a 3-snapshot capture

> Diff between baseline (192 MB) and after-cleanup (235 MB) snapshots, with
> 20 iterations of "open and close the check-rule edit dialog":
> `EventListener` count grew by 432 (≈ 22 per iteration), `system / Context`
> grew by 1.8 MB. Retainer view shows the listeners are bound to `window`
> resize via `useResizeObserver` in `query-builder/chart.tsx:88`, and the
> hook never calls `disconnect()` on unmount. Fix: add cleanup in the
> hook's `useEffect`. Expected outcome: cleanup snapshot returns to within
> 1 MB of baseline.

### Bad — single-snapshot leak claim

> The page is using 192 MB. There must be a leak somewhere. Probably the
> chart component.

Why bad: 192 MB is a baseline measurement, not evidence of a leak. The
constructor in question wasn't named. The fix is unmeasured.

## Common mistakes

- **Diagnosing a leak from one snapshot.** Refuse and ask for ≥ 2.
- **Comparing snapshots taken seconds apart with no action.** That's idle
  GC noise (mostly `code` eviction). Ask for snapshots bracketing an
  action or further apart.
- **Reading total file size as memory size.** The on-disk JSON is ~2–3×
  the actual heap — always run the script and read `Total self_size`.
- **Not running GC before the snapshot.** Chrome's snapshot triggers a
  GC, but explicit GC (the trash icon) cleans up eligible objects more
  aggressively. Recommend it in capture instructions.
- **Conflating "high" with "leaking".** A heavy baseline is fixable too,
  but the fix is different (lazy-load, avoid eager allocation) from a
  leak fix (cleanup on unmount).
- **Trusting `<unknown>` constructor names.** They mean v8 didn't know
  the name at allocation time — usually anonymous classes / closures.
  Drop into Phase 4 retainer analysis instead.
