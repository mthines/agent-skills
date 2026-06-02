---
title: Input Detection — React, Chrome trace, cpuprofile, heap snapshot
impact: HIGH
tags:
  - input-detection
  - file-format
  - intake
  - heap-snapshot
---

# Input Detection

Decide which profile format the user passed. Detection is by file shape, not
extension — React, Chrome, heap snapshots all use JSON files (different
extensions but the same `.json` shape underneath).

## Decision flow

Read the first ~64 KB of the file (use `head -c 65536` then attempt JSON
parse of the buffer; for very small files, read it all).

| Top-level key signature                                   | Format                       | Notes                                              |
| --------------------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `dataForRoots` AND `rendererID` (or `version`)            | React DevTools Profiler      | Single root array under `dataForRoots`             |
| `traceEvents` (array of objects with `ph`, `ts`, `cat`)   | Chrome Performance trace     | DevTools-saved trace                               |
| Top-level array starting with `{"args":...,"cat":..."ph":` | Chrome trace (array form)   | Older / minimal format                             |
| `nodes` AND `samples` AND `timeDeltas`                    | Chrome `.cpuprofile`         | Legacy CPU profiler, importable into Performance   |
| `snapshot.meta.node_fields` AND `nodes` AND `edges` AND `strings` | Chrome `.heapsnapshot` | Object-graph snapshot. `nodes` is a flat int array |
| Heap-snapshot shape AND non-empty `samples` array         | Chrome `.heaptimeline`       | Allocation instrumentation on timeline             |
| Top-level `head` (with `callFrame` / `children`) AND `samples` (with `nodeId` / `weight`) | Chrome `.heapprofile` | Allocation sampling profile                        |
| Magic bytes `1f 8b`                                       | gzipped — `gunzip -k`, retry | Common for large traces                            |

If none match, ask the user to identify the source. Do not guess.

## Quick checks

Run these in order. The first match wins.

```bash
# 1. Gzipped?
file -b "<path>" | grep -q gzip && gunzip -k "<path>"

# 2. Try React DevTools shape
jq -e 'has("dataForRoots") and (has("rendererID") or has("version"))' "<path>" >/dev/null 2>&1 \
  && echo "react-profiler"

# 3. Try Chrome trace (object form)
jq -e 'has("traceEvents") and (.traceEvents | type == "array")' "<path>" >/dev/null 2>&1 \
  && echo "chrome-trace"

# 4. Try Chrome trace (array form)
jq -e 'type == "array" and (.[0] | has("ph") and has("ts"))' "<path>" >/dev/null 2>&1 \
  && echo "chrome-trace-array"

# 5. Try cpuprofile
jq -e 'has("nodes") and has("samples") and has("timeDeltas")' "<path>" >/dev/null 2>&1 \
  && echo "cpuprofile"

# 6. Try heap snapshot / heap timeline (same shape; timeline has non-empty samples)
jq -e '.snapshot.meta.node_fields and (.nodes | type == "array") and (.edges | type == "array") and (.strings | type == "array")' "<path>" >/dev/null 2>&1 \
  && jq -e '(.samples // []) | length > 0' "<path>" >/dev/null 2>&1 \
  && echo "heap-timeline" \
  || (jq -e '.snapshot.meta.node_fields' "<path>" >/dev/null 2>&1 && echo "heap-snapshot")

# 7. Try heap profile (sampling allocations)
jq -e '.head and .samples and (.samples | type == "array") and (.samples[0] | has("nodeId") and has("size"))' "<path>" >/dev/null 2>&1 \
  && echo "heap-profile"
```

Prefer `jq` for structural detection. Avoid loading the full file into
memory if it is > 50 MB — Chrome traces from real apps routinely exceed
200 MB and heap snapshots routinely exceed 400 MB. Use streaming parsers
(`jq --stream` or `gron`) for detection. For deep heap analysis, use the
dedicated [`scripts/heap-summary.mjs`](../scripts/heap-summary.mjs) and
[`scripts/heap-diff.mjs`](../scripts/heap-diff.mjs) — they parse once into
typed arrays and avoid jq's O(N) scan-per-question pattern.

