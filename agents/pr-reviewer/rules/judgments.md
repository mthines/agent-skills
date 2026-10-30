---
title: pr-reviewer — writing judgments.json
impact: HIGH
tags:
  - pr-reviewer
  - judgments
  - write-path
---

# pr-reviewer — writing `judgments.json`

`judgments.json` is the only file the model writes for Step 4; `finalize.mjs` derives the report, the inline comments, the gates, the verdict, and the write plan from it and `context.json`.

1. Copy [`schemas/judgments.example.json`](../schemas/judgments.example.json) and replace every value with this run's; drop `threads[]` entries on a first run and `impact_trace` when no consumer or dependency was traced.
2. Run `node "$AGENT_SUPPORT/pr-reviewer/scripts/validate-judgments.mjs" <judgments.json>` before `finalize.mjs`. It prints `OK`, or one line per error naming the JSON path and the rule it broke.
3. Fix only the paths it names. Open [`schemas/judgments.schema.json`](../schemas/judgments.schema.json) only for a field the error names and the table below does not explain; never read the whole schema.

```text
✗ cat schemas/judgments.schema.json   # 18 KB to learn a shape the example already shows
✓ cp schemas/judgments.example.json <dir>/judgments.json → edit → validate-judgments.mjs → finalize.mjs
```

**Why:** the schema is a validator's input, not a writing guide; an example plus a validator that names each bad path costs one small read and at most one fix round.

## The fields

**What the model still supplies**, via `judgments.json` (schema:
[`schemas/judgments.schema.json`](../schemas/judgments.schema.json), enforced by
`validate-judgments.mjs`):

| Field | Content |
| --- | --- |
| `summary` | The report's top-level `SUMMARY` scalar (≤ 240 chars) — the one line of prose `finalize.mjs` cannot derive from the candidates. |
| `gates.gate1` | Description-vs-code judgment (Gate 1). |
| `gates.gate4` | Self-review-signals judgment (Gate 4). |
| `gates.gate5` | Docs judgment (Gate 5). |
| `candidates[]`, `threads[]`, `lenses[]`, `memory` | Everything Steps 2/2.4–2.9c produced. `finalize.mjs` computes thresholds, the defer band, suppression, placement, caps, and the gates/verdict from these — it invents none of it. |
| `scanned_files` | `SCANNED_FILES` (Step 2), as repo-relative paths. `finalize.mjs` counts it against `context.scopePaths` for the report's `Checked` row. Omitted, the row drops its files-read part. |
| `impact_trace` | Per changed export the consumer-impact finder traced, and per dependency the dependency finder read (`symbol` = package, `path` = manifest), `{symbol, path, verified: [<files read that still hold>]}` ([`impact-graph.md` § In the report](./impact-graph.md#in-the-report)). `finalize.mjs` builds the report's `Reach`, `Dependencies`, and `Overlapping PRs` rows from it, `impact.json`, and the posted consumer-impact claims. |
| `candidates[].decide` | `true` on a claim that is the author's choice between two acceptable options — rendered `Decide: <title>` and counted `to decide`. Never together with `blocking`. |
| `candidates[].fix` | The remedy. When it is one line of ≤ 140 chars, the findings table shows it under the title; on a `decide` candidate, write the context for the choice instead. |
| `memory.indexed` | `MEMORIES_READ_COUNT` from Step 1.0: every LoreKit entry listed, all three families. The report's `<N> indexed` half; finalize renders the largest of it, `read[]`'s length, and the used count. |
| `memory.relevance_rules[]`, `memory.lessons_used[]`, `memory.read[]` | Copy `id`, `scope`, and `key` onto every entry. Take `id` from the `memory_list` / `memory_search` entry that surfaced the key — `memory_read` returns none. Take `scope` from the entry, or from the scope the call was made with when the entry omits it — a `scope="global"` `memory_list` does, and a ref without a scope is never cited. `read[]` lists `{ id, scope, key }` for every body this run fetched with `memory_read` (Steps 1.2a, 1.2d, 2.7b). The run trace opens each memory by these ([`run-telemetry.md § The memory`](./run-telemetry.md#the-memory)). |

## `context.render`

There is no second, hand-assembled JSON file: every slot the old manual payload table listed (`RUN.tier`, `RUN.depth`, `IMPACT`, `WITHHELD`, `MEMORIES_USED[]`, `FINDINGS[]`, … — full list at `report-rendering.md` § REPORT_BODY payload) is read straight off `context.json` and `judgments.json` by `finalize.mjs`. `context.render.*` is the one passthrough bag for facts `finalize.mjs` was never scoped to compute (`FIX_ALL_URL` — [`posting.md` § Fix-with-Agent0 buttons](./posting.md) — `IMPACT_IMAGE` — [`posting.md` § The impact image](./posting.md#the-impact-image) — `MEMORIES_SUMMARY`, `INTEGRATIONS`, `SKIPPED_FILES`, `RUN_ANOMALY`, `carriedForward`, and — only to override what `finalize/reach.mjs` builds from `scanned_files` / `impact_trace` — `COVERAGE` and `IMPACT`): set these on `context.json` before invoking `finalize.mjs`, never post-patch the rendered body.
