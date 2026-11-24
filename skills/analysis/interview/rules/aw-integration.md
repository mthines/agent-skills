---
title: aw Integration — Default-On Delegation Contract
impact: MEDIUM
tags:
  - autonomous-workflow
  - aw
---

# aw Integration

`aw` runs this skill by default on Full and Lite tasks, and on Micro only with `--interview`; `--no-interview` skips it.
The skill itself decides whether to ask: when the request or an existing spec already answers every `blocking` question, it asks nothing and writes the brief.

```text
Skill("interview")   # writes .agent/{branch}/brief.md + a verdict
→ ready | ready-with-assumptions : aw lifts the restatement and assumptions, skips its inline gate
→ blocked                        : aw halts and reports the unknown, even under --no-confirm
```

## Contract — change these together

1. The verdicts `ready`, `ready-with-assumptions`, and `blocked`.
2. The classes `blocking` and `advisory`, shared with `aw` Phase 0's inline gate (the fallback when this skill is not installed).
3. The brief headings `aw` reads: `Restatement` (with `[user-stated]` / `[inferred]` tags), `In scope`, `Out of scope (non-goals)`, `Success criteria`, `Constraints`, `Assumptions (advisory)`, and `Affected areas`.

Renaming any of them means updating, in the same change, these `autonomous-workflow` files: `rules/phase-0-validation.md` (anchor `scope-alignment`), `rules/phase-1-planning.md` (anchor `scope-brief`), `aw/rules/full-tier.md` (Step 1, item 5), and the Lite rows of `SKILL.md` § Lite and Micro path.
