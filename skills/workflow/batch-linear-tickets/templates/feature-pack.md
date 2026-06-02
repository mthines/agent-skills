Plan an implementation for the following feature.

## Intent
<one paragraph from the Evidence Record's problem / motivation section>

## Linear ticket
<TICKET-ID> — <ticket title>
URL: <Linear ticket URL>

## Acceptance criteria
<bullet list from the Evidence Record. Each criterion must be independently verifiable from
the resulting PR diff (not inferred from chat).>

## Sources
<bullet list of evidence sources: Linear ticket URL, attached design docs, user-supplied file
references, screenshots, related tickets — whatever was resolved in Phase 1>

## Affected code (initial scope)
| File | Line(s) / Symbol | Role |
|------|------------------|------|
| ...  | ...              | entry / boundary / leaf / new |

Mark `new` for files the implementation will create. The planner refines this table during
Phase 0 of the autonomous-workflow.

## Proposed approach
<plain-language description of how the feature will be built — components touched, patterns
used, integration points. From the investigator's Evidence Record. Not a step-by-step
implementation — that's the planner's job.>

## Out of scope
<bullet list of related work that is explicitly NOT part of this ticket — sibling tickets,
follow-ups, refactors deferred. Captures the user's "stop here" boundary.>

## Confidence
- plan-mode: <X%>
- breakdown:
  - Completeness: <Y%>
  - Feasibility: <Y%>
  - No ambiguity: <Y%>

## Correlated tickets
<bullet list of any tickets Phase 2 correlated to this one. Empty if standalone. If
correlated, the executor's PR description must reference each with "Implements {TICKET_ID}".>

## Requirements
- Branch: feat/<short-slug>
- The PR description (created later by the executor) must reference the Linear ticket URL.
- Open the PR as a draft. The Phase 7 verifier decides when to undraft.
- The verifier checks that every Acceptance Criterion above is observable in the PR diff —
  do not weaken or rephrase the criteria during planning.
