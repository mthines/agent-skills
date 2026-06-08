<!-- FIXTURE: a valid Core-only plan.md. All 8 Core sections present; Acceptance
     Criteria non-empty. Expected: rule#2 = 8, rule#3 ≥ 1 → gate not capped. -->
# Plan: add a dark-mode toggle

## TL;DR
Add a header toggle that switches theme and persists the choice. Small, UI-only.

## Requirements
- [user-stated] A visible toggle in the header.
- [inferred] Preference survives reload.

### Out of Scope
- Per-component theme overrides.

## Decisions
- Use the existing `ThemeContext` (alternative: new store — rejected, overkill).

## Acceptance Criteria
- Clicking the toggle flips the theme.
- The choice persists across a reload.

## Implementation Order
1. Add toggle to `Header.tsx`.
2. Wire it to `ThemeContext`.

## File Changes
| Action | File | Change | Reason |
| ------ | ---- | ------ | ------ |
| modify | `src/Header.tsx` | add toggle | user-facing control |

## Verification
- Fast: `npx tsc --noEmit`
- Pre-PR: `npm test && npm run build`

## Progress Log
- [2026-06-07T00:00:00Z] Plan created.
