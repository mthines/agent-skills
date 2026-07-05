<!-- FIXTURE: a valid Core-only plan.md. All 8 Core sections present; Acceptance
     Criteria non-empty with AC-{n} IDs + (covers: R{m}) annotations covering every
     [user-stated] requirement; the create row has an Existing Code Survey verdict.
     Expected: rule#2 = 8, rule#3 ≥ 1, rule#9 pass, rule#10 pass → gate not capped. -->
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
- [ ] AC-1 (covers: R1) — When the header renders, the system shall show the theme toggle.
- [ ] AC-2 (covers: R2) — When the page reloads, the system shall restore the stored theme.

## Implementation Order
1. Add toggle to `Header.tsx`.
2. Wire it to `ThemeContext`.

## File Changes
| Action | File | Change | Reason |
| ------ | ---- | ------ | ------ |
| modify | `src/Header.tsx` | add toggle | user-facing control |
| create | `src/theme/persist.ts` | localStorage read/write helpers | persistence |

## Existing Code Survey
| Planned new unit | Searched for | Closest existing match | Verdict | Rationale |
| ---------------- | ------------ | ---------------------- | ------- | --------- |
| `persist.ts` | grep "localStorage", "persist", "storage"; refs of ThemeContext | none | BUILD NEW | no storage abstraction exists |

## Verification
- Fast: `npx tsc --noEmit`
- Pre-PR: `npm test && npm run build`

## Progress Log
- [2026-06-07T00:00:00Z] Plan created.
