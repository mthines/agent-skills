---
title: Dual-Process Fit — Design for System 1, Reserve System 2
impact: HIGH
tags:
  - system-1
  - system-2
  - kahneman
  - cognitive-load
---

# Dual-Process Fit

System 1 is fast, automatic, and effortless; System 2 is slow, deliberate, and limited.
Most behavior at work runs on System 1, so a change that needs System 2 every time it is performed will decay.
Design routine behaviors for System 1 and spend System 2 only where a mistake is costly.

## Decision: which system should this step use?

| The step… | Design for | Do |
| --- | --- | --- |
| is repeated often and low-risk (run tests, tag a ticket, add a label) | System 1 | Make it the default, automatic, or one action at the moment it is due |
| is irreversible or high-cost (delete data, deploy to prod, approve spend) | System 2 | Add deliberate, informative friction: a summary of consequences and a typed confirmation |
| is new and must be learned once (first use of a tool) | System 2, then System 1 | Teach once with a worked example, then automate or template the repeat |
| needs judgment that cannot be defaulted (code review quality) | System 2, supported | Give a short checklist at the moment of judgment, not a document to remember |

```text
✗ "Remember to add the `perf` label when a PR touches the hot path."   — relies on System 2 recall, every PR
✓ A CODEOWNERS-style bot adds the `perf` label when the diff touches `src/hot/**`; the author can remove it.
```

## System 1 levers

Apply these to routine steps.

1. **Default it.** The pre-selected or pre-filled option wins most of the time; make it the desired one and keep opting out easy.
2. **Cut steps.** Count the actions from trigger to done; every removed step raises completion.
3. **Prompt at the moment.** Put the cue where and when the behavior is due — in the PR template, the CLI output, the calendar invite — not in a wiki.
4. **Make it salient.** One visually dominant next action; remove competing ones.
5. **Anchor to an existing routine.** "After I open a PR, I …" beats a new standalone habit.
6. **Show what peers do.** A true descriptive norm ("8 of 10 teams already …") is processed automatically.

## System 2 guardrails

Apply these to steps that deserve deliberation.

1. Friction must **inform**: show what will happen, to what, and whether it can be undone.
2. Ask for an action that proves attention (type the resource name), not one more click.
3. Never add System 2 friction to a routine step to "make people think" — it will be bypassed by habit or by workaround.

## Workshop hooks

When teaching the model (see the `workshop` mode), use a demonstration the audience experiences rather than a definition:

- The bat-and-ball question from the Cognitive Reflection Test ("A bat and ball cost $1.10; the bat costs $1.00 more than the ball") shows System 1 answering first and wrongly.
- Ask the room to recall the last time they did the target behavior without thinking, then the last time they skipped it without deciding to — both are System 1.

Do not demonstrate with priming studies; their findings have not replicated (see [`../references/frameworks.md`](../references/frameworks.md)).
