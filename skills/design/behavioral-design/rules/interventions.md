---
title: Interventions — Choose and Rank the Lever
impact: HIGH
tags:
  - east
  - choice-architecture
  - defaults
  - friction
  - measurement
---

# Interventions

Pick levers that target the primary barrier from [`diagnosis.md`](./diagnosis.md), check them against EAST, rank them, and attach a metric to each.

## Contents

- Barrier → lever lookup
- EAST check
- Ranking
- Measurement
- Review checklist

## Barrier → lever lookup

| Primary barrier | Start with | Example (team adoption) | Avoid |
| --- | --- | --- | --- |
| `physical-capability` | Practice and physical aids, or reduce the physical demand | Paired practice runs before a first on-call shift; shorter shifts so the handover is not done exhausted | Assuming one demo builds a physical skill |
| `psychological-capability` | Worked example + memory aid at the moment | A filled-in example span in the PR template; a `--help` that shows the one command | A 30-page wiki |
| `physical-opportunity` | Provision access, remove steps, default it, prompt at the moment | Grant dashboard access on onboarding; pre-install the CLI in the dev container; make the pre-push hook run only affected tests (90 s, not 11 min); a bot comment when a PR adds an endpoint without a span | Reminders without removing the friction |
| `social-opportunity` | Visible modelling and true norms | Leads demo their own use in standup; a dashboard of adoption by team | Shaming individuals or leaderboards that rank people |
| `reflective-motivation` | Evidence the actor trusts, remove conflicting incentives | Show the 3 incidents a span would have shortened; count the work in sprint goals | Mandates without a reason |
| `automatic-motivation` | Habit anchoring and making it satisfying | "After I open a PR, I paste the dashboard link"; immediate visible feedback when done | Willpower appeals |

## EAST check

Run every candidate intervention through the Behavioural Insights Team's EAST framework.
A candidate that fails **Easy** is rewritten before the others are checked.

| Letter | Question | Fail example → fix |
| --- | --- | --- |
| **Easy** | Does it reduce the number of steps, the decisions, or the effort? Is the desired option the default? | "Opt in on the wiki" → on by default, opt out in one click |
| **Attractive** | Does it draw attention and make the behavior feel rewarding or relevant? | Generic announcement → personalised message naming the actor's own service |
| **Social** | Does it use true norms, visible commitment, or peer networks? | Top-down mandate → champions in each team demo it first |
| **Timely** | Does it reach the actor when they are most receptive — at the trigger event, or a fresh start? | Announced in a quarterly all-hands → prompt at PR open; launch at the sprint start |

## Ranking

Rank candidates by this order of keys:

1. Targets the primary barrier (yes before no).
2. Lever family: environment and ability (defaults, step removal, prompts) before social, before motivation (persuasion, incentives).
3. Effort to ship: low before high.
4. Evidence grade from [`../references/frameworks.md`](../references/frameworks.md): strong, then moderate, then mixed, then weak.

Emit at most 3 interventions as the plan; list the rest as "considered".
Fill the slots with primary-barrier interventions first; a secondary-barrier intervention may take a remaining slot.
Three well-chosen changes are testable; ten are not.

## Measurement

Every intervention carries:

| Field | Rule |
| --- | --- |
| Metric | The target behavior's frequency, from a system of record (CI, git, analytics), not a survey |
| Baseline | Measured before the change, or `unknown` with "measure for 2 weeks first" as action 1; when no system records the behavior yet, ship the instrumentation in report-only mode and measure for 2 weeks before the intervention goes live |
| Comparison | A/B, staggered rollout by team, or before/after with the date of the change recorded |
| Decay check | Re-measure at 4–8 weeks; a nudge that only works while it is new is a novelty effect |

```text
✗ Success = "people like the new process" (survey)
✓ Success = % of PRs adding an endpoint that include a span: 22 % baseline → ≥ 60 % at 6 weeks, staggered by team
```

## Review checklist

Use in `review` mode against a rollout plan, process change, or product flow.
Each item is a finding when it fails; rank Critical (ethics failures), then High (no target behavior, no metric, System 2 on a routine step), then Medium.

- [ ] One observable target behavior is named.
- [ ] A barrier is named and the plan targets it.
- [ ] The desired behavior is the default where a default is possible.
- [ ] Steps from trigger to done are counted and minimised.
- [ ] A prompt fires at the moment the behavior is due.
- [ ] Routine steps need no System 2 recall; costly steps have informative friction ([`dual-process.md`](./dual-process.md)).
- [ ] Social signals used are true and do not single out individuals.
- [ ] Each change has a metric, a baseline, and a decay check.
- [ ] Every lever passes the three-question test in [`ethics.md`](./ethics.md).
