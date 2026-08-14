---
title: Brief Artifact — Schema, Path, and Downstream Consumption
impact: HIGH
tags:
  - brief
  - artifact
  - handoff
  - re-runnable
---

# Brief Artifact

Phase 4.
The deliverable is a confirmed, self-contained `brief.md` plus a readiness verdict.
It is the shared-understanding contract that planning reads instead of re-deriving scope from scratch.

## Where it lives

```text
.agent/{branch}/brief.md
```

`{branch}` is the current git branch (`git branch --show-current`).
This matches the `autonomous-workflow` artifact convention (`plan.md`, `checks.yaml`, `walkthrough.md` live in the same directory), so `aw-planner` picks the brief up with no path negotiation.
If not on a feature branch (e.g. bare `/interview` on `main`), write to `.agent/interview/brief.md` and say so.

The brief is scratch, not a tracked artifact.
Before writing, confirm `.agent/` is gitignored (it is in `autonomous-workflow` repos); if the repo does not ignore it, add `.agent/` to `.gitignore` or tell the user the file is untracked so it is not committed by accident.

## Re-runnable

A second run on the same branch **updates the brief in place**, it does not append a second file.
Re-running after new information (a follow-up answer, a changed requirement) is the expected path: re-restate, re-research the delta, refresh the unknowns, rewrite `brief.md`, and re-set the verdict.
Bump nothing and version nothing — the brief is a living scratch document, not an immutable snapshot.

## Schema

Emit exactly these sections. Omit a section only when it is genuinely empty, and say `None.` rather than deleting the heading.

```markdown
# Brief: <short title>

**Readiness:** ready | ready-with-assumptions | blocked
**Branch:** <branch>   **Updated:** <ISO 8601>

## Request (verbatim)
<the user's exact words>

## Restatement
<one paragraph in your own words + the requirement bullets, each tagged [user-stated] / [inferred]>

## In scope
- <what this change will do>

## Out of scope (non-goals)
- <what this change deliberately will not do>

## Open questions resolved
- Q: <blocking unknown>  →  A: <the user's answer>

## Assumptions (advisory)
- <default proceeded on, not user-confirmed> — reversible because <why>

## Success criteria
- <observably true when done>

## Constraints
- <performance / compat / security / governing-doc rules the design must honor>

## Affected areas (from research)
- `path/to/file.ts` — <role in the change>

## Handoff
Next: <planning entry point, e.g. aw-planner reads this brief> | blocked on <unknown>
```

## Downstream consumption

- `aw-planner` Phase 1 reads `brief.md` as the scope contract: the restatement seeds Requirements, `In scope` / `Out of scope` bound the plan, `Success criteria` seed Acceptance Criteria, and `Affected areas` seed the Existing Code Survey.
- A `blocked` verdict tells the caller not to proceed to planning until the named unknown is resolved.
- The brief never contains a plan, file diffs, or product code — it is scope, not solution.

## Common mistakes

- Writing a second `brief.v2.md` on re-run. **Fix:** update `brief.md` in place.
- Leaking a plan or code into the brief. **Fix:** stop at scope; the plan is `aw-planner`'s output.
- Dropping the `Out of scope` section because it feels empty. **Fix:** keep the heading, write `None.` — an explicit empty non-goal list is signal.
- Setting `ready` while a blocking unknown is open. **Fix:** an open blocking unknown is `blocked` (or `ready-with-assumptions` only if it was truly advisory).
