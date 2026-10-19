---
name: ux
description: >
  Reviews and plans UX for web and React Native (Expo) UIs: walks the user's
  real path through the code, checks what each control actually does, then goes
  deep on accessibility (WCAG 2.2) and microcopy. Never recommends a dark
  pattern. Triggers on "ux review", "ux audit", "check accessibility", "is this
  accessible", "plan the X flow", "improve copy", "/ux".
disable-model-invocation: false
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: advisory
  tags: [ux, accessibility, design, react-native, expo, web, wcag, usability, ux-writing, dark-patterns, flow-planning]
---

# UX

Audit or plan a UI the way a product reviewer does: start from what the user is trying to get done, prove what the code does, then add accessibility depth.
Read every target file completely before reporting on it.

## Modes

| Request | Mode | Order of work |
| --- | --- | --- |
| "review / audit this page", "ux feedback", `/ux` (default) | `audit` | Pass 1 → Pass 2 → Verify → Report |
| "plan the X flow", "design the onboarding", "how should X work" | `plan` | Flow plan first, then a Pass 1 + Pass 2 audit of any existing code the flow touches |
| "check accessibility", "is this accessible", "check contrast" | `a11y` | Pass 1 steps 1–2 only (job + task), then Pass 2 in full |
| "improve copy", "review microcopy" | `copy` | [`rules/ux-writing.md`](./rules/ux-writing.md) on every user-facing string, ordered by where it sits on the user's path |
| Consent, cancellation, paywall, sign-up, permission prompt, AI chat — in any mode | `dark-patterns` | Always also apply [`rules/dark-patterns.md`](./rules/dark-patterns.md); any hit is Critical |

## Step 0 — Scope

1. Resolve the target: the user's named files, else the changed UI files (`git diff --name-only <base>...HEAD`), else the current file.
2. Detect the platform: web (`<div>`, CSS, Tailwind), React Native (`View`, `Pressable`, `expo-router`), or both. Ask when ambiguous.
3. Read the target files, then the handlers, hooks, stores, routes, and API calls they reach — Pass 1 depends on them.

## Pass 1 — The user's path (first, always)

Outcome-changing findings (a broken flow, a control that does the wrong thing, a dead end) come from this pass, not from the checklist.
Follow [`rules/user-path.md`](./rules/user-path.md):

1. Name the page's job and the primary user task in one sentence each.
2. Walk the task end to end in the code, from entry to the next step after success.
3. For each control on the path, read its handler and state changes, and compare what it does with what the UI promises.
4. Cover empty, loading, stale, error, and first-run states.
5. Check the activation / next-step path: can the user actually do what the page tells them to do next?
6. Note what already works — the report keeps it.

## Pass 2 — Accessibility and interaction depth

Follow [`rules/accessibility.md`](./rules/accessibility.md) on every interactive element Pass 1 touched:

- Contrast computed from the actual tokens and resolved colors, in every theme.
- Focus management on open, close, delete, and route change.
- Live regions: what is announced, how often, and whether it floods.
- ARIA roles and patterns, keyboard paths, touch targets, reduced motion.

Load the extra rule files only when the code contains the trigger:

| Code contains | Load |
| --- | --- |
| Hard-coded colors, theme tokens, dark mode, type sizes | [`rules/visual-design.md`](./rules/visual-design.md) |
| User-facing strings | [`rules/ux-writing.md`](./rules/ux-writing.md) |
| Consent, subscriptions, cancellation, checkout, sign-up, permissions, AI surfaces | [`rules/dark-patterns.md`](./rules/dark-patterns.md) |
| Charts or dashboards | `Skill("charting")` for chart choice; keep contrast, labels, and targets here |
| Style direction, brand, "make it less generic" | `Skill("visual-design")`; merge its output with this report |

A missing companion skill never blocks; log `<name> — skipped (not installed)` and continue.

## Verify before reporting

Every claimed behaviour cites the `file:line` that proves it.
When the code cannot prove it statically, label the finding **unverified** and say what would confirm it.
Details and examples: [`rules/verify-before-reporting.md`](./rules/verify-before-reporting.md).

For a Critical or High finding about motion, timing, focus order, or hover-revealed content, `Skill("screen-recorder")` may capture evidence (`caller: "ux"`, `context.finding-id = "<file:line>"`); append its `RECORDING_PATH=` as a `Recording:` line.

## Report

Use [`templates/review-report.md`](./templates/review-report.md).

1. Order findings by impact on the primary task — a broken step outranks a contrast miss.
2. Put a severity label (`Critical` / `High` / `Medium` / `Low`) on each finding; severity is a label, not the document's section structure.
3. Give every finding `file:line`, what the user experiences, and a concrete fix (code when the fix is code).
4. Include **What works (keep)**, a **Plan** (first three moves), and **How we'll know it worked** (one measurable signal per top item).
5. Report at most ten findings; merge duplicates and drop nitpicks before cutting a real issue.

| Severity | Criteria |
| --- | --- |
| Critical | The user cannot finish the task, loses data, is misled, or is locked out (keyboard / screen reader); any dark pattern |
| High | The task finishes but with a wrong result, confusion, or an AA failure on the path |
| Medium | Friction or an AA failure off the main path |
| Low | Polish |

## Hard rules

1. Never recommend a dark pattern; if asked to add one, refuse, name the harm, and give the honest alternative ([`rules/dark-patterns.md`](./rules/dark-patterns.md)).
2. Never assert behaviour you did not read in the code.
3. Never apply an iOS rule to Android code or the reverse.
4. Match the bar to the context: a prototype gets the path and blockers, a production surface gets AA in full.
