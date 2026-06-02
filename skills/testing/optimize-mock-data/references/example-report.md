---
title: Example Report — Realistic analyze Output
tags:
  - example
  - report
---

# Example Report

A realistic `analyze` run against a 22-file agent0 fixture corpus
where one new mock was just added with slightly drifted shape.

## Command

```bash
python3 scripts/diff-shapes.py components/ui/src/agent0/mocks/
```

## Output

```
Optimize-Mock-Data Report
=========================
Corpus: components/ui/src/agent0/mocks/ (22 files)
Clusters: 3 (reference: 18 files / outlier: 2 clusters of 3 + 1)

Reference cluster (18 files):
  - invoke-agent-artifacts-dashboards.json
  - invoke-agent-artifacts-dashboards-2.json
  - invoke-agent-artifacts-dashboards-3.json
  - invoke-agent-artifacts-github.json
  - invoke-agent-artifacts-github-2.json
  - invoke-agent-opencode-0-init.json
  - ... (12 more)
Fingerprint sha256: 4b1e8e2c…a9f1

Drift sites (5 total — H:1 M:2 L:2):

  HIGH — messages[].cost.dimensions[].cost                (3/22 files)
    Reference type: number
    Outlier type:   string
    Files:
      - invoke-agent-artifacts-dashboards-4.json
      - invoke-agent-0-response.json
      - invoke-agent-opencode-3-done.json

  MED — messages[].userId                                 (4/22 files missing)
    Reference type: string
    Files:
      - invoke-agent-opencode-2-init.json
      - invoke-agent-opencode-2-loading.json
      - invoke-agent-opencode-2-midway.json
      - invoke-agent-0-response.json

  MED — thread.networkLevel                               (3/22 files missing)
    Reference type: string
    Files:
      - invoke-agent-opencode-2-init.json
      - invoke-agent-opencode-2-loading.json
      - invoke-agent-opencode-2-midway.json

  LOW — messages[].timezoneOffset                         (5/22 files have, 17 lack)
    Reference type: <not present in reference>
    Note: only on `role=human` messages; consider documenting as optional.

  LOW — messages[].contexts                               (1/22 files)
    Reference type: array
    Note: present in the dashboards-4 mock only — review whether other mocks should backfill.

Formatting:
  Indentation: 18 files use 2-space, 4 files use tabs.
  Trailing newline: 22 files present.
  Line endings: all LF.

Recommendations:
  1. HIGH — type-drift on `messages[].cost.dimensions[].cost`. Pick a single
     type (number is the majority); convert the 3 outliers.
  2. Backfill `messages[].userId` on the 4 mocks that lack it, OR mark it
     officially optional in the consuming type.
  3. Normalize indentation: `python3 scripts/normalize.py --in-place ...`.

Summary: 22 files / 3 clusters / 5 drift sites (HIGH:1 MED:2 LOW:2)
```

## How the agent should follow up

1. Show the report verbatim — do not paraphrase.
2. Ask the user **one** question: "Run `normalize` to fix
   formatting-only drift (LOW), or hand-review the HIGH/MED items
   first?"
3. Never silently mutate files after `analyze`. Always require an
   explicit `normalize` or `shrink` invocation.
