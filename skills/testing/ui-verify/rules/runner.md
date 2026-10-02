---
title: Runner — extract, resolve, materialize, dispatch aw-tester, report
impact: HIGH
tags:
  - ui-verify
  - aw-tester
  - playwright
  - runner
---

# Runner

The `run` operation: get the spec, point the selected runner at the live preview, and report its verdict.
The runner is an **on-demand orchestrator** — it resolves once, dispatches the spec run and then the [adversarial pass](./adversarial.md), reads both results, and writes lessons. It does not watch, retry the browser, or fix code. It picks between two runners with `--driver`; both emit the same verdict per the [spec-run contract](../../../workflow/autonomous-workflow/rules/spec-run-contract.md).

## Contents

- [Step 1: Get the spec](#step-1-get-the-spec)
- [Step 2: Resolve the preview URL](#step-2-resolve-the-preview-url)
- [Step 3: Materialize the ephemeral files](#step-3-materialize-the-ephemeral-files)
- [Step 4: Select the driver and run](#step-4-select-the-driver-and-run)
- [Step 4b: Adversarial pass — try to break it](#step-4b-adversarial-pass--try-to-break-it)
- [Step 5: Report the verdict](#step-5-report-the-verdict)
- [Step 6: Write lessons](#step-6-write-lessons)

## Step 1: Get the spec

**From the PR (default).** Read the PR body with the call for your resolved access path ([`SKILL.md` Step 0](../SKILL.md#step-0-resolve-your-github-access-path) holds the mapping): `gh pr view <pr> --json body -q .body` on the `gh` path, `mcp__github__pull_request_read` with `method: "get"` on the `mcp` path.
Unlike the deployment lookup in Step 2, this read has an mcp equivalent, so an absent `gh` never blocks it.
Extract the region between `<!-- ui-verify:v1 -->` and `<!-- /ui-verify:v1 -->` (see [`spec-format.md`](./spec-format.md)).
**Legacy fallback:** if that marker is absent, look for the former `<!-- preview-spec:v1 -->` … `<!-- /preview-spec:v1 -->` region — a block authored before this skill was renamed — and run it identically (the body grammar is unchanged). Only when *neither* marker is present is there no spec.
The committed PR body is the **only** source the PR path reads. It never reads `.agent/{branch}/specs.md` — that file is gitignored and absent on a fresh checkout ([`spec-sources.md § Two artifacts, two lifetimes`](./spec-sources.md#two-artifacts-two-lifetimes)). Verifying against the PR is therefore independent of any local aw run.

- No markers → report `no spec — nothing to run` and stop. The PR has no embedded spec; `author` never ran, or the diff was not UI.
- Markers present but empty body → report `empty spec` and stop.

Strip the `<details>` / `<summary>` wrapper and the markers. What remains is the `specs.md` body (the `Target:` / `Refactor:` header plus the `## Spec N:` blocks).

**From a local path (shortcut).** When the run argument is a filesystem path to a `specs.md` (a local author→run loop, before any PR exists), read it verbatim and skip extraction. A local path requires `--url <preview-url>` — there is no PR to resolve a deployment from. This path is for fast local iteration; the durable, checkout-independent source is still the PR body.

## Step 2: Resolve the preview URL

Resolve the URL per [`preview-url-resolution.md`](./preview-url-resolution.md).
Any `inconclusive: …` outcome there is terminal for this run — report it and stop. The spec was not run; do not report a pass or a fail.
That resolution also consults the committed `.claude/aw-targets/preview.yml`'s optional `preview_url` block (after `--url`, before the deployments API) — so a repo whose CI CLI-deploys previews behind a `github-actions[bot]` comment resolves without a manual `--url`.

## Step 3: Materialize the ephemeral files

Write two files under `.agent/{branch}/.ui-verify/` (the branch is the PR's head ref; the directory is git-ignored scratch):

1. **`specs.md`** — the extracted spec body from Step 1, verbatim.
2. **`aw-target.yml`** — the browser context, built as follows:
   - If `.claude/aw-targets/preview.yml` exists in the repo, start from it (auth, fixtures, constraints) and set `base_url` to the resolved URL. This is how a preview behind Vercel deployment protection or an app login gets authenticated — the committed file carries the auth **strategy**, never the credentials. The full flow (the two walls, the CI env-var path, the Google-SSO caveat) is [`preview-auth.md`](./preview-auth.md).
   - If it does not exist, first look for an existing repo auth convention the way `aw-setup` does ([aw-setup § Reuse before you scaffold](../../../workflow/autonomous-workflow/aw-setup/SKILL.md#reuse-before-you-scaffold)) — a `.claude/aw-targets/*.yml` with `auth.storage_state`, a captured `.browser/auth-state*.json`, or a `refresh-auth*.mjs` login script — and reuse it: point `storage_state` / `refresh.command` at it, capturing against the resolved `PREVIEW_URL`. Only when no convention exists, scaffold from [`templates/preview-target.yml.template`](../templates/preview-target.yml.template) with `auth.strategy: none` and note in the report that authed specs will be skipped by `aw-tester`.
   - Always override `base_url` with the resolved URL, no trailing slash.

   **Auth is env-var-driven and runs here, before the spec run:**
   - Export `PREVIEW_URL` (the resolved URL) for the auth commands to read.
   - When `auth.refresh` is configured (and `when: always`, or the `storage_state` file is missing/stale), run `refresh.command` — it reads the credentials named in `refresh.env` from the environment (a CI secret, an OS-keychain export, or a local `.env`), logs in non-interactively, and writes the gitignored `storage_state`. It never receives a credential from this runner or from any file. If a required env var is unset, the command fails loudly and the run reports the authed specs `skipped`, never a false pass.
   - When `auth.bypass_header` is configured, carry the block **verbatim** (name + env-var reference) into the ephemeral `aw-target.yml`. Do **not** resolve the secret here — `aw-tester` reads the env var and applies the header to its own Playwright context at launch (Step 4), so the value never enters this runner's scope or logs.

Never write the resolved URL or any credential into the committed `.claude/aw-targets/preview.yml` — only into the ephemeral `.agent/{branch}/.ui-verify/aw-target.yml`, and even there a credential is a **reference** (the env-var name), never a value.

## Step 4: Select the driver and run

Resolve `--driver` (default `auto`), then run the spec through the chosen runner. Both read the target from the `Aw-Target file:` path and the spec from the `Specs file:` path — the ephemeral overlay from Step 3, not the committed `preview.yml` placeholder. Both emit the identical verdict block ([spec-run contract § 4](../../../workflow/autonomous-workflow/rules/spec-run-contract.md#4-verdict-schema-mandatory--do-not-deviate)). `--all` runs every spec (not `--bail-on-first-red`) — an on-demand verification wants the full picture.

**Screenshots are on by default.** A `ui-verify run` always passes
`--auto-capture` to the runner, so every run yields full-page screenshots — each
spec's final state plus each navigating step — under
`.agent/{branch}/.aw-tester/captures/`, ready to drop into a PR description
([spec-run contract § Auto-capture](../../../workflow/autonomous-workflow/rules/spec-run-contract.md#auto-capture-a-run-option)).
Pass `--no-screenshots` to omit the flag when the images are not wanted. Both
dispatch blocks below carry `--auto-capture` unless `--no-screenshots` was given.

**On a Dash0 Agent0 Automation sandbox, this step is replaced** by [`agent0-runtime.md`](./agent0-runtime.md#driver-selection-playwright-without-the-prompt): `auto` resolves to Playwright with no prompt, a browser precondition runs first, and `aw-tester` is dispatched as a `general` sub-agent reading its definition file. The input lines of the dispatch are the ones below, unchanged.

**`auto` (default): resolve to a concrete driver — Chrome first, then Playwright, with no question asked.**
The Chrome runner is in-session and needs the browser extension; the Playwright runner is a sub-agent and needs an available tool that dispatches one (`Task`, `Agent`, or another spelling). Pick:

1. If the `mcp__claude-in-chrome__*` tools are available and `tabs_context_mcp` returns a connected browser → **chrome**.
2. Else Chrome is unavailable. When some available tool dispatches a sub-agent → **playwright**: print the [fallback notice](#the-auto-mode-fallback-notice), then run the Playwright driver block below. When none does, there is no driver: report `inconclusive: no driver available (unattended — no Chrome extension, no sub-agent dispatch)` under `--unattended`, else `NOT RUN (no Chrome extension and no sub-agent dispatch available)`, and stop.

`auto` never calls `AskUserQuestion`, attended or under `--unattended`: invoking `run` is the request for a verdict, and Playwright is the engine that can produce one when Chrome cannot.

**Driver `chrome` — invoke [`aw-tester-chrome`](../../../workflow/autonomous-workflow/aw-tester-chrome/SKILL.md) in-session:**

```text
Skill("aw-tester-chrome", "
  Run the specs at .agent/{branch}/.ui-verify/specs.md against aw-target 'preview'.
  Aw-Target file: .agent/{branch}/.ui-verify/aw-target.yml
  Specs file: .agent/{branch}/.ui-verify/specs.md
  Mode: --all --auto-capture
")
```

If it returns `verdict: inconclusive` with `fallback: playwright` (extension gone, or a `storage-state` target sitting on a login screen), in `auto` mode print the [fallback notice](#the-auto-mode-fallback-notice) and run the Playwright driver; when no tool dispatches a sub-agent, report the chrome `inconclusive` as-is. This is the one chrome→playwright fallback per run — never fall back a second time. A forced `--driver chrome` never falls back — report its verdict as-is.

**Driver `playwright` — dispatch [`aw-tester`](../../../workflow/autonomous-workflow/templates/aw-tester.agent.md) as a sub-agent** ([`§ Parse inputs`](../../../workflow/autonomous-workflow/templates/aw-tester.agent.md)):

```text
Task(
  subagent_type: "aw-tester",
  description: "Run ui-verify against PR preview",
  prompt: |
    Run the specs at .agent/{branch}/.ui-verify/specs.md against aw-target "preview".
    Aw-Target file: .agent/{branch}/.ui-verify/aw-target.yml
    Specs file: .agent/{branch}/.ui-verify/specs.md
    Mode: --all --auto-capture
)
```

If `--driver playwright` is forced and no available tool dispatches a sub-agent, say so and stop: the runner cannot substitute for `aw-tester` in-context, because its Playwright execution and locator-healing live in the isolated agent. Report `NOT RUN (sub-agent dispatch unavailable)`.

### The auto-mode fallback notice

Print this notice **only in `auto` mode**, at the two points above where Chrome cannot produce a verdict and a sub-agent can be dispatched: Chrome unavailable at driver selection, or a Chrome run that came back `inconclusive` with `fallback: playwright`.
A forced `--driver chrome` or `--driver playwright` never prints it — an explicit driver needs no explanation.
It is one line of output, printed before the dispatch, never a question:

```text
✅ RIGHT
ui-verify: Chrome extension not connected — running with Playwright (aw-tester). Pass --driver chrome to require Chrome.
ui-verify: Chrome returned inconclusive (login screen) — running with Playwright (aw-tester). Pass --driver chrome to require Chrome.

❌ WRONG
AskUserQuestion("The Chrome extension isn't connected. Run with Playwright instead?")
```

Name the reason in the first clause: `Chrome extension not connected`, or `Chrome returned inconclusive (<reason>)` with the `notes:` reason from the Chrome verdict.
Step 5 names the driver that produced the verdict, so the report always says `playwright` after a fallback.

## Step 4b: Adversarial pass — try to break it

The spec proved the happy path; this step tries to break the same change and documents every probe with screenshots.
Full procedure, catalog, oracles, and guardrails: [`adversarial.md`](./adversarial.md).
**It never changes the verdict from Step 4** — its findings travel in a separate `adversarial:` block.

A run that already stopped (`NOT RUN …`, or a terminal `inconclusive: …` from Step 2 or Step 4) never reaches this step.
Otherwise run it only when **all** of these hold, and when one fails, record its line and go to Step 5:

| Condition | When it fails, record |
| --- | --- |
| `--no-adversarial` was not passed | `adversarial: skipped (--no-adversarial)` |
| the overlay does not set `adversarial.enabled: false` | `adversarial: skipped (disabled in preview.yml)` |
| at least one spec has `result: pass` | `adversarial: skipped (no passing spec to probe)` |

Probe only the specs whose `result` is `pass`, and use the driver Step 4 actually ran:

**Driver `chrome`** — follow [`adversarial.md`](./adversarial.md) in this session with the extension, running only the categories its [§ Driver capabilities](./adversarial.md#driver-capabilities) table marks available to Chrome.

**Driver `playwright`** — dispatch a general-purpose sub-agent that reads the rule file, with these input lines:

```text
Task(
  subagent_type: "general-purpose",
  description: "ui-verify adversarial pass against PR preview",
  prompt: |
    Try to break the change these specs describe on the live preview, and document every probe with screenshots.
    Your procedure is <absolute path of this skill>/rules/adversarial.md — read it and follow it.
    Aw-Target file: .agent/{branch}/.ui-verify/aw-target.yml
    Specs file: .agent/{branch}/.ui-verify/specs.md
    Probe specs: <ids of the specs whose result was pass>
    Playwright bin: .agent/{branch}/.aw-tester/playwright-bin
    Output dir: .agent/{branch}/.ui-verify/adversarial/
    Lessons: <matched ui-verify-lessons bodies, or none>
    Mode: --driver playwright
)
```

Fill `Lessons:` per [`memory.md § Read at run time`](./memory.md#read-at-run-time), and append `--no-screenshots` to the `Mode:` line when the caller passed it.
On a Dash0 Agent0 sandbox, dispatch it as [`agent0-runtime.md § Dispatch the adversarial pass`](./agent0-runtime.md#dispatch-the-adversarial-pass) shows instead.
A reply with no `adversarial:` block is `adversarial: not run (<first line of the reply>)` — never an empty findings list.

## Step 5: Report the verdict

The runner returns a compact YAML verdict (`verdict: green | red | inconclusive`, one entry per spec with `result` and, on failure, `diagnostics` capped at 30 lines) — identical shape from either driver.
Relay it to the user as-is plus the resolved preview URL and which driver ran it. Do not re-run (beyond the one documented chrome→playwright fallback), and do not paste browser logs beyond the diagnostics the runner already trimmed.

**Surface the screenshots.** When the verdict carries a `captures:` array (it does on every default run, since `--auto-capture` is on — see Step 4), list each `path` in the report under a **Screenshots** heading so the user can attach them to the PR description. State the count and the directory (`.agent/{branch}/.aw-tester/captures/`); if `captures:` is absent, say `no screenshots (--no-screenshots)`. Never inline the image bytes — the paths are the deliverable.

**Surface the adversarial pass** under an **Adversarial pass** heading, after the screenshots:

1. One summary line, which callers relay verbatim: `adversarial: <probes_run> probes, <N> findings (<C> critical, <H> high, <M> medium, <L> low)`, followed by ` — partial: <reason>` when the block's `status` is `partial`; or the `skipped (…)` / `not run (…)` line from Step 4b.
2. Each finding, most severe first: its id, severity, oracle, probe, expected vs actual, and its before and after image paths.
3. The passed probes, one line each, then `categories_skipped` with their reasons.
4. The path of `report.md` — the document with every probe and its images inline.

Keep the happy-path verdict line first and unchanged; a critical finding is stated in the summary line, never by rewriting `verdict`.

Optionally, when the caller asked for it, post the verdict as a PR comment. Off by default — the runner reports to the terminal.

## Step 6: Write lessons

Write to `ui-verify-lessons` **only** when a spec failed for a navigation or precondition reason that a better spec would have avoided — see [`memory.md § Write at run time`](./memory.md) for exactly what qualifies and what does not.
A locator miss that the runner healed is the runner's lesson (`aw-tester-lessons`), not this skill's; do not duplicate it.
An adversarial probe error caused by an app-wide quirk (debounced inputs, an optimistic toast that reverts) also qualifies — see [`memory.md § Write at run time`](./memory.md#write-at-run-time).
