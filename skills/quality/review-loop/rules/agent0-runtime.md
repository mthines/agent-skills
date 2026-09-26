---
title: Agent0 runtime — running review-loop inside a Dash0 Agent0 Automation
impact: HIGH
tags:
  - review-loop
  - agent0
  - automation
  - cross-harness
---

# Agent0 runtime

`review-loop` assumes a harness that dispatches a named custom agent (`pr-reviewer`) and resolves `Skill()` from the filesystem.
A **Dash0 Agent0 Automation sandbox** does neither, and without this rule the loop can only skip at iteration 0.
This rule changes no convergence condition, gate, or cap, and adds exactly one stop reason, `reviewer-refused`, for a reviewer reply that is not a review.
It changes only **how each sub-step is reached** on that one host.

Detection, the generic substitutions (`Skill()` → a file read, a custom agent → a `general` sub-agent reading its definition, `general-purpose` → `general`, link paths, questions), the constraint files, and the setup script are owned by [`agents/shared/rules/agent0-host.md`](../../../../agents/shared/rules/agent0-host.md) and are not restated here.
Agent0 mode is on iff `/tmp/workspace/agent-skills/env.sh` exists.
The shared rule's substitutions still leave the Step 0 precondition **passing**: `general` is a sub-agent dispatch tool, and the skip lines fire only when none exists under any name.

## Contents

- [Sub-step A — dispatch a `general` reviewer pointed at the bundle](#sub-step-a--dispatch-a-general-reviewer-pointed-at-the-bundle)
- [Where each other sub-step reads its procedure](#where-each-other-sub-step-reads-its-procedure)
- [What still cannot run on this host](#what-still-cannot-run-on-this-host)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## Sub-step A — dispatch a `general` reviewer pointed at the bundle

The review must still run in a **separate context**.
Reading the bundle and reviewing in the loop's own context would be a self-review wearing a reviewer's label — the one substitution this rule forbids.

```text
<dispatch>(
  subagent_type: "general",
  description:   "pr-reviewer pass on PR #<n>",
  prompt: |
    Review <PR-URL> once, read-only.
    Your procedure is /tmp/workspace/pr-reviewer/pr-reviewer.agent0.md — read it and follow it.
    Your standing constraints are /tmp/workspace/pr-reviewer/RUN-CONSTRAINTS.md.
    Start from the prepared context: node /tmp/workspace/pr-reviewer/pr-reviewer/scripts/prepare-review.mjs --pr <PR-URL> (writes /tmp/workspace/review-context.json).
    You cannot dispatch sub-agents; run the finders and the verifier in this context, one after another.
    Flags: <--critical, if set>
    End with the verdict line (PASS | WARN | FAIL), the count of new actionable findings, and the sticky report URL.
)
```

Three properties of that prompt are load-bearing:

- **It is short and points at files.** Never inline the constraints into it ([why](../../../../agents/shared/rules/agent0-host.md#a-custom-agent-becomes-a-general-sub-agent-that-reads-its-definition)).
- **It states the serial fan-out.** The reviewer is already one level deep, so it has no second rung. [`finders.md`](../../../../agents/pr-reviewer/rules/finders.md) runs finders serially where parallel calls are unavailable, and [`finding-verifier.md`](../../../../agents/shared/rules/finding-verifier.md#sub-agent-isolation-when-available) permits the in-agent verifier shape. The review is slower than a top-level Agent0 review, with the same pipeline and the same verdict.
- **It asks for the verdict in the final message.** That message is the only content the loop receives; `NEW_FINDINGS` and `FINAL_VERDICT` are read from it.

A reply that opens with a refusal or a `BLOCKED` line is **not** a review.
Set `STOP_REASON = "reviewer-refused"`, report the reply's first line verbatim, and stop — never read it as `NEW_FINDINGS == false`, which would converge an unreviewed PR.

## Where each other sub-step reads its procedure

| Sub-step | `SKILL.md` call | Agent0 file |
| --- | --- | --- |
| B | `Skill("implement-suggestion", "<PR> --resolve-all")` | `$AGENT_SKILLS_ROOT/skills/implement-suggestion/SKILL.md` |
| C | `Skill("polish", "simplify")` | `$AGENT_SKILLS_ROOT/skills/polish/SKILL.md` (which in turn reads `$AGENT_SKILLS_ROOT/skills/code-quality/SKILL.md`) |
| D | `ci-auto-fix` sub-agent | `general` sub-agent told to read `$AGENT_SKILLS_ROOT/skills/ci-auto-fix/SKILL.md`, with `/tmp/workspace/agent-skills/CONSTRAINTS.md` named in its prompt as its standing constraints — it pushes, and `AGENTS.md` may not load into a sub-agent |
| 1.6 | `ui-verify run` | `$AGENT_SKILLS_ROOT/skills/ui-verify/SKILL.md`, which follows [its own Agent0 rule](../../../testing/ui-verify/rules/agent0-runtime.md) — Playwright via a `general` `aw-tester`, one level deep from this loop |

Every one of these is followed in the loop's own top-level context, so each keeps the single dispatch rung it needs.

## What still cannot run on this host

| Dispatch | Owner | Outcome |
| --- | --- | --- |
| Chromium | Step 1.6, when the setup script could not install it | `not run (playwright browser unavailable in this sandbox: <reason>)` — Step 1.6 is report-only, so convergence is unaffected |

The outcome is reported by name, because a skip that reads as a pass is the self-concealing degradation this repo's `F6`/`F7` doctrine exists to catch.

## What this rule does not do

- It does not change any exit condition, cap, or the `--merge` gate, and it adds no stop reason beyond `reviewer-refused`. The loop is the loop.
- It does not let the loop review in its own context. Sub-step A is always a dispatch.
- It does not restate the reviewer's Agent0 rule. The reviewer's host facts, bundle, and prepared context are owned by [`agents/pr-reviewer/rules/agent0-runtime.md`](../../../../agents/pr-reviewer/rules/agent0-runtime.md).
