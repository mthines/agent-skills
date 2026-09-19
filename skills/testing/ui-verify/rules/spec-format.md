---
title: Embedded spec format — the marker, the collapsed block, the ceiling exemption
impact: HIGH
tags:
  - ui-verify
  - pr-description
  - marker
  - single-source-of-truth
---

# Embedded spec format

The UI verification spec lives inside the PR description, inside a collapsed `<details>` block, between two HTML-comment markers.
The markers make the block **machine-findable** — the runner and `review-loop` locate it without parsing prose — and the collapse keeps it out of a reviewer's way.

## Contents

- [The marker contract](#the-marker-contract)
- [The spec grammar is `aw-tester`'s — do not fork it](#the-spec-grammar-is-aw-testers--do-not-fork-it)
- [Two host-contract rules](#two-host-contract-rules)
- [Good and bad](#good-and-bad)

## The marker contract

The block is exactly this shape.
`author` starts from the literal boilerplate in [`templates/embedded-spec.md.template`](../templates/embedded-spec.md.template) and fills in the `Spec N:` blocks for the diff at hand.

```markdown
<!-- ui-verify:v1 -->
<details>
<summary>🧪 UI verification spec — run against the preview deployment</summary>

Target: preview
Refactor: no

## Spec 1: <one-line user goal>
url: /path/to/changed/screen
flow:
  - WHEN {role: "button", name: "Save"} is clicked
    THEN {role: "dialog", name: "Saved"} is visible

</details>
<!-- /ui-verify:v1 -->
```

Rules:

- **The open marker is `<!-- ui-verify:v1 -->` and the close marker is `<!-- /ui-verify:v1 -->`, verbatim.** The runner extracts the region between them. Match them exactly, including the version token `v1`.
- **Legacy marker (read-only back-compat).** This skill was formerly `preview-spec`, and PRs authored then carry `<!-- preview-spec:v1 -->` … `<!-- /preview-spec:v1 -->`. The **runner reads both**: it looks for `ui-verify:v1` first, then falls back to `preview-spec:v1`, so an already-embedded legacy block still runs. **`author` only ever writes the current `ui-verify:v1` marker** — when it finds a legacy-marked block on a PR it is re-authoring, it replaces the whole legacy region with a `ui-verify:v1` region (a silent in-place migration), never leaving both. The body grammar is byte-identical across the two markers, so the fallback is a marker-string match, nothing more.
- **There is at most one block per PR.** `author` on a PR that already has one replaces the region in place — it never appends a second. A legacy block counts as "one" for this rule: migrate it, do not add a second.
- **The `<details>` opens collapsed.** Never `<details open>` — the block is for the runner, not the reader.
- **The content between the markers is the spec body**, not prose. `author` writes it; the runner reads it; no other step edits it.

## The spec grammar is `aw-tester`'s — do not fork it

The body inside the block uses `aw-tester`'s spec grammar **verbatim**: the `Target:` / `Refactor:` header fields, the `## Spec N: <goal>` blocks, `url:`, `preconditions:`, the `WHEN … THEN … AND …` flow steps, the single-braces locator mini-grammar, `continues-from:`, `network: METHOD /path returned NNN`, and the `CAPTURE "<label>" [fullPage]` documentation-screenshot step.
Its single source of truth is [`specs.md.template`](../../../workflow/autonomous-workflow/templates/specs.md.template).

Do not redefine, extend, or abbreviate that grammar here.
If a behavior cannot be expressed in it, say so in the author report — do not invent syntax the runner cannot parse.

One field is fixed for this skill: **`Target: preview`**.
The runner resolves that target to the PR's live preview deployment (see [`preview-url-resolution.md`](./preview-url-resolution.md)).

## Two host-contract rules

Both are owned jointly with the [description contract](../../../delivery/create-pr/rules/description-contract.md); this file is the authority for the ui-verify side.

1. **The marked region is exempt from the description length ceiling.** `create-pr`'s body target is ≤ 25 rendered lines (hard 40), counting every line. The ui-verify block is collapsed and machine-oriented, so it does **not** count toward that budget. `create-pr`'s Step 5 length self-check skips everything between the markers.
2. **The marked region is preserved verbatim on refresh.** When `review-loop` refreshes the PR body to match the shipped diff, it carries the whole `<!-- ui-verify:v1 -->` … `<!-- /ui-verify:v1 -->` region forward unchanged. The refresh rewrites narrative sections only. Re-authoring the spec is `ui-verify author`'s job, not the refresh's — the same owned-region principle as the `pr-reviewer` sticky comment.

## Good and bad

**Good** — one behavior, role-and-name locators, exact markers:

```markdown
<!-- ui-verify:v1 -->
<details>
<summary>🧪 UI verification spec — run against the preview deployment</summary>

Target: preview
Refactor: no

## Spec 1: A user renames a dashboard from the header
url: /dashboards/{dashboardId}
flow:
  - WHEN {role: "button", name: "Rename"} is clicked
    THEN {role: "textbox", name: "Dashboard name"} is visible
  - WHEN {role: "textbox", name: "Dashboard name"} is filled with "Q3 revenue"
    AND {role: "button", name: "Save"} is clicked
    THEN {text: "Q3 revenue"} is visible on the page
    AND network: PATCH /api/dashboards/{dashboardId} returned 200

</details>
<!-- /ui-verify:v1 -->
```

**Bad** — invented syntax, CSS selector, no markers, expanded:

```markdown
<details open>
<summary>Test spec</summary>

## Spec 1
click ".btn-primary"            <!-- CSS selector is never a valid locator -->
assert page.title == "Saved"    <!-- not the WHEN/THEN grammar -->

</details>
```

(Why it is bad: no markers so the runner cannot find it, `<details open>` shouts at the reader, `.btn-primary` is a CSS selector the grammar forbids, and `click …` / `assert …` is invented syntax `aw-tester` cannot parse.)
