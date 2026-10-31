---
title: Lens invocation — resolving pr-reviewer's composed skills across harnesses
impact: HIGH
tags:
  - pr-reviewer
  - lens-invocation
  - cross-harness
  - self-concealing-degradation
---

# Lens invocation

`pr-reviewer` composes three repo-owned quality lenses through `Skill()`: `measurable`, `confidence`, and `verify-behavior`.
Severity and the holistic pass are shared rules, not lenses, and need no resolution.
On an Agent0 sandbox the host's `skill` tool knows none of the three names: `confidence` and `verify-behavior` return `Skill "<name>" not found`, and `measurable` silently returns an unrelated built-in skill's recipe.
**Why:** [`references/lens-invocation-rationale.md`](../references/lens-invocation-rationale.md).

## Resolution algorithm

Resolve every lens in this order, before any `Skill("<lens-name>", …)` call:

1. Check whether `$HOME/.claude/skills/<lens-name>/SKILL.md` exists.
2. Present → read it and follow it in this context, exactly as if `Skill()` had loaded it. This is the authoritative path, not a fallback.
3. Absent → call the host's `Skill(<lens-name>, …)`, and record a `RUN_ANOMALY` (case 2 below).

```text
resolve(lens_name):
  path = "$HOME/.claude/skills/" + lens_name + "/SKILL.md"   # never "~" — the Read tool does not expand it
  if file_exists(path):
    read(path) and follow it in-context
  else:
    Skill(lens_name, ...)                    # host resolution — always reported
```

```text
# incorrect: keyed on the error string — the measurable collision returns no error and passes straight through
try: Skill("measurable", "audit") except "not found": read(path)
# correct: file-presence decides before the call
if file_exists("$HOME/.claude/skills/measurable/SKILL.md"): read and follow it
```

Never apply this substitution to a `Task` / `Agent` sub-agent dispatch: a lens is a skill definition this agent already runs in its own context, while a dispatched reviewer exists for context isolation, which has no in-context substitute.

## `RUN_ANOMALY` is mandatory

Record a `RUN_ANOMALY` in each of these three cases:

1. **The lens cannot run** — no local file, and the host has no usable answer.
2. **Resolution used the host's `Skill()` at all**, even when it appeared to succeed: with no local file there is nothing to check the answer against.
3. **The local file loaded, but the skill cannot serve this call** — for example, a local install that lacks the mode the caller passes (`measurable`/`audit`, `confidence`/`code`, `verify-behavior`/`claim`).

`RUN_ANOMALY` is one line; the renderer rejects a newline.
When several lenses degrade in one run, put them all on that one line, grouped by reason:

```text
RUN_ANOMALY: verify-behavior, confidence unavailable (no local file, no host skill) — behavioral claims on this run have no executed proof and fallback scores are missing; measurable resolved via host fallback (collision, unverified) — this run's measurability findings are unverified
```

A single degraded lens gets its own line:

```text
RUN_ANOMALY: verify-behavior lens unavailable on this host (no local file, no host skill) — behavioral claims on this run have no executed proof
```

The run announcement, the terminal Quality Gate summary, and the posted report all carry the anomaly, never only the terminal output.
A run that could not execute its lenses, or executed them on an unverifiable answer, never reports clean.

## Spine and enhancement lenses

| Class | Lenses | A genuine skip means |
| --- | --- | --- |
| **Spine** | `verify-behavior` | Behavioral claims have no executed proof. |
| **Enhancement** | `measurable`, `confidence` | The review is smaller, not less trustworthy. |

Neither class ever changes `RUN.tier`: supply it exactly as depth routing set it, and carry the degradation in `RUN_ANOMALY` only.

## The three invocation sites

Each lens has one owner file that references this rule — the file that owns the consequence of that lens failing:

| Lens | Owner file |
| --- | --- |
| `measurable` | [`measurability-review.md`](./measurability-review.md) |
| `confidence` | [`per-comment-confidence.md`](./per-comment-confidence.md) |
| `verify-behavior` | [`verification-receipt.md`](./verification-receipt.md) |

## What this rule does not do

- It does not change what any lens computes; it decides only whether a lens runs and how loudly a skip is reported.
- It does not add a report section or fill `RUN.tier`; it fills the existing `RUN_ANOMALY` slot only.
- It does not retry a failed host resolution; the file-presence check runs once, before the call.
- It does not resolve review-checklist lenses (`lens.md` files: `ux`, `ai-engineering`, a team's `.agents/review/lenses/<name>.md`).
  [`select-lenses.mjs`](../../pr-reviewer/scripts/select-lenses.mjs) picks those and hands back their text, under [`rubric-composition.md` § Review lenses](./rubric-composition.md#review-lenses).
