---
title: Diagnose Mode — Retrospective Self-Improvement for Any Skill
impact: HIGH
tags:
  - diagnose
  - self-improvement
  - retrospective
  - meta
  - skill-quality
---

# Diagnose Mode

## Contents

- [Overview](#overview)
- [When to Run Diagnose Mode](#when-to-run-diagnose-mode)
- [Invocation](#invocation)
- [Procedure](#procedure)
- [Output Artifact](#output-artifact)
- [Applying the Proposed Change](#applying-the-proposed-change)
- [Sharing the Improvement Upstream](#sharing-the-improvement-upstream)
- [Hard Rules](#hard-rules)
- [Fallback for Skills Without a Diagnostic Surface](#fallback-for-skills-without-a-diagnostic-surface)

---

## Overview

Diagnose Mode is `create-skill`'s retrospective entry point.
It does not scaffold, review, or upgrade.
It analyses a session in which **another skill** executed and produced an unsatisfactory result, identifies which of that skill's phases / gates / companions should have caught the problem, and emits a proposed change to the **target skill's source** so the same class of failure cannot recur.

The procedure is **skill-agnostic**.
The skill-specific knowledge — phase model, failure taxonomy, existing per-phase guards, source path roots — is read from the target skill's own [`rules/diagnostic-surface.md`](./diagnostic-surface.md) at runtime.
Skills that do not declare a surface fall back to the inferred-from-`SKILL.md` path documented at the bottom of this file (with reduced fidelity).

Diagnose Mode never modifies anything autonomously.
It writes one report file and stops.
Any proposed change to the target skill is **gated through `Skill("confidence", "bug-analysis")`** and **always requires explicit user confirmation** before `--apply` runs `git apply`.
If the confidence score is below 90 %, `--apply` is **disabled for that report** and the diagnosis becomes a discussion artifact rather than an applyable patch.

Run Diagnose Mode while the failing session is still in context — that is when the agent has the maximum amount of evidence (the target skill's plan/walkthrough/log artifacts, tests, user feedback, transcripts) to attribute the failure to a specific gate.

---

## When to Run Diagnose Mode

Trigger on any of:

- The user observes that a skill produced incorrect or low-quality output despite all gates passing.
- A bug found post-merge traces back to a missed check in a workflow skill.
- A companion (or sub-step) was *not* invoked when it should have been — missing trigger.
- A companion *was* invoked but its gate passed for the wrong reason — false-green.
- The user asks: "why did `<skill>` miss this?", "how could `<skill>` have caught this?", or `/create-skill diagnose <skill>`.

Do **not** run Diagnose Mode for:

- Routine bugs in the user's product code unrelated to a skill's gaps — use `/fix-bug` or `/holistic-analysis` instead.
- Failures in-progress mid-workflow — use the target skill's own stuck-loop or `confidence(bug-analysis)` instead.
- Diagnosis of a skill whose source is not on the local checkout — Diagnose Mode needs to be able to resolve the source path to write a unified diff.

---

## Invocation

```
/create-skill diagnose <target-skill-name>
```

Or via `Skill()`:

```
Skill("create-skill", "diagnose <target-skill-name>")
```

`<target-skill-name>` is the directory name under `skills/` (e.g. `autonomous-workflow`, `fix-bug`).
If omitted, ask the user — do not guess.

### Optional flags

| Flag                 | Effect                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `--symptom "<text>"` | Verbatim user description of the failure. Becomes Section 1 of the report.                          |
| `--scope <name>`     | Restrict analysis to a specific phase (`phase-3`), companion (`tdd`), or rule file in the target.   |
| `--apply`            | After report generation, apply the proposed diff to the target skill's local checkout. Confirm first. |
| `--pr`               | After applying locally, open a PR against `agent-skills.git` with the improvement.                  |
| `--no-write`         | Print the report to stdout only — do not write `.agent/{branch}/diagnose-*.md`.                     |

`--apply` and `--pr` modify the **target skill's own source files**, never the user's product code.
Treat them with the same caution as any other source-modifying action — show the diff and ask for confirmation, even in Auto mode.

---

## Procedure

Diagnose Mode is seven steps.
Each step has a concrete deliverable.
The confidence gate at Step 5 is **mandatory** — there is no path to `--apply` that bypasses it.

### Step 1 — Resolve the diagnostic surface

Locate the target skill's diagnostic surface:

1. Resolve the target skill's source path: `readlink -f skills/<target-skill-name>/`.
2. Read `skills/<target-skill-name>/rules/diagnostic-surface.md` if it exists.
3. If it does not exist, fall back to inference (see [Fallback](#fallback-for-skills-without-a-diagnostic-surface)) and warn the user once that fidelity is reduced.

The surface gives you the target skill's:

- **Phase model** — list of phases / steps with their gates and rule files.
- **Failure taxonomy** — known classes (each with an ID like `F1`, `F2`, plus `F-novel`).
- **Existing-guards-per-phase table** — what already runs at each phase.
- **Source root** — the path against which `git apply` is executed (`skills/<target-skill-name>/`).
- **Hard invariants** — gates the target skill marks as load-bearing (the diagnoser is forbidden from proposing relaxations to these without manual user confirmation).

### Step 2 — Evidence collection

Gather every observable that describes what happened:

1. The **user's symptom description** (from `--symptom` or the conversation).
2. The **target skill name** plus its source path resolved in Step 1.
3. The current **branch name** and worktree path of the failing session.
4. Any **artifacts** the target skill produced (`plan.md`, `walkthrough.md`, transcripts, logs) — names declared in the diagnostic surface.
5. The **invocation log** of any companions / sub-steps the target ran (when, with what outcome).
6. Any **diff** between the produced output and what the user says was correct.
7. The **transcript** of any tests, lint runs, CI runs, or judgments that "passed" while the bug was present.

If the target ran in a degraded mode (e.g. autonomous-workflow Lite, fix-bug `--analyse-only`) and produced fewer artifacts, note that fact explicitly — it is a contributing factor and the report must call it out.

### Step 3 — Failure classification

Match the symptom against the target's failure taxonomy from the diagnostic surface.
Pick **exactly one** primary class.
If the failure is a novel mode not in the taxonomy, classify it as `F-novel` and propose adding a new taxonomy row to the target's surface file in Step 4.

### Step 4 — Phase-attribution analysis

Walk every phase listed in the target's diagnostic surface.
For each, answer four questions:

1. Did this phase run?
2. Was its gate satisfied or bypassed (and how)?
3. Could a tighter check at this phase plausibly have caught the failure?
4. If yes, what is the **smallest concrete change** that would have caught it?

Output a table — one row per phase — with the answers.
Highlight the phases where (3) is `yes` and (4) is non-trivial.

### Step 5 — Proposed improvement

Construct **one** improvement proposal targeted at the earliest phase where a tighter check would have caught the failure (earliest is better — fail fast, save downstream tokens).

The proposal must contain:

- **Type** — one of: new check in an existing rule, new companion / sub-step, new trigger condition, new gate, taxonomy / registry update.
- **Target file** — full path inside `skills/<target-skill-name>/`.
- **Concrete edit** — before/after blocks with the exact text to add, change, or remove.
- **Unified diff** — fenced ```diff block in the report, ready to apply with `git apply`.
- **Mechanical vs. judgment** — is the new check rule-based (deterministic) or LLM-judged? Prefer mechanical when possible.
- **Cost** — how many tokens or seconds the new check adds per target-skill run.
- **Validation plan** — how to confirm the change actually catches the failure mode (ideally: a regression test or a worked example placed in `references/` of the target skill).

If the failure was classified `F-novel` in Step 3, the proposal must also include the new row to append to the target's failure-taxonomy table in `rules/diagnostic-surface.md`.

### Step 6 — Confidence gate (MANDATORY)

Run:

```
Skill("confidence", "bug-analysis")
```

Pass the diagnosis as the work-under-review: the symptom, the failure-class, the phase-attribution table, and the proposed edit.
The skill scores how confident it is that the **proposal actually fixes the failure class without weakening other gates**.

| Score   | Meaning                                                                | Effect on `--apply`                                                                                |
| ------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ≥ 90 %  | Proposal is well-grounded; targeted change unlikely to regress others | `--apply` permitted (still asks for confirmation)                                                  |
| 75–89 % | Proposal is plausible but not reliable enough to change skill source  | `--apply` **disabled**; report saved as discussion artifact; user invited to refine the proposal |
| < 75 %  | Proposal is speculative or addresses the wrong root cause             | `--apply` **disabled**; report saved with `status: low-confidence` so it surfaces in audits        |

Record the score and the gate outcome in the report (Section 6 below).
If the score is below 90 %, **the agent does not offer `--apply`** even if the user passed the flag — it states the score, links to the report, and suggests the user iterate on the proposal manually.

This is the load-bearing safety check.
Without it, Diagnose Mode could weaken the target skill's own gates whenever the agent is overconfident in a wrong analysis.

### Step 7 — Write the report

Write the diagnosis report to:

```
.agent/{branch}/diagnose-{target-skill}-{YYYYMMDD-HHMMSS}.md
```

The report is **self-contained** — another user with no access to the original session must be able to read it and apply the improvement.
Use the structure in [Output Artifact](#output-artifact).

If `--no-write` is set, print the report to stdout instead.

### Step 8 — Optional apply / PR (only if Step 6 ≥ 90 %)

If `--apply` is set **and** the Step 6 confidence score is ≥ 90 %:

1. Show the unified diff inline.
2. **Ask the user to confirm.** Always — Auto mode does not bypass this.
3. On confirmation, run `git apply` against the diff inside the target skill's source root.
4. Run any local skill validators the target declares (e.g. `claude plugin validate` if available).
5. Report success or rollback.

If `--apply` is set **but** the Step 6 score is below 90 %:

- Refuse to apply.
- Print the score, the reason, and the path to the report.
- Suggest: "Refine the proposal, run Diagnose Mode again, or apply the diff manually after review."

If `--pr` is also set (still gated on Step 6 ≥ 90 %):

1. Stage the changes locally.
2. Create a feature branch named `diagnose/<target-skill>-<failure-class>-<short-slug>` in the `agent-skills.git` repo.
3. Open a PR titled `<target-skill>: harden against <failure-class>` with the diagnosis report attached as the PR description.
4. **Do not auto-push without confirmation.** Show the branch + PR title and wait for the user.

---

## Output Artifact

The diagnosis report uses plain Markdown — no YAML frontmatter.
The metadata header at the top is parseable enough for any future tooling, and skips the ceremony.

```markdown
# Diagnosis: <one-line failure summary>

- Generated: <ISO 8601 timestamp>
- Target skill: <target-skill-name>
- Branch: <branch-name>
- Failure class: <ID> | F-novel
- Confidence (Step 6): <score>%
- Apply status: permitted | disabled-low-confidence

## 1. Symptom

<verbatim user description, or summary if synthesised from session>

## 2. Evidence

- Diagnostic surface present: yes/no (path)
- Artifacts observed: <list — names from the target's surface>
- Companion / sub-step invocations observed: <list>
- Tests / judgments that passed while bug was present: <list>
- Diff between shipped output and corrected output: <link or inline>

## 3. Failure classification

- Class: <ID> — <name>
- Reasoning: <2–4 sentences citing evidence>

## 4. Phase-attribution analysis

| Phase | Ran? | Gate satisfied? | Could a tighter check have caught it? | Smallest fix |
| ----- | ---- | --------------- | ------------------------------------- | ------------ |
| ...   | ...  | ...             | ...                                   | ...          |

## 5. Proposed improvement

- Type: <new check | new companion | new trigger | new gate | taxonomy update>
- Target: <full path inside skills/<target-skill>/>
- Mechanical or judgment: <mechanical | judgment>
- Cost: <tokens / seconds>

### Before

\```<lang>
<existing content>
\```

### After

\```<lang>
<new content>
\```

### Unified diff

\```diff
<git-apply-ready diff>
\```

## 6. Confidence gate result

- Score: <N>%
- Reasoning: <2–4 sentences from `confidence(bug-analysis)`>
- Outcome: `--apply` permitted | `--apply` disabled (score below 90 %)

## 7. Validation plan

- How to confirm the new check catches the failure: <steps>
- Optional: a regression worked-example to add under `references/` in the target skill

## 8. Sharing

- Apply locally: `cd skills/<target-skill> && git apply <path-to-this-report>` (or use `--apply` if Section 6 permitted it)
- Open a PR: `--pr` flag (also gated on Section 6 ≥ 90 %), or manually with the diff above
```

If a future user wants machine-readable metadata, the header is regular enough to grep — and a real consumer can be added later without breaking past reports.

---

## Applying the Proposed Change

`--apply` is gated on **two** preconditions, in order:

1. **Step 6 confidence ≥ 90 %.** If the gate failed, `--apply` is refused — the agent prints the score and the report path and stops.
2. **Explicit user confirmation.** Even with the gate passing, the agent must show the diff and ask before running `git apply`.

When both preconditions are met:

1. Print the unified diff to the conversation.
2. Ask for confirmation. Auto mode does not bypass this.
3. On confirm: extract the diff block from the report and run `git apply` from `skills/<target-skill>/`.
4. If `git apply` fails, fall back to manual `Edit` / `Write` based on the Before/After blocks. Treat any difference between the diff and the actual edit as a fresh decision and re-confirm.
5. Report which files changed.

When the agent operates from a copy of the target skill that is not a checked-out repo (e.g. `~/.claude/skills/<target>/` symlinked to a read-only path), `--apply` resolves the real source via `readlink -f` first.

---

## Sharing the Improvement Upstream

The diagnosis report is designed to be shareable.
Other users improve their local skill in two ways:

1. **Receive a report file** — drop the `diagnose-*.md` into their `agent-skills.git` checkout and run `git apply` on the embedded diff.
2. **Pull an upstream PR** — when `--pr` is used, the PR carries the report as its description and the diff as its commit, so any user who pulls the merged change inherits the fix.

The report is intentionally provider-neutral: another agent harness (Codex, Cursor, OpenCode) can read the report, apply the diff, and benefit from the improvement without needing this Claude Code session.

---

## Hard Rules

- **Diagnose Mode never modifies user product code.** It only proposes changes to the target skill's own source.
- **Diagnose Mode never auto-applies.** `--apply` requires (a) Step 6 confidence ≥ 90 % and (b) explicit user confirmation, in that order. `--pr` requires a successful local apply first. Auto mode does not bypass either check.
- **No `--apply` without confidence.** If `Skill("confidence", "bug-analysis")` returns < 90 %, `--apply` is refused even if the user passed the flag — the report becomes a discussion artifact.
- **Every diagnosis cites a taxonomy class.** Either an existing row from the target's surface, or `F-novel` plus a proposed new row. New rows are appended to the target's `rules/diagnostic-surface.md` only when a diagnosis clears the confidence gate AND the user approves the apply.
- **Earliest-phase fix wins.** When multiple phases could have caught the failure, propose the change at the earliest phase — failing fast saves the most tokens.
- **Mechanical checks beat judgment checks.** A deterministic rule that can be evaluated without an LLM call is always preferred over an LLM-judged review step.
- **One proposal per report.** If the analysis surfaces multiple independent gaps, run Diagnose Mode again per gap rather than bundling fixes.
- **The agent does not weaken existing gates.** Proposals that *remove* or *relax* a gate the target's surface marks as a hard invariant require the user to type the change manually — Diagnose Mode will surface the analysis but will not pre-fill an apply diff for a relaxation.
- **Diagnose Mode does not edit `create-skill` itself by default.** Self-diagnosis is allowed but requires the user to pass the target name explicitly (`/create-skill diagnose create-skill`) — there is no path where the diagnoser silently rewrites its own procedure.

---

## Fallback for Skills Without a Diagnostic Surface

If the target skill has no `rules/diagnostic-surface.md`, Diagnose Mode degrades gracefully rather than refusing:

1. Read the target's `SKILL.md` end-to-end.
2. Treat each H2 section that names a phase, step, or stage as a candidate phase row.
3. Use a minimal taxonomy: `F-novel` only.
4. Treat every gate / companion mentioned in the body as an existing guard.
5. Resolve the source root as `skills/<target-skill>/`.
6. **Print one warning before generating the report**: "No diagnostic surface declared for `<target>` — fidelity is reduced; consider adding `skills/<target>/rules/diagnostic-surface.md` from the template at `skills/create-skill/templates/diagnostic-surface.template.md`."

The fallback is intentionally low-effort — it exists so a brand-new skill can still be diagnosed before its author has had time to declare a surface.
The right long-term fix is to declare the surface; the report explicitly recommends doing so.
