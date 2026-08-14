---
title: Interview — Worked Example
impact: LOW
tags:
  - reference
  - example
  - walkthrough
---

# Interview — Worked Example

An end-to-end run of the skill on a real-shaped request, showing the adaptive gate producing an interview in one case and silence in another.
Load this when you want to see what a full run looks like before executing one.

## Contents

- [Run A — underspecified request (interview fires)](#run-a--underspecified-request-interview-fires)
- [Run B — crisp request (adaptive pass)](#run-b--crisp-request-adaptive-pass)

---

## Run A — underspecified request (interview fires)

**Request:** "Add PR status to the Sessions panel."

### Phase 0 — Restate and diff

```text
Restatement: Surface each branch's GitHub PR state inside the Sessions tree view.
Requirements:
- [user-stated] Show PR status per branch in the Sessions panel.
- [inferred] Which states (open / merged / CI-failing / closed)?      ← delta
- [inferred] Poll live vs render once?                                 ← delta
```

### Phase 1 — Research the ground

```text
Explore finds:
- src/lib/pr-status-cache.ts     — caches per-branch PR enrichment, no-flip guarantee.
- src/lib/pr-poller.ts           — polls at 90s, capped at 20 branches.
- src/lib/pr-status-reducer.ts   — maps SessionStatus + PrEnrichment → DisplayStatus.
Resolved by research: caching (reuse PrStatusCache), cadence source (PrPoller exists).
Still open: which states to display; whether to reuse the 90s cadence or add a new one.
```

### Phase 2 — Surface unknowns (gate)

```text
- [blocking] Which PR states does the badge show?  (changes the reducer + glyph set)
- [blocking] Cadence: reuse PrPoller's 90s or a new configurable interval?
- [advisory] Glyph set — default to the calm ⚪🟡🟠🔴 palette (repo memory). Record, don't ask.
- Non-goals to confirm: not adding a PR detail view; not changing poll cap.
Decision: INTERVIEW (2 blocking unknowns).
```

### Phase 3 — Interview

```text
AskUserQuestion([
  { header: "PR states",   question: "Which PR states should the badge show?",
    options: [ open+merged+ci-failing (recommended), open+merged only, all four incl. closed ] },
  { header: "Poll source", question: "Where should the cadence come from?",
    options: [ reuse PrPoller's 90s (recommended), new configurable interval ] },
])
User picks: open+merged+ci-failing; reuse the 90s cadence.
```

### Phase 4 — Confirm & brief

```markdown
# Brief: PR status badge in Sessions panel

**Readiness:** ready-with-assumptions
**Branch:** feat/sessions-pr-badge   **Updated:** 2026-08-14T10:12:00Z

## In scope
- Per-branch badge showing open / merged / CI-failing, reusing PrPoller's 90s cadence and PrStatusCache.

## Out of scope (non-goals)
- No PR detail view. No change to the 20-branch poll cap.

## Open questions resolved
- Q: which states → A: open + merged + ci-failing.
- Q: cadence → A: reuse PrPoller's 90s.

## Assumptions (advisory)
- Glyph set = ⚪🟡🟠🔴 (repo calm-status convention) — reversible, cheap to swap.

## Success criteria
- Each branch row renders the correct badge; a transient gh error never flips a cached state.

## Affected areas (from research)
- `src/lib/pr-status-reducer.ts` — extend DisplayStatus mapping.
- `src/providers/sessions-provider.ts` — render the badge.

## Handoff
Next: aw-planner reads this brief.
```

---

## Run B — crisp request (adaptive pass)

**Request:** "Change `DOUBLE_CLICK_MS` in `markdown-click-handler.ts` from 300 to 250."

```text
Phase 0: restatement matches the request verbatim; no inferred deltas.
Phase 1: markdown-click-handler.ts exports DOUBLE_CLICK_MS = 300 as a single named constant.
Phase 2: unknowns = none blocking (value stated, location named, change reversible).
Decision: PASS — ask nothing.
Phase 4: brief.md written, readiness: ready.
```

Output to the user:

```text
Scope is unambiguous — no questions needed. Brief written to .agent/{branch}/brief.md, readiness: ready.
```

This silence is the skill working correctly, not skipping a step: it still restated, researched, enumerated, and wrote the brief — it simply found nothing worth interrupting for.
