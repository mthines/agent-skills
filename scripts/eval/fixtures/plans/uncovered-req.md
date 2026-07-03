<!-- FIXTURE: invalid — traceability gap. R1 is [user-stated] but no Acceptance
     Criterion carries a (covers: R1) annotation (AC-1 covers only R2).
     Expected: rule#9 exits non-zero → gate capped at 89%, fails. -->
# Plan: add a dark-mode toggle

## TL;DR
Add a header toggle that switches theme and persists the choice.

## Requirements
- [user-stated] A visible toggle in the header.
- [inferred] Preference survives reload.

### Out of Scope
- Per-component theme overrides.

## Decisions
- Use the existing `ThemeContext`.

## Acceptance Criteria
- [ ] AC-1 (covers: R2) — When the page reloads, the system shall restore the stored theme.

## Implementation Order
1. Add toggle to `Header.tsx`.

## File Changes
| Action | File | Change | Reason |
| ------ | ---- | ------ | ------ |
| modify | `src/Header.tsx` | add toggle | user-facing control |

## Verification
- Fast: `npx tsc --noEmit`
- Pre-PR: `npm test && npm run build`

## Progress Log
- [2026-06-07T00:00:00Z] Plan created.
