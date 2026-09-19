---
name: ui-verify
description: >
  Makes a UI pull request autonomously verifiable. `author` generates a
  step-by-step UI verification spec for the PR's visual change and injects it
  into the PR description as a collapsed, machine-findable block (delegated
  to by `create-pr` on UI diffs; also runnable standalone). `run` extracts
  that block, resolves the PR's live preview deployment URL via the GitHub
  deployments API, and runs the spec against it with Playwright by
  dispatching the `aw-tester` agent, then reports a pass/fail verdict. A
  two-way LoreKit memory loop connects them: the runner records navigation
  quirks it hits, and the author reads those lessons so future specs start
  correct from the outset. Web only — the spec grammar and Playwright runner
  are `aw-tester`'s; this skill owns the PR-embedding, URL resolution, and the
  authoring loop. Triggers on "write a preview spec", "add a UI verification
  spec", "verify this PR's preview", "run the preview spec", "test the
  preview deployment", "verify this PR autonomously", "/ui-verify". `verify`
  is the one-shot composite (author-if-needed → run → report) for a PR with no
  spec yet — someone else's, or an agent0 / Vercel-preview automation. `setup`
  scaffolds the committed preview aw-target this skill runs against (auth, the
  two walls, the repo-scoped LoreKit auth profile) — a thin delegator to
  `aw-setup --target preview`.
disable-model-invocation: false
argument-hint: '[setup|author|run|verify] [pr-url|pr-number|specs-path] [--url <preview-url>] [--driver auto|chrome|playwright]'
license: MIT
allowed-tools: Bash(gh *) Bash(git *) Bash(jq *) Bash(node *) Read Edit Write Grep Glob Skill Task Agent AskUserQuestion mcp__github__pull_request_read mcp__github__update_pull_request mcp__lorekit__memory_list mcp__lorekit__memory_search mcp__lorekit__memory_read mcp__lorekit__memory_write
metadata:
  author: mthines
  version: '1.3.0'
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
`ui-verify` turns that click-through into an artifact an agent can follow: a short spec in the PR description, run against the deployed preview by `aw-tester`, reporting pass or fail.

> **This `SKILL.md` is a thin index.**
> Detailed procedures live in [`rules/*.md`](./rules) and [`templates/*.md`](./templates).
> Each operation loads only what it needs.

## What this skill reuses

This skill owns three things and reuses the rest.

| Concern | Owner |
| --- | --- |
| The spec grammar (`WHEN/THEN/AND`, the locator mini-grammar, `url:`, `network:`) | `aw-tester` — [`specs.md.template`](../../workflow/autonomous-workflow/templates/specs.md.template). This skill references it and never forks it. |
| The spec-run contract (locator ladder, auth semantics, verdict schema) | [`spec-run-contract.md`](../../workflow/autonomous-workflow/rules/spec-run-contract.md) — the engine-agnostic contract both runners implement. |
| The runners + the compact verdict | Two, one contract: [`aw-tester`](../../workflow/autonomous-workflow/templates/aw-tester.agent.md) (Playwright sub-agent) and [`aw-tester-chrome`](../../workflow/autonomous-workflow/aw-tester-chrome/SKILL.md) (in-session Chrome). `run --driver` picks one. |
| The browser context (`base_url`, auth, fixtures) | `aw-target.yml` — [`aw-target.yml.template`](../../workflow/autonomous-workflow/templates/aw-target.yml.template). |
| Scaffolding the committed preview aw-target (auth detection, the two walls, the confirming login, the repo-scoped records) | `aw-setup` — the `setup` operation is a thin delegator (`aw-setup --target preview`); this skill never reimplements it. |
| The two-way lessons loop | `aw-tester-lessons` (locator friction, existing) + `ui-verify-lessons` (navigation / spec-quality friction, new). See [`rules/memory.md`](./rules/memory.md). |
| **Embedding the spec in the PR body** (marker + collapsed block, ceiling exemption) | this skill — [`rules/spec-format.md`](./rules/spec-format.md). |
| **Resolving the PR's preview URL** (GitHub deployments API) | this skill — [`rules/preview-url-resolution.md`](./rules/preview-url-resolution.md). |
| **The author + run orchestration** | this skill — this file + [`rules/runner.md`](./rules/runner.md). |

