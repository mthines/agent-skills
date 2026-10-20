---
name: ui-verify
description: >
  Makes a UI PR autonomously verifiable: `author` writes an intent spec into the
  PR body; `run` checks it on the preview (or a local stack with `--env local`)
  with evidence, an adversarial pass, and telemetry-verify; `verify` does both;
  `--post-findings` feeds `review-loop --ui`. Config: `.agents/aw/`.
  Web only; triggers on "write a preview spec", "verify this PR's preview", "try
  to break this PR's preview", "/ui-verify".
disable-model-invocation: false
argument-hint: '[author|run|verify] [pr-url|pr-number|specs-path] [--env preview|local] [--url <url>] [--driver auto|chrome|playwright] [--no-screenshots] [--no-recording] [--no-adversarial] [--no-telemetry] [--post-findings] [--attach-media] [--wait-preview <min>] [--no-brainstorm|--brainstorm deep] [--unattended]'
license: MIT
allowed-tools: Bash(gh *) Bash(git *) Bash(jq *) Bash(node *) Read Edit Write Grep Glob Skill Task Agent AskUserQuestion mcp__github__pull_request_read mcp__github__update_pull_request mcp__github__pull_request_review_write mcp__github__add_comment_to_pending_review mcp__github__add_issue_comment mcp__github__update_issue_comment mcp__Dash0__getWebEvents mcp__Dash0__getAttributeKeys mcp__Dash0__generateDash0Url mcp__lorekit__memory_list mcp__lorekit__memory_search mcp__lorekit__memory_read mcp__lorekit__memory_write
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: slash-command
  tags:
    - playwright
    - ui-verification
    - preview-deployment
    - pull-request
    - aw-tester
    - github-deployments
    - lorekit
    - self-improvement
    - telemetry
    - screen-recording
---

# UI Verify

Attach an executable UI verification spec to a pull request, then run it against the live preview deployment.
The runner may take a different route than the written steps — it records each deviation — but it passes a spec only when every expected outcome was observed, with evidence, on the component the PR changed.

## Contents

