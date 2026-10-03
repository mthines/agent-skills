---
name: ui-verify
description: >
  Makes a UI pull request autonomously verifiable. `author` writes a Markdown
  intent spec — the happy path plus out-of-bounds cases from a PR-scoped
  brainstorm — into the PR description as a collapsed, machine-findable block
  (delegated to by `create-pr` on UI diffs). `run` resolves the PR's live
  preview URL via the GitHub deployments API and runs the spec there through
  `aw-tester`, which may adapt the route but checks every expected outcome with
  evidence, and reports a verdict plus full-page screenshots (`--no-screenshots`
  opts out). It then tries to break the same change — hostile input, double
  submits, failed requests, small viewports — and documents every probe with
  screenshots, never changing the verdict (`--no-adversarial` opts out).
  `verify` is author-if-needed, then run. `setup` delegates to `aw-setup
  --target preview`. A LoreKit loop feeds runner friction into the next spec.
  Web only. Triggers on "write a preview spec", "verify this PR's preview",
  "try to break this PR's preview", "/ui-verify".
disable-model-invocation: false
argument-hint: '[setup|author|run|verify] [pr-url|pr-number|specs-path] [--url <preview-url>] [--driver auto|chrome|playwright] [--no-screenshots] [--no-adversarial] [--no-brainstorm|--brainstorm deep] [--unattended]'
license: MIT
allowed-tools: Bash(gh *) Bash(git *) Bash(jq *) Bash(node *) Read Edit Write Grep Glob Skill Task Agent AskUserQuestion mcp__github__pull_request_read mcp__github__update_pull_request mcp__lorekit__memory_list mcp__lorekit__memory_search mcp__lorekit__memory_read mcp__lorekit__memory_write
metadata:
  author: mthines
  version: '1.10.0'
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
---

# UI Verify

Attach an executable UI verification spec to a pull request, then run it against the live preview deployment.

A reviewer verifies a UI change by clicking through the preview.
`ui-verify` turns that click-through into an artifact an agent can follow: a short Markdown spec in the PR description, run against the deployed preview by `aw-tester`, reporting pass or fail.
The runner may take a different route than the written steps — it records each deviation — but it passes a spec only when every expected outcome was observed, with evidence, on the component the PR changed.

> **This `SKILL.md` is a thin index.**
> Detailed procedures live in [`rules/*.md`](./rules) and [`templates/*.md`](./templates).
> Each operation loads only what it needs.

## What this skill reuses

This skill owns four things and reuses the rest.