## Operations

Parse `$ARGUMENTS`. The first token selects the operation.

| Operation | Trigger | What it does |
| --- | --- | --- |
| `setup` | first token `setup` | Scaffold the committed **preview** aw-target (`.claude/aw-targets/preview.yml`) this skill runs against — auth strategy, the two walls, the confirming login, the repo-scoped LoreKit auth profile + UI surface. A thin delegator to `aw-setup --target preview`; the discoverable front door so you never need the `aw` namespace. |
| `author` | first token `author`, or delegated from `create-pr` | Seed the spec from an existing source (the aw planner's `specs.md`, a `/fix-bug` repro) or generate it from the diff, then inject the marked collapsed block into the PR body. Reads memory first. |
| `run` | first token `run` | Extract the block from the PR (or read a local `specs.md` path), resolve the preview URL, run the spec via the selected driver, report the verdict, write lessons. |
| `verify` | first token `verify` | One-shot composite for a PR with no spec: author-if-needed (author only when the block is absent — never overwrite a hand-written one), then `run`, then report a single combined verdict. The autonomous entry point for others' PRs and CI / agent0 automation. |

If no operation token is present, default to `author` when a diff or branch context is in scope, and `run` when only a PR reference is given. `setup` is always explicit.

### Drivers

`run` executes the spec through one of two runners — same grammar, same verdict, different engine. Pick with `--driver`:

| `--driver` | Runner | When |
| --- | --- | --- |
| `auto` (default) | Chrome if the extension is connected; otherwise asks before using Playwright | Everyday use — fast locally, correct everywhere. |
| `chrome` | [`aw-tester-chrome`](../../workflow/autonomous-workflow/aw-tester-chrome/SKILL.md), in-session | Force the fast see→act loop against your logged-in Chrome. |
| `playwright` | [`aw-tester`](../../workflow/autonomous-workflow/templates/aw-tester.agent.md) sub-agent | CI, remote envs, or no browser extension. |

`author` never touches a browser and takes no `--driver`.

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
   - `.agent/{branch}/specs.md` — the autonomous-workflow planner's `aw-tester` specs, already run locally at Phase 4. Same grammar: lift its `## Spec N:` blocks verbatim.
   - A `/fix-bug` reproduction artifact for a UI or visual bug — an `e2e-testing` flow or a `repro/<id>.md` checklist. Adapt its steps into the grammar.
   Both sources are gitignored, local-only files. This works because `author` runs in the same worktree that wrote them, and it copies their content into the **committed** PR body — the durable artifact `run` later reads. The gitignored file is never committed; only its lifted content reaches GitHub. See [`rules/spec-sources.md § Two artifacts, two lifetimes`](./rules/spec-sources.md#two-artifacts-two-lifetimes). When a source is found, seed the block from it and skip step 3, so the PR block matches what was verified locally rather than a second, divergent description of the same behavior.
3. **Otherwise, write the spec from the diff.** Read the diff (`git diff <base>...HEAD --name-status` plus the relevant files), then write one `## Spec N:` block per user-visible behavior the diff changes, in `aw-tester`'s grammar. Prefer role-and-name locators; use `{testid: …}` only as an escape hatch. Keep it to the behaviors a reviewer would actually click through — 1 to 3 specs, not an exhaustive suite.
4. **Wrap and inject** the spec in the marked collapsed block per [`rules/spec-format.md`](./rules/spec-format.md), and write it into the PR body with the body-write call for your resolved [access path](#step-0-resolve-your-github-access-path), preserving everything already there.
Writing the block into the PR body is this operation's **only** deliverable, so a run that could not perform that write has not authored a spec.
Report it as `failed (no GitHub access path)` rather than reporting the specs you drafted — a drafted spec that never reached the PR is indistinguishable from none to every later reader, including `run`.

The block is **exempt from the `create-pr` description length ceiling** and is **preserved verbatim** by `review-loop`'s body refresh — both rules live in [`rules/spec-format.md`](./rules/spec-format.md) and in the [description contract](../../delivery/create-pr/rules/description-contract.md).

Report: how many specs were authored, and the one-line goal of each.

## Operation `run`

Run the embedded spec against the live preview.

Full procedure: **[`rules/runner.md`](./rules/runner.md)**. In outline:

1. **Get the spec.** Extract it from the PR body between the `<!-- ui-verify:v1 -->` markers — the committed PR body is the only source that works on any checkout and in any later session. As a shortcut for a local author→run loop, `run <specs-path>` reads a local `specs.md` directly (no PR, no extraction). Absent → report `no spec` and stop.
2. **Resolve the preview URL** per [`rules/preview-url-resolution.md`](./rules/preview-url-resolution.md). A `--url <preview-url>` argument overrides resolution (required with a local `specs-path`, and required on the `mcp` path). Any `inconclusive: …` outcome from that file is terminal — report it and stop, without a pass or a fail. Its two commonest are `inconclusive: no access path for deployment lookup (pass --url)` (no lookup was possible) and `inconclusive: preview not deployed` (the lookup ran and found nothing).
3. **Materialize** an ephemeral `specs.md` and an `aw-target.yml` overlay (`base_url` = resolved URL) under `.agent/{branch}/.ui-verify/`, reading auth and fixtures from a committed `.claude/aw-targets/preview.yml` when one exists.
4. **Select the driver and run** per `--driver` (see [Drivers](#drivers) and [`rules/runner.md § Step 4`](./rules/runner.md)). `auto` invokes `aw-tester-chrome` in-session when the Chrome extension is connected; when Chrome is unavailable or a Chrome run returns `fallback: playwright`, it asks the user before running the `aw-tester` sub-agent rather than falling back silently. A forced `--driver chrome`/`playwright` never prompts. Mode `--all`.
5. **Report** the verdict (pass / fail / inconclusive, per spec) — identical shape from either driver.
6. **Write lessons** per [`rules/memory.md § Write at run time`](./rules/memory.md) when a spec failed for a navigation or precondition reason — not for a locator miss, which is the runner's own lesson to write.

## Operation `verify`

One-shot: make a PR autonomously verifiable and verify it, in a single call.
This is the entry point for a PR you did not author — a teammate's, or one an
agent0 / CI automation is checking against a Vercel-style preview — where no
spec exists yet.

1. **Author if, and only if, the block is absent.** Read the PR body. If it
   already carries a `<!-- ui-verify:v1 -->` block, keep it verbatim — never
   overwrite a hand-written or previously-authored spec. If it is absent, run
   Operation `author` (including its Step 0 `is-ui-diff` gate): a `no` from the
   gate ends `verify` here with `not verified (no UI files in diff)`, and a
   `failed (no GitHub access path)` from `author` ends it with that same reason —
   there is nothing to run.
2. **Run.** Then run Operation `run` against the resolved preview URL, honouring
   `--url` and `--driver` exactly as `run` does. On the `mcp` path (or a local
   `specs-path`), `--url` is required — without it, report
   `inconclusive: no access path for deployment lookup (pass --url)` and stop,
   never `preview not deployed`.
3. **Report one combined verdict.** State whether the spec was authored fresh or
   reused, then the `run` verdict (pass / fail / inconclusive, per spec). A red
   verdict is a finding about the PR, not a `verify` failure.

`verify` composes the two existing operations and adds no new browser or
GitHub behaviour — every hard rule below applies unchanged. It is idempotent:
a second `verify` on the same PR reuses the block authored by the first.

## Hard rules

- **Never fork the spec grammar.** It is `aw-tester`'s single source of truth. If a step cannot be expressed in it, say so — do not invent syntax.
- **Never weaken a spec to make it pass.** A red verdict is a finding, not a failure of this skill.
- **Never store a secret in the spec, the target file, or a lesson.** Preview-auth credentials live in the committed `preview.yml`'s refresh command or in the environment, never in the PR body — the spec is public.
- **The runner reports; it does not fix.** Applying a fix for a failing spec is the author's job (a better spec) or the PR author's (a code change).
