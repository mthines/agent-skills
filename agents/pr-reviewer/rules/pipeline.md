---
title: Deterministic pipeline — artifact contracts, --dry-run, --isolated
impact: HIGH
tags:
  - pr-reviewer
  - deterministic-pipeline
  - dry-run
  - isolated
---

# Deterministic pipeline

The single home for the pr-reviewer deterministic pipeline's cross-cutting contracts:
what `--dry-run` and `--isolated` mean, the artifact flow between
`prepare-review.mjs` → judgment → `finalize.mjs` → `execute-write-plan.mjs`, and
the write-plan op → MCP tool mapping. This rule owns the CONTRACT; each script's
own header owns its CLI surface, and `agents/pr-reviewer.md` Step 0 / Step 4
own where the flags are read and where the carve-outs apply.

## Contents

- [`--dry-run`](#--dry-run)
- [`--isolated`](#--isolated)
- [Artifact flow](#artifact-flow)
- [Write-plan op → MCP tool map](#write-plan-op--mcp-tool-map)

## `--dry-run`

A full pipeline run that stops **after** `finalize.mjs` writes its rendered
artifacts and **before** `execute-write-plan.mjs` — or the agent's own Step 4
— would issue a single GitHub or LoreKit write. Verified at plan time: no
`--dry-run` / `--preview` / no-write mode existed anywhere in `pr-reviewer.md`
or `branch-reviewer.md` before this pipeline; Step 4c's state write was
documented as **unconditional**, so this is the one explicit carve-out, not a
silent exception discovered later.

**Zero writes means zero, not "zero unless something else needs it":**

| Object | Normal behavior | Under `--dry-run` |
| --- | --- | --- |
| Sticky report comment | `POST`/`PATCH` the comment | Rendered to `$(scratchRoot())/<run-id>/report-body.md`, never posted |
| Review (inline comments) | `POST /pulls/{n}/reviews` | Rendered to `$(scratchRoot())/<run-id>/inline-comments.json`, never posted |
| Thread resolve / reply | `resolve_review_thread` mutation, reply comment | Classified to `$(scratchRoot())/<run-id>/thread-plan.json`, no mutation issued |
| PR-state record | `mcp__lorekit__memory_write` (Step 4c, unconditional otherwise) | Not written |
| Knowledge / hotspot records | `mcp__lorekit__memory_write` (Step 2.7b / memory.md) | Not written |
| `reviewer-comment-relevance` outcome | `mcp__lorekit__memory_write` (Step 2.9c) | Not written |

Every pre-flight assertion still runs (`payload_is_safe` and its successors,
line-validity, the Gate 3 tri-state re-evaluation against the *would-be*
thread resolutions) — a dry-run that skipped its own safety checks would
rehearse a payload that was never actually validated, which defeats the
point of rehearsing at all.

`execute-write-plan.mjs --dry-run` (Phase 4) makes this mechanical: the
write-plan is built exactly as it would be for a real run, and the script
spawns zero `gh` processes and returns zero LoreKit ops to execute —
asserted by its own `--self-test`.

## `--isolated`

Comparable repeat runs — the A/B harness (`scripts/eval/ab-review.mjs`) and
the finalize shadow run both need the SAME PR reviewed N times with no run
depending on what a prior run in the series left behind. `--isolated`:

1. Skips the Step 0.7 LoreKit state-record read entirely. `PRIOR_RUN=none`,
   `IS_RE_REVIEW=false` unconditionally — no fallback to the sticky's footer
   SHA either, because that fallback is itself a form of carried state.
2. Forces `RUN_MODE=full` (the D1/D6 first-run trigger fires on every
   invocation, `route-depth.mjs`'s `firstRun` input is always `true`).
3. **Requires `--pin-head <sha>`.** `prepare-review.mjs` compares the pin
   against the live `headRefOid` and hard-stops with no review on a
   mismatch: `head moved: pinned <a> live <b>`. A pinned run that silently
   reviewed a moved head would poison every metric an A/B or shadow
   comparison computes from it — this is not a narrower review, it is a
   review of a different commit wearing the pinned one's label.

`--isolated` says nothing about writes on its own — pair it with `--dry-run`
for a comparability run that is also side-effect-free (the A/B harness and
the shadow run always pass both together).

## Artifact flow

```
review-context.json  (prepare-review.mjs)
        │
        ▼
judgments.json        (the model — single-context agent OR /pr-review --fanout)
        │
        ▼  validate-judgments.mjs (schema SSOT)
        │
        ▼
finalize-result.json + report-body.md + pointer-body.md + inline/*.md + write-plan.json
        │  (finalize.mjs)
        ▼
write-result.json     (execute-write-plan.mjs, or the agent executing ops over MCP)
```

Each artifact's shape, and the op → MCP tool mapping below, are filled in as
each phase lands (Phase 2 onward); this section is the index they attach to.

## Write-plan op → MCP tool map

Filled in at Phase 4 (`execute-write-plan.mjs`). Placeholder table so a reader
mid-pipeline can see the shape that is coming, rather than finding a gap:

| `write-plan.json` op | `gh` path | `mcp__*` tool |
| --- | --- | --- |
| `sticky.upsert` | *(Phase 4)* | *(Phase 4)* |
| `review.create` | *(Phase 4)* | *(Phase 4)* |
| `thread.reply` | *(Phase 4)* | *(Phase 4)* |
| `thread.resolve` | *(Phase 4)* | *(Phase 4)* |
| `lorekit.write` | *(Phase 4)* | *(Phase 4)* |