## Sanity checks before trusting the file

| Check                                                                 | Why                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| File size > 1 KB                                                      | Empty or near-empty profiles capture nothing useful          |
| For React: `dataForRoots` is a non-empty array                        | A profile with no commits cannot be analysed                 |
| For Chrome: at least one event with `cat` containing `devtools.timeline` | Confirms it was saved from the Performance panel             |
| For Chrome: total wall-clock duration ≥ 100ms                          | Sub-100ms traces are too short to identify long tasks         |
| For heap snapshots: `node_count` > 1000                               | Snapshots from a totally empty page aren't useful             |
| For heap-leak diagnosis: ≥ 2 snapshots passed                          | One snapshot can't show growth — refuse leak diagnosis from a single file |
| For heap snapshots taken < 30 s apart with no action                  | Too close together — captures idle GC churn (mostly `code` eviction); ask for snapshots further apart or bracketing an action |
| Recording was made on a representative device profile                  | Ask if uncertain — desktop CPU 4× throttle ≠ real mobile     |

If any sanity check fails, surface it to the user before continuing — bad
inputs produce confidently wrong fixes.

## Examples

### Good — minimal React profile shape

```json
{
  "version": 5,
  "rendererID": 1,
  "dataForRoots": [
    {
      "rootID": 1,
      "displayName": "App",
      "commitData": [/* ... */],
      "operations": [/* ... */]
    }
  ]
}
```

### Good — Chrome trace shape

```json
{
  "traceEvents": [
    {"name": "RunTask", "cat": "devtools.timeline", "ph": "X",
     "ts": 1234567890, "dur": 142000, "tid": 1, "pid": 12345,
     "args": {"data": {"type": "RunTask"}}}
  ],
  "metadata": {"source": "DevTools", "startTime": "2026-04-01T..."}
}
```

### Good — minimal heap snapshot shape

```json
{
  "snapshot": {
    "meta": {
      "node_fields": ["type","name","id","self_size","edge_count","detachedness"],
      "node_types":  [["hidden","array","string","object","code","closure", "..."]],
      "edge_fields": ["type","name_or_index","to_node"],
      "edge_types":  [["context","element","property","internal","..."]]
    },
    "node_count": 7647888,
    "edge_count": 20950271
  },
  "nodes":   [/* flat int array, node_count * node_fields.length entries */],
  "edges":   [/* flat int array, edge_count * edge_fields.length entries */],
  "strings": [/* string table referenced by node `name` */]
}
```

### Bad — wrong file passed

```json
{ "name": "my-app", "version": "1.0.0", "dependencies": {} }
```

`package.json` is not a profile. Reject and ask the user for the correct file.

## Common mistakes

- **Trusting the extension.** React saves to `.json`; Chrome saves to
  `.json`. **Fix:** always inspect file shape.
- **Forgetting gzip.** Chrome offers compressed `.json.gz` for sharing.
  **Fix:** check magic bytes first.
- **Loading 200 MB into a single `Read` call.** **Fix:** use streaming jq
  or extract only the keys you need.
- **Loading a 500 MB heap snapshot via jq for whole-file analysis.**
  **Fix:** use [`scripts/heap-summary.mjs`](../scripts/heap-summary.mjs) and
  [`scripts/heap-diff.mjs`](../scripts/heap-diff.mjs) (single parse, typed-array
  iteration). Run with `node --max-old-space-size=4096` (raise to 8192 for
  > 700 MB files).
- **Diagnosing a leak from a single heap snapshot.** **Fix:** refuse and
  ask for ≥ 2 snapshots — phrase a single-snapshot finding as a baseline
  analysis, not a leak diagnosis.
