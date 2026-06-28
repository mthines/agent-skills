---
name: cross-ticket-correlation
description: Detect shared root causes, duplicate tickets, file conflicts, and dependency ordering across multiple tickets — bug or feature
priority: HIGH
---

# Cross-Ticket Correlation

After all parallel Phase 1 analyses return, analyze the results across tickets to detect
patterns that affect execution strategy. The inputs to this phase are the per-ticket analyses
from Phase 1 — each contains a type (bug | feature), an Evidence Record (with affected files),
a root cause (bugs) or proposed approach (features), and a confidence score.

Correlation runs across types — a feature and a bug touching the same file are still a
conflict worth surfacing.

---

## Correlation Checks

### 1. Shared Root Cause (bug-to-bug only)

Compare root causes from each bug ticket's `rca-investigator` Root-Cause Record. If two or more
bug tickets:

- Point to the same function, file, or code path as the root cause.
- Describe the same underlying bug with different symptoms.
- Reference the same error message or behavior.

**Action**: Group them. Propose a single PR that fixes the shared root cause and references all
affected tickets. The executor's PR description must include "Fixes {TICKET_ID}" for every
correlated bug ticket.

Feature tickets don't have a "root cause" — for cross-feature overlap, use the next check.

### 2. Shared Affected Files (any type)

Compare each analysis's Affected-Code table. If two implementations:

- Modify the same file(s).
- One modifies a function or component that the other depends on.

**Action**: Flag the conflict. Either:

- Combine into a single PR if the changes are compatible (e.g., a feature adding a parameter
  that a bug-fix can leverage).
- Establish execution order (one PR lands before the other).
- Warn the user about potential merge conflicts.

Cross-type conflicts (bug + feature on the same file) are the most common and most worth
surfacing — they often signal that the feature work supersedes the bug-fix scope.

### 3. Potential Duplicates (same type only)

If two tickets of the same type have:

- Nearly identical Symptoms (bugs) or Acceptance Criteria (features).
- Same root cause (bugs) or same Proposed Approach (features).
- Same Affected-Code table.

**Action**: Flag as potential duplicates. Let the user decide whether to:

- Resolve both with one PR (mark one as duplicate in Linear).
- Investigate further to confirm they are the same issue / ask.

Cross-type duplicate detection (a bug + a feature that "do the same thing") is rare and almost
always a labeling problem — flag it as a classification question to the user rather than as a
duplicate.

### 4. Dependencies

If ticket A requires ticket B to be in place first (e.g., a feature adds a component that a
bug-fix needs to call, or a refactor must land before a feature can build on it), establish
ordering.

**Action**: Note the dependency. Mark the dependent ticket as `Blocked` in Phase 3's table.
Execute B first, then A. If running in parallel is not safe, surface this to the user before
they approve.

---

## Output Format

Present correlation findings between the summary table and the approval prompt:

```markdown
### Cross-Ticket Correlations

**Shared root cause**: SUP-123 and SUP-456 (both bugs) stem from [description] in [file].
→ Recommend: single PR resolving both.

**File conflict**: AI-1165 (feature) and SUP-123 (bug) both modify
`components/ui/src/components/ui/dataset-picker.tsx`.
→ Recommend: execute AI-1165 first; the feature rewrite likely supersedes the bug-fix scope.

**Potential duplicate**: SUP-100 and SUP-200 (both bugs) describe the same symptom with the
same root cause.
→ Recommend: confirm with user, resolve with one PR and mark the other as duplicate.
```

If no correlations are found, state: "No cross-ticket correlations detected — all tickets can
be executed independently."
