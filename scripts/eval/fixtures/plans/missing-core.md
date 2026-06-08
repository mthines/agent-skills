<!-- FIXTURE: invalid — the Verification Core section is missing (7 of 8).
     Expected: rule#2 = 7 (< 8) → gate capped at 89%, gate fails. -->
# Plan: add a dark-mode toggle

## TL;DR
Add a header toggle that switches theme and persists the choice.

## Requirements
- [user-stated] A visible toggle in the header.

## Decisions
- Use the existing `ThemeContext`.

## Acceptance Criteria
- Clicking the toggle flips the theme.

## Implementation Order
1. Add toggle to `Header.tsx`.

## File Changes
| Action | File | Change | Reason |
| ------ | ---- | ------ | ------ |
| modify | `src/Header.tsx` | add toggle | user-facing control |

## Progress Log
- [2026-06-07T00:00:00Z] Plan created.
