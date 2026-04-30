---
name: batch-approval-ux
description: Summary table format, status values, and approval commands for batch ticket processing
priority: MEDIUM
---

# Batch Approval UX

How to present batch investigation results and collect user approval.

---

## Status Values

Each ticket gets one of these statuses after investigation:

| Status | Meaning | Can Approve? |
|--------|---------|--------------|
| **Ready** | Confidence >= 90%, clear proposal | Yes |
| **Needs Review** | Confidence 70-89%, proposal has concerns | Yes (with warning) |
| **Needs Info** | Information gaps prevent confident analysis | **No** — must resolve gaps first |
| **Blocked** | Depends on another ticket or external factor | **No** — must resolve blocker first |

---

## Summary Table Format

```
## Batch Ticket Analysis

| # | Ticket | Title | Confidence | Scope | Status |
|---|--------|-------|------------|-------|--------|
| 1 | SUP-123 | Brief title | 95% | Low (2 files) | Ready |
| 2 | ENG-456 | Brief title | 82% | Med (5 files) | Needs Review |
| 3 | SUP-789 | Brief title | — | — | Needs Info |
```

---

## Detail Sections

For each ticket, provide a collapsible detail block immediately after the table:

```
<details>
<summary>#1 SUP-123: Title — 95% — Ready</summary>

**Problem:** One-line summary
**Root cause:** [Certainty marker] — Description
**Proposed fix:** What will change, in which files
**Files:** file1.ts:42, file2.ts:100
**Risk:** What could go wrong
**Confidence:** Correctness 97% | Completeness 93% | No Regressions 95%
</details>
```

---

## Information Gaps Section

If any ticket has "Needs Info" status, present gaps prominently before the approval prompt:

```
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
| **"all"** | Proceed with all "Ready" tickets |
| **"1, 3, 5"** | Proceed with specific ticket numbers |
| **"all including risky"** | Proceed with Ready + Needs Review tickets |
| **"review plans"** | Proceed, but pause at Phase 5 to inspect `plan.md` files before dispatching executors |
| **"none"** | Stop — user wants to review manually |

**Rules:**
- "Needs Info" tickets cannot be approved until gaps are resolved
- "Blocked" tickets cannot be approved until the blocker is resolved
- If user provides missing info, re-run investigation for those tickets only
- After re-run, present an updated table and ask again
