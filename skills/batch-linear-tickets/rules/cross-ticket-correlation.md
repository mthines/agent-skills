---
name: cross-ticket-correlation
description: Detect shared root causes, duplicate tickets, file conflicts, and dependency ordering across multiple tickets
priority: HIGH
---

# Cross-Ticket Correlation

After all parallel `/fix-bug --analyse-only` calls return, analyze the results across tickets to
detect patterns that affect execution strategy. The inputs to this phase are the analyses
returned from `/fix-bug` — each contains an Evidence Record (with affected files), a root cause,
a proposed change, and a confidence score.

---

## Correlation Checks

### 1. Shared Root Cause

Compare root causes (from `/fix-bug`'s holistic-analysis output) across tickets. If two or more
tickets:

- Point to the same function, file, or code path as the root cause.
- Describe the same underlying bug with different symptoms.
- Reference the same error message or behavior.

**Action**: Group them. Propose a single PR that fixes the shared root cause and references all
affected tickets. The executor's PR description must include "Fixes {TICKET_ID}" for every
correlated ticket.

### 2. Shared Affected Files

Compare each analysis's Affected-Code table. If two fixes:

- Modify the same file(s).
- One modifies a function that the other depends on.

**Action**: Flag the conflict. Either:

- Combine into a single PR if the changes are compatible.
- Establish execution order (fix A lands before fix B).
- Warn the user about potential merge conflicts.

### 3. Potential Duplicates

If two tickets have:

- Nearly identical Symptoms.
- Same root cause from holistic-analysis.
- Same Affected-Code table.

**Action**: Flag as potential duplicates. Let the user decide whether to:

- Resolve both with one PR (mark one as duplicate in Linear).
- Investigate further to confirm they are the same issue.

### 4. Dependencies

If fix A requires fix B to be in place first (e.g., A adds a feature that B's fix relies on),
establish ordering.

**Action**: Note the dependency. Mark the dependent ticket as `Blocked` in Phase 3's table.
Execute B first, then A. If running in parallel is not safe, surface this to the user before
they approve.

---

## Output Format

Present correlation findings between the summary table and the approval prompt:

```markdown
### Cross-Ticket Correlations

**Shared root cause**: SUP-123 and SUP-456 both stem from [description] in [file].
→ Recommend: single PR resolving both.

**File conflict**: ENG-789 and SUP-123 both modify `components/api/src/handler.ts`.
→ Recommend: execute SUP-123 first, then ENG-789.

**Potential duplicate**: SUP-100 and SUP-200 describe the same symptom with the same root cause.
→ Recommend: confirm with user, resolve with one PR and mark the other as duplicate.
```

If no correlations are found, state: "No cross-ticket correlations detected — all tickets can be
executed independently."

