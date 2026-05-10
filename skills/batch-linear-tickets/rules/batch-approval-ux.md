---
name: batch-approval-ux
description: Summary table format, status values, and approval commands for batch ticket processing
priority: MEDIUM
---

# Batch Approval UX

How to present batch analysis results and collect user approval. The status values map directly
to `/fix-bug`'s confidence-gate outcomes.

---

## Status Values

Each ticket gets one of these statuses after Phase 1's `/fix-bug --analyse-only` returns:

| Status | Source | Meaning | Can Approve? |
|--------|--------|---------|--------------|
| **Ready** | `/fix-bug` confidence >= 90% | Clear proposal, gate cleared | Yes |
| **Needs Review** | `/fix-bug` confidence 70–89% | Proposal has concerns | Yes (with warning) |
| **Needs Info** | `/fix-bug` returned an Information Gap from the investigator | Evidence extraction blocked | **No** — must resolve gaps first |
| **Stopped** | `/fix-bug` confidence < 70% | No safe proposal — needs human direction | **No** — surface to user before any approval |
| **Blocked** | Cross-ticket correlation found a dependency | Depends on another ticket | **No** — must resolve blocker first |

---

## Summary Table Format

```markdown
## Batch Ticket Analysis

| # | Ticket | Title | Confidence | Scope | Status |
|---|--------|-------|------------|-------|--------|
| 1 | SUP-123 | Brief title | 95% | Low (2 files) | Ready |
| 2 | ENG-456 | Brief title | 82% | Med (5 files) | Needs Review |
| 3 | SUP-789 | Brief title | — | — | Needs Info |
| 4 | ENG-100 | Brief title | 64% | High (8 files) | Stopped |
```

---

## Detail Sections

For each ticket, provide a collapsible detail block immediately after the table. The content is
copied verbatim from `/fix-bug --analyse-only`'s output:

```markdown
<details>
<summary>#1 SUP-123: Title — 95% — Ready</summary>

**Symptom:** One-line summary
**Root cause:** From holistic-analysis
**Proposed fix:** What will change, in which files
**Affected files:** file1.ts:42, file2.ts:100
**Confidence:** Evidence X% | Root cause certainty Y% | Fix confidence Z%
</details>
```

---

## Information Gaps Section

If any ticket has `Needs Info` status, present gaps prominently before the approval prompt:

```markdown
### Information Needed Before Proceeding

**SUP-789**: Missing reproduction steps.
→ Can you get repro steps from the customer, or share the affected org/environment?

**ENG-100**: Ambiguous scope — could be a frontend or backend issue.
→ Which side is the user experiencing the problem on?
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

- `Needs Info` and `Stopped` tickets cannot be approved until gaps / direction are resolved.
- `Blocked` tickets cannot be approved until the blocker is resolved.
- If user provides missing info, re-run `/fix-bug --analyse-only` for those tickets only and
  re-present the table.

