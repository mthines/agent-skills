---
name: batch-approval-ux
description: Summary table format, status values, and approval commands for batch ticket processing — handles both bug and feature tickets
priority: MEDIUM
---

# Batch Approval UX

How to present batch analysis results and collect user approval. Status values map directly to
the per-ticket confidence-gate outcomes from Phase 1 — `confidence(analysis)` for bugs,
`confidence(plan)` for features.

---

## Status Values

Each ticket gets one of these statuses after Phase 1 returns:

| Status | Source | Meaning | Can Approve? |
|--------|--------|---------|--------------|
| **Ready** | Phase 1 confidence ≥ 90% | Clear proposal, gate cleared | Yes |
| **Needs Review** | Phase 1 confidence 70–89% | Proposal has concerns | Yes (with warning) |
| **Needs Info** | Investigator returned an Information Gap, ticket has no labels (unclassified), or Linear fetch failed | Evidence extraction or classification blocked | **No** — must resolve gaps first |
| **Stopped** | Phase 1 confidence < 70% | No safe proposal — needs human direction | **No** — surface to user before any approval |
| **Blocked** | Cross-ticket correlation found a dependency | Depends on another ticket | **No** — must resolve blocker first |

---

## Summary Table Format

```markdown
## Batch Ticket Analysis

| # | Ticket | Type | Title | Confidence | Scope | Status |
|---|--------|------|-------|------------|-------|--------|
| 1 | SUP-123 | bug | Brief title | 95% | Low (2 files) | Ready |
| 2 | ENG-456 | bug | Brief title | 82% | Med (5 files) | Needs Review |
| 3 | AI-1165 | feature | Brief title | 91% | Med (4 files) | Ready |
| 4 | SUP-789 | bug | Brief title | — | — | Needs Info |
| 5 | ENG-100 | feature | Brief title | 64% | High (8 files) | Stopped |
| 6 | DASH-99 | ? | Brief title | — | — | Needs Info (unclassified) |
```

The **Type** column shows the result of Phase 1's classification step. `?` means the ticket has
no labels and no `--type=` flag was passed.

---

## Detail Sections

For each ticket, provide a collapsible detail block immediately after the table. The content is
shaped by ticket type:

### Bug detail block

```markdown
<details>
<summary>#1 SUP-123 (bug): Title — 95% — Ready</summary>

**Symptom:** One-line summary
**Root cause:** From the rca-investigator Root-Cause Record
**Proposed fix:** What will change, in which files
**Affected files:** file1.ts:42, file2.ts:100
**Confidence:** Evidence X% | Root cause certainty Y% | Fix confidence Z%
</details>
```

### Feature detail block

```markdown
<details>
<summary>#3 AI-1165 (feature): Title — 91% — Ready</summary>

**Intent:** One-line summary of what the feature does
**Acceptance criteria:**
- Criterion 1
- Criterion 2
**Proposed approach:** What components are touched, the integration plan
**Affected files:** file1.tsx:42, file2.tsx (new)
**Confidence:** Completeness X% | Feasibility Y% | No ambiguity Z%
</details>
```

---

## Information Gaps Section

If any ticket has `Needs Info` status, present gaps prominently before the approval prompt:

```markdown
### Information Needed Before Proceeding

**SUP-789** (bug): Missing reproduction steps.
→ Can you get repro steps from the customer, or share the affected org/environment?

**ENG-100** (feature): Acceptance criteria not specified in the ticket.
→ Can you list the user-visible behaviors the feature must produce?

**DASH-99** (unclassified): Ticket has no labels and no `--type=` flag was passed.
→ Add a Linear label (e.g., `bug` or `feature`) or re-run with `--type=bug` / `--type=feature`.
```

---

## Approval Commands

Present these options to the user:

| Command | Effect |
|---------|--------|
| **"all"** | Proceed with all `Ready` tickets (Phase 4 dispatches `aw-planner` + `aw-executor`) |
| **"1, 3, 5"** | Proceed with specific ticket numbers |
| **"all including risky"** | Proceed with `Ready` + `Needs Review` tickets |
| **"none"** | Stop — user wants to review manually |

**Rules:**

- `Needs Info`, `Stopped`, and unclassified tickets cannot be approved until the underlying
  issue is resolved.
- `Blocked` tickets cannot be approved until the blocker is resolved.
- If the user provides missing info, re-run only the relevant Phase 1 steps for those tickets
  and re-present the table.
- If the user provides a `--type=` override after initially running with `--type=auto`, only
  re-run Phase 1 for tickets whose classification would change.
