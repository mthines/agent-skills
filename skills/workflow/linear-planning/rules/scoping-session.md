---
title: Scoping Session — The Planning Meeting
impact: HIGH
tags:
  - scoping
  - discovery
  - requirements
  - risk
  - interview
---

# Scoping Session

Run this before drafting any project, milestone, or ticket.
The scoping session is a structured interview that replaces the meeting a team
would hold to define scope, dependencies, and risk.
Its output is a **scoping doc** — the raw material Phase 3 turns into structure.
Ask the questions in **one batched message** so the user answers once; do not
drip them one at a time.

## Contents

- What a good scope captures
- The interview (batched)
- Turning answers into a scoping doc
- Spikes for unknowns
- Examples
- Common mistakes

## What a good scope captures

A scope is complete when you can answer all six, with `<TBD>` only where the
user genuinely cannot decide yet:

| Dimension        | The question it answers                                        |
| ---------------- | -------------------------------------------------------------- |
| Problem          | What is broken / missing, and who feels it?                    |
| Outcome          | What is observably true when this is done?                     |
| Users / actors   | Who uses or is affected by the result?                         |
| Constraints      | Deadlines, tech, compliance, budget, team capacity.            |
| Boundaries       | What is explicitly **out of scope** for this effort?           |
| Risks / unknowns | What could derail it, and what must be spiked or validated?    |

## The interview (batched)

Ask exactly these, adapted to the input. Skip a question only if the input
already answers it — and say which ones the input already answered.

1. **Problem** — What problem are we solving, and what happens today without
   it? Who is affected?
2. **Outcome & success signal** — When this ships, what is observably
   different? Is there a metric or a yes/no check that proves success?
3. **Scope boundaries** — What is explicitly **not** part of this? What is the
   smallest version worth shipping (the walking skeleton)?
4. **Users & surfaces** — Which users, roles, or systems touch this? Which
   surfaces (screens, endpoints, jobs) change?
5. **Constraints & deadline** — Any hard date, tech mandate, compliance need,
   or capacity limit? Is this tied to a cycle, release, or initiative?
6. **Dependencies & unknowns** — What must exist first (other teams, services,
   decisions)? What are we unsure about that needs a spike before estimating?
7. **Slicing preference** — Is there a natural order the user wants (e.g. "ship
   read-only first, then editing")?

For `ticket` mode, ask a compressed subset: problem, outcome, acceptance
signal, boundaries, and any blocking work. One paragraph of answers is enough.

## Turning answers into a scoping doc

Render the answers back as a short doc and confirm it before Phase 2:

```markdown
## Scope: <working title>

**Problem.** <2–3 sentences, user- or operations-facing.>
**Outcome.** <what is true when done; the success signal.>
**Users / surfaces.** <who and what changes.>
**Constraints.** <dates, tech, compliance, capacity — or "none stated".>
**Out of scope.** <explicit boundaries.>
**Risks / unknowns.** <what needs a spike or validation before estimating.>
**Slicing.** <preferred order, or "TBD — propose in Phase 3".>
```

## Spikes for unknowns

If an unknown blocks estimation (unproven approach, third-party behaviour,
unclear data shape), plan a **spike ticket** with a time box and a concrete
question to answer — not open-ended research.
A spike's acceptance criterion is "we can now estimate X" or "we chose approach
Y with evidence Z", never "investigated the thing".

## Examples

### Good — a scoping answer that unblocks structure

```text
Problem: Users can't export dashboards; support gets ~5 tickets/week asking.
Outcome: A user can export any dashboard to PDF from the dashboard menu.
Out of scope: Scheduled/recurring exports, CSV, per-widget export.
Risk: Unsure our charts render server-side — needs a spike before estimating.
Slicing: Ship single-dashboard manual export first; bulk later.
```

Why: every dimension is answered, the risk names a spike, and the slice is a
shippable skeleton.

### Bad — scope that will produce bad tickets

```text
"Add export. Should be flexible and cover everything users might want."
```

Why bad: no boundary, no success signal, "everything" is not a scope. This
produces vague tickets and endless churn. Push back and run the interview.

## Common mistakes

- Skipping the session because the input "seems clear". **Fix:** confirm the
  six dimensions explicitly; clarity is cheap to verify, expensive to assume.
- Accepting "make it flexible / handle everything" as a scope. **Fix:** force a
  smallest-shippable version and an explicit out-of-scope list.
- Treating an unknown as an estimate. **Fix:** convert it to a time-boxed spike
  with a concrete question.
