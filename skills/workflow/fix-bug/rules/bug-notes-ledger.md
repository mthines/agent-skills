---
title: Bug-Notes Ledger — Compaction-Survival Artefact
impact: HIGH
tags:
  - context-engineering
  - compaction
  - hypothesis-ledger
  - structured-memory
  - durable-state
---

# Bug-Notes Ledger

A durable artefact written to `.agent/<branch-or-slug>/bug-notes.md`. Captures hypotheses,
ruled-out causes, counterexamples, and the confidence trajectory across all phases. Designed to
survive compaction so a re-invoked `/fix-bug` (or `holistic-analysis`) does not re-explore dead
ends.

Source: [Effective context engineering for AI agents (Anthropic, Sep 2025)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
— "memory as structured note-taking … so Session 2 picks up where Session 1 left off."
Also [`anthropics/cwc-long-running-agents`](https://github.com/anthropics/cwc-long-running-agents).

## Contents

- [Path convention](#path-convention)
- [Lifecycle](#lifecycle)
- [Schema](#schema)
- [Read-on-entry, append-on-exit contract](#read-on-entry-append-on-exit-contract)

---

## Path convention

```text
.agent/<branch-or-slug>/bug-notes.md
```

- For full mode (Phase 6 created a worktree on branch `fix/<slug>`): `.agent/fix/<slug>/bug-notes.md`
- For `--analyse-only` mode (no worktree): `.agent/_in-progress/<slug>/bug-notes.md`. The slug is
  derived from the input (Linear ticket ID, Dash0 span ID, or hash of the user's input).

The ledger is consumed by:

- `holistic-analysis` (Phase 3 entry) — to skip ruled-out hypotheses.
- `aw-planner` (Phase 6 entry) — to plan around known counterexamples.
- `aw-executor` (Phase 6 entry) — to load counterexamples for the CEGIS refinement loop.
- `bug-fix-verifier` (Phase 7) — read-only.

---

## Lifecycle

| Event | Action |
|-------|--------|
| Phase 1 (after pre-flight) | **Create** the ledger with the partial Evidence Record + pre-flight findings |
| Phase 2 (after repro lock) | **Append** the repro path + status |
| Phase 3 (after holistic analysis) | **Append** the hypotheses table from holistic-analysis Phase 4 |
| Phase 4 (after confidence gate) | **Append** the confidence score + breakdown |
| Phase 5 (after branch decision) | **Append** the chosen branch (auto-fix / proposal / stop) |
| Phase 6 (after planner) | **Append** the planner's `plan.md` summary + plan confidence |
| Phase 6 (after each executor refinement round) | **Append** counterexamples (failing input/output) |
| Phase 7 (after verifier) | **Append** the verifier's verdict + evidence |
| Phase 8 (after telemetry verification) | **Append** the post-deploy rate decay |

A phase that re-runs (e.g., user says "try again") **must** preserve prior entries — only ever
append. Do not overwrite.

---

## Schema

```markdown
# Bug Notes — <slug>

## Evidence Record
<verbatim from Phase 2>

## Pre-flight findings (Phase 1.5)
<table from preflight.md output format>

## Reproduction (Phase 2.5)
- Path: <repro path>
- Command: <repro command>
- Status: <failing on HEAD | best-effort>
- Bisect result (if run): <commit sha + diff size>

## Hypotheses ledger
| # | Hypothesis | State | Evidence-for | Evidence-against | Source |
|---|------------|-------|--------------|------------------|--------|
| 1 | Null-deref in UserService.fetchUser | confirmed | repro fails on commit f3a2b1c | — | pre-flight + bisect |
| 2 | Race condition between fetch and cache write | ruled-out | — | repro is single-threaded; cache mock disabled | holistic-analysis Phase 4 |

States:
- `open` — under investigation.
- `confirmed` — supported by deterministic evidence (repro, bisect, telemetry).
- `ruled-out` — contradicted by deterministic evidence.

## Counterexamples
List of input/output pairs that broke a candidate fix:

| Round | Input | Expected | Actual | Notes |
|-------|-------|----------|--------|-------|
| 1 | `userId="0"` | user object | TypeError: cannot read 'id' of undefined | first executor patch missed `==="0"` edge case |

## Confidence trajectory
| Phase | Score | Breakdown | Trigger |
|-------|-------|-----------|---------|
| 4 (initial) | 78% | Evidence 80%, Root cause 75%, Fix 80% | Phase 4 first run |
| 4 (post-CEGIS round 2) | 92% | Evidence 95%, Root cause 90%, Fix 92% | Counterexample addressed |

## Outcome
<one of:>
- Auto-implemented: PR <url> on branch <name>. Verifier green. Telemetry decayed.
- Below gate: <X%> proposal returned for review. Missing evidence: <list>.
- Stopped: <reason>.
```

Use the schema strictly — phases that read the ledger rely on the section headers and table
columns being stable.

---

## Read-on-entry, append-on-exit contract

Every phase that reads or writes the ledger follows this contract:

1. **On entry**: read the full ledger. Use the `Hypotheses ledger` and `Counterexamples` sections
   to avoid re-exploring known dead ends.
2. **On exit**: append the phase's findings under the relevant section. Do not modify earlier
   sections — they are immutable history.
3. **On compaction**: the ledger survives. The phase re-reads the ledger and resumes.

This is the central compaction-survival mechanism. Without it, a long bug investigation that
spans context compactions will silently re-explore the same hypotheses each turn.
