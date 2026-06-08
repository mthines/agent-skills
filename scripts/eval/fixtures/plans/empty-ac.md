<!-- FIXTURE: the #31 regression case. All 8 Core headings ARE present (rule#2 = 8),
     but the Acceptance Criteria section is EMPTY — the heading is immediately
     followed by the next section. Expected: rule#3 = 0 → gate capped at 89%, fails.
     This is exactly the shape that the pre-#31 awk idiom mis-counted as passing. -->
# Plan: add a dark-mode toggle

## TL;DR
Add a header toggle that switches theme and persists the choice.

## Requirements
- [user-stated] A visible toggle in the header.

## Decisions
- Use the existing `ThemeContext`.

## Acceptance Criteria

## Implementation Order
1. Add toggle to `Header.tsx`.

## File Changes
| Action | File | Change | Reason |
| ------ | ---- | ------ | ------ |
| modify | `src/Header.tsx` | add toggle | user-facing control |

## Verification
- Fast: `npx tsc --noEmit`

## Progress Log
- [2026-06-07T00:00:00Z] Plan created.