| Concern | Owner |
| --- | --- |
| The two spec formats — the **intent** format this skill writes (`Format: intent`: `**Changed:**`, `**Start:**`, `**Steps:**` with `[must-follow]`, `**Expected:**`), and the **grammar** it lifts (`WHEN/THEN/AND`, the locator mini-grammar, `url:`, `network:`, `semantic:`) | `aw-tester` — `templates/intent-spec.md.template` and [`specs.md.template`](../../workflow/autonomous-workflow/templates/specs.md.template), side by side. This skill references both and never forks either. The `semantic:` assertion (delegated to [`jev-assert`](../../quality/jev-assert/SKILL.md)) flows through unchanged because it lives in the shared grammar the runner parses. |
| The spec-run contract (locator ladder, auth semantics, verdict schema, and how an intent spec is explored, graded, cached, and replayed — § 6) | [`spec-run-contract.md`](../../workflow/autonomous-workflow/rules/spec-run-contract.md) — the engine-agnostic contract both runners implement. |
| The runners + the compact verdict | Two, one contract: [`aw-tester`](../../workflow/autonomous-workflow/templates/aw-tester.agent.md) (Playwright sub-agent) and [`aw-tester-chrome`](../../workflow/autonomous-workflow/aw-tester-chrome/SKILL.md) (in-session Chrome). `run --driver` picks one. |
| The browser context (`base_url`, auth, fixtures) | `aw-target.yml` — [`aw-target.yml.template`](../../workflow/autonomous-workflow/templates/aw-target.yml.template). |
| Scaffolding the committed preview aw-target (auth detection, the two walls, the confirming login, the repo-scoped records) | `aw-setup` — the `setup` operation is a thin delegator (`aw-setup --target preview`); this skill never reimplements it. |
| The two-way lessons loop | `aw-tester-lessons` (locator friction, existing) + `ui-verify-lessons` (navigation / spec-quality friction, new). See [`rules/memory.md`](./rules/memory.md). |
| **Embedding the spec in the PR body** (marker + collapsed block, ceiling exemption) | this skill — [`rules/spec-format.md`](./rules/spec-format.md). |
| **Resolving the PR's preview URL** (GitHub deployments API) | this skill — [`rules/preview-url-resolution.md`](./rules/preview-url-resolution.md). |
| **The author + run orchestration** | this skill — this file + [`rules/runner.md`](./rules/runner.md). |
| **The adversarial pass** (probe catalog, oracles, guardrails, evidence report) | this skill — [`rules/adversarial.md`](./rules/adversarial.md), harness [`templates/adversarial-probes.spec.ts.template`](./templates/adversarial-probes.spec.ts.template); rationale and sources in [`references/adversarial-testing.md`](./references/adversarial-testing.md). |
| **The out-of-bounds brainstorm** (pending states, baseline moves, the `fan-out` / `in-context` modes, recovery outcomes) | this skill — [`rules/out-of-bounds.md`](./rules/out-of-bounds.md); rationale in [`references/out-of-bounds-rationale.md`](./references/out-of-bounds-rationale.md). `--brainstorm deep` delegates to the `ideate` skill. |
| The severity tier that caps the out-of-bounds specs | `severity` — its [§ Severity rubric](../../quality/severity/SKILL.md#severity-rubric), inlined into the brainstorm judge's prompt; this skill owns only the gate (`critical` or `high`, one per move). |

## Operations

Parse `$ARGUMENTS`. The first token selects the operation.

| Operation | Trigger | What it does |
| --- | --- | --- |
| `setup` | first token `setup` | Scaffold the committed **preview** aw-target (`.claude/aw-targets/preview.yml`) this skill runs against — auth strategy, the two walls, the confirming login, the repo-scoped LoreKit auth profile + UI surface. A thin delegator to `aw-setup --target preview`; the discoverable front door so you never need the `aw` namespace. |
| `author` | first token `author`, or delegated from `create-pr` | Lift an existing grammar spec verbatim (the aw planner's `specs.md`), or write a Markdown intent spec from a `/fix-bug` repro or the diff, add the out-of-bounds specs a PR-scoped brainstorm selects by severity ([`rules/out-of-bounds.md`](./rules/out-of-bounds.md)), then inject the marked collapsed block into the PR body. Reads memory first. |
| `run` | first token `run` | Extract the block from the PR (or read a local `specs.md` path), resolve the preview URL, run the spec via the selected driver, then run the **adversarial pass** against every passing spec, report the verdict, the adversarial findings, **and the screenshots it captured**, write lessons. Screenshots are on by default (`--auto-capture`): full-page, each spec's final state plus each navigating step, into `.agent/{branch}/.aw-tester/captures/` for the PR description; `--no-screenshots` opts out. |
| `verify` | first token `verify` | One-shot composite for a PR with no spec: author-if-needed (author only when the block is absent — never overwrite a hand-written one), then `run` (with screenshots on, as above), then report a single combined verdict. The autonomous entry point for others' PRs and CI / agent0 automation. |

If no operation token is present, default to `author` when a diff or branch context is in scope, and `run` when only a PR reference is given. `setup` is always explicit.

### Drivers

`run` executes the spec through one of two runners — same grammar, same verdict, different engine. Pick with `--driver`:

| `--driver` | Runner | When |
| --- | --- | --- |
| `auto` (default) | Chrome if the extension is connected; otherwise Playwright, announced with a one-line notice — never a question | Everyday use — fast locally, correct everywhere. |
| `chrome` | [`aw-tester-chrome`](../../workflow/autonomous-workflow/aw-tester-chrome/SKILL.md), in-session | Force the fast see→act loop against your logged-in Chrome; never falls back to Playwright. |
| `playwright` | [`aw-tester`](../../workflow/autonomous-workflow/templates/aw-tester.agent.md) sub-agent | CI, remote envs, or no browser extension. |

`author` never touches a browser and takes no `--driver`.

### `--unattended` — never ask, never hang

`run` and `verify` take `--unattended` for callers with nobody to answer a question: a convergence loop (`review-loop` Step 1.6 always passes it), a CI job, or any Agent0 Automation.
Under `--unattended` the skill **never calls `AskUserQuestion`**, because on a host with no user an unanswered question blocks forever or errors, and on a host without the tool it cannot be asked at all.
Driver selection asks no question in either mode — `auto` falls back from Chrome to Playwright on its own ([`rules/runner.md § Step 4`](./rules/runner.md)) — so the flag changes only these points:

| Point | Attended | `--unattended` |
| --- | --- | --- |
| `auto`, Chrome unavailable or `inconclusive` with `fallback: playwright` | Playwright, with the one-line fallback notice | same |
| `auto`, no Chrome **and** no sub-agent dispatch | `NOT RUN (no Chrome extension and no sub-agent dispatch available)` | `inconclusive: no driver available (unattended — no Chrome extension, no sub-agent dispatch)` — no verdict, never `red` |
| `setup` | runs the interview | not accepted — `blocked (needs a human: setup is an interview)` |

A forced `--driver` behaves exactly as it does attended.

```text
❌ WRONG — an automated caller that may reach an interactive step
Skill("ui-verify", "run <PR-URL>")                 # no --unattended: nothing guarantees a question-free run

✅ RIGHT
Skill("ui-verify", "run <PR-URL> --unattended")    # Playwright, or an inconclusive line — never a question
```

**In a Dash0 Agent0 Automation sandbox** (`/tmp/workspace/agent-skills/env.sh` exists), read [`rules/agent0-runtime.md`](./rules/agent0-runtime.md) before Step 0.
It works from a checkout of the PR head, resolves `auto` straight to Playwright (no user is present, and Playwright is the only driver on an Agent0 host — installed by the automation's setup script or by the [on-demand install below](#on-demand-browser-install--run-and-verify)), checks the browser the setup installed, and dispatches `aw-tester` as a `general` sub-agent that reads its definition file — the host cannot dispatch the custom type.
`setup` is interactive and stops there as `blocked (needs a human …)`.
Agent0 mode implies [`--unattended`](#--unattended--never-ask-never-hang) whether or not the caller passed it.

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

Both operations touch GitHub.
Resolve which path you have — `gh` CLI, `mcp__github__*` tools, or neither — per **[`agents/shared/rules/github-access.md`](../../../agents/shared/rules/github-access.md)**.
Resolve once, state the path, and use it for the whole run.
The commands below are the `gh`-path form.

**On the `mcp` path, use these equivalents.**
Naming them here is load-bearing: the `gh`-path form above is not a mapping, and a reader who has to invent one writes nothing to the PR.

| `gh`-path command | `mcp`-path equivalent |
| --- | --- |
| `gh pr view <pr> --json body` | `mcp__github__pull_request_read` with `method: "get"` |
| `gh pr edit <pr> --body <body>` | `mcp__github__update_pull_request` with `body` |
| `gh api repos/<owner>/<repo>/deployments?sha=…` | **none — see below** |

**`author` works on both paths; `run`'s URL resolution does not.**
[`rules/preview-url-resolution.md`](./rules/preview-url-resolution.md) reads the GitHub deployments API, and no `mcp__github__*` tool exposes deployments.
So on the `mcp` path, `run` must take an explicit `--url <preview-url>` argument.
Without one, report `inconclusive: no access path for deployment lookup (pass --url)` and stop — never report `inconclusive: preview not deployed`, which claims a fact about the deployment that was never checked.

This paragraph is a summary; the branch is **enforced** in [`rules/preview-url-resolution.md § The access-path precondition`](./rules/preview-url-resolution.md#the-access-path-precondition-check-this-before-step-1), which owns the resolution decision and which [`rules/runner.md § Step 2`](./rules/runner.md) treats as terminal.
It has to live there because its condition is *`run` invoked without `--url`* — an argument this step cannot see.

## Operation `setup`

Scaffold the committed preview aw-target this skill runs against. This is a
**thin delegator** — the setup logic (auth detection, storage-state capture,
the two-wall / env-var flow, the confirming login, and the repo-scoped LoreKit
records) lives in one place, `aw-setup`, and is not reimplemented here. `setup`
is the discoverable front door: a `/ui-verify` user who hits a preview-auth wall
runs `/ui-verify setup` without needing to know the `aw` namespace.

Delegate, forwarding any extra tokens verbatim:

```text
Skill("aw-setup", "--target preview")
```

If `aw-setup` is not installed, say so and point the user at
[`rules/preview-auth.md`](./rules/preview-auth.md) to configure
`.claude/aw-targets/preview.yml` by hand — never scaffold a parallel setup here.

**What it produces** (all team-shared, by two mechanisms):

- **Committed files** — `.claude/aw-targets/preview.yml` and, for a
  non-interactive login, `refresh-auth.mjs`. These are the source of truth the
  tools execute (`aw-tester` reads the YAML, `node` runs the script, Playwright
  loads the gitignored `storage_state` by path), shared with the team **by git**.
- **Repo-scoped LoreKit records** — the UI surface and the auth profile, shared
  **by LoreKit**. These are agent-facing discovery indexes, not authoritative
  config; when a record and `preview.yml` disagree, the YAML wins. See
  [`rules/memory.md`](./rules/memory.md).

## Operation `author`

Inject one collapsed, marked UI verification spec into the PR body.

**Step 0 — decide "is this a UI change?" mechanically. Do not eyeball the diff.**
Run the shared `is-ui-diff` gate, which classifies the changed files against the repo's learned UI surface (falling back to broad defaults), so every caller — `create-pr`, `aw-planner`, `review-loop`, a standalone run — decides identically:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/is-ui-diff.mjs --base "$(git merge-base origin/HEAD HEAD)"
```

Read the final `UI_DIFF:` line. `no` → stop and report `not authored (no UI files in diff)`; never author a spec for a non-UI diff. `yes` → continue.

**Reflect the repo's learned UI surface when one exists.** The gate cannot call LoreKit itself — a script cannot reach an MCP tool — so read the surface record first (`memory.read` scope `repo::{owner}/{repo}`, key `ui-verify-lessons::ui-surface`; see [`rules/memory.md § The UI surface record`](./rules/memory.md#the-ui-surface-record)) and, when present, forward its JSON body so the gate reflects what *this* repo counts as UI:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/is-ui-diff.mjs --base <merge-base> --surface-json '<the record body>'
```

With no record the broad defaults apply, so a repo with no learnings yet still gets a correct answer. When a UI change slips through as `no` (or a non-UI diff as `yes`), that is a signal to refine the surface — see [`rules/memory.md § The UI surface record`](./rules/memory.md#the-ui-surface-record).

1. **Read memory first.** Load spec-authoring lessons and locator lessons per [`rules/memory.md § Read at author time`](./rules/memory.md). These tell you the app's navigation quirks and stable locators before you write a single step.
2. **Reuse an existing spec source when present.** Before writing anything, check for a spec artifact the surrounding flow already produced, in priority order (full contract: [`rules/spec-sources.md`](./rules/spec-sources.md)):
   - `.agent/{branch}/specs.md` — the autonomous-workflow planner's `aw-tester` specs, already run locally at Phase 4. Lift its `## Spec N:` blocks verbatim into a `<!-- ui-verify:v1 -->` block — never translate them.
   - A `/fix-bug` reproduction artifact for a UI or visual bug — an `e2e-testing` flow or a `repro/<id>.md` checklist. Rewrite it as an intent spec whose `**Expected:**` items are the fixed behavior.
   Both sources are gitignored, local-only files. This works because `author` runs in the same worktree that wrote them, and it copies their content into the **committed** PR body — the durable artifact `run` later reads. The gitignored file is never committed; only its lifted content reaches GitHub. See [`rules/spec-sources.md § Two artifacts, two lifetimes`](./rules/spec-sources.md#two-artifacts-two-lifetimes). When a source is found, seed the block from it and skip step 3, so the PR block matches what was verified locally rather than a second, divergent description of the same behavior.
3. **Otherwise, write an intent spec from the diff.** Read the diff (`git diff <base>...HEAD --name-status` plus the relevant files), then write one `## Spec N:` block per user-visible behavior the diff changes, per [`rules/spec-format.md § Writing an intent spec (v2)`](./rules/spec-format.md#writing-an-intent-spec-v2): name the `**Changed:**` target, start the step that exercises it with `[must-follow]`, and list each outcome under `**Expected:**` on that target. Put locators you know from lessons under `**Hints:**` in the role-and-name form. Keep it to the behaviors a reviewer would actually click through — 1 to 3 specs, not an exhaustive suite.
4. **Brainstorm out-of-bounds specs** for the pending states the changed component creates — what a user hits after ignoring, dismissing, reloading, leaving and returning to, or acting from a second tab on something the UI is waiting on — per [`rules/out-of-bounds.md`](./rules/out-of-bounds.md).
   Its [When it runs](./rules/out-of-bounds.md#when-it-runs) table picks the mode: `fan-out` (five generator sub-agents in one message, then one judge) whenever some available tool dispatches a sub-agent, `in-context` when none does, and `skipped` for `--no-brainstorm`, a lifted grammar block, or a diff with no pending state.
   Append the `Out of bounds:` intent specs it selects after the happy-path specs: `ignore`, `dismiss`, and `reload` for a pending user decision, then every candidate the `severity` rubric rates `critical` or `high`. Severity is the cap, not a count; each spec ends in a keep-going step and expects only recovery outcomes.
5. **Wrap and inject** the spec in the marked collapsed block per [`rules/spec-format.md`](./rules/spec-format.md), and write it into the PR body with the body-write call for your resolved [access path](#step-0-resolve-your-github-access-path), preserving everything already there.
Writing the block into the PR body is this operation's **only** deliverable, so a run that could not perform that write has not authored a spec.
Report it as `failed (no GitHub access path)` rather than reporting the specs you drafted — a drafted spec that never reached the PR is indistinguishable from none to every later reader, including `run`.

The block is **exempt from the `create-pr` description length ceiling** and is **preserved verbatim** by `review-loop`'s body refresh — both rules live in [`rules/spec-format.md`](./rules/spec-format.md) and in the [description contract](../../delivery/create-pr/rules/description-contract.md).

Report: how many specs were authored, and the one-line goal of each, then the brainstorm line from [`rules/out-of-bounds.md § Step 6`](./rules/out-of-bounds.md#step-6-report).

## Operation `run`

Run the embedded spec against the live preview.

Full procedure: **[`rules/runner.md`](./rules/runner.md)**. In outline:

1. **Get the spec.** Extract it from the PR body between the `<!-- ui-verify:v2 -->` markers, else the `<!-- ui-verify:v1 -->` markers, else the legacy `<!-- preview-spec:v1 -->` ones — the committed PR body is the only source that works on any checkout and in any later session. As a shortcut for a local author→run loop, `run <specs-path>` reads a local `specs.md` directly (no PR, no extraction). Absent → report `no spec` and stop.
2. **Resolve the preview URL** per [`rules/preview-url-resolution.md`](./rules/preview-url-resolution.md). A `--url <preview-url>` argument overrides resolution (required with a local `specs-path`, and required on the `mcp` path). Any `inconclusive: …` outcome from that file is terminal — report it and stop, without a pass or a fail. Its two commonest are `inconclusive: no access path for deployment lookup (pass --url)` (no lookup was possible) and `inconclusive: preview not deployed` (the lookup ran and found nothing). For a repo whose previews aren't GitHub-integrated (CLI-deployed in the repo's own CI, surfaced by a `github-actions[bot]` comment or a stable alias that isn't `*-git-*`), commit a `preview_url` block in `.claude/aw-targets/preview.yml` so resolution finds the URL without a manual `--url` each run — see [Repo-configured resolution](./rules/preview-url-resolution.md#repo-configured-resolution-when-previews-arent-github-integrated).
3. **Materialize** an ephemeral `specs.md` and an `aw-target.yml` overlay (`base_url` = resolved URL) under `.agent/{branch}/.ui-verify/`, reading auth and fixtures from a committed `.claude/aw-targets/preview.yml` when one exists.
4. **Select the driver and run** per `--driver` (see [Drivers](#drivers) and [`rules/runner.md § Step 4`](./rules/runner.md)). `auto` invokes `aw-tester-chrome` in-session when the Chrome extension is connected; when Chrome is unavailable or a Chrome run returns `fallback: playwright`, it prints a one-line fallback notice and runs the `aw-tester` sub-agent — no question, attended or under [`--unattended`](#--unattended--never-ask-never-hang). A forced `--driver chrome` never falls back; a forced `--driver playwright` skips Chrome. Mode `--all`.
   An intent spec (`Format: intent`) needs nothing extra from this skill: the runner replays a cached route when one matches the spec's text, otherwise explores the route from the steps, adapts plain steps, follows `[must-follow]` steps exactly, and grades every `**Expected:**` item with an evidence line (contract § 6).
   - **Then try to break it** ([`runner.md § Step 4b`](./rules/runner.md#step-4b-adversarial-pass--try-to-break-it)). Run the adversarial pass per [`rules/adversarial.md`](./rules/adversarial.md) against every spec that passed: hostile input, double submits, failed and slow requests, interrupted navigation, keyboard-only use, small viewports — only the categories the spec's surface exposes. Each probe leaves before/after screenshots under `.agent/{branch}/.ui-verify/adversarial/captures/` and a line in `report.md`; each finding carries steps, expected vs actual, and a severity. It **never changes the verdict** from step 4. `--no-adversarial` (or `adversarial.enabled: false` in `preview.yml`) skips it.
5. **Report** the verdict (pass / fail / inconclusive, per spec) — identical shape from either driver — then, for an intent spec, each spec's route, its `Expected` items with their evidence, and its deviations ([`runner.md § Step 5`](./rules/runner.md#step-5-report-the-verdict)), then the adversarial summary line and its findings.
6. **Write lessons** per [`rules/memory.md § Write at run time`](./rules/memory.md) when a spec failed for a navigation or precondition reason — not for a locator miss, which is the runner's own lesson to write.

## Operation `verify`

One-shot: make a PR autonomously verifiable and verify it, in a single call.
This is the entry point for a PR you did not author — a teammate's, or one an
agent0 / CI automation is checking against a Vercel-style preview — where no
spec exists yet.

1. **Author if, and only if, the block is absent.** Read the PR body. If it
   already carries a ui-verify block of any version — `<!-- ui-verify:v2 -->`,
   `<!-- ui-verify:v1 -->`, or the legacy `<!-- preview-spec:v1 -->` — keep it
   verbatim — never overwrite a hand-written or previously-authored spec. If it is absent, run
   Operation `author` (including its Step 0 `is-ui-diff` gate, and honouring
   `--no-brainstorm` and `--brainstorm deep` exactly as `author` does): a `no` from the
   gate ends `verify` here with `not verified (no UI files in diff)`, and a
   `failed (no GitHub access path)` from `author` ends it with that same reason —
   there is nothing to run.
2. **Run.** Then run Operation `run` against the resolved preview URL, honouring
   `--url`, `--driver`, `--no-adversarial`, and `--unattended` exactly as `run` does —
   including its adversarial pass. On the `mcp` path (or a local
   `specs-path`), `--url` is required — without it, report
   `inconclusive: no access path for deployment lookup (pass --url)` and stop,
   never `preview not deployed`.
3. **Report one combined verdict.** State whether the spec was authored fresh or
   reused, then the `run` verdict (pass / fail / inconclusive, per spec), then the
   adversarial summary line. A red verdict is a finding about the PR, not a
   `verify` failure.

`verify` composes the two existing operations and adds no new browser or
GitHub behaviour — every hard rule below applies unchanged. It is idempotent:
a second `verify` on the same PR reuses the block authored by the first.

## Hard rules

- **Never fork either spec format.** Both are `aw-tester`'s: the grammar in `specs.md.template`, the intent format in `intent-spec.md.template`. If a behavior cannot be expressed in them, say so — do not invent syntax or fields.
- **A route may change; an outcome may not.** An intent spec passes only when every `**Expected:**` item was observed with an evidence line, every `[must-follow]` step was performed as written, and the `**Changed:**` target was exercised — the contract's grading table decides, never judgment. Deviations on plain steps are reported, never failed.
- **Never weaken a spec to make it pass.** A red verdict is a finding, not a failure of this skill.
- **Never store a secret in the spec, the target file, or a lesson.** Preview-auth credentials live in the committed `preview.yml`'s refresh command or in the environment, never in the PR body — the spec is public.
- **On Agent0, `aw-tester` is still a dispatched sub-agent.** Never run the spec in the orchestrating context; dispatch a `general` sub-agent pointed at its definition file ([`rules/agent0-runtime.md`](./rules/agent0-runtime.md)). A missing sandbox browser is `NOT RUN (…)` with the setup script's reason, never `red`.
- **The out-of-bounds brainstorm runs only in `author`, from the session that can dispatch.** `fan-out` sends exactly five generators in one message and then one judge, none of which dispatches; with no dispatch tool it runs `in-context`. `run` and the adversarial pass never brainstorm ([`rules/out-of-bounds.md`](./rules/out-of-bounds.md)).
- **`--unattended` never asks.** No `AskUserQuestion` on any path; every question point takes the fixed answer in [`--unattended`](#--unattended--never-ask-never-hang), and a run with no driver is `inconclusive`, never a hang and never `red`.
- **The runner reports; it does not fix.** Applying a fix for a failing spec is the author's job (a better spec) or the PR author's (a code change).
- **The adversarial pass never changes the verdict, and never acts destructively.** Its findings travel in their own `adversarial:` block; it probes only specs that passed, stays on the preview origin, stubs configured side-effect endpoints, and activates a destructive control only on a record it created ([`rules/adversarial.md § Guardrails`](./rules/adversarial.md#guardrails)).
