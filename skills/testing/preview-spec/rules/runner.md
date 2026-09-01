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

The `run` operation: extract the embedded spec, point `aw-tester` at the live preview, and report its verdict.
The runner is an **on-demand orchestrator** — it resolves and dispatches once, reads the verdict, and writes lessons. It does not watch, retry the browser, or fix code.

## Step 1: Extract the spec

Read the PR body: `gh pr view <pr> --json body -q .body`.
Extract the region between `<!-- preview-spec:v1 -->` and `<!-- /preview-spec:v1 -->` (see [`spec-format.md`](./spec-format.md)).

- No markers → report `no spec — nothing to run` and stop. The PR has no embedded spec; `author` never ran, or the diff was not UI.
- Markers present but empty body → report `empty spec` and stop.

Strip the `<details>` / `<summary>` wrapper and the markers. What remains is the `specs.md` body (the `Target:` / `Refactor:` header plus the `## Spec N:` blocks).

## Step 2: Resolve the preview URL

Resolve the URL per [`preview-url-resolution.md`](./preview-url-resolution.md).
Any `inconclusive: …` outcome there is terminal for this run — report it and stop. The spec was not run; do not report a pass or a fail.

## Step 3: Materialize the ephemeral files

Write two files under `.agent/{branch}/.preview-spec/` (the branch is the PR's head ref; the directory is git-ignored scratch):

1. **`specs.md`** — the extracted spec body from Step 1, verbatim.
2. **`aw-target.yml`** — the browser context, built as follows:
   - If `.claude/aw-targets/preview.yml` exists in the repo, start from it (auth, fixtures, constraints) and set `base_url` to the resolved URL. This is how a preview behind Vercel deployment protection or an app login gets authenticated — the committed file carries the auth strategy, never the credentials.
   - If it does not exist, scaffold from [`templates/preview-target.yml.template`](../templates/preview-target.yml.template) with `auth.strategy: none` and note in the report that authed specs will be skipped by `aw-tester`.
   - Always override `base_url` with the resolved URL, no trailing slash.

Never write the resolved URL or any credential into the committed `.claude/aw-targets/preview.yml` — only into the ephemeral `.agent/{branch}/.preview-spec/aw-target.yml`.

## Step 4: Dispatch `aw-tester`

Dispatch the runner as a sub-agent, passing the explicit spec and target paths. `aw-tester` reads its target from the `Aw-Target file:` path when the prompt gives one, falling back to the name-derived path only when it does not — its documented input contract ([`aw-tester.agent.md § Parse inputs`](../../../workflow/autonomous-workflow/templates/aw-tester.agent.md)), so the ephemeral overlay is read, not the committed `preview.yml` placeholder:

```
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

`--all` runs every spec (not `--bail-on-first-red`) — an on-demand verification wants the full picture, not just the first failure.

If `Task` is unavailable in the harness, say so and stop: the runner cannot substitute for `aw-tester` in-context, because its Playwright execution and locator-healing live in the isolated agent. Report `NOT RUN (sub-agent dispatch unavailable)`.

## Step 5: Report the verdict

`aw-tester` returns a compact YAML verdict (`verdict: green | red | inconclusive`, one entry per spec with `result` and, on failure, `diagnostics` capped at 30 lines).
Relay it to the user as-is plus the resolved preview URL. Do not re-run, and do not paste browser logs beyond the diagnostics `aw-tester` already trimmed.

Optionally, when the caller asked for it, post the verdict as a PR comment. Off by default — the runner reports to the terminal.

## Step 6: Write lessons

Write to `preview-spec-lessons` **only** when a spec failed for a navigation or precondition reason that a better spec would have avoided — see [`memory.md § Write at run time`](./memory.md) for exactly what qualifies and what does not.
A locator miss that `aw-tester` healed is `aw-tester`'s lesson, not this skill's; do not duplicate it.
