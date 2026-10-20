---
title: Lift Check — Does the Skill Beat No Skill and a Dummy?
impact: HIGH
tags:
  - evaluation
  - plugin-eval
  - lift
  - pruning
---

# Lift Check

Measure a skill's lift: the score with the skill minus the score without it, on the same tasks.
Run a same-length dummy skill as a control, so lift from "any extra context" is not credited to the skill's content.
A skill whose lift does not beat the dummy's is decoration: it costs tokens and changes nothing.

**Why:** popular skill libraries often score no better than a dummy file of the same length — see [`references/lift-and-prune-rationale.md`](../references/lift-and-prune-rationale.md).

## Contents

- Step 1 — Wrap the skill as a plugin
- Step 2 — Write the cases
- Step 3 — Run both arms
- Step 4 — Read the verdict
- Fallback without `claude plugin eval`

## Step 1 — Wrap the skill as a plugin

`claude plugin eval` evaluates a plugin, not a lone skill.
Wrap the skill in a throwaway plugin in the scratchpad, and build a dummy twin:

```bash
W=<scratchpad>/lift/<name>
mkdir -p "$W/real/.claude-plugin" "$W/real/skills" "$W/dummy/.claude-plugin" "$W/dummy/skills/<name>"
printf '{"name":"%s-real","version":"0.0.0"}\n' <name> > "$W/real/.claude-plugin/plugin.json"
printf '{"name":"%s-dummy","version":"0.0.0"}\n' <name> > "$W/dummy/.claude-plugin/plugin.json"
cp -R <skill-dir> "$W/real/skills/<name>"
```

Write `$W/dummy/skills/<name>/SKILL.md` with the **same frontmatter** (so it triggers identically) and a body of the same line count with generic, task-neutral advice ("Read the relevant files before editing. Keep changes small.").
Never edit the real skill's directory; the wrapper holds a copy.

## Step 2 — Write the cases

Scaffold with `claude plugin eval init`, then write at least 3 cases under `evals/<case>/` in the real wrapper, and copy the same `evals/` into the dummy wrapper.

| Case source | Use |
| --- | --- |
| The `scaffold` Phase 0 brief, on a fresh input | always, when it exists |
| The skill's own `evals/evals.json` prompts | when present |
| Real requests from the user's history that should trigger the skill | to reach 3 |

Each case is `evals/<case>/prompt.md` (frontmatter `runs`, `model`, `max_turns`; body = the prompt) plus at least one `evals/<case>/graders/<grader>.md`.
Turn each ledger correction and each definition-of-done clause into a grader; prefer deterministic types (`regex`, `file_exists`, `tool_used`) over `llm`.

```markdown
<!-- ✗ Wrong — any output passes this -->
---
type: llm
---
The report is good.

<!-- ✓ Right — fails exactly when the ledger's correction #1 recurs -->
---
type: llm
---
Revenue in report.md equals gross minus refunds for every row; fail if any revenue figure equals the gross column alone.
```

## Step 3 — Run both arms

```bash
claude plugin eval "$W/real"  --model <target-model> --runs 3 --json "$W/real.json"  --no-publish
claude plugin eval "$W/dummy" --model <target-model> --runs 3 --json "$W/dummy.json" --no-publish
```

- Pin `--model` to the model the skill will run on.
- Add `--allow-tools Bash,Write,Edit` only when the task needs them.
- Add `--max-cost-usd <n>` when evaluating more than one skill.
- Exit code `2` means a partial run (cost ceiling or auth failure): report it as partial, never as a verdict.

Each plugin run executes every case with the plugin and without it, and reports `aggregates.meanDelta` (with minus without) and per-case `cases[].aggregates.delta`.

## Step 4 — Read the verdict

Let `Δreal` and `Δdummy` be the two `aggregates.meanDelta` values.

| Result | Verdict | Do this |
| --- | --- | --- |
| `Δreal ≤ 0` | harmful or inert | Delete, or rewrite from a fresh no-skill run (`rules/run-first.md`). |
| `0 < Δreal ≤ Δdummy` | decoration | Delete, or trim to the lines tied to cases where per-case `delta` beat the dummy, then re-run. |
| `Δreal > Δdummy` | lift | Keep. Report both deltas. |

Report the result in one line:

```text
Lift: <name> Δreal=+0.42 Δdummy=+0.05 (3 cases × 3 runs, claude-opus-5-5) → lift
```

## Fallback without `claude plugin eval`

When `claude plugin eval --help` fails, run each case by hand in fresh sub-agent sessions: once with the skill, once without, and once with the dummy.
Grade all three against the same graders and apply the Step 4 table to the pass rates.
Mark the report `Lift (manual, 1 run per arm)` so nobody reads it as a measured score.
