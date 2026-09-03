---
title: Runner — extract, resolve, materialize, dispatch aw-tester, report
impact: HIGH
tags:
  - preview-spec
  - aw-tester
  - playwright
  - runner
---

# Runner

The `run` operation: get the spec, point the selected runner at the live preview, and report its verdict.
The runner is an **on-demand orchestrator** — it resolves and dispatches once, reads the verdict, and writes lessons. It does not watch, retry the browser, or fix code. It picks between two runners with `--driver`; both emit the same verdict per the [spec-run contract](../../../workflow/autonomous-workflow/rules/spec-run-contract.md).

## Step 1: Get the spec

**From the PR (default).** Read the PR body: `gh pr view <pr> --json body -q .body`.
Extract the region between `<!-- preview-spec:v1 -->` and `<!-- /preview-spec:v1 -->` (see [`spec-format.md`](./spec-format.md)).
The committed PR body is the **only** source the PR path reads. It never reads `.agent/{branch}/specs.md` — that file is gitignored and absent on a fresh checkout ([`spec-sources.md § Two artifacts, two lifetimes`](./spec-sources.md#two-artifacts-two-lifetimes)). Verifying against the PR is therefore independent of any local aw run.

- No markers → report `no spec — nothing to run` and stop. The PR has no embedded spec; `author` never ran, or the diff was not UI.
- Markers present but empty body → report `empty spec` and stop.

Strip the `<details>` / `<summary>` wrapper and the markers. What remains is the `specs.md` body (the `Target:` / `Refactor:` header plus the `## Spec N:` blocks).

**From a local path (shortcut).** When the run argument is a filesystem path to a `specs.md` (a local author→run loop, before any PR exists), read it verbatim and skip extraction. A local path requires `--url <preview-url>` — there is no PR to resolve a deployment from. This path is for fast local iteration; the durable, checkout-independent source is still the PR body.

## Step 2: Resolve the preview URL

Resolve the URL per [`preview-url-resolution.md`](./preview-url-resolution.md).
Any `inconclusive: …` outcome there is terminal for this run — report it and stop. The spec was not run; do not report a pass or a fail.

## Step 3: Materialize the ephemeral files

Write two files under `.agent/{branch}/.preview-spec/` (the branch is the PR's head ref; the directory is git-ignored scratch):

1. **`specs.md`** — the extracted spec body from Step 1, verbatim.
2. **`aw-target.yml`** — the browser context, built as follows:
   - If `.claude/aw-targets/preview.yml` exists in the repo, start from it (auth, fixtures, constraints) and set `base_url` to the resolved URL. This is how a preview behind Vercel deployment protection or an app login gets authenticated — the committed file carries the auth strategy, never the credentials.
   - If it does not exist, first look for an existing repo auth convention the way `aw-setup` does ([aw-setup § Reuse before you scaffold](../../../workflow/autonomous-workflow/aw-setup/SKILL.md#reuse-before-you-scaffold)) — a `.claude/aw-targets/*.yml` with `auth.storage_state`, a captured `.browser/auth-state*.json`, or a `refresh-auth*.mjs` login script — and reuse it: point `storage_state` / `refresh.command` at it, capturing against the resolved `PREVIEW_URL`. Only when no convention exists, scaffold from [`templates/preview-target.yml.template`](../templates/preview-target.yml.template) with `auth.strategy: none` and note in the report that authed specs will be skipped by `aw-tester`.
   - Always override `base_url` with the resolved URL, no trailing slash.

Never write the resolved URL or any credential into the committed `.claude/aw-targets/preview.yml` — only into the ephemeral `.agent/{branch}/.preview-spec/aw-target.yml`.

## Step 4: Select the driver and run

Resolve `--driver` (default `auto`), then run the spec through the chosen runner. Both read the target from the `Aw-Target file:` path and the spec from the `Specs file:` path — the ephemeral overlay from Step 3, not the committed `preview.yml` placeholder. Both emit the identical verdict block ([spec-run contract § 4](../../../workflow/autonomous-workflow/rules/spec-run-contract.md#4-verdict-schema-mandatory--do-not-deviate)). `--all` runs every spec (not `--bail-on-first-red`) — an on-demand verification wants the full picture.

**`auto` (default): resolve to a concrete driver — Chrome first, and never silently fall to Playwright.**
The Chrome runner is in-session and needs the browser extension; the Playwright runner is a sub-agent and needs `Task`. Pick:

1. If the `mcp__claude-in-chrome__*` tools are available and `tabs_context_mcp` returns a connected browser → **chrome**.
2. Else Chrome is unavailable. Do **not** auto-select Playwright — ask the user first per [§ The auto-mode Playwright prompt](#the-auto-mode-playwright-prompt). Run Playwright only if they accept; if they decline, report `NOT RUN (chrome unavailable, user declined Playwright)` and stop. If `Task` is also unavailable, there is nothing to offer — report `NOT RUN (no Chrome extension and no sub-agent dispatch available)` and stop without prompting.

**Driver `chrome` — invoke [`aw-tester-chrome`](../../../workflow/autonomous-workflow/aw-tester-chrome/SKILL.md) in-session:**

```text
Skill("aw-tester-chrome", "
  Run the specs at .agent/{branch}/.preview-spec/specs.md against aw-target 'preview'.
  Aw-Target file: .agent/{branch}/.preview-spec/aw-target.yml
  Specs file: .agent/{branch}/.preview-spec/specs.md
  Mode: --all
")
```

If it returns `verdict: inconclusive` with `fallback: playwright` (extension gone, or a `storage-state` target sitting on a login screen), in `auto` mode do **not** fall through automatically — ask the user first per [§ The auto-mode Playwright prompt](#the-auto-mode-playwright-prompt). Run the Playwright driver only if they accept; if they decline, report the chrome `inconclusive` verdict as-is and stop. A forced `--driver chrome` never falls back — report its verdict as-is, no prompt.

**Driver `playwright` — dispatch [`aw-tester`](../../../workflow/autonomous-workflow/templates/aw-tester.agent.md) as a sub-agent** ([`§ Parse inputs`](../../../workflow/autonomous-workflow/templates/aw-tester.agent.md)):

```text
Task(
  subagent_type: "aw-tester",
  description: "Run preview-spec against PR preview",
  prompt: |
    Run the specs at .agent/{branch}/.preview-spec/specs.md against aw-target "preview".
    Aw-Target file: .agent/{branch}/.preview-spec/aw-target.yml
    Specs file: .agent/{branch}/.preview-spec/specs.md
    Mode: --all
)
```

If `--driver playwright` is forced and `Task` is unavailable, say so and stop: the runner cannot substitute for `aw-tester` in-context, because its Playwright execution and locator-healing live in the isolated agent. Report `NOT RUN (sub-agent dispatch unavailable)`.

### The auto-mode Playwright prompt

This prompt fires **only in `auto` mode**, at the two points above where Chrome cannot produce a verdict: Chrome unavailable at driver selection, or a Chrome run that came back `inconclusive` with `fallback: playwright`. A forced `--driver chrome` or `--driver playwright` never reaches this prompt — an explicit driver is the user's decision already, so honor it without asking.

Ask with `AskUserQuestion`:

- **Question.** State why Chrome can't verify (`The Chrome extension isn't connected`, or `Chrome returned inconclusive: <reason>`), then ask whether to run the spec with Playwright (the `aw-tester` sub-agent) instead.
- **Options.** `Use Playwright` — run the Playwright driver now. `Don't run` — stop without a Playwright run.

On `Use Playwright`, run the Playwright driver block above; if `Task` is unavailable, report `NOT RUN (sub-agent dispatch unavailable)` and stop. On `Don't run`, do not dispatch: report the chrome `inconclusive` verdict when there is one, else `NOT RUN (chrome unavailable, user declined Playwright)`. Either way, stop.

## Step 5: Report the verdict

The runner returns a compact YAML verdict (`verdict: green | red | inconclusive`, one entry per spec with `result` and, on failure, `diagnostics` capped at 30 lines) — identical shape from either driver.
Relay it to the user as-is plus the resolved preview URL and which driver ran it. Do not re-run (beyond the one documented chrome→playwright fallback), and do not paste browser logs beyond the diagnostics the runner already trimmed.

Optionally, when the caller asked for it, post the verdict as a PR comment. Off by default — the runner reports to the terminal.

## Step 6: Write lessons

Write to `preview-spec-lessons` **only** when a spec failed for a navigation or precondition reason that a better spec would have avoided — see [`memory.md § Write at run time`](./memory.md) for exactly what qualifies and what does not.
A locator miss that the runner healed is the runner's lesson (`aw-tester-lessons`), not this skill's; do not duplicate it.
