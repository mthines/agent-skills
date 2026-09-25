---
title: Agent0 host — running repo-owned skills inside a Dash0 Agent0 Automation
impact: HIGH
tags:
  - agent0
  - automation
  - cross-harness
  - dispatch
---

# Agent0 host

A **Dash0 Agent0 Automation sandbox** runs this repo's skills on a host that does not resolve them the way the Claude Code CLI does.
This rule owns the substitutions **every** repo-owned skill makes on that host.
A skill-specific Agent0 rule ([`review-loop`](../../../skills/quality/review-loop/rules/agent0-runtime.md), [`ui-verify`](../../../skills/testing/ui-verify/rules/agent0-runtime.md)) links here and adds only what is specific to it.

The host facts, each measured, are owned by [`pr-reviewer/rules/agent0-runtime.md § The four host facts`](../../pr-reviewer/rules/agent0-runtime.md#the-four-host-facts).
Two of them, plus one property of every automation, decide everything below:

- The host's skill tool resolves a **fixed enum of built-ins** and never the filesystem (fact 2).
- **Custom agent types are not dispatchable**; `general` sub-agents are, exactly **one level** deep (fact 3).
- An automation has **no interactive user** — a question asked with `AskUserQuestion` is never answered. This one is not a measured host fact; it is what an automation is.

## Contents

- [Detect the host by the install, never by a failed call](#detect-the-host-by-the-install-never-by-a-failed-call)
- [The substitutions](#the-substitutions)
- [A custom agent becomes a `general` sub-agent that reads its definition](#a-custom-agent-becomes-a-general-sub-agent-that-reads-its-definition)
- [No user to ask](#no-user-to-ask)
- [Constraint files: one per role](#constraint-files-one-per-role)
- [The setup script](#the-setup-script)

---

## Detect the host by the install, never by a failed call

The host is Agent0 **iff** `/tmp/workspace/agent-skills/env.sh` exists.
Source it at the start of every Bash call that needs a path — shell state does not persist between tool calls.

```text
✅ RIGHT — file presence, evaluated before any call
if file_exists("/tmp/workspace/agent-skills/env.sh"): AGENT0 = 1

❌ WRONG — inferring the host from how a call failed
try Task(subagent_type="aw-tester") except "not found": AGENT0 = 1
```

The failed-call form is the `F6` anti-pattern ([`diagnostic-surface.md`](../../../skills/workflow/autonomous-workflow/rules/diagnostic-surface.md)): it spends a round trip to learn what the filesystem already states, and a host that fails differently is misclassified.
When the file is absent, none of this rule applies.

## The substitutions

| A skill writes | Under `AGENT0 = 1`, do instead |
| --- | --- |
| `Skill("<name>", "<args>")` | Read `$AGENT_SKILLS_ROOT/skills/<name>/SKILL.md` and follow it in this context with `<args>` |
| `subagent_type: "general-purpose"` | `subagent_type: "general"` — the host's spelling of the same capability |
| `subagent_type: "<custom agent>"` | A `general` sub-agent that reads the agent's definition file — [below](#a-custom-agent-becomes-a-general-sub-agent-that-reads-its-definition) |
| a relative link into `agents/<path>` | `$AGENT_SKILLS_ROOT/<path>` — the installer copies `agents/` to that root and each skill to `…/skills/<name>/`, so a link's `../` depth no longer lands on the file |
| `AskUserQuestion(…)` | The skill's documented automation answer — [below](#no-user-to-ask) |

`$AGENT_SKILLS_ROOT` is `/tmp/workspace/pr-reviewer`, exported by `env.sh`.
A skill whose file is absent is reported as `not installed (<name>)`, never skipped silently.

## A custom agent becomes a `general` sub-agent that reads its definition

A custom agent keeps its isolation: it still runs in a **separate context**, dispatched once.
What changes is how its procedure reaches that context — by path, in a short prompt.

| Custom agent | Definition file |
| --- | --- |
| `pr-reviewer` | `$AGENT_SKILLS_ROOT/pr-reviewer.agent0.md` (the compiled bundle) |
| `aw-tester` | `$AGENT_SKILLS_ROOT/skills/autonomous-workflow/templates/aw-tester.agent.md` |

```text
<dispatch>(
  subagent_type: "general",
  prompt: |
    <one line: the task>.
    Your procedure is <definition file> — read it and follow it.
    Run `. /tmp/workspace/agent-skills/env.sh` at the start of every Bash call.
    You cannot dispatch sub-agents; do every step in this context.
    <the agent's own input lines, unchanged>
)
```

Keep the prompt short and pointing at files.
Four of 34 measured runs refused a dense constraint-laden prompt as a suspected injection ([`pr-reviewer/rules/agent0-runtime.md § The dispatch prompt is short on purpose`](../../pr-reviewer/rules/agent0-runtime.md#the-dispatch-prompt-is-short-on-purpose)).
A reply that opens with a refusal or a `BLOCKED` line is a distinct outcome, reported as such — never read as a pass.

An agent with **no** definition file on this host (`aw-planner`) has no `general` substitute: the step is reported by name as `not run (<agent> not dispatchable on this host)`.
Never perform a custom agent's role in the dispatching context — that removes the isolation it exists for.

## No user to ask

An `AskUserQuestion` in an automation blocks forever or returns nothing.
Each skill that asks one states its automation answer in its own Agent0 rule, and that answer is always a **decision the automation's configuration already made**, never a guess:

| Skill | Question | Automation answer |
| --- | --- | --- |
| `ui-verify run` | Chrome unavailable — run Playwright instead? | Yes: the setup script installing Playwright is the consent ([rule](../../../skills/testing/ui-verify/rules/agent0-runtime.md#driver-selection-playwright-without-the-prompt)) |

A question with no documented answer stops the run with `blocked (needs a human: <question>)`.

## Constraint files: one per role

Each role reads its own constraints, named in its prompt or in `AGENTS.md`:

| File | Reader | Says |
| --- | --- | --- |
| `/tmp/workspace/pr-reviewer/RUN-CONSTRAINTS.md` | a dispatched reviewer | read-only: never push, approve, or merge |
| `/tmp/workspace/agent-skills/CONSTRAINTS.md` | the automation's top-level session, and any sub-agent it dispatches that commits, pushes, or posts (named in that sub-agent's prompt) | write only what the procedure it was given writes |
| `/tmp/workspace/AGENTS.md` | whatever the host auto-loads | points each role at its own file |

The reviewer's installer writes its read-only constraints into `AGENTS.md` too, which is correct for a review-only automation and wrong for any other.
The [setup script](#the-setup-script) overwrites it after that installer runs.

## The setup script

[`scripts/agent0-setup.sh`](../../../scripts/agent0-setup.sh) is the source of truth for an automation's `sandbox.setupScript`.
It installs the repo at `PIN` (default: the latest `main`, with the resolved commit printed), delegates the reviewer install to [`pr-reviewer/scripts/agent0-setup.sh`](../../pr-reviewer/scripts/agent0-setup.sh), installs a Playwright Chromium for `ui-verify`, writes the files above, and fails closed.

The automation's prompt then names the top-level procedure by path, because `Skill()` cannot resolve it:

```text
Read /tmp/workspace/agent-skills/CONSTRAINTS.md, then read
/tmp/workspace/pr-reviewer/skills/<skill>/SKILL.md and follow it for <PR-URL>.
```
