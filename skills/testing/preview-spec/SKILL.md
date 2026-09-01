---
name: preview-spec
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
  preview deployment", "/preview-spec".
disable-model-invocation: true
argument-hint: '[author|run] [pr-url|pr-number] [--url <preview-url>]'
license: MIT
allowed-tools: Bash(gh *) Bash(git *) Bash(jq *) Read Edit Write Grep Glob Skill Task mcp__lorekit__memory_list mcp__lorekit__memory_search mcp__lorekit__memory_read mcp__lorekit__memory_write
metadata:
  author: mthines
  version: '1.0.0'
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

# Preview Spec

Attach an executable UI verification spec to a pull request, then run it against the live preview deployment.

A reviewer verifies a UI change by clicking through the preview.
`preview-spec` turns that click-through into an artifact an agent can follow: a short spec in the PR description, run against the deployed preview by `aw-tester`, reporting pass or fail.

> **This `SKILL.md` is a thin index.**
> Detailed procedures live in [`rules/*.md`](./rules) and [`templates/*.md`](./templates).
> Each operation loads only what it needs.

## What this skill reuses

This skill owns three things and reuses the rest.

| Concern | Owner |
| --- | --- |
| The spec grammar (`WHEN/THEN/AND`, the locator mini-grammar, `url:`, `network:`) | `aw-tester` — [`specs.md.template`](../../workflow/autonomous-workflow/templates/specs.md.template). This skill references it and never forks it. |
| The Playwright runner + the compact verdict | `aw-tester` — dispatched as a sub-agent. |
| The browser context (`base_url`, auth, fixtures) | `aw-target.yml` — [`aw-target.yml.template`](../../workflow/autonomous-workflow/templates/aw-target.yml.template). |
| The two-way lessons loop | `aw-tester-lessons` (locator friction, existing) + `preview-spec-lessons` (navigation / spec-quality friction, new). See [`rules/memory.md`](./rules/memory.md). |
| **Embedding the spec in the PR body** (marker + collapsed block, ceiling exemption) | this skill — [`rules/spec-format.md`](./rules/spec-format.md). |
| **Resolving the PR's preview URL** (GitHub deployments API) | this skill — [`rules/preview-url-resolution.md`](./rules/preview-url-resolution.md). |
| **The author + run orchestration** | this skill — this file + [`rules/runner.md`](./rules/runner.md). |

## Operations

Parse `$ARGUMENTS`. The first token selects the operation.

| Operation | Trigger | What it does |
| --- | --- | --- |
| `author` | first token `author`, or delegated from `create-pr` | Seed the spec from an existing source (the aw planner's `specs.md`, a `/fix-bug` repro) or generate it from the diff, then inject the marked collapsed block into the PR body. Reads memory first. |
| `run` | first token `run` | Extract the block from the PR, resolve the preview URL, dispatch `aw-tester`, report the verdict, write lessons. |

If no operation token is present, default to `author` when a diff or branch context is in scope, and `run` when only a PR reference is given.

## Step 0: Resolve your GitHub access path

Both operations touch GitHub.
Resolve which path you have — `gh` CLI, `mcp__github__*` tools, or neither — per **[`agents/shared/rules/github-access.md`](../../../agents/shared/rules/github-access.md)**.
Resolve once, state the path, and use it for the whole run.
The commands below are the `gh`-path form.

## Operation `author`

Inject one collapsed, marked UI verification spec into the PR body.

1. **Read memory first.** Load spec-authoring lessons and locator lessons per [`rules/memory.md § Read at author time`](./rules/memory.md). These tell you the app's navigation quirks and stable locators before you write a single step.
2. **Reuse an existing spec source when present.** Before writing anything, check for a spec artifact the surrounding flow already produced, in priority order (full contract: [`rules/spec-sources.md`](./rules/spec-sources.md)):
   - `.agent/{branch}/specs.md` — the autonomous-workflow planner's `aw-tester` specs, already run locally at Phase 4. Same grammar: lift its `## Spec N:` blocks verbatim.
   - A `/fix-bug` reproduction artifact for a UI or visual bug — an `e2e-testing` flow or a `repro/<id>.md` checklist. Adapt its steps into the grammar.
   Both sources are gitignored, local-only files. This works because `author` runs in the same worktree that wrote them, and it copies their content into the **committed** PR body — the durable artifact `run` later reads. The gitignored file is never committed; only its lifted content reaches GitHub. See [`rules/spec-sources.md § Two artifacts, two lifetimes`](./rules/spec-sources.md#two-artifacts-two-lifetimes). When a source is found, seed the block from it and skip step 3, so the PR block matches what was verified locally rather than a second, divergent description of the same behavior.
3. **Otherwise, write the spec from the diff.** Read the diff (`git diff <base>...HEAD --name-status` plus the relevant files), then write one `## Spec N:` block per user-visible behavior the diff changes, in `aw-tester`'s grammar. Prefer role-and-name locators; use `{testid: …}` only as an escape hatch. Keep it to the behaviors a reviewer would actually click through — 1 to 3 specs, not an exhaustive suite.
4. **Wrap and inject** the spec in the marked collapsed block per [`rules/spec-format.md`](./rules/spec-format.md), and write it into the PR body with `gh pr edit --body`, preserving everything already there.

The block is **exempt from the `create-pr` description length ceiling** and is **preserved verbatim** by `review-loop`'s body refresh — both rules live in [`rules/spec-format.md`](./rules/spec-format.md) and in the [description contract](../../delivery/create-pr/rules/description-contract.md).

Report: how many specs were authored, and the one-line goal of each.

## Operation `run`

Run the embedded spec against the live preview.

Full procedure: **[`rules/runner.md`](./rules/runner.md)**. In outline:

1. **Extract** the spec from the PR body between the `<!-- preview-spec:v1 -->` markers. Absent → report `no spec` and stop. The committed PR body is the only source `run` reads — it never depends on the gitignored `.agent/{branch}/specs.md`, so it works on any checkout and in any later session.
2. **Resolve the preview URL** per [`rules/preview-url-resolution.md`](./rules/preview-url-resolution.md). A `--url <preview-url>` argument overrides resolution. Not deployed yet → report `inconclusive: preview not deployed` and stop.
3. **Materialize** an ephemeral `specs.md` and an `aw-target.yml` overlay (`base_url` = resolved URL) under `.agent/{branch}/.preview-spec/`, reading auth and fixtures from a committed `.claude/aw-targets/preview.yml` when one exists.
4. **Dispatch** `aw-tester` with the explicit spec and target paths (mode `--all`).
5. **Report** the verdict `aw-tester` returns (pass / fail / inconclusive, per spec).
6. **Write lessons** per [`rules/memory.md § Write at run time`](./rules/memory.md) when a spec failed for a navigation or precondition reason — not for a locator miss, which is `aw-tester`'s own lesson to write.

## Hard rules

- **Never fork the spec grammar.** It is `aw-tester`'s single source of truth. If a step cannot be expressed in it, say so — do not invent syntax.
- **Never weaken a spec to make it pass.** A red verdict is a finding, not a failure of this skill.
- **Never store a secret in the spec, the target file, or a lesson.** Preview-auth credentials live in the committed `preview.yml`'s refresh command or in the environment, never in the PR body — the spec is public.
- **The runner reports; it does not fix.** Applying a fix for a failing spec is the author's job (a better spec) or the PR author's (a code change).
