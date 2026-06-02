---
title: Tradeoffs — When Principles Conflict
impact: MEDIUM
tags:
  - tradeoffs
  - decision-tree
  - tiebreakers
---

# Tradeoffs

These principles will sometimes pull against each other. Defaults:

- **Readability vs. performance** → readability wins until a profile says otherwise.
- **DRY vs. clarity** → clarity wins **for code shapes that happen to look alike**: two slightly-different 5-line blocks beat one 12-line generic helper that takes flags. But DRY wins **for the same concept** — duplicated constants, parallel maps over the same union, and re-implementations of an existing utility must be consolidated. The test is *meaning*, not *appearance*: if the two pieces must always change together to stay correct, they are one thing; if they merely share a shape, they are two.
- **Reuse vs. premature abstraction** → reuse existing utilities always; extract a *new* generic helper only on the third real caller. See the decision tree in `maintainability.md` §4.
- **Short name vs. clear name** → clear name. `userPendingApproval` beats `usr`.
- **Guard clause vs. single-return-style** → guard clauses, unless the language/team strongly enforces single-return (e.g., some functional styles).
- **Co-location vs. layered folders** → co-locate the type, its metadata, and the functions that operate on it. A reader who lands on a union should not have to grep across `types/`, `constants/`, and `utils/` to understand it.
