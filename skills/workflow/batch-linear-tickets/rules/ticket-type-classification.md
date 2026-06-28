---
name: ticket-type-classification
description: Classify each Linear ticket as bug or feature so Phase 1 can dispatch the right analysis pipeline
priority: HIGH
---

# Ticket-Type Classification

Phase 1 needs to know whether each ticket is a **bug** (route through investigator +
rca-investigator) or a **feature** (route through investigator only). Classification is
mechanical and cheap — it reads Linear labels and falls back to a status when labels are
ambiguous or absent.

---

## Classification Rules (in order)

### 1. Explicit flag override (highest priority)

If the user passed `--type=bug` or `--type=feature` to the skill, every ticket in the batch
inherits that type. Skip the label check entirely.

If the user passed `--type=auto` (or no flag), continue with the label-based rules below.

### 2. Label-based classification (default)

Fetch each ticket's labels via `mcp__claude_ai_Linear__get_issue` (or the equivalent
`mcp__linear-server__*` tool). Match the label set against this table:

| Has any label in this set | Type |
|---------------------------|------|
| `bug`, `defect`, `incident`, `regression`, `hotfix`, `fix`, `kind/bug` | **bug** |
| Anything else | **feature** |

The match is case-insensitive and matches whole label names (not substrings).

### 3. Fallback when no labels are present

If a ticket has **zero labels**, classification is **unknown**:

- The ticket's status in the Phase 3 summary table is `Needs Info`.
- The user is asked to either (a) add a label in Linear and re-run, or (b) re-invoke with an
  explicit `--type=bug` / `--type=feature`.

Do not guess from the title or description text. Title heuristics ("Add X", "Fix Y") are
unreliable across workspaces and team conventions; explicit labels or explicit flags are
required.

---

## Workspace Customization

If your Linear workspace uses non-standard labels (e.g. `kind/incident` instead of `incident`):

1. **Pass `--type=` explicitly** for every batch — simplest, no skill edits needed.
2. **Or edit the bug-label set** in this file by adding your workspace's labels to the bug row
   of the table above.

Avoid adding workspace-specific feature labels — anything that isn't a bug label is a feature
by default, so the bug list is the only one that needs maintenance.

---

## Output of Classification

Phase 1 carries the classification forward in two places:

1. **Per-ticket type field** in the analysis result (used to pick the bug vs feature pipeline
   in Step 1c and the confidence mode in Step 1d).
2. **Type column in the summary table** (rendered in Phase 3 via
   [batch-approval-ux](./batch-approval-ux.md)).

The user sees the inferred type before approving. If a ticket was mis-classified, the user can
either: cancel and re-run with the right `--type=`, or approve and let the executor proceed
(the executor doesn't care about type — only Phase 1's analysis depth was affected).

---

## Edge Cases

- **Ticket has both bug AND feature labels.** Bug wins (it's the more conservative routing —
  holistic-analysis is additive, not destructive).
- **Ticket has a parent ticket of the other type.** The ticket's own labels still drive
  classification. Parent ticket type is informational only.
- **Linear MCP fetch fails for one ticket.** Mark that ticket `Needs Info` and continue with
  the others. Surface the fetch failure in the gaps section.
- **All tickets in the batch are unclassified.** Stop Phase 1 and ask for an explicit `--type=`
  flag before continuing — running an empty batch wastes tokens.
