---
title: Trim Policy — What is Safe to Drop from an Array
impact: MEDIUM
tags:
  - trim
  - cardinality
  - token-economics
---

# Trim Policy

`trim` mode caps the length of arrays of *data points* nested inside
`artifacts.*` subtrees so a fixture file stays under a manageable
size when the bloat lives in array cardinality (e.g. 127-entry
attribute lists, 38-entry log-record arrays, 50-entry time-series
sample lists) rather than in long strings. The implementation lives
in [`scripts/trim.py`](../scripts/trim.py).

`trim` is the **only** mode that reduces array cardinality, and it
**never modifies any string** under any condition — message
`content`, panel descriptions, tool arguments, and every other
string field stay byte-identical. The unit of work is "drop a
trailing array entry," never "shorten a string."

## Contents

- What is trimmable — the three conditions an array must satisfy.
- Strict allowlist of data-point keys — no default fallback.
- Protected subtrees — the never-descend list.
- Order preservation — keep-first-N rule.
- Indent preservation — detect from source, do not normalise.
- Idempotency — second run is a no-op.
- Decision flow — full lookup table for each array.
- Common mistakes — pitfalls and their fixes.

## What is trimmable

An array is **trimmable** when all of:

1. Its ancestry includes a key named `artifacts` (i.e. the array
   sits somewhere under `$.messages[*].artifacts.*` or any other
   `artifacts.*` subtree).
2. Its **immediate parent key** is on the strict data-point
   allowlist (see below). If the parent key is not on the list, the
   array is left alone even if it is huge. This is by design —
   structural arrays inside artifacts (`panels`, `widgets`,
   `queries`, …) must stay intact for fixture consumers.
3. `len(array) > budget` for that parent key.

If any condition fails, leave the array untouched. Recurse through
its elements regardless — nested artifact arrays still get
evaluated.

## Strict allowlist of data-point keys

Defaults baked into `trim.py`. **There is no `default` fallback** —
keys not on this list are never trimmed:

| Key             | Budget | What it covers                                              |
| --------------- | -----: | ----------------------------------------------------------- |
| `webEvents`     |      2 | OTLP web-events list response wrappers                      |
| `logRecords`    |      2 | OTLP log records inside scope-logs; high-cardinality        |
| `scopeLogs`     |      1 | Always a single scope per resource in practice              |
| `scopeSpans`    |      1 | Same as `scopeLogs` — practically a singleton               |
| `resourceSpans` |      1 | Same as `scopeLogs`                                         |
| `series`        |      3 | Time-series response                                        |
| `dataPoints`    |      5 | OTLP metric data points                                     |
| `points`        |      5 | Generic data points (chart data, line data)                 |
| `samples`       |      5 | PromQL sample arrays                                        |
| `metrics`       |      3 | Generic metrics wrapper                                     |
| `events`        |      2 | Event list                                                  |
| `spans`         |      2 | Span list                                                   |
| `rows`          |      3 | Tabular query response rows                                 |
| `records`       |      3 | Generic records wrapper                                     |
| `results`       |      3 | Generic results array                                       |
| `attributes`    |      5 | Attribute-comparison / attribute-list responses             |
| `catalog`       |      3 | Metric catalog responses                                    |

Override or extend with repeated `--max-array key=N` flags. Adding
a key not on the default list via `--max-array` is how you opt that
key into trimming for a specific corpus — explicit and visible.

To **disable** trimming for a key, raise its budget high (e.g.
`--max-array attributes=10000`). There is no "skip this key" syntax
by design (explicit is better than implicit).

## Protected subtrees

These paths are **never trimmed**, regardless of length:

| Path                                | Why protected                                           |
| ----------------------------------- | ------------------------------------------------------- |
| `$.messages`                        | Conversation order is fixture-load-bearing              |
| `$.thread.*`                        | Thread metadata; arrays here describe identity          |
| Any `$.<top-level>` outside artifacts | If it is not inside an artifact response, leave alone |

A fixture consumer that relies on "50 messages, 22 tool calls, 8
assistant turns" must still be able to assert those counts after
`trim` ran. The script's tree walker tracks ancestry and refuses
to enter a protected top-level subtree unless an `artifacts`
ancestor sits in between.

## Order preservation

`trim` always keeps the **first N** entries in source order. It
never sorts, shuffles, or samples. Test fixtures rely on order
(chronological events, ranked search results, paginated cursors) —
randomised selection would create non-reproducible diffs.

## Indent preservation

`trim` detects the source file's indentation (tab vs N-space) and
renders the output with the same indentation. A tab-indented input
stays tab-indented; a 2-space input stays 2-space. The motivation:
running `trim` on a file with zero in-budget arrays must be a true
no-op, not a re-indentation. Use `normalize` mode for indentation
changes; never bundle the two.

Override with `--indent <N>` or `--indent tab` when explicitly
desired.

## Idempotency

A second run with the same flags is a no-op. The script asserts
this by comparing the rendered output to the file on disk before
writing and emitting `no changes` to stderr if they match. Verify
by re-running:

```bash
python3 scripts/trim.py --in-place path/to/mock.json
python3 scripts/trim.py --in-place path/to/mock.json   # prints "no changes"
```

## Decision flow

| Signal                                                              | Action                          |
| ------------------------------------------------------------------- | ------------------------------- |
| Array is outside any `artifacts.*` subtree                          | Leave alone (recurse children)  |
| Array is under `$.messages` / `$.thread.*` (and not inside artifacts) | Leave alone (recurse children)  |
| Array's parent key is NOT on the allowlist                          | Leave alone (recurse children)  |
| Array's parent key IS on the allowlist AND length ≤ budget          | Leave alone (recurse children)  |
| Array's parent key IS on the allowlist AND length > budget          | Keep first N, drop the rest     |
| **Any string field, anywhere**                                      | **Leave alone (never modify)**  |

## Common mistakes

- **Trimming a structural array because it sits inside `artifacts`.**
  A `panels` array of dashboard panels is not data points — it is
  the dashboard's shape. **Fix:** the allowlist is strict; `panels`
  is not on it. Do not add a `default` fallback budget.
- **Truncating message `content`.** Out of scope for `trim`. The
  user expects every `content` string to round-trip byte-identical.
  Use `shrink` mode only when string truncation is explicitly
  wanted, and even then `content` should be on the protected list.
- **Re-ordering before trimming.** Don't. The first N entries are
  the first N entries in source order. If a test depends on the
  *last* N, the test was already brittle; raise the budget instead.
- **Bundling trim with shrink.** They are orthogonal modes. Run
  them in sequence for max reduction only when both effects are
  wanted; never merge them.
- **Adding a default fallback.** Tempting when a corpus has many
  un-recognised data-point arrays, but it risks silently trimming
  structural arrays. **Fix:** add specific keys via `--max-array
  newKey=N` instead.
- **Bundling indentation normalisation.** `trim` preserves source
  indentation. If you also want to normalise (tab → 2-space), run
  `normalize` afterwards.
