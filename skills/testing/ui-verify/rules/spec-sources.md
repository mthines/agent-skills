---
title: Spec sources — reuse what the flow already produced, else generate
impact: HIGH
tags:
  - ui-verify
  - autonomous-workflow
  - fix-bug
  - reuse
  - single-source-of-truth
---

# Spec sources

When `ui-verify author` runs inside a larger flow, that flow has often **already written a spec** for the same UI change and verified it locally.
Reuse it. Regenerating from the diff produces a second, divergent description of the same behavior — the PR block would then disagree with what was actually run.

Check these sources in priority order. The first that exists wins; fall through to generating from the diff only when none do.

## Two artifacts, two lifetimes

`.agent/{branch}/specs.md` and the PR-body block are **different files with different lifetimes**. Do not conflate them.

| Artifact | Lifetime | Who reads it |
| --- | --- | --- |
| `.agent/{branch}/specs.md` | Gitignored, local to the worktree. Exists only during the aw run that wrote it. | The aw executor (Phase 4, against a local target) and Phase 7 Spec Rehearsal (against the preview) — both inside that same run. |
| The ui-verify block in the PR body (`<!-- ui-verify:v2 -->`, or `<!-- ui-verify:v1 -->` for a lifted grammar spec) | Committed to GitHub as part of the PR description. Outlives the run and survives a fresh checkout. | `ui-verify run` and any on-demand agent, in any later session. |

`author` is the **one-way bridge** between them. It runs during the aw flow, while `specs.md` still exists in the worktree, and copies that content into the committed PR body. That is why the gitignore never breaks verification: the durable artifact is the PR block, `run` reads **only** the PR block (never `specs.md`), and `specs.md` itself is never committed — only its lifted content reaches GitHub.

So both uses are supported, and they are separate:

- **Local verification during the aw run** reads `specs.md` directly (Phase 4, Phase 7). Fast, in-worktree, no PR needed.
- **Verification against the PR** reads the committed block (`ui-verify run`). Portable, checkout-independent, repeatable after the run ends.

## Source 1: the autonomous-workflow planner's `specs.md`

Path: `.agent/{branch}/specs.md`.

The autonomous-workflow planner emits this for UI tasks (Phase 1), the executor runs it against a local target at Phase 4, and Phase 7 re-runs it against the preview deployment.
It is written in **`aw-tester`'s WHEN/THEN grammar — the format a `<!-- ui-verify:v1 -->` block carries** — so reuse is a lift into a v1 block, never a translation into the intent format.

The file is gitignored, but this works because `author` runs during the same aw flow (Phase 6), where the worktree still holds `specs.md`. You are reading a local file and writing its content into the committed PR body — see [Two artifacts, two lifetimes](#two-artifacts-two-lifetimes). A standalone `author` on a fresh checkout finds no `specs.md` and falls through to [Source 3](#source-3-generate-from-the-diff).

How to reuse:

1. Read `.agent/{branch}/specs.md`.
2. Lift its `## Spec N:` blocks **verbatim** into a `<!-- ui-verify:v1 -->` collapsed block (see [`spec-format.md § Which format to write`](./spec-format.md#which-format-to-write)).
3. Set the header to `Target: preview` — the planner's file targets `local` (Phase 4 ran it against the dev server); the PR block runs against the preview deployment. This is the one field you change.
4. Do not re-derive or trim the specs. The planner authored them against the plan and the executor verified them; the PR block is the same contract pointed at a different environment.

## Source 2: a `/fix-bug` reproduction artifact

`/fix-bug` writes a failing reproduction for the bug at Phase 2.5. For a UI or visual bug (reproduction-layer rows 5–7: web E2E, mobile E2E, visual), that artifact describes the exact user-visible behavior to check:

- An `e2e-testing` / `e2e-testing-mobile` flow — its Flow steps become the intent spec's `**Steps:**` and its Assertions its `**Expected:**` items.
- A best-effort `repro/<id>.md` checklist — its manual reproduction steps become the spec's `**Steps:**`.

Write it as a `<!-- ui-verify:v2 -->` intent spec ([`spec-format.md § Writing an intent spec (v2)`](./spec-format.md#writing-an-intent-spec-v2)).
The step that triggers the bug is `[must-follow]`, and the component the bug lived in is `**Changed:**`.
The bug's fix makes the repro pass, so the preview spec expects the **fixed** behavior: phrase each `**Expected:**` item as the correct outcome, not the buggy one. The repro path is recorded in `.agent/{branch}/bug-notes.md` under `## Reproduction (Phase 2.5)`.

## Source 3: generate from the diff

When neither artifact exists — a standalone `create-pr` run, or a flow that produced no spec — write a `<!-- ui-verify:v2 -->` intent spec from the diff as the `author` operation's step 3 describes.
This is the fallback, not the default, whenever a flow-produced source is available.

## Why priority, not merge

Pick one source; do not stitch a generated spec onto a lifted one.
A lifted `specs.md` is already the complete, verified description of the change; appending diff-derived specs risks contradicting it.
If the lifted source genuinely misses a behavior the diff added after the plan was written, that is a signal the plan drifted — note it in the author report rather than silently patching the block.
