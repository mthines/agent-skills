---
title: Output Contract — Review Mode Findings Format
impact: MEDIUM
tags:
  - output
  - review
  - reporting
---

# Output Contract

When invoked in review mode, structure findings as:

```
## Code Quality Review: [target]

### High Impact (fix these)
- [file:line] [issue] → [proposed change, citing recipe ID where applicable: R1, R6, etc.]

### Medium Impact (consider)
- [file:line] [issue] → [proposed change]

### Low Impact / Style (optional)
- [file:line] [issue]

### Maintainability findings
- [file:line] [duplicated concept / parallel maps / shotgun-surgery risk] → [proposed consolidation, e.g., R1 Consolidate Parallel Maps]
- [estimated change footprint for the next obvious variant: N files, type-checked? yes/no]

### Correctness findings (when relevant)
- [file:line] [idempotency / money / dates / determinism / async / resources]
- [proposed fix, citing recipe ID]

### Testability findings (when relevant)
- [file:line] [hard-to-test surface, missing injection, coupled to global state]
- [proposed fix, e.g., R9 Inject the Clock / RNG / IDs]

### What's already good
- [brief notes on what to preserve]
```

The Maintainability findings section is required when the reviewed code introduces or extends union types, enums, shared constants, or new utilities. Correctness and Testability sections are required when the reviewed code involves retryable operations, money, dates, async I/O, resource handles, or non-trivial pure logic. Skip them when not applicable — do not manufacture findings to look thorough.

When invoked in authoring mode, just write the code (or hand off to the `tdd` skill first for new code). Apply the principles silently. Don't narrate every guard clause — the user will see clean code in the diff.
