---
title: Run First — Do the Job Before Writing the Skill
impact: HIGH
tags:
  - scaffold
  - run-first
  - corrections-ledger
  - evaluation
---

# Run First

Do the job the skill is meant to do, once, end to end, in this session, with no skill loaded.
Write the skill only afterwards, from the corrections that run needed.
A skill is the list of things the agent got wrong on the job, not a manual for the whole process.

**Why:** a skill written before the job has run documents imagined problems; most of its lines restate what the model already does, cost tokens, and change nothing — see [`references/run-first-rationale.md`](../references/run-first-rationale.md).

## Contents

- Step 1 — The brief
- Step 2 — The run
- Step 3 — The corrections ledger
- Step 4 — Route each correction
- Step 5 — The no-skill exit
- Waiving the run
- Definition of done

## Step 1 — The brief

Ask the user for exactly four things, in one message:

| Field | Ask for | Example (weekly client report) |
| --- | --- | --- |
| Task | One sentence: what the job produces. | "This week's client report from the CRM export." |
| Real input | A real file, URL, ticket, PR, or command the job runs on now. Never an invented sample. | `exports/crm-2026-10-19.csv` |
| Guardrails | What the run must not touch or do. | "Do not edit the template. Do not email anyone." |
| Definition of done | A pass/fail condition on the output. | "Every figure matches the export; every template section is filled." |

Do not ask for the skill's name, description, modes, invocation control, or runtime yet.
Those answers depend on what the run shows, and Distill (Phase 2) asks for them.

Reject a definition of done that cannot fail.

```text
✗ Wrong — nothing can fail this
Done: the report is finished and looks good.

✓ Right — each clause passes or fails against the output
Done: every figure in report.md equals the matching cell in the export,
and no template section is empty.
```

## Step 2 — The run

Do the job on the real input, in this session, with the target skill absent.

1. Do not load, read, or draft any part of the skill you are about to write.
   Other installed skills stay available: the run measures what the agent does out of the box.
2. Plan while working; do not stop to present a plan.
3. Respect the guardrails literally.
   An outward-facing action (sending a message, pushing, deploying, paying) is never performed in the run: produce the draft or the command and stop there.
4. Check the output against the definition of done yourself before you show it.
5. Show the user the output and the definition-of-done result, then ask: "What did I get wrong, or what would you have done differently?"
6. Apply each correction the user gives, re-check the definition of done, and repeat until the user accepts the output.

Run on the model the skill will run on when that model is available in this session.
When it is not, record the model you ran on in the ledger; Phase 8 re-checks on the target model.

## Step 3 — The corrections ledger

Record every correction as it happens, in `.agent/{branch}/skill-run-<name>.md` (scratchpad when there is no repo).
One row per correction, including the ones you caught yourself against the definition of done:

```markdown
# Run ledger — weekly-client-report

Brief: this week's client report from exports/crm-2026-10-19.csv.
Guardrails: template unchanged; no email.
Done: every figure equals the export; no empty section.
Model: claude-opus-5-5

| # | What went wrong | Correction | Caught by | Route |
| - | --------------- | ---------- | --------- | ----- |
| 1 | Summed revenue including refunds | Revenue = gross − refunds column | user | skill gotcha |
| 2 | Asked which export to use | Newest file in exports/ matching crm-*.csv | user | skill gotcha |
| 3 | Figure on p.2 off by one row | — (fixed by the check) | definition of done | check script |
| 4 | Opened a draft email to the client | Never email the client | user | hook |
```

Do not record what went right.
A step the agent did correctly unaided is not a skill line.

## Step 4 — Route each correction

Give every ledger row exactly one route:

| The correction is… | Route | Lands in |
| --- | --- | --- |
| Something the agent got wrong and would get wrong again on this job | skill gotcha | `SKILL.md` body, one line or one short block |
| A fact or command true for the whole workspace, not this one job | workspace fact | the project's `CLAUDE.md`, not the skill |
| Something that must never happen | hook | a `PreToolUse` hook that blocks it; the skill states the guardrail once without capitals |
| A definition-of-done clause the agent can check mechanically | check script | `scripts/check-<name>.mjs` the skill runs before reporting done |
| A large research step or an MCP-heavy step that floods the context | subagent step | a `SKILL.md` instruction to run that step in a sub-agent and return only the result |
| A one-off detail of this input that will not recur | drop | nowhere |

```markdown
<!-- ✗ Wrong — the skill re-documents the whole process -->
## Steps
1. Open the CRM export.
2. Read the template.
3. Compute each figure.
4. Fill in each section.
5. IMPORTANT: NEVER email the client.

<!-- ✓ Right — only the ledger's corrections, the guardrail once, and the check -->
## Gotchas
- Revenue is the gross column minus the refunds column, never gross alone.
- Use the newest `exports/crm-*.csv`; do not ask which export.

Do not email the client; a hook blocks it.
Before reporting done, run `node ${CLAUDE_SKILL_DIR}/scripts/check-report.mjs report.md <export>` and show its output.
```

## Step 5 — The no-skill exit

Count the rows routed `skill gotcha`, `check script`, or `subagent step`.

| Count | Do this |
| --- | --- |
| 0 | Stop. Tell the user the agent already does this job; no skill is written. Offer to write any `workspace fact` rows to `CLAUDE.md` and any `hook` rows as hooks. |
| ≥ 1 | Continue to Distill (Phase 2). |

## Waiving the run

Skip the run only when one of these holds, and record which in the ledger:

1. The user explicitly waives it ("skip the run", `--no-run`).
2. The job cannot run in this session and has no draft-only form, for example it needs hardware or a production system the session cannot reach.

"The skill is simple" and "I already know the steps" are not reasons to skip.
A waived run leaves the ledger empty, so Phase 8 must capture a no-skill baseline before the skill counts as done.

## Definition of done

- [ ] The brief has all four fields, and the definition of done can fail.
- [ ] The job ran on the real input with the target skill absent, or the waiver reason is recorded.
- [ ] The user accepted the run's output.
- [ ] Every correction is a ledger row with exactly one route.
- [ ] The no-skill exit was evaluated and its outcome stated.
