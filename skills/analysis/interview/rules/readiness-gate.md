---
title: Readiness Gate — Enumerate, Classify, Interview-or-Pass
impact: HIGH
tags:
  - readiness
  - blocking
  - adaptive
  - gate
---

# Readiness Gate

Phase 2, and the heart of the skill.
After research, enumerate every remaining unknown, classify each as `blocking` or `advisory`, and decide whether to interview or pass silently.
This is what makes the skill adaptive: it interrupts the user only for a load-bearing unknown and stays quiet otherwise.

## Step 1 — Enumerate unknowns

Walk each category from [`consultative-completeness.md`](./consultative-completeness.md) and list what is still open after Phase 1:
ambiguities in intent, non-goals, edge cases, success criteria, constraints, and integration risks.
Include the surviving `[inferred]` deltas from Phase 0.
Write them as a flat list; do not resolve them yet.

## Step 2 — Classify each unknown

| Class      | Test                                                                                         | What to do                                              |
| ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `blocking` | A wrong guess sends the implementation down a materially different path, or the change is hard to reverse. | Ask the user in Phase 3.                                |
| `advisory` | A reasonable default exists and being wrong is cheap to correct later.                        | Proceed on the default; record it as an assumption.     |

Bias rule: when unsure whether an unknown is `blocking`, treat it as `blocking`.
An unasked load-bearing question costs a rebuild; an asked cheap one costs one line in a batch.

## Step 3 — Decide interview-or-pass

| Condition                                                        | Decision                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Zero `blocking` unknowns **and** the request is crisp.          | **Pass.** Ask nothing. Log one line, write `brief.md`, return `ready`.          |
| One or more `blocking` unknowns.                                | **Interview.** Take the blocking set (plus high-value advisory ones) to Phase 3. |
| `--non-interactive` set and `blocking` unknowns exist.          | Do not prompt. List them under `Open questions` in the brief and return `blocked` — a genuine blocking unknown you could not ask is not something to assume past. (If re-classification shows none were actually load-bearing, they were `advisory` all along → `ready-with-assumptions`.) |

The adaptive pass is a feature, not a shortcut.
A crisp request with no blocking unknowns *should* produce silence plus a brief — that is the skill working, not skipping.

## Readiness verdicts

Set exactly one at Phase 4:

| Verdict                 | Meaning                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `ready`                 | No blocking unknowns remain; assumptions (if any) are all advisory.            |
| `ready-with-assumptions`| Proceeding on advisory assumptions the user has not confirmed; each is listed. |
| `blocked`               | A blocking unknown is unresolved (user unavailable, or `--non-interactive`).   |

## Examples

### Good — adaptive pass

```text
Request: "Bump the double-click window in markdown-click-handler from 300ms to 250ms."
Unknowns after research: none blocking (DOUBLE_CLICK_MS is a single named constant; value is stated).
Decision: PASS. brief.md written, verdict: ready. No questions asked.
```

### Good — targeted interview

```text
Request: "Add PR status to the panel."
Unknowns: [blocking] which states to show; [blocking] poll cadence source of truth;
[advisory] badge glyph set (default to the calm ⚪🟡🟠🔴 palette per repo memory).
Decision: INTERVIEW on the two blocking unknowns; proceed on the glyph default, record it.
```

## Common mistakes

- Classifying everything `blocking` and interrogating the user. **Fix:** advisory unknowns get a recorded default, not a question.
- Classifying a hard-to-reverse choice `advisory` to avoid asking. **Fix:** irreversibility forces `blocking`.
- Treating the adaptive pass as "I skipped the interview". **Fix:** a pass still enumerates, classifies, and writes the brief — it just found nothing worth asking.
