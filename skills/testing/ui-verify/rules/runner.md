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
The runner is an **on-demand orchestrator** — it resolves once, dispatches the spec run, then the [adversarial pass](./adversarial.md) and the telemetry read in parallel, and writes lessons. It does not watch, retry the browser, or fix code. It picks between two runners with `--driver`; both emit the same verdict per the [spec-run contract](../../../workflow/autonomous-workflow/rules/spec-run-contract.md).

## Contents

- [Step 0: Resolve the config and the environment](#step-0-resolve-the-config-and-the-environment)
- [Step 1: Get the spec](#step-1-get-the-spec)
- [Step 2: Resolve the preview URL](#step-2-resolve-the-preview-url)
- [Step 3: Materialize the ephemeral files](#step-3-materialize-the-ephemeral-files)
- [Step 4: Select the driver and run](#step-4-select-the-driver-and-run)
- [Step 4b: Adversarial pass — try to break it](#step-4b-adversarial-pass--try-to-break-it)
- [Step 4c: Telemetry — `telemetry-verify` on each window](#step-4c-telemetry--telemetry-verify-on-each-window)
- [Step 5: Report the verdict](#step-5-report-the-verdict)
- [Step 5b: Post findings (under `--post-findings`)](#step-5b-post-findings-under---post-findings)
- [Step 6: Write lessons](#step-6-write-lessons)

## Step 0: Resolve the config and the environment

Resolve the suite config per the `verify` skill's `rules/config.md`: `.agents/aw/environments.yml` and `.agents/aw/ui.yml`, with `~/.agents/aw/config.yml` → `repos.<owner>/<name>` merged over them.
`ENV` is `--env` (default `preview`); `environments.<ENV>` supplies the URL source, `auth`, and `fixtures`, and `ui.yml` supplies `driver`, `screenshots`, `recording`, `constraints`, and `adversarial`.
A flag beats `ui.yml`; `ui.yml` beats the defaults.
No `.agents/aw/environments.yml` → run with `auth.strategy: none` and say `no login configured (run /verify setup)` in the report; never guess a login.

## Step 1: Get the spec

**From the PR (default).** Read the PR body with the call for your resolved access path ([`SKILL.md` Step 0](../SKILL.md#step-0-resolve-your-github-access-path) holds the mapping): `gh pr view <pr> --json body -q .body` on the `gh` path, `mcp__github__pull_request_read` with `method: "get"` on the `mcp` path.
Unlike the deployment lookup in Step 2, this read has an mcp equivalent, so an absent `gh` never blocks it.
Extract the first region found, in this order (see [`spec-format.md § The marker contract`](./spec-format.md#the-marker-contract)):

1. `<!-- ui-verify:v2 -->` … `<!-- /ui-verify:v2 -->` — a Markdown intent spec (header `Format: intent`).
2. `<!-- ui-verify:v1 -->` … `<!-- /ui-verify:v1 -->` — a grammar spec.
3. **Legacy fallback:** `<!-- preview-spec:v1 -->` … `<!-- /preview-spec:v1 -->` — a grammar block authored before this skill was renamed; run it identically.

Only when none of the three is present is there no spec.
A v2 region whose header lacks `Format: intent` is still run as an intent spec: add the line when materializing it in Step 3, and say so in the report.
The committed PR body is the **only** source the PR path reads. It never reads `.agent/{branch}/specs.md` — that file is gitignored and absent on a fresh checkout ([`spec-sources.md § Two artifacts, two lifetimes`](./spec-sources.md#two-artifacts-two-lifetimes)). Verifying against the PR is therefore independent of any local aw run.

- No markers → report `no spec — nothing to run` and stop. The PR has no embedded spec; `author` never ran, or the diff was not UI.
- Markers present but empty body → report `empty spec` and stop.

Strip the `<details>` / `<summary>` wrapper and the markers. What remains is the `specs.md` body: the header (`Target:` plus `Format: intent` for v2, or `Target:` / `Refactor:` for v1) and the `## Spec N:` blocks.

**From a local path (shortcut).** When the run argument is a filesystem path to a `specs.md` (a local author→run loop, before any PR exists), read it verbatim and skip extraction — either format; the `Format: intent` header line decides which. A local path requires `--url <preview-url>` — there is no PR to resolve a deployment from. This path is for fast local iteration; the durable, checkout-independent source is still the PR body.

## Step 2: Resolve the preview URL

Resolve the URL per [`preview-url-resolution.md`](./preview-url-resolution.md).
Any `inconclusive: …` outcome there is terminal for this run — report it and stop. The spec was not run; do not report a pass or a fail.
That resolution also consults `environments.preview.url` (`comment`, `template`) after `--url` and before the deployments API — so a repo whose CI CLI-deploys previews behind a `github-actions[bot]` comment resolves without a manual `--url`.
With `--env local`, the URL is `--url` (the caller started the stack), else `environments.local.url`; skip the deployment lookup.

**`--wait-preview <minutes>` — wait for a build instead of stopping.**
A caller running in parallel with pushes (the `review-loop --ui` lane) passes it, because the preview for a fresh head is usually still building.
When resolution returns `inconclusive: preview building` or `inconclusive: preview not deployed`, wait 60 seconds and resolve again, until a URL resolves or `<minutes>` have passed; then report the last outcome as terminal.
Every other `inconclusive: …` outcome stays terminal at once — waiting cannot fix a missing access path or a failed deploy.
Without the flag, the first outcome is terminal, as above.

## Step 3: Materialize the ephemeral files

Write two git-ignored files (the branch is the PR's head ref):

1. **`.agent/{branch}/.ui-verify/specs.md`** — the extracted spec body from Step 1, verbatim — plus a `Format: intent` header line when Step 1 found a v2 region without one.
   Never touch `.agent/{branch}/.aw-tester/routes/`: it is the runners' route cache for intent specs (spec-run contract § 6.6), and a later run in this worktree replays from it.
2. **`.agent/{branch}/aw-target.<ENV>.yml`** — `aw-tester`'s target: `name: <ENV>`, `base_url:` the resolved URL (no trailing slash), then `environments.<ENV>.auth` and `.fixtures` verbatim, `ui.yml`'s `constraints`, and `ui.yml`'s `adversarial.allowed_origins` (as `adversarial.allowed_origins`).

**Auth runs here, before the spec run, and is env-var-driven** (full flow: the `verify` skill's `rules/auth.md`):

- Export `PREVIEW_URL` (the resolved URL) for the auth commands to read.
- When `auth.refresh` is set and `when: always`, or the `storage_state` file is missing or stale, run `refresh.command`. It reads the credentials named in `refresh.env` from the environment and writes the gitignored `storage_state`. An unset variable fails the command loudly, and the authed specs report `skipped`, never a false pass.
- Carry `auth.bypass_header` (name plus env-var name) verbatim; `aw-tester` reads the variable and applies the header at launch, so the value never enters this runner's scope or logs.

A credential is only ever a **reference** (an env-var name) in either file, never a value, and the resolved URL is never written to `.agents/aw/`.

## Step 4: Select the driver and run

Resolve `--driver` (default `auto`), then run the spec through the chosen runner. Both read the target from the `Aw-Target file:` path and the spec from the `Specs file:` path — the files from Step 3. Both emit the identical verdict block ([spec-run contract § 4](../../../workflow/autonomous-workflow/rules/spec-run-contract.md#4-verdict-schema-mandatory--do-not-deviate)). `--all` runs every spec (not `--bail-on-first-red`) — an on-demand verification wants the full picture.

Both runners detect the format from the `Format: intent` header line themselves, so the dispatch blocks below are the same for both formats.
For an intent spec each runner replays a cached route when one matches the spec's text, otherwise explores the route, and returns each spec with the intent keys (`route`, `changed`, `expected`, `deviations`).

**Record the window.** Immediately before the dispatch, record `RUN_STARTED_AT` as UTC ISO-8601 (`date -u +%Y-%m-%dT%H:%M:%SZ`); when the verdict returns, record `SPECS_ENDED_AT`. Step 4c reads telemetry for exactly that window.

**Recordings are on by default on the Playwright driver.** The Playwright dispatch block carries `--record-video`, so `aw-tester` writes one video per spec under `.agent/{branch}/.aw-tester/recordings/` ([`recording.md`](./recording.md)).
Pass `--no-recording` to drop the flag. The Chrome driver cannot record and its block never carries the flag.

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
  Run the specs at .agent/{branch}/.ui-verify/specs.md against aw-target '<ENV>'.
  Aw-Target file: .agent/{branch}/aw-target.<ENV>.yml
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
    Run the specs at .agent/{branch}/.ui-verify/specs.md against aw-target "<ENV>".
    Aw-Target file: .agent/{branch}/aw-target.<ENV>.yml
    Specs file: .agent/{branch}/.ui-verify/specs.md
    Mode: --all --auto-capture --record-video
)
```

If `--driver playwright` is forced and no available tool dispatches a sub-agent, say so and stop: the runner cannot substitute for `aw-tester` in-context, because its Playwright execution and locator-healing live in the isolated agent. Report `NOT RUN (sub-agent dispatch unavailable)`.

### The auto-mode fallback notice

Print this notice **only in `auto` mode**, at the two points above where Chrome cannot produce a verdict and a sub-agent can be dispatched: Chrome unavailable at driver selection, or a Chrome run that came back `inconclusive` with `fallback: playwright`.
A forced `--driver chrome` or `--driver playwright` never prints it — an explicit driver needs no explanation.
It is one line of output, printed before the dispatch, never a question:

```text
✅ RIGHT
ui-verify: Chrome extension not connected — running with Playwright (aw-tester); logs in via .agents/aw/environments.yml (preview), not your Chrome session. Pass --driver chrome to require Chrome.
ui-verify: Chrome returned inconclusive (login screen) — running with Playwright (aw-tester); first run installs Playwright + Chromium under .agent/<branch>/.aw-tester/; no preview login configured (run /verify setup if the preview needs one). Pass --driver chrome to require Chrome.

❌ WRONG
AskUserQuestion("The Chrome extension isn't connected. Run with Playwright instead?")
ui-verify: running with Playwright.   # no reason, and silent about the install and the login it switches to
```

Name the reason in the first clause: `Chrome extension not connected`, or `Chrome returned inconclusive (<reason>)` with the `notes:` reason from the Chrome verdict.
Then append each clause whose condition holds, in this order, separated by `; `:

| Append | When |
| --- | --- |
| `first run installs Playwright + Chromium under .agent/<branch>/.aw-tester/` | Neither `node_modules/.bin/playwright` nor `.agent/{branch}/.aw-tester/node_modules/.bin/playwright` exists, so `aw-tester`'s binary resolution will install one |
| `logs in via .agents/aw/environments.yml (<ENV>), not your Chrome session` | The `aw-target.<ENV>.yml` from Step 3 has `auth.strategy` `storage-state` or `env-credentials` |
| `authed specs will be skipped (auth.strategy: manual)` | Its `auth.strategy` is `manual` |
| `no preview login configured (run /verify setup if the preview needs one)` | Its `auth.strategy` is `none` or absent |

Exactly one of the three login clauses always applies, because the Playwright run never inherits the Chrome session.
Step 5 names the driver that produced the verdict, so the report always says `playwright` after a fallback.

## Step 4b: Adversarial pass — try to break it

The spec proved the happy path; this step tries to break the same change and documents every probe with screenshots.
Start it in the same message as Step 4c's first dispatch, so the two run in parallel.
Full procedure, catalog, oracles, and guardrails: [`adversarial.md`](./adversarial.md).
**It never changes the verdict from Step 4** — its findings travel in a separate `adversarial:` block.

A run that already stopped (`NOT RUN …`, or a terminal `inconclusive: …` from Step 2 or Step 4) never reaches this step.
Otherwise run it only when **all** of these hold, and when one fails, record its line and go to Step 5:

| Condition | When it fails, record |
| --- | --- |
| `--no-adversarial` was not passed | `adversarial: skipped (--no-adversarial)` |
| `ui.yml` does not set `adversarial.enabled: false` | `adversarial: skipped (disabled in ui.yml)` |
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
    Aw-Target file: .agent/{branch}/aw-target.<ENV>.yml
    Specs file: .agent/{branch}/.ui-verify/specs.md
    Probe specs: <ids of the specs whose result was pass>
    Playwright bin: .agent/{branch}/.aw-tester/playwright-bin
    Output dir: .agent/{branch}/.ui-verify/adversarial/
    Lessons: <matched ui-verify-lessons bodies, or none>
    Mode: --driver playwright
)
```

Fill `Lessons:` per [`memory.md § Read at run time`](./memory.md#read-at-run-time), and append `--no-screenshots` and `--no-recording` to the `Mode:` line when the caller passed them.
On a Dash0 Agent0 sandbox, dispatch it as [`agent0-runtime.md § Dispatch the adversarial pass`](./agent0-runtime.md#dispatch-the-adversarial-pass) shows instead.
A reply with no `adversarial:` block is `adversarial: not run (<first line of the reply>)` — never an empty findings list.

When this step returns, or when it was skipped, record `RUN_ENDED_AT` (UTC ISO-8601).

## Step 4c: Telemetry — `telemetry-verify` on each window

The browser proved what the user sees; `telemetry-verify` proves what the services recorded during the same run.
**It never changes the verdict from Step 4** — its findings travel in a separate `telemetry:` block.
`--no-telemetry` skips it with `telemetry: skipped (--no-telemetry)`; so does a run that already stopped.

1. **Spec window, in parallel with Step 4b.** In the message that starts the adversarial pass, also dispatch:

   ```text
   Agent(subagent_type="general-purpose",
         prompt="Run Skill(\"telemetry-verify\", \"--env <ENV> --from <RUN_STARTED_AT> --to <SPECS_ENDED_AT> --host <preview host> --driver <driver Step 4 ran> [--brief .agent/{branch}/plan.md] [--out .agent/{branch}/.ui-verify/telemetry.jsonl]\") and return only its TELEMETRY block")
   ```

   Pass `--brief` only when that file exists. On Agent0 the sub-agent type is `general`.
2. **Adversarial window, after Step 4b.** When the adversarial pass returns, dispatch the same call with `--from <SPECS_ENDED_AT> --to <RUN_ENDED_AT>` and no `--brief` (probes are not acceptance criteria). Skip it when Step 4b did not run.
3. With no sub-agent dispatch tool, run `Skill("telemetry-verify", …)` in this session after Step 4b, once per window.

A reply with no `TELEMETRY` block is `telemetry: not run (<first line of the reply>)`.
`telemetry-verify` owns the server, the ingest wait, the oracles, and the skip reasons; never query telemetry from this runner.

## Step 5: Report the verdict

The runner returns a compact YAML verdict (`verdict: green | red | inconclusive`, one entry per spec with `result` and, on failure, `diagnostics` capped at 30 lines) — identical shape from either driver.
Relay it to the user as-is plus the resolved preview URL and which driver ran it. Do not re-run (beyond the one documented chrome→playwright fallback), and do not paste browser logs beyond the diagnostics the runner already trimmed.

**Surface an intent spec's evidence.** For each spec carrying `format: intent`, print one line, then its items:

```text
Spec-1 pass — route: explored — changed: exercised — 2/2 expected observed — 1 deviation
  E1 observed — locator: {role: "heading", name: "Q3 revenue"} — visible
  E2 observed — network: PATCH /api/dashboards/d-42 → 200
  deviation step 1 (added): dismissed the cookie banner before opening the dashboard
```

Print every `expected` item with its `evidence`, and every deviation, exactly as the runner returned them.
Never shorten a pass to its verdict word: the evidence lines are what lets a reviewer trust it.
Relay each spec's `result` and `reason` exactly as the runner graded them: never soften a `fail`, and never harden a `skipped` — contract § 6.5 grades a closed-list `unreachable` cause `skipped` before it looks at `changed`, so `changed: not-exercised` on a preview with a named flag off is `skipped`, not `fail`.
List the specs whose title starts with `Out of bounds:` after the others, under an **Out of bounds** heading ([`out-of-bounds.md`](./out-of-bounds.md)); they are graded and counted in `verdict` exactly like the rest.

**Surface the screenshots.** When the verdict carries a `captures:` array (it does on every default run, since `--auto-capture` is on — see Step 4), list each `path` in the report under a **Screenshots** heading. State the count and the directory (`.agent/{branch}/.aw-tester/captures/`); if `captures:` is absent, say `no screenshots (--no-screenshots)`. Never inline the image bytes — the paths are the deliverable.

**Attach them under `--attach-media`.** Never tell the user to attach files by hand. Select the explicit `CAPTURE` files first, then each spec's `*-auto-final.png`, up to 6 images, then up to 2 recordings of passing specs, and delegate once:

```text
Skill("attach-media", "<pr-url> <path>#<label> ... --to body")
```

Print its first report line under the **Screenshots** heading. Without the flag, print `attach-media: not requested (pass --attach-media)`.

**Surface the recordings** under a **Recordings** heading, after the screenshots, per [`recording.md § Report`](./recording.md#report): one line per video with its spec or probe id, result, and path, or the one-line reason there are none.

**Surface the adversarial pass** under an **Adversarial pass** heading, after the recordings:

1. One summary line, which callers relay verbatim: `adversarial: <probes_run> probes, <N> findings (<C> critical, <H> high, <M> medium, <L> low)`, followed by ` — partial: <reason>` when the block's `status` is `partial`; or the `skipped (…)` / `not run (…)` line from Step 4b.
2. Each finding, most severe first: its id, severity, oracle, probe, expected vs actual, and its before and after image paths.
3. The passed probes, one line each, then `categories_skipped` with their reasons.
4. The path of `report.md` — the document with every probe and its images inline.

Keep the happy-path verdict line first and unchanged; a critical finding is stated in the summary line, never by rewriting `verdict`.

**Surface the telemetry** under a **Telemetry** heading, after the adversarial pass: each window's `TELEMETRY` block verbatim — its journey lines, `signals:` and `findings:` lines, and `[receipt] verdict:` line — or the `skipped (…)` / `not run (…)` line.
Like the adversarial pass, a telemetry finding never rewrites `verdict`.

Optionally, when the caller asked for it, post the verdict as a PR comment. Off by default — the runner reports to the terminal.

## Step 5b: Post findings (under `--post-findings`)

Only when the caller passed `--post-findings`: write every failing spec, every `critical` or `high` adversarial finding, and every `critical` or `high` telemetry finding to the PR as a file-level review thread, deduped by fingerprint, and upsert the `<!-- ui-verify:lane -->` summary comment.
Full procedure: [`post-findings.md`](./post-findings.md).
`run` with a local `specs-path` has no PR and ignores the flag with the note `post-findings: skipped (no PR)`.

## Step 6: Write lessons

Write to `ui-verify-lessons` **only** when a spec failed for a navigation or precondition reason that a better spec would have avoided, or an intent spec passed with an `adapted` or `added` deviation the author could have written as a step or hint — see [`memory.md § Write at run time`](./memory.md) for exactly what qualifies and what does not.
A locator miss that the runner healed is the runner's lesson (`aw-tester-lessons`), not this skill's; do not duplicate it.
An adversarial probe error caused by an app-wide quirk (debounced inputs, an optimistic toast that reverts) also qualifies — see [`memory.md § Write at run time`](./memory.md#write-at-run-time).
