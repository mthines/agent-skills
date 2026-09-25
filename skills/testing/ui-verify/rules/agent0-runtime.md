---
title: Agent0 runtime — running ui-verify inside a Dash0 Agent0 Automation
impact: HIGH
tags:
  - ui-verify
  - agent0
  - automation
  - playwright
---

# Agent0 runtime

On a Dash0 Agent0 Automation sandbox, `ui-verify` hits three host facts at once: there is no Chrome extension, there is no user to answer the Playwright prompt, and `aw-tester` is a custom agent type the host cannot dispatch.
This rule makes `author`, `run`, and `verify` work there anyway.
It changes no spec grammar, no verdict mapping, and no resolution rule.

Detection, the generic substitutions, and the setup script are owned by [`agents/shared/rules/agent0-host.md`](../../../../agents/shared/rules/agent0-host.md) and are not restated here.
Agent0 mode is on iff `/tmp/workspace/agent-skills/env.sh` exists; source it at the start of every Bash call.

## Contents

- [Work from a checkout of the PR head](#work-from-a-checkout-of-the-pr-head)
- [Driver selection: Playwright, without the prompt](#driver-selection-playwright-without-the-prompt)
- [The browser precondition](#the-browser-precondition)
- [Dispatch `aw-tester` as a `general` sub-agent](#dispatch-aw-tester-as-a-general-sub-agent)
- [Preview auth comes from the automation's secrets](#preview-auth-comes-from-the-automations-secrets)
- [`setup` needs a human](#setup-needs-a-human)

---

## Work from a checkout of the PR head

`author` reads the diff, and `run` reads the committed `.claude/aw-targets/preview.yml` and writes `.agent/{branch}/…` scratch — all relative to a checkout.
When the working directory is not a checkout of the PR's repository at its head, make one before Step 0:

```bash
. /tmp/workspace/agent-skills/env.sh
D=/tmp/workspace/ui-verify/<repo>
[ -d "$D/.git" ] || gh repo clone <owner>/<repo> "$D" -- --filter=blob:none -q
cd "$D" && gh pr checkout <n> -f
```

Everything below runs from that directory.
A clone that fails is `inconclusive: no checkout of <owner>/<repo> (<error>)` — never a spec run against the wrong tree.

## Driver selection: Playwright, without the prompt

| `--driver` | Agent0 outcome |
| --- | --- |
| `auto` (default) | **`playwright`, with no `AskUserQuestion`.** The prompt in [`runner.md § The auto-mode Playwright prompt`](./runner.md#the-auto-mode-playwright-prompt) exists so a person is never surprised by a headless run they did not ask for. Here nobody is present to ask, and the automation's setup script installing Playwright is that decision, made in advance |
| `playwright` | `playwright` |
| `chrome` | `NOT RUN (chrome driver unavailable on this host — no browser extension)`. A forced driver is never substituted |

This is the only question `ui-verify` asks, so on this host it asks none.

## The browser precondition

The setup script installs and smoke-tests Chromium once, and records the outcome in `UI_VERIFY_BROWSER`.
Check it before dispatching:

```bash
. /tmp/workspace/agent-skills/env.sh
[ "$UI_VERIFY_BROWSER" = ok ] || echo "NOT RUN (playwright browser unavailable in this sandbox: $UI_VERIFY_BROWSER_REASON)"
```

Anything but `ok` stops the run with that line.
It is `NOT RUN`, never `red`: no driver executed, so there is no verdict to be red about — the same class as the existing driver-unavailable returns, and `review-loop` Step 1.6 already maps it.

Then link the installed modules into `aw-tester`'s run directory, so its [Playwright resolution](../../../workflow/autonomous-workflow/templates/aw-tester.agent.md#pinned-playwright-resolution-replaces-npx---yes-playwrightlatest) takes rung 2 (branch-local) and never downloads at run time:

```bash
AW_DIR=".agent/$(git branch --show-current)/.aw-tester"
mkdir -p "$AW_DIR"
[ -x node_modules/.bin/playwright ] || ln -sfn "$UI_VERIFY_PLAYWRIGHT_NODE_MODULES" "$AW_DIR/node_modules"
```

The link carries both the `playwright` binary and the `@playwright/test` package the generated spec imports.
A project that has its own Playwright installed keeps rung 1, as it would anywhere else.
`PLAYWRIGHT_BROWSERS_PATH` from `env.sh` makes `aw-tester`'s idempotent `install chromium` a no-op.

## Dispatch `aw-tester` as a `general` sub-agent

In place of the `Task(subagent_type: "aw-tester", …)` block in [`runner.md § Step 4`](./runner.md#step-4-select-the-driver-and-run):

```text
<dispatch>(
  subagent_type: "general",
  description: "Run ui-verify against PR preview",
  prompt: |
    Run the specs at .agent/{branch}/.ui-verify/specs.md against aw-target "preview".
    Your procedure is /tmp/workspace/pr-reviewer/skills/autonomous-workflow/templates/aw-tester.agent.md — read it and follow it.
    Run `. /tmp/workspace/agent-skills/env.sh` at the start of every Bash call.
    Work in <the checkout directory>.
    Aw-Target file: .agent/{branch}/.ui-verify/aw-target.yml
    Specs file: .agent/{branch}/.ui-verify/specs.md
    Mode: --all --auto-capture
)
```

The input lines are the `runner.md` block's, unchanged, so the verdict shape is identical.
Drop `--auto-capture` under `--no-screenshots`, exactly as there.
The sub-agent is one level deep and dispatches nothing; `aw-tester` never does.

A reply that opens with a refusal or a `BLOCKED` line is `inconclusive: aw-tester refused (<first line>)`, never a verdict.

## Preview auth comes from the automation's secrets

[`preview-auth.md`](./preview-auth.md) already reads every credential from an environment variable named in `preview.yml` (`refresh.env`, `bypass_header`).
On this host those variables are the automation's `envVars` / secrets — set each one the committed `preview.yml` names.
One that is unset makes the authed specs `skipped`, exactly as it does in CI, and the report says which variable was missing.

## `setup` needs a human

`ui-verify setup` delegates to `aw-setup --target preview`, an interview.
On this host it stops with `blocked (needs a human: setup is interactive — run /ui-verify setup locally and commit .claude/aw-targets/preview.yml)`.
`author`, `run`, and `verify` need only the committed file it produces.
