---
title: Workflow Patterns — Shaping the Degree of Freedom
impact: MEDIUM
tags:
  - workflow
  - degrees-of-freedom
  - patterns
---

# Workflow Patterns

Match the shape of the instruction to how much judgment the step actually
needs. Getting this wrong in either direction costs reliability.

## Degrees of freedom

| Freedom | When to use                                   | Shape                          | Cue |
| ------- | ----------------------------------------------- | -------------------------------- | ---------------------------------- |
| Low     | Fragile, destructive, or exactly-repeatable steps | A literal command or script     | "Crossing a bridge" — one correct path, high cost of deviation |
| Medium  | A known set of valid approaches, one usually better | A decision table with named options | "Choosing a route on a map" — several fine paths, pick by signal |
| High    | Genuine judgment calls (code review, design taste) | Prose principles + examples    | "Exploring a field" — no single correct path, describe good outcomes instead |

Getting the freedom level wrong in either direction:

- **Too low** on a judgment call (a rigid script for "review this PR")
  produces mechanical, low-quality output that misses context a human
  reviewer would catch.
- **Too high** on a fragile step ("use whatever flags seem reasonable" for
  a schema migration) produces unsafe, non-reproducible behavior.

See `rules/anti-patterns.md` § B2 for the failure mode this rubric guards
against.

## Copyable progress checklist

For a multi-step workflow with real gates, give the agent a literal
checklist to copy and fill in as it works — not just a description of the
steps:

```markdown
## Progress

- [ ] Step 1 — <gate>
- [ ] Step 2 — <gate>
- [ ] Step 3 — <gate>
```

This makes partial progress visible across a compaction boundary and
gives the agent an explicit place to record "step 2 failed, retrying."

## Validator loop

When a step's output can be mechanically checked, loop until the check
passes rather than accepting the first attempt:

```markdown
1. Generate the output.
2. Run the validator.
3. If it fails, read the findings, fix them, and go to step 2.
4. Stop after 3 failed attempts and surface the remaining findings to the user.
```

Always cap the loop — an uncapped retry loop against a validator that can
never pass (a stale golden file, an unreachable check) burns the whole
turn silently.

## Conditional workflow

State branches as a table, not as nested prose "if/else":

### Good

```markdown
| Condition                          | Do                                |
| ------------------------------------ | ------------------------------------ |
| Target file exists                  | Read it, then patch                |
| Target file missing                 | Create it from the template        |
```

### Bad

```markdown
If the target file exists, you should read it first and then patch it,
but if it doesn't exist, you'll need to create it, unless there's a
template available, in which case use that instead.
```

Why bad: the branching logic is buried in prose; a table makes every case
and its action scannable at a glance.

## Input/output example pairs

For a transformation task, show one full input alongside its exact
expected output rather than describing the transformation in prose alone:

```markdown
Input:  `2024-3-7`
Output: `2024-03-07`
```

An example pair disambiguates edge cases (zero-padding, here) that prose
rules often leave unstated.

## Strict vs. flexible template

Decide, per template file, whether the agent may deviate from it:

- **Strict** — a legal notice, a commit message format the CI parses. Say
  "copy verbatim, only fill the placeholders."
- **Flexible** — a starting skeleton for a report. Say "use as a
  starting point; adapt sections to the specific finding."

Mark this explicitly at the top of the template file itself — do not
leave the agent to guess which kind it received.
