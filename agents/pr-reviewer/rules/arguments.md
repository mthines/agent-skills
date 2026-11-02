---
title: 'pr-reviewer arguments — depth presets, the model axis, precedence, validation'
impact: HIGH
tags:
  - pr-reviewer
  - configuration
  - depth
  - models
---

# pr-reviewer arguments

Read this file to set up, change, or debug how deep a review runs, which model runs it, and where each setting comes from.
Two axes are independent: **depth** (how much work the review does) and **model** (which model does it).
**Why:** [`../references/depth-presets.md`](../references/depth-presets.md).

## Contents

- [The two axes](#the-two-axes)
- [Depth presets](#depth-presets)
- [Deprecated depth flags](#deprecated-depth-flags)
- [The model axis](#the-model-axis)
- [Precedence](#precedence)
- [Opt-out flags](#opt-out-flags)
- [Validation](#validation)
- [Reading the depth line](#reading-the-depth-line)
- [Copy-paste config](#copy-paste-config)

## The two axes

| Axis | Set with | Config key | Changes |
| --- | --- | --- | --- |
| Depth | `--depth quick\|standard\|deep\|max` | `depth:` | finders, topology, verifier tier, lenses, tool-call budget |
| Model | `--model <m>` on `/pr-review` | `models: workers:` | the model of a dispatched sub-agent, nothing else |

A depth value never selects a model, and a model value never changes a depth lever.

```text
✗ Wrong — asks the depth knob to save money by picking a model
  --thoroughness 0.3   (meant: "use the cheap model")
✓ Right — one flag per axis
  --depth standard --model sonnet
```

## Depth presets

Each preset is one column of the [thoroughness budget](./depth-routing.md#thoroughness-budget) and gives the same budget as the routed-tier default of the same name.

| Preset | Finders | Verifier tier | Tool-call budget | Tier |
| --- | --- | --- | --- | --- |
| `quick` | correctness, intent, quality; intent isolated; measurability lens | 1 | ×1 | routed |
| `standard` | + consumer-impact, dependency, standards on the delta; optimality lens | 2 | ×1 | routed |
| `deep` | consumer-impact and standards on every file | 2 | ×1.5 | forced `deep` |
| `max` | same as `deep` | 3 (execution) | ×2 | forced `deep` |

- With no depth setting the routed tier picks the preset: routed `quick` → `quick`, `standard` → `standard`, `deep` → `deep`.
- `quick` and `standard` never lower the routed tier.
  A diff that rules D1–D13 route to `deep` still runs as `deep`, at that preset's budget.
- A preset equal to the routed tier's default is the default, so it keeps the lean `quick` budget.

```bash
# ✓ Right
/pr-review <PR> --depth deep
# ✗ Wrong — a number that picks a column by luck
/pr-review <PR> --thoroughness 0.83
```

## Deprecated depth flags

These keep working and add one `RUN_ANOMALY` line naming the replacement.

| Deprecated | Runs as |
| --- | --- |
| `--effort high`, config `effort: high` | `--depth max` |
| `--thoroughness <n>`, config `thoroughness: <n>` | the preset whose column holds `n`: below 0.5 `quick`, 0.5 to below 0.8 `standard`, 0.8 to below 0.95 `deep`, 0.95 and up `max` |

`--full` is not deprecated and not a depth alias: it forces a full, non-incremental review at the `deep` tier.
Pair it with `--depth` when you want a different budget.

## The model axis

| Role | Chosen by | Default | Applied by |
| --- | --- | --- | --- |
| Reviewer (`pr-reviewer`) | `--model` on `/pr-review` | the agent's frontmatter, `model: opus` | the caller's dispatch tool, as its `model` parameter |
| Workers (the intent and pass-2 sub-agents) | config `models: workers:` | the caller's own model | the caller's dispatch tool, as its `model` parameter |

Valid values: `opus`, `sonnet`, `haiku`, or a full `claude-*` id.
The dispatch tool may accept only the aliases; the id is passed through as given.

Where a model cannot be chosen:

- A harness whose dispatch tool has no `model` parameter runs every sub-agent on its own model.
  The skill dispatches without one and prints `models: not applied (<role>)`.
- `/review-loop` and a direct `Task(subagent_type="pr-reviewer")` run the reviewer on `model: opus`: neither takes `--model`.
- The orchestrator that dispatches the reviewer runs on whatever model the user's session uses.

```text
✗ Wrong — a model flag forwarded to the script, which exits 2 on an unknown argument
  prepare-review.mjs --pr 12 --model haiku
✓ Right — the skill reads it and passes it to the dispatch
  Agent(subagent_type="pr-reviewer", model="sonnet", prompt="<PR> --context …")
```

## Precedence

One rule, applied to every setting: **CLI > config > default**.
Config is read from the PR's base commit, never the head.

| Setting | CLI | Config (base commit) | Default |
| --- | --- | --- | --- |
| Depth | `--depth`, else `--effort high`, else `--thoroughness` | `depth:`, else `effort: high`, else `thoroughness:` | the routed tier's preset |
| Reviewer model | `--model` | — | agent frontmatter, `opus` |
| Worker model | — | `models: workers:` | the caller's model |
| Finder passes | `--finder-passes` | `finder_passes:` | `1` |
| Impact image | `--impact-image` | `impact_image:` | off |

Within one source the first listed key wins.
A deprecated key is read only when the keys above it are unset, and logs its anomaly only when it is the one used.

## Opt-out flags

An opt-out flag always wins over a preset: the lever stays off whatever the depth.

| Flag | Turns off | Lever the preset would otherwise set |
| --- | --- | --- |
| `--no-measurable` | the measurability lens | on from `quick` |
| `--no-holistic` | the holistic broad pass and escalation | on from `quick` |
| `--no-escalate` | escalation only | cap grows with depth |
| `--no-standards` | the standards finder | on from `standard` |
| `--skip-gates` | Gates 1–5; inline review only | not a depth lever |

A preset never re-enables an opted-out lever, and an opt-out never changes the preset reported in the depth line.

## Validation

`prepare-review.mjs` checks every flag before it makes a network call; an error prints one line per problem and exits 2.
The `pr-review` skill runs prepare first, so a bad flag costs no model turn.

| Input | Result |
| --- | --- |
| `--depth` not one of `quick`, `standard`, `deep`, `max` | exit 2 |
| `--depth` with `--thoroughness` or `--effort` | exit 2: pass `--depth` alone |
| `--thoroughness` not a number from 0 to 1, or with no value | exit 2 |
| `--effort` other than `high` | exit 2 |
| `--finder-passes` other than `1` or `2` | exit 2 |
| `--isolated` with neither `--pin-head` nor `--review-sha` | exit 2 |
| `--review-sha` without `--isolated`, or with `--pin-head` | exit 2 |
| a config key outside its domain | ignored, one `RUN_ANOMALY` line, never coerced |

The agent's own Step 0 checks stay as a backstop for a caller that skips prepare.

```bash
# ✗ Wrong — used to review at maximum depth after a typo, silently
/pr-review <PR> --thoroughness 0,8
# ✓ Right — exits 2: "--thoroughness 0,8 is not a number from 0 to 1"
```

## Reading the depth line

`context.depth` carries `requested`, `effective`, `source`, `floor`, and `line`; the terminal report's `**Depth**` line prints `line`.

| `line` | Meaning |
| --- | --- |
| `depth standard (default)` | no depth setting; the routed tier chose it |
| `depth deep (--depth)` | the CLI chose it |
| `depth deep (config)` | `depth:` in the base config chose it |
| `depth quick -> standard (floor: infra)` | the request was below the risk floor for this diff and the run lifted it |

The floor lifts a request below `standard` for a high-stakes shape (`auth`, `payments`, `schema-migration`, `secrets`, `infra`) or a high blast radius.
A lifted run also carries a `risk floor:` `RUN_ANOMALY` line.

## Copy-paste config

```yaml
# .agents/review/config.yaml — read from the PR's base commit
depth: standard        # quick | standard | deep | max
models:
  workers: haiku       # opus | sonnet | haiku | claude-* id; omit for the caller's model
finder_passes: 1       # 1 | 2
impact_image: false    # true | false
```

```yaml
# ✗ Wrong — deprecated keys and an inline models value
effort: high
thoroughness: 0.8
models: haiku
# ✓ Right
depth: max
models:
  workers: haiku
```
