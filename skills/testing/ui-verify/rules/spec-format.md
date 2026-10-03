---
title: Embedded spec format — the markers, the two spec formats, the ceiling exemption
impact: HIGH
tags:
  - ui-verify
  - pr-description
  - marker
  - intent-spec
  - single-source-of-truth
---

# Embedded spec format

The UI verification spec lives inside the PR description, inside a collapsed `<details>` block, between two HTML-comment markers.
The markers make the block **machine-findable** — the runner and `review-loop` locate it without parsing prose — and the collapse keeps it out of a reviewer's way.

## Contents

- [The marker contract](#the-marker-contract)
- [Which format to write](#which-format-to-write)
- [Writing an intent spec (v2)](#writing-an-intent-spec-v2)
- [Two host-contract rules](#two-host-contract-rules)
- [Good and bad](#good-and-bad)

## The marker contract

Three marker versions exist.
`author` writes v2, or v1 only when lifting a grammar source verbatim; `run` reads all three, in this order:

| Marker pair | Body format | Written by `author` | Read by `run` |
| --- | --- | --- | --- |
| `<!-- ui-verify:v2 -->` … `<!-- /ui-verify:v2 -->` | **Intent** — Markdown, header `Format: intent` | yes — the default | first |
| `<!-- ui-verify:v1 -->` … `<!-- /ui-verify:v1 -->` | **Grammar** — `WHEN/THEN/AND` | only when lifting `.agent/{branch}/specs.md` verbatim ([`spec-sources.md`](./spec-sources.md)) | second |
| `<!-- preview-spec:v1 -->` … `<!-- /preview-spec:v1 -->` | Grammar (the skill's former name) | never | last, read-only |

`author` starts a v2 block from the literal boilerplate in [`templates/embedded-spec.md.template`](../templates/embedded-spec.md.template):

```markdown
<!-- ui-verify:v2 -->
<details>
<summary>🧪 UI verification spec — run against the preview deployment</summary>

Target: preview
Format: intent

## Spec 1: <one-line user goal>
**Changed:** <the control or region the diff adds or changes>
**Start:** /path/to/changed/screen
**Steps:**
1. [must-follow] <the action that exercises the change>
**Expected:**
- <user-observable outcome on the changed target>

</details>
<!-- /ui-verify:v2 -->
```

Rules:

- **Match the markers verbatim, including the version token.** The runner extracts the region between an open marker and its own close marker; a `v2` open with a `v1` close is no block.
- **The body format follows the marker.** A v2 body carries `Format: intent` in its header; a v1 body never does.
- **There is at most one block per PR, of any version.** `author` on a PR that already has one replaces the whole region in place — it never appends a second.
  Replacing a `preview-spec:v1` region is a silent migration: write the new block where the old one was, never leaving both.
- **The `<details>` opens collapsed.** Never `<details open>` — the block is for the runner, not the reader.
- **The content between the markers is the spec body**, not prose. `author` writes it; the runner reads it; no other step edits it.
- **One field is fixed for this skill: `Target: preview`.** The runner resolves it to the PR's live preview deployment (see [`preview-url-resolution.md`](./preview-url-resolution.md)).

## Which format to write

| Spec source ([`spec-sources.md`](./spec-sources.md)) | Marker and format |
| --- | --- |
| `.agent/{branch}/specs.md` — the aw planner's grammar spec, already run at Phase 4 | v1, its `## Spec N:` blocks lifted verbatim — no translation |
| A `/fix-bug` reproduction artifact | v2 intent |
| The diff | v2 intent |

Never translate a lifted grammar spec into intent form: it already ran green against a local target, and the PR block must be that same contract.
Never mix formats in one block.

## Writing an intent spec (v2)

The format's single source of truth is `autonomous-workflow`'s `templates/intent-spec.md.template`; how the runners execute and grade it is `rules/spec-run-contract.md` § 6 of the same skill.
The rules below are what an author needs, restated so this file stands alone — when the two disagree, the template wins.
Do not add fields, tokens, or syntax the template does not define.

Write one `## Spec N:` block per user-visible behavior the diff changes — 1 to 3 specs, the behaviors a reviewer would click through.
After them, `author` may append the out-of-bounds specs its brainstorm selects by severity ([§ Out-of-bounds specs](#out-of-bounds-specs)).
Each block carries, in this order:

| Field | Required | Rule |
| --- | --- | --- |
| `**Changed:**` | yes | Name the control, component, or region the diff adds or changes, the way a user sees it: "the Rename button in the dashboard header". The run fails when it never touches this target. |
| `**Start:**` | yes | A path relative to the preview's base URL; `{placeholders}` resolve from the preview target's `fixtures.references`. |
| `**Preconditions:**` | no | Bullets naming the state the run needs — a feature flag, a seeded record. Name each one: the runner may call an item unreachable only for a flag or record named here. |
| `**Steps:**` | yes | A numbered list of imperative user actions, one per step. Plain steps are guidance the runner may adapt. Start the step that exercises the `Changed` target with `[must-follow]` — at least one per spec. |
| `**Expected:**` | yes | Bullets, one user-observable outcome each, observable on the `Changed` target or its direct effect. Name concrete text, values, or counts. A network outcome uses exactly `` `METHOD /path` returns NNN ``. |
| `**Hints:**` | no | Bullets carrying locators and navigation quirks from lessons ([`memory.md`](./memory.md)), in the single-braces locator form: `{role: "textbox", name: "Dashboard name"}`. |
| `**Out of scope:**` | no | Bullets naming what the spec deliberately does not check. |

Four authoring rules decide whether the run can prove anything:

1. **Mark the change, not the scaffolding, as `[must-follow]`.** When the diff adds a button, the click on that button is must-follow; opening the page that holds it is guidance.
2. **Expect what the changed component itself renders.** An outcome visible before the change could run — a picker entry, a menu item that reveals the new widget — proves a flag or a route, not the change. Expect the widget's own content.
3. **Name the instance.** When several elements share a name or test id, say which one: "the tool step titled *List all services in catalog*", never "the tool step".
4. **Keep each `Expected` item checkable.** "Works correctly" and "looks good" cannot be observed. "The header shows *Q3 revenue*" can.

Never put a CSS selector, `nth-child`, or XPath in any field, and never a credential — the block is public.

### Out-of-bounds specs

An out-of-bounds spec covers a user who leaves the happy path while the changed component is waiting on something.
It uses the same fields as any intent spec — no new syntax — with three conventions, owned by [`out-of-bounds.md § Step 5`](./out-of-bounds.md#step-5-write-each-selected-idea-as-an-intent-spec):

1. The title starts with `Out of bounds:`.
2. Plain steps reach the pending state; the interruption is a `[must-follow]` step; the keep-going step after it is a second `[must-follow]` step.
3. Every `**Expected:**` item is a recovery outcome — the user can continue, the pending item has one clear state, nothing is lost silently, one action has one effect, or views agree — never a design choice.

```markdown
## Spec 3: Out of bounds: reload while a question is pending, then answer it
**Changed:** the question card in an Agent0 thread
**Start:** /agent0
**Preconditions:**
- A seeded thread whose last turn is paused on an unanswered question
**Steps:**
1. Open the seeded thread.
2. [must-follow] Reload the page.
3. [must-follow] Pick the first answer on the question card, or send "Continue" from the composer when no card is shown.
**Expected:**
- After the reload, the question card shows the same state it showed before the reload.
- The thread continues with an agent reply, and no error message appears.
```

## Two host-contract rules

Both are owned jointly with the [description contract](../../../delivery/create-pr/rules/description-contract.md); this file is the authority for the ui-verify side.
They apply to every marker version.

1. **The marked region is exempt from the description length ceiling.** `create-pr`'s body target is ≤ 25 rendered lines (hard 40), counting every line. The ui-verify block is collapsed and machine-oriented, so it does **not** count toward that budget. `create-pr`'s Step 5 length self-check skips everything between the markers.
2. **The marked region is preserved verbatim on refresh.** When `review-loop` refreshes the PR body to match the shipped diff, it carries the whole marked region forward unchanged. The refresh rewrites narrative sections only. Re-authoring the spec is `ui-verify author`'s job, not the refresh's — the same owned-region principle as the `pr-reviewer` sticky comment.

## Good and bad

**Good** — v2, the change marked must-follow, outcomes on the changed target:

```markdown
<!-- ui-verify:v2 -->
<details>
<summary>🧪 UI verification spec — run against the preview deployment</summary>

Target: preview
Format: intent

## Spec 1: A user renames a dashboard from the header
**Changed:** the Rename button in the dashboard header (new in this PR)
**Start:** /dashboards/{dashboardId}
**Steps:**
1. Open the dashboard.
2. [must-follow] Click **Rename** in the dashboard header.
3. Replace the name with "Q3 revenue" and save.
**Expected:**
- The header shows "Q3 revenue" without a page reload.
- `PATCH /api/dashboards/{dashboardId}` returns 200
**Hints:**
- The name field is {role: "textbox", name: "Dashboard name"}.

</details>
<!-- /ui-verify:v2 -->
```

**Bad** — no `Changed`, no must-follow step, an outcome nobody can observe, a CSS selector, mismatched markers:

```markdown
<!-- ui-verify:v2 -->
<details open>
<summary>Test spec</summary>

## Spec 1: Rename
**Steps:**
1. Click ".btn-primary".          <!-- CSS selector is never valid -->
**Expected:**
- Renaming works correctly.       <!-- not observable -->

</details>
<!-- /ui-verify:v1 -->
```

(Why it is bad: the close marker's version does not match the open, so the runner finds no block; `<details open>` shouts at the reader; the header has no `Format: intent`; the spec has no `Changed`, no `Start`, and no `[must-follow]` step, so the runner skips it as malformed; `.btn-primary` is a CSS selector; and "works correctly" names nothing the runner can observe.)
