---
title: Diagnosis — Find the Barrier Before Choosing a Lever
impact: HIGH
tags:
  - com-b
  - fogg
  - diagnosis
---

# Diagnosis

Name the single barrier that most stops the target behavior, using COM-B, then cross-check with Fogg's B=MAP.
Run this before any intervention: the barrier decides the lever.

## Contents

- COM-B classification
- Classification procedure
- Fogg B=MAP cross-check
- Output

## COM-B classification

A behavior (B) happens only when the actor has the Capability (C), the Opportunity (O), and the Motivation (M) at the moment it is due.
Classify every barrier into exactly one of the six components.

| Component | The actor… | Typical evidence | Primary lever family |
| --- | --- | --- | --- |
| `physical-capability` | lacks the physical skill, access, or tooling permission to do it | "I don't have access to the dashboard", "the CLI isn't installed on my machine" | Enablement, training |
| `psychological-capability` | does not know how, does not know it is expected, or cannot remember the steps | "I didn't know we had a runbook", "I always forget the flag", "how do I write a span?" | Education, training, checklists, memory aids |
| `physical-opportunity` | is blocked by the environment: time, steps, tooling friction, missing trigger, wrong place | "it takes 12 minutes to run", "the button is three menus deep", "nobody reminds us at the moment it matters" | Environmental restructuring: remove steps, defaults, prompts at the moment |
| `social-opportunity` | sees peers or leaders not doing it, or doing it is socially costly | "nobody senior does it", "asking looks like I don't know", "the team norm is to skip it" | Modelling, social norms, visible champions |
| `reflective-motivation` | does not believe it is worth it, or has a conflicting goal or incentive | "it doesn't catch real bugs", "my sprint goal is shipping, not this" | Persuasion with evidence, goal alignment, removing conflicting incentives |
| `automatic-motivation` | has a habit, emotion, or impulse pulling the other way | "I just push out of habit", "the alert noise makes me ignore it", "it feels tedious" | Habit design, environmental restructuring, making it satisfying |

## Classification procedure

1. List every barrier stated or observed for the target behavior, one per line.
2. For each, ask the three questions in order and stop at the first **yes**:
   1. Could the actor do it right now if their life depended on it? **No** → a capability component (`physical-` if the gap is access or tooling, `psychological-` if it is knowledge or memory).
   2. Does the environment or the people around them make it hard, slow, or costly? **Yes** → an opportunity component (`physical-` for time, steps, and tooling; `social-` for norms and status).
   3. Otherwise → a motivation component (`reflective-` if they disagree it is worth it, `automatic-` if they agree but habit or feeling wins).
3. Pick the **primary barrier**: the one that, removed alone, would most raise the behavior's frequency.
   When two tie, prefer the opportunity barrier — environment changes are cheaper and more durable than changing minds.
4. Record the evidence for the primary barrier.
   Self-report alone ("people say they're too busy") is weak evidence; prefer an observation or a number (step count, run time, % who have access).

```text
✗ Barrier: "people are lazy"            — not a COM-B component, untestable, blames the actor
✓ Barrier: physical-opportunity — the pre-push test run takes 11 min (CI timing, p50); engineers skip it to keep flow
```

Agreeing with the goal but not acting is the most common pattern in team adoption.
That is never `reflective-motivation`; it is an opportunity or `automatic-motivation` barrier, and persuasion will not fix it.

### No evidence available

When no barrier has an observation, a number, or even a self-report:

1. List the plausible barriers as hypotheses, each with evidence `unknown`.
2. Mark the primary barrier `provisional`, chosen with the tie-break in step 3.
3. Make validating it action 0 of the plan: ask 5–10 actors who do not perform the behavior which barrier applies, or pull the number that would decide it.
4. Prefer interventions that are cheap to reverse until action 0 confirms the barrier.

## Fogg B=MAP cross-check

Fogg's model states a behavior occurs when Motivation, Ability, and a Prompt converge at the same moment.
Use it to sanity-check the COM-B result:

| Fogg check | Question | If it fails |
| --- | --- | --- |
| Prompt | Is there a cue at the exact moment the behavior is due? | No prompt → `physical-opportunity`; add a prompt before anything else |
| Ability | Which link of the ability chain is weakest — time, money, physical effort, mental effort, or routine? | The weakest link is the friction to remove |
| Motivation | Is motivation high enough for the current difficulty? | Lower the difficulty first; raise motivation only when difficulty is already minimal |

A behavior with no prompt fails regardless of motivation; check the prompt first.

## Output

```text
Target behavior: <who does what, when, measured how>
Barriers:
  - <component> — <barrier> — evidence: <observation or number | self-report>
Primary barrier: <component> — <barrier> [provisional]
Fogg check: prompt <present|missing>, weakest ability link <time|money|physical|mental|routine>, motivation <sufficient|insufficient>
```
