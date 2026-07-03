<!-- FIXTURE: invalid — anti-reinvention gap. The File Changes table has a
     `create` row but there is no ## Existing Code Survey section.
     Expected: rule#10 exits non-zero → gate capped at 89%, fails. -->
# Plan: add a dark-mode toggle

## TL;DR
Add a header toggle that switches theme and persists the choice.

## Requirements
- [user-stated] A visible toggle in the header.

## Decisions
- Use the existing `ThemeContext`.

## Acceptance Criteria
- [ ] AC-1 (covers: R1) — When the header renders, the system shall show the theme toggle.

## Implementation Order
1. Add toggle to `Header.tsx`.

## File Changes
| Action | File | Change | Reason |
| ------ | ---- | ------ | ------ |
| modify | `src/Header.tsx` | add toggle | user-facing control |
| create | `src/theme/persist.ts` | localStorage helpers | persistence |

## Verification
- Fast: `npx tsc --noEmit`
- Pre-PR: `npm test && npm run build`

## Progress Log
- [2026-06-07T00:00:00Z] Plan created.
