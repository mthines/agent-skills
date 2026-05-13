---
title: Drift Detection — Clustering, Severity, Report Format
impact: HIGH
tags:
  - drift
  - clustering
  - report-format
---

# Drift Detection

Take a set of shape fingerprints and produce a structured drift
report. The algorithm is implemented in
[`scripts/diff-shapes.py`](../scripts/diff-shapes.py) — this rule
documents the clustering strategy, severity rubric, and the canonical
report format.

## Contents

- Clustering — grouping files by fingerprint match and picking the reference.
- Per-outlier diff — `missing` / `extra` / `type_drift` categories.
- Severity rubric — `HIGH` / `MED` / `LOW` rules.
- Report format — exact text emitted in `analyze` mode.
- Decision flow — what to print for each cluster shape.
- Common mistakes — pitfalls and their fixes.

## Clustering

1. Group files by **exact fingerprint match**. Each group is a
   cluster.
2. The largest cluster becomes the **reference cluster**.
3. Tie-breaker, in order:
   - Most files in the cluster (already handled by step 1).
   - Most recently modified file in the cluster (by `mtime`).
4. Every other cluster is an **outlier cluster**.

## Per-outlier diff

For each outlier cluster, compute the key-path delta against the
reference:

- **Missing**: key paths the outlier lacks that the reference has.
- **Extra**: key paths the outlier has that the reference lacks.
- **Type drift**: key paths present in both but with a different
  type (e.g. `string` vs `null`, `number` vs `string`).

Sort delta entries by **frequency in the corpus** — the missing key
that affects the most files is reported first.

## Severity rubric

Assign one severity to each drift site (a single key path).

| Severity | Rule                                                                                  |
| -------- | ------------------------------------------------------------------------------------- |
| `HIGH`   | Type drift on the same key path (string vs number, etc.). Breaks any type-checked consumer. |
| `MED`    | Missing required-looking key (no `?` in name, not `null` anywhere) in > 25 % of files.   |
| `LOW`    | Missing optional-looking key, or extra key in < 25 % of files. Formatting-only drift.    |

A type drift is always `HIGH` regardless of frequency — even one
mock with the wrong type can crash a strict consumer.

## Report format

Use this exact structure for `analyze` mode output:

```
Optimize-Mock-Data Report
=========================
Corpus: <path> (<N> files)
Clusters: <C> (reference: <ref-cluster-size> files / outlier: <outlier-count>)

Reference cluster (<ref-cluster-size> files):
  - <file>
  - <file>
  ...
Fingerprint sha256: <hash>

Drift sites (<K> total — H:<n> M:<n> L:<n>):

  HIGH — messages[].cost                                  (3/22 files)
    Reference type: object{dimensions:array, totalCost:number}
    Outlier type:   null
    Files: invoke-agent-opencode-2-init.json, invoke-agent-0-response.json, ...

  MED — messages[].userId                                 (4/22 files missing)
    Reference type: string
    Files: invoke-agent-0-response.json, ...

  LOW — thread.networkLevel                               (2/22 files missing)
    Reference type: string
    Files: ...

Formatting:
  Indentation: 18 files use 2-space, 4 files use tabs.
  Trailing newline: 20 files present, 2 missing.
  Line endings: all LF.

Recommendations:
  1. Normalize indentation to 2-space (run `normalize` mode).
  2. Decide policy for `messages[].cost` — either backfill with null or remove from outliers.
  3. Audit `messages[].userId` — likely required for auth-bearing fixtures.

Summary: 22 files / 3 clusters / 5 drift sites (HIGH:1 MED:2 LOW:2)
```

## Decision flow

| Signal                                                      | Action                                              |
| ----------------------------------------------------------- | --------------------------------------------------- |
| 1 cluster, no drift                                         | Print "No drift detected." and exit                 |
| 2+ clusters, all drift `LOW`                                | Suggest `normalize` mode only                       |
| Any drift `MED` or higher                                   | Print recommendations; do not silently fix          |
| Type drift detected                                         | Always `HIGH`, even if 1/N                          |
| Reference cluster contains < 50 % of files                  | Warn: "No majority shape — review manually"         |

## Common mistakes

- **Treating outlier as the reference.** When the user added the
  newest file, it is usually the outlier, not the reference. **Fix:**
  always pick the largest cluster.
- **Reporting per-file diffs.** A 22-file corpus could produce 22²
  diffs. **Fix:** report per-cluster against the reference only.
- **Counting formatting as drift.** Indentation and trailing newlines
  are not shape drift — they are formatting. Report them separately.
- **Bailing on the first drift.** The point of the report is to
  enumerate everything. **Fix:** collect all drift sites, then sort
  by severity, then emit.
