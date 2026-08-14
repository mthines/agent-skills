---
title: Research Grounding — Restate, Diff, and Locate Before Asking
impact: HIGH
tags:
  - restate-and-diff
  - research
  - grounding
---

# Research Grounding

Covers Phase 0 (restate the request and diff it against the user's words) and Phase 1 (research the code so the interview's questions are specific and its answers are pre-resolved).
The single biggest failure of a scoping interview is asking the user something the code, the request, or five minutes of reading already answers.
This rule removes those questions before Phase 2 ever runs.

## Phase 0 — Restate and diff

Restate the request in your own words, then diff your restatement against the user's exact words and surface every delta.

1. Write the request back as a one-paragraph restatement plus a bullet list of discrete requirements.
2. Tag each requirement `[user-stated]` (traceable to their words) or `[inferred]` (your reading, not their words).
3. Surface every `[inferred]` bullet explicitly — these are the deltas. An inferred requirement is a candidate blocking unknown, not a fact.
4. Never silently promote an inference to a requirement. If it matters and the user did not say it, it is a Phase 2 unknown.

The purpose is to catch specification misalignment early: you plan against your *perception* of the request unless you force the perception into words and check it.

## Phase 1 — Research the ground

Explore the code and context so questions land on real decisions, not blanks.
Prefer a read-only `Explore` sub-agent for breadth; fall back to `Grep`/`Glob`/`Read` for a targeted look.

| Look for                | Why it changes the interview                                                        |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Affected files / modules | Turns "where does this live?" into a named location you confirm, not ask open-ended. |
| Prior art / near-dupes  | An existing `PrStatusCache`, helper, or pattern makes "build vs reuse" a real question. |
| Established patterns     | The repo's conventions become the default; you ask only when the request breaks them. |
| Constraints             | Types, schemas, config, governing docs (`CLAUDE.md`, `.claude/rules/`) that bound the design. |
| Integration seams       | Callers, contracts, and data flow the change must not break.                        |

After research, re-test every candidate unknown from Phase 0: if the code now answers it, delete it. Only survivors reach Phase 2.

## Examples

### Good

```text
Restatement: Add a per-branch PR status badge to the Sessions panel.
Requirements:
- [user-stated] Show PR open / merged / CI-failing state per branch.
- [inferred] Poll at the same 90s cadence as the existing PrPoller.   ← delta, confirm in Phase 2
Research: src/lib/pr-status-cache.ts already caches per-branch PR enrichment
with a no-flip guarantee → reuse it; do NOT ask "should we cache?".
```

### Bad — ungrounded

```text
Questions for the user:
- Where should the PR status live?          ← the code shows the Sessions panel; don't ask
- Should we cache the result?               ← PrStatusCache already does; don't ask
- What does a merged PR look like?           ← resolvable from pr-status-reducer.ts; read it
```

## Common mistakes

- Skipping the diff and treating your restatement as the spec. **Fix:** tag `[inferred]` bullets and surface them.
- Interviewing before reading the code. **Fix:** research is Phase 1, questions are Phase 3 — never reorder.
- Researching endlessly instead of asking. **Fix:** research resolves *answerable* unknowns; genuine judgment calls still go to the user.
