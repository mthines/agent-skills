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
This rule changes no convergence condition, gate, or cap, and adds exactly one stop reason, `reviewer-refused`, for a reviewer reply that is not a review, plus one skip line for an [on-demand install](#install-on-demand-when-the-marker-is-absent) that failed.
It changes only **how each sub-step is reached** on that one host.

Detection, the generic substitutions (`Skill()` → a file read, a custom agent → a `general` sub-agent reading its definition, `general-purpose` → `general`, link paths, questions), the constraint files, and the setup script are owned by [`agents/shared/rules/agent0-host.md`](../../../../agents/shared/rules/agent0-host.md) and are not restated here.
Agent0 mode is on iff `/tmp/workspace/agent-skills/env.sh` exists.
A session that ran no setup script creates that file itself, through the [on-demand install](#install-on-demand-when-the-marker-is-absent) that Step 0 row 4 runs; the detection rule does not change, because the file still decides.
The shared rule's substitutions still leave the Step 0 precondition **passing**: `general` is a sub-agent dispatch tool, and the skip lines fire only when none exists under any name.

## Contents

- [Install on demand when the marker is absent](#install-on-demand-when-the-marker-is-absent)
- [Sub-step A — dispatch a `general` reviewer pointed at the bundle](#sub-step-a--dispatch-a-general-reviewer-pointed-at-the-bundle)
- [Where each other sub-step reads its procedure](#where-each-other-sub-step-reads-its-procedure)
- [What still cannot run on this host](#what-still-cannot-run-on-this-host)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## Install on demand when the marker is absent

Only an automation that pastes [`scripts/agent0-setup.sh`](../../../../scripts/agent0-setup.sh) as its `sandbox.setupScript` gets the marker and the bundle before the run starts.
The generic automation that answers a `/review-loop` comment does not, and neither does a chat thread whose sandbox was not prepared.
There the dispatch tool offers `explore` and `general`, and the loop used to skip at iteration 0 with the PR unreviewed.

Step 0 row 4 installs the same files the setup script would, from the same script, in this context.
**The block and its outcome table live in [`SKILL.md` § On-demand install — Step 0 row 4](../SKILL.md#on-demand-install--step-0-row-4), not here.**
Agent0 can import a skill as its `SKILL.md` alone, and an import without `rules/` would never reach a block kept in this file; that is exactly how the install was skipped before.
This section keeps only why the block is shaped the way it is.

### Which hosts install

The block installs only on an Agent0 host. The prepared-sandbox marker and the unprepared-host signals are independent:

| Signal | Means |
| --- | --- |
| `/tmp/workspace/agent-skills/env.sh` | A **prepared** sandbox: the setup script already ran. Row 2, no install |
| `/tmp/workspace`, `/tmp/.opencode/skills/`, or `/tmp/.opencode/agents/general.md` exists | An **unprepared** Agent0 sandbox. The opencode paths are the host's import tree (a flat import lands at `/tmp/.opencode/skills/custom/review-loop/SKILL.md`) and exist even before `/tmp/workspace` does, so the block creates `/tmp/workspace` itself |
| None of them | Not Agent0 — a local machine. Row 5 skips, and nothing is ever installed into `/tmp` |

Five properties of the block are load-bearing:

- **It runs the setup script, not a second installer.** One install procedure, so an on-demand install and a prepared sandbox cannot drift apart. The script comes from the repository this skill is published from, at `main`, which is also the setup script's own default `PIN`.
- **It passes `WITH_PLAYWRIGHT=0`.** The install then takes seconds rather than minutes. `ui-verify` at Step 1.6 tops the browser up itself — its own on-demand browser install (`SKILL.md § On-demand browser install — run and verify`) runs when `UI_VERIFY_BROWSER != ok`, bounded to its own budget and capped at one attempt per sandbox, so a slow or failed top-up never affects convergence: Step 1.6 stays report-only either way.
- **It leaves `/tmp/workspace/AGENTS.md` as it found it.** The setup script writes one for sessions that load it at start. Written mid-run it would change the instructions of every sub-agent dispatched afterwards, and nothing here needs it: sub-step A's prompt names `RUN-CONSTRAINTS.md`, and every writing sub-agent is handed `CONSTRAINTS.md` in its prompt.
- **It needs an Agent0 signal, and `/tmp/workspace` is not required to exist.** The opencode import tree identifies an unprepared sandbox on its own, so the skill works out of the box after a flat import; a machine with none of the signals never gets an install into `/tmp`.
- **The marker is the only success test.** The setup script writes `env.sh` before its own verification, so a failed exit removes it; otherwise the next run in the same sandbox would take row 2 on an install that never verified.

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

- It does not change any exit condition, cap, or the `--merge` gate, and it adds no stop reason beyond `reviewer-refused` and the install-failed skip. The loop is the loop.
- It does not install a browser on demand. An automation that wants Step 1.6 to run Playwright uses the setup script as its `sandbox.setupScript`.
- It does not let the loop review in its own context. Sub-step A is always a dispatch.
- It does not restate the reviewer's Agent0 rule. The reviewer's host facts, bundle, and prepared context are owned by [`agents/pr-reviewer/rules/agent0-runtime.md`](../../../../agents/pr-reviewer/rules/agent0-runtime.md).
