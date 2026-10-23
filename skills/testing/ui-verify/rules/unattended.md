---
title: --unattended — never ask, never hang
impact: HIGH
tags:
  - ui-verify
  - unattended
  - automation
---

# `--unattended` — never ask, never hang

`run` and `verify` take `--unattended` for callers with nobody to answer a question: a convergence loop (`review-loop` Step 1.6 always passes it), a CI job, or any Agent0 Automation.
Agent0 mode implies `--unattended` whether or not the caller passed it.

Under `--unattended` the skill **never calls `AskUserQuestion`**.
**Why:** on a host with no user an unanswered question blocks forever or errors, and on a host without the tool it cannot be asked at all.

Driver selection asks no question in either mode — `auto` falls back from Chrome to Playwright on its own ([`runner.md § Step 4`](./runner.md#step-4-select-the-driver-and-run)) — so the flag changes only these points:

| Point | Attended | `--unattended` |
| --- | --- | --- |
| `auto`, Chrome unavailable or `inconclusive` with `fallback: playwright` | Playwright, with the one-line fallback notice | same |
| `auto`, no Chrome **and** no sub-agent dispatch | `NOT RUN (no Chrome extension and no sub-agent dispatch available)` | `inconclusive: no driver available (unattended — no Chrome extension, no sub-agent dispatch)` — no verdict, never `red` |
| Chrome `--record-video`, the Allow prompt | `capture.mjs start --wait 600`, asks the user to click **Allow** | `--wait 15`, no question; after the first exit `6`, `gif_creator` for the remaining specs |

A forced `--driver` behaves exactly as it does attended.

```text
❌ WRONG — an automated caller that may reach an interactive step
Skill("ui-verify", "run <PR-URL>")                 # no --unattended: nothing guarantees a question-free run

✅ RIGHT
Skill("ui-verify", "run <PR-URL> --unattended")    # Playwright, or an inconclusive line — never a question
```