- [Files](#files)
- [Operations](#operations)
- [On a Dash0 Agent0 host](#on-a-dash0-agent0-host)
- [Step 0: Resolve your GitHub access path](#step-0-resolve-your-github-access-path)
- [Operation `author`](#operation-author) · [`run`](#operation-run) · [`verify`](#operation-verify)
- [Hard rules](#hard-rules)

## Files

This skill's own rules are linked where they apply below. It reuses these and never forks them:

| Concern | Owner |
| --- | --- |
| Spec formats: intent (`Format: intent`) and grammar (`WHEN/THEN/AND`, locators, `url:`, `network:`, `semantic:` via [`jev-assert`](../../quality/jev-assert/SKILL.md)) | `aw-tester`'s `templates/intent-spec.md.template` and [`specs.md.template`](../../workflow/autonomous-workflow/templates/specs.md.template) |
| Spec-run contract (locators, auth, verdict, intent grading — § 6, `--record-video`) | [`spec-run-contract.md`](../../workflow/autonomous-workflow/rules/spec-run-contract.md) |
| Config: environments, login, fixtures, UI surface, adversarial settings | `.agents/aw/environments.yml` and `.agents/aw/ui.yml` — the `aw-verify` skill's `rules/config.md`; written by `/aw-verify setup` |
| Telemetry of the run | `telemetry-verify`, dispatched per window ([`rules/runner.md § Step 4c`](./rules/runner.md#step-4c-telemetry--telemetry-verify-on-each-window)) |
| Out-of-bounds severity cap (`critical` or `high`, one per move) | the tier table in [`rules/out-of-bounds.md`](./rules/out-of-bounds.md) |

Why `SKILL.md` is shaped this way: [`references/skill-design.md`](./references/skill-design.md).

## Operations

The first token of `$ARGUMENTS` selects the operation.
With no operation token, default to `author` when a diff or branch context is in scope, and `run` when only a PR reference is given.
Setup is `/aw-verify setup`; this skill has none.

| Operation | Does |
| --- | --- |
| `author` | Write the spec block into the PR body (also delegated to by `create-pr`). |
| `run` | Run the block (or a local `specs.md`) on the preview — or a local stack with `--env local --url <url>` — try to break it, read its telemetry, report; screenshots on by default (`--no-screenshots` opts out). |
| `verify` | `author` if no block exists, then `run` — the entry point for others' PRs and automation. |

`run` picks a driver with `--driver`; `author` never touches a browser and takes no `--driver`.

| `--driver` | Runner |
| --- | --- |
| `auto` (default) | Chrome if the extension is connected; otherwise Playwright, announced with a one-line notice — never a question |
| `chrome` | [`aw-tester-chrome`](../../workflow/autonomous-workflow/aw-tester-chrome/SKILL.md) in-session; never falls back to Playwright |
| `playwright` | [`aw-tester`](../../workflow/autonomous-workflow/templates/aw-tester.agent.md) sub-agent — CI, remote envs, no browser extension |

`--unattended` (for loops, CI, and Agent0): read [`rules/unattended.md`](./rules/unattended.md) when the flag is passed or the host is Agent0.

## On a Dash0 Agent0 host

**In a Dash0 Agent0 Automation sandbox** (`/tmp/workspace/agent-skills/env.sh` exists), read [`rules/agent0-runtime.md`](./rules/agent0-runtime.md) before Step 0.
It works from a checkout of the PR head, resolves `auto` straight to Playwright (no user is present, and Playwright is the only driver on an Agent0 host — installed by the automation's setup script or by the [on-demand install below](#on-demand-browser-install--run-and-verify)), checks the browser the setup installed, and dispatches `aw-tester` as a `general` sub-agent that reads its definition file — the host cannot dispatch the custom type.
Agent0 mode implies [`--unattended`](./rules/unattended.md) whether or not the caller passed it.

**Read linked files from the install, never from the imported folder.**
An Agent0 import can hold this `SKILL.md` alone, with no `rules/` or `scripts/` beside it.
Whenever `/tmp/workspace/agent-skills/env.sh` exists, source it (`. /tmp/workspace/agent-skills/env.sh`) in every Bash call, and read every `rules/…` or `scripts/…` file this skill links from `$AGENT_SKILLS_ROOT/skills/ui-verify/`, every sibling skill from `$AGENT_SKILLS_ROOT/skills/<name>/`, and every `agents/<path>` link from `$AGENT_SKILLS_ROOT/<path>`.
When `$AGENT_SKILLS_ROOT/skills/ui-verify/SKILL.md` differs from the copy you are running, or you cannot compare them, follow the installed copy: **the installed copy at `$AGENT_SKILLS_COMMIT` wins**, because the rules it links come from that commit, and an import is a snapshot that goes stale.

**An unprepared Agent0 host** has no `env.sh` but has `/tmp/workspace`, `/tmp/.opencode/skills/`, or `/tmp/.opencode/agents/general.md`.
`run` and `verify` install the Playwright browser themselves on this host — see [On-demand browser install — run and verify](#on-demand-browser-install--run-and-verify) below — and report `NOT RUN (Agent0 sandbox not prepared: …)` only when that install itself fails, never a question and never a `red`.
Check for this host first, before Step 0 and before running any script this skill links.
There, `author` stops with `not authored (Agent0 sandbox not prepared: add scripts/agent0-setup.sh as the automation's sandbox.setupScript)`, because its Step 0 runs `scripts/is-ui-diff.mjs`, which a `SKILL.md`-only import does not contain, and `author` needs no browser, so it never runs the on-demand block.
`verify` runs the on-demand block's stage (a) — the base install — before Step 0, so by the time `author`'s own `is-ui-diff.mjs` gate would run, the host already has `env.sh` and the scripts that install copies alongside it: `author`'s `not authored (Agent0 sandbox not prepared: …)` line above fires only when that base install itself fails, not on every unprepared host.

#### On-demand browser install — run and verify

This block is owned here, not in a linked file, because a `SKILL.md`-only import must still reach it.
It runs only for `run` and `verify`, never under `--driver chrome` and never for `author` — none of those need a Playwright browser.
Why each line here is shaped the way it is: [`references/agent0-browser-install.md`](./references/agent0-browser-install.md).
Run it with the Bash tool's `timeout: 600000` — the worst case sits close to it.

```bash
# ui-verify run/verify: the host is Agent0 and the recorded browser isn't ok
# (or there is no marker at all). Two stages: a fast base install when the
# marker is entirely absent, then a bounded top-up that installs the browser
# itself — at most once per sandbox (the sentinel below).
M=/tmp/workspace/agent-skills/env.sh
B=/tmp/workspace/.agent-skills-install
SENT=/tmp/workspace/.agent-skills-install/playwright.attempted
if [ -d /tmp/workspace ] || [ -d /tmp/.opencode/skills ] || [ -f /tmp/.opencode/agents/general.md ]; then A0=1; else A0=0; fi
if [ "$A0" = 1 ]; then
  if [ ! -f "$M" ]; then
    mkdir -p /tmp/workspace "$B" && rm -f "$B/AGENTS.md.before"
    [ -e /tmp/workspace/AGENTS.md ] && cp -p /tmp/workspace/AGENTS.md "$B/AGENTS.md.before"
    rc=1
    if curl -fsSL --max-time 30 -o "$B/agent0-setup.sh" \
         https://raw.githubusercontent.com/mthines/agent-skills/main/scripts/agent0-setup.sh; then
      WITH_PLAYWRIGHT=0 timeout 200 bash "$B/agent0-setup.sh" > "$B/setup.log" 2>&1
      rc=$?
    else
      echo "could not download scripts/agent0-setup.sh" > "$B/setup.log"
    fi
    if [ -e "$B/AGENTS.md.before" ]; then
      cp -p "$B/AGENTS.md.before" /tmp/workspace/AGENTS.md
    else
      rm -f /tmp/workspace/AGENTS.md
    fi
    [ "$rc" = 0 ] || rm -f "$M"
  fi
  if [ ! -f "$M" ]; then
    echo "BROWSER: not prepared — $(tail -n 1 "$B/setup.log" 2>/dev/null)"
  else
    . "$M"
    if [ "$UI_VERIFY_BROWSER" = ok ]; then
      echo "BROWSER: ok (prepared)"
    elif [ -f "$SENT" ]; then
      echo "BROWSER: unavailable — $(cat "$SENT")"
    else
      mkdir -p "$B"
      start=$SECONDS
      # Prefer the $HOST copy agent0-setup.sh already placed and verified
      # (D-B) — a prepared-then-degraded sandbox needs no second download.
      # Fall back to curling from main only when that copy is absent (an
      # install from an older commit).
      SCRIPT=/tmp/workspace/agent-skills/agent0-playwright.sh
      if [ ! -f "$SCRIPT" ]; then
        SCRIPT="$B/agent0-playwright.sh"
        if ! curl -fsSL --max-time 30 -o "$SCRIPT" \
             https://raw.githubusercontent.com/mthines/agent-skills/main/scripts/agent0-playwright.sh; then
          echo "could not download scripts/agent0-playwright.sh" > "$B/playwright.log"
          SCRIPT=""
        fi
      fi
      if [ -n "$SCRIPT" ]; then
        BUDGET=280 timeout 300 bash "$SCRIPT" > "$B/playwright.log" 2>&1
        rc=$?
        . "$M"
      else
        rc=1
      fi
      if [ "$rc" = 0 ] && [ "$UI_VERIFY_BROWSER" = ok ]; then
        echo "BROWSER: ok (installed on demand, $((SECONDS - start))s)"
      else
        # rc != 0 means agent0-playwright.sh never ran (no script) or the
        # outer `timeout 300` killed it before it rewrote $M — either way
        # $M's reason (if any) is stale, so never trust it here: read the
        # run log directly instead of falling back to a leftover env value.
        if [ "$rc" = 0 ]; then
          reason="${UI_VERIFY_BROWSER_REASON:-$(tail -n 1 "$B/playwright.log" 2>/dev/null)}"
        else
          reason="$(tail -n 1 "$B/playwright.log" 2>/dev/null)"
        fi
        echo "$reason" > "$SENT"
        echo "BROWSER: unavailable — $reason"
      fi
    fi
  fi
else
  echo "BROWSER: not run (not an Agent0 host)"
fi
```

Read the outcome from the last line:

| Last line | Do |
| --- | --- |
| `BROWSER: ok (prepared)` | Continue exactly as the prepared-host path already does. |
| `BROWSER: ok (installed on demand, <N>s)` | Continue the same way, and report the browser source as `installed on demand (<N>s)`. |
| `BROWSER: unavailable — <reason>` | Stop with `NOT RUN (playwright browser unavailable in this sandbox: <reason>)`. The sentinel means a second `run`/`verify` in the same sandbox reports this immediately — never a second multi-minute attempt. |
| `BROWSER: not prepared — <reason>` | Stop with `NOT RUN (Agent0 sandbox not prepared: on-demand install failed: <reason>)`. |
| `BROWSER: not run (not an Agent0 host)` | Not Agent0 — continue the local, non-sandbox path unchanged. |

## Step 0: Resolve your GitHub access path

Resolve which path you have — `gh` CLI, `mcp__github__*` tools, or neither — per [`agents/shared/rules/github-access.md`](../../../agents/shared/rules/github-access.md).
Resolve once, state the path, and use it for the whole run.
The commands in this skill are the `gh`-path form; on the `mcp` path use these equivalents:

| `gh`-path command | `mcp`-path equivalent |
| --- | --- |
| `gh pr view <pr> --json body` | `mcp__github__pull_request_read` with `method: "get"` |
| `gh pr edit <pr> --body <body>` | `mcp__github__update_pull_request` with `body` |
| `gh api repos/<owner>/<repo>/pulls/<n>/comments … -f subject_type=file` (`--post-findings` threads) | `mcp__github__pull_request_review_write` (`create`, then `submit_pending`) around `mcp__github__add_comment_to_pending_review` with `subjectType: "FILE"` |
| `gh api repos/<owner>/<repo>/issues/<n>/comments` (the `--post-findings` summary) | `mcp__github__add_issue_comment`, or `mcp__github__update_issue_comment` when it exists |
| `gh api repos/<owner>/<repo>/deployments?sha=…` | **none — see below** |

**`author` works on both paths; `run`'s URL resolution does not.**
No `mcp__github__*` tool exposes deployments, so on the `mcp` path `run` must take an explicit `--url <preview-url>`.
Without one, report `inconclusive: no access path for deployment lookup (pass --url)` and stop — never report `inconclusive: preview not deployed`, which claims a fact about the deployment that was never checked.
[`rules/preview-url-resolution.md § The access-path precondition`](./rules/preview-url-resolution.md#the-access-path-precondition-check-this-before-step-1) enforces this branch, and [`rules/runner.md § Step 2`](./rules/runner.md) treats it as terminal.

## Operation `author`

Inject one collapsed, marked UI verification spec into the PR body.

**Step 0 — decide "is this a UI change?" with the shared gate, never by eyeballing the diff.**
When `.agents/aw/ui.yml` sets `surface`, forward it to the gate as JSON (the gate's fields: `mode`, `extensions`, `dirExtensions`, `dirs`, `globs` — `include` is accepted as `globs` — and `exclude`):

```bash
node ${CLAUDE_SKILL_DIR}/scripts/is-ui-diff.mjs --base "$(git merge-base origin/HEAD HEAD)" [--surface-json '<ui.yml surface as JSON>']
```

Read the final `UI_DIFF:` line: `no` → stop with `not authored (no UI files in diff)`; `yes` → continue.
A misclassified diff is a signal to refine `ui.yml`'s `surface` ([`rules/memory.md § The UI surface`](./rules/memory.md#the-ui-surface)).

1. **Read memory first** — spec-authoring and locator lessons per [`rules/memory.md § Read at author time`](./rules/memory.md).
2. **Reuse an existing spec source** in priority order ([`rules/spec-sources.md`](./rules/spec-sources.md)): `.agent/{branch}/specs.md` (written by `/aw` or `/aw-verify`) — lift its `## Spec N:` blocks verbatim, never translated, into a `<!-- ui-verify:v2 -->` block when its header has `Format: intent`, else a `<!-- ui-verify:v1 -->` block; else a `/fix-bug` repro artifact for a UI bug — rewrite it as an intent spec whose `**Expected:**` items are the fixed behavior. When a source is found, seed the block from it and skip step 3.
3. **Otherwise write an intent spec from the diff** per [`rules/spec-format.md § Writing an intent spec (v2)`](./rules/spec-format.md#writing-an-intent-spec-v2): one `## Spec N:` per user-visible behavior, name the `**Changed:**` target, mark the step that exercises it `[must-follow]`, list each outcome under `**Expected:**`, and put known locators under `**Hints:**`. 1 to 3 specs.
4. **Brainstorm out-of-bounds specs** for the pending states the changed component creates, per [`rules/out-of-bounds.md`](./rules/out-of-bounds.md); its [When it runs](./rules/out-of-bounds.md#when-it-runs) table picks `fan-out`, `in-context`, or `skipped`. Append the `Out of bounds:` specs it selects: `ignore`, `dismiss`, and `reload` for a pending user decision, then every candidate the `severity` rubric rates `critical` or `high`. Severity is the cap, not a count; each spec ends in a keep-going step and expects only recovery outcomes.
5. **Wrap and inject** the block per [`rules/spec-format.md`](./rules/spec-format.md) with the body-write call for your [access path](#step-0-resolve-your-github-access-path), preserving everything already in the body. When that write cannot be made, report `failed (no GitHub access path)` — never the drafted specs.

The block is exempt from the `create-pr` description length ceiling and preserved verbatim by `review-loop`'s body refresh ([`rules/spec-format.md`](./rules/spec-format.md), [description contract](../../delivery/create-pr/rules/description-contract.md)).

Report the number of specs authored with the one-line goal of each, then the brainstorm line from [`rules/out-of-bounds.md § Step 6`](./rules/out-of-bounds.md#step-6-report).

## Operation `run`

Follow [`rules/runner.md`](./rules/runner.md). In outline:

1. **Get the spec** from the PR body between the `<!-- ui-verify:v2 -->` markers, else `<!-- ui-verify:v1 -->`, else the legacy `<!-- preview-spec:v1 -->`. `run <specs-path>` reads a local `specs.md` instead. Absent → report `no spec` and stop.
2. **Resolve the preview URL** per [`rules/preview-url-resolution.md`](./rules/preview-url-resolution.md); `--url` overrides it and is required with a local `specs-path` or on the `mcp` path. Any `inconclusive: …` from that file is terminal.
3. **Materialize** `.agent/{branch}/.ui-verify/specs.md` and `aw-tester`'s target `.agent/{branch}/aw-target.<env>.yml` from `.agents/aw/environments.yml` and `ui.yml` ([`runner.md § Step 3`](./rules/runner.md#step-3-materialize-the-ephemeral-files)).
4. **Run** with the selected driver, mode `--all` ([`runner.md § Step 4`](./rules/runner.md#step-4-select-the-driver-and-run)). Then, in parallel, the adversarial pass against every passing spec ([`rules/adversarial.md`](./rules/adversarial.md); `--no-adversarial` skips) and `telemetry-verify` on the spec window, then `telemetry-verify` on the adversarial window ([`runner.md § Step 4c`](./rules/runner.md#step-4c-telemetry--telemetry-verify-on-each-window); `--no-telemetry` skips). Neither changes the verdict. Playwright runs record every spec and adversarial finding ([`rules/recording.md`](./rules/recording.md); `--no-recording` skips).
5. **Report** per [`runner.md § Step 5`](./rules/runner.md#step-5-report-the-verdict): per-spec verdict, intent-spec routes, evidence and deviations, screenshots, recordings, then the adversarial and telemetry lines and findings. `--post-findings` also writes blocking results as review threads ([`rules/post-findings.md`](./rules/post-findings.md)). `--attach-media` puts screenshots and passing-spec recordings into the PR body via `Skill("attach-media", …)`; a local `specs-path` run reports `attach-media: skipped (no PR)`.
6. **Write lessons** per [`rules/memory.md § Write at run time`](./rules/memory.md) for a navigation or precondition failure — never for a locator miss, which is the runner's own lesson.

## Operation `verify`

1. **Author only when no block exists.** If the PR body carries `<!-- ui-verify:v2 -->`, `<!-- ui-verify:v1 -->`, or the legacy `<!-- preview-spec:v1 -->`, keep it verbatim. Otherwise run Operation `author`, honouring
   `--no-brainstorm` and `--brainstorm deep` exactly as `author` does; a gate `no` ends with `not verified (no UI files in diff)`, and `author`'s `failed (no GitHub access path)` ends `verify` with that reason.
2. **Run** Operation `run`, honouring `--env`, `--url`, `--driver`, `--no-adversarial`, `--no-recording`, `--no-telemetry`, `--post-findings`, `--attach-media`, `--wait-preview`, and `--unattended` exactly as `run` does. On the `mcp` path or with a local `specs-path`, no `--url` → `inconclusive: no access path for deployment lookup (pass --url)`.
3. **Report one combined verdict**: spec authored fresh or reused, the `run` verdict per spec, then the adversarial and telemetry lines. A red verdict is a finding about the PR.

## Hard rules

- **Never fork either spec format.** Both are `aw-tester`'s: the grammar in `specs.md.template`, the intent format in `intent-spec.md.template`. If a behavior cannot be expressed in them, say so — never invent syntax or fields.
- **A route may change; an outcome may not.** An intent spec passes only when every `**Expected:**` item was observed with an evidence line, every `[must-follow]` step was performed as written, and the `**Changed:**` target was exercised — the contract's grading table decides. Deviations on plain steps are reported, never failed.
- **Never weaken a spec to make it pass, and never fix code.** A red verdict is a finding; the runner reports.
- **Never store a secret in the spec, the target file, or a lesson.** Credentials live in the environment, named by `.agents/aw/environments.yml`; the spec is public.
- **On Agent0, `aw-tester` is still a dispatched sub-agent** — a `general` sub-agent pointed at its definition file ([`rules/agent0-runtime.md`](./rules/agent0-runtime.md)). A missing sandbox browser is `NOT RUN (…)`, never `red`.
- **The out-of-bounds brainstorm runs only in `author`, from the session that can dispatch.** `fan-out` sends exactly five generators in one message and then one judge, none of which dispatches; with no dispatch tool it runs `in-context`. `run` and the adversarial pass never brainstorm.
- **`--unattended` never asks** ([`rules/unattended.md`](./rules/unattended.md)): no `AskUserQuestion` on any path, and a run with no driver is `inconclusive`, never a hang or `red`.
- **Telemetry never changes the verdict, and this skill never queries it** — `telemetry-verify` reads each window ([`rules/runner.md § Step 4c`](./rules/runner.md#step-4c-telemetry--telemetry-verify-on-each-window)).
- **Only `--post-findings` writes review threads, and only blocking results**: a failing spec, a `critical`/`high` adversarial finding, or a `critical`/`high` telemetry finding, deduped by fingerprint ([`rules/post-findings.md`](./rules/post-findings.md)).
- **The adversarial pass never changes the verdict, and never acts destructively** — passing specs only, preview origin only, side-effect endpoints stubbed, destructive controls only on records it created ([`rules/adversarial.md § Guardrails`](./rules/adversarial.md#guardrails)).
