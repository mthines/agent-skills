---
title: Spec sources — reuse what the flow already produced, else generate
impact: HIGH
tags:
  - preview-spec
  - autonomous-workflow
  - fix-bug
  - reuse
  - single-source-of-truth
---

# Spec sources

When `preview-spec author` runs inside a larger flow, that flow has often **already written a spec** for the same UI change and verified it locally.
Reuse it. Regenerating from the diff produces a second, divergent description of the same behavior — the PR block would then disagree with what was actually run.

Check these sources in priority order. The first that exists wins; fall through to generating from the diff only when none do.

## Two artifacts, two lifetimes

`.agent/{branch}/specs.md` and the PR-body block are **different files with different lifetimes**. Do not conflate them.

| Artifact | Lifetime | Who reads it |
| --- | --- | --- |
| `.agent/{branch}/specs.md` | Gitignored, local to the worktree. Exists only during the aw run that wrote it. | The aw executor (Phase 4, against a local target) and Phase 7 Spec Rehearsal (against the preview) — both inside that same run. |
| The `<!-- preview-spec:v1 -->` block in the PR body | Committed to GitHub as part of the PR description. Outlives the run and survives a fresh checkout. | `preview-spec run` and any on-demand agent, in any later session. |

`author` is the **one-way bridge** between them. It runs during the aw flow, while `specs.md` still exists in the worktree, and copies that content into the committed PR body. That is why the gitignore never breaks verification: the durable artifact is the PR block, `run` reads **only** the PR block (never `specs.md`), and `specs.md` itself is never committed — only its lifted content reaches GitHub.

So both uses are supported, and they are separate:

- **Local verification during the aw run** reads `specs.md` directly (Phase 4, Phase 7). Fast, in-worktree, no PR needed.
- **Verification against the PR** reads the committed block (`preview-spec run`). Portable, checkout-independent, repeatable after the run ends.

## Source 1: the autonomous-workflow planner's `specs.md`

Path: `.agent/{branch}/specs.md`.

The autonomous-workflow planner emits this for UI tasks (Phase 1), the executor runs it against a local target at Phase 4, and Phase 7 re-runs it against the preview deployment.
It is written in **`aw-tester`'s grammar — the same grammar this skill's block uses** — so reuse is a lift, not a translation.

The file is gitignored, but this works because `author` runs during the same aw flow (Phase 6), where the worktree still holds `specs.md`. You are reading a local file and writing its content into the committed PR body — see [Two artifacts, two lifetimes](#two-artifacts-two-lifetimes). A standalone `author` on a fresh checkout finds no `specs.md` and falls through to [Source 3](#source-3-generate-from-the-diff).

How to reuse:

1. Read `.agent/{branch}/specs.md`.
2. Lift its `## Spec N:` blocks **verbatim** into the marked collapsed block (see [`spec-format.md`](./spec-format.md)).
3. Set the header to `Target: preview` — the planner's file targets `local` (Phase 4 ran it against the dev server); the PR block runs against the preview deployment. This is the one field you change.
4. Do not re-derive or trim the specs. The planner authored them against the plan and the executor verified them; the PR block is the same contract pointed at a different environment.

## Source 2: a `/fix-bug` reproduction artifact

`/fix-bug` writes a failing reproduction for the bug at Phase 2.5. For a UI or visual bug (reproduction-layer rows 5–7: web E2E, mobile E2E, visual), that artifact describes the exact user-visible behavior to check:

- An `e2e-testing` / `e2e-testing-mobile` flow — adapt its steps into the `WHEN/THEN/AND` grammar.
- A best-effort `repro/<id>.md` checklist — its manual reproduction steps become the spec's `flow:`.

The bug's fix makes the repro pass, so the preview spec asserts the **fixed** behavior: phrase each `THEN` as the correct outcome, not the buggy one. The repro path is recorded in `.agent/{branch}/bug-notes.md` under `## Reproduction (Phase 2.5)`.

## Source 3: generate from the diff

When neither artifact exists — a standalone `create-pr` run, or a flow that produced no spec — generate from the diff as the `author` operation's step 3 describes.
This is the fallback, not the default, whenever a flow-produced source is available.

## Why priority, not merge

Pick one source; do not stitch a generated spec onto a lifted one.
A lifted `specs.md` is already the complete, verified description of the change; appending diff-derived specs risks contradicting it.
If the lifted source genuinely misses a behavior the diff added after the plan was written, that is a signal the plan drifted — note it in the author report rather than silently patching the block.
