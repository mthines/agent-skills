---
title: aw Integration — On-Demand Delegation Contract
impact: MEDIUM
tags:
  - autonomous-workflow
  - aw
---

# aw Integration

`aw` runs this skill on a Full-tier task only with `--interview` or when two or more `blocking` questions remain after its short Phase 0; `--interview` also forces it on Micro and Lite, and `--no-interview` skips it.

```text
Skill("interview")   # writes .agent/{branch}/brief.md + a verdict
→ ready | ready-with-assumptions : aw lifts the restatement and assumptions, skips its inline gate
→ blocked                        : aw halts and reports the unknown, even under --no-confirm
```

## Contract — change these together

1. The verdicts `ready`, `ready-with-assumptions`, and `blocked`.
2. The classes `blocking` and `advisory`, shared with `aw` Phase 0's inline gate (the fallback when this skill is not installed).
3. The brief headings `aw` Phase 1 reads: `Restatement` (with `[user-stated]` / `[inferred]` tags), `In scope`, `Out of scope (non-goals)`, `Success criteria`, `Assumptions (advisory)`, and `Affected areas`.

Renaming any of them means updating `autonomous-workflow` `rules/phase-0-validation.md` (anchor `scope-alignment`) and `rules/phase-1-planning.md` (anchor `scope-brief`) in the same change.
