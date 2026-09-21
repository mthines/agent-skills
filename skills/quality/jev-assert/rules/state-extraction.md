---
title: State extraction — driver-agnostic page text for Jev
impact: HIGH
tags:
  - jev
  - state
  - accessibility
  - driver-agnostic
---

# State extraction

Jev evaluates **text**, not images.
This rule owns how a page's current state becomes the text Jev reads, from either
browser driver, so the assertion layer never depends on which one ran.
A screenshot is never a valid input — a capture that produced only an image is
not usable state, and the call is `unobtainable`, not a guess.

## What counts as state

Preferred, in order:

1. **Accessibility tree** — the roles, names, and values a user relies on.
   This is the richest text state and the one both runners already produce.
2. **Rendered page text** — visible text content when the a11y tree is
   unavailable.
3. **Relevant DOM text** — a scoped subtree's text, when a whole-page capture is
   too large or too noisy.

Pass the state as a named JSON field, not a raw blob, so the Jev question can
reference it clearly:

```json
{ "page_text": "<captured accessibility/page text>" }
```

## Per-driver capture

The rungs and their order do not change with the driver; only the tool that
produces them does — the same principle the shared
[locator ladder](../../../workflow/autonomous-workflow/rules/spec-run-contract.md)
already follows.

| Driver             | Accessibility tree                 | Page text                          |
| ------------------ | ---------------------------------- | ---------------------------------- |
| Playwright (`aw-tester`) | the a11y snapshot the runner takes between steps | the page's text content |
| claude-in-chrome (`aw-tester-chrome`) | `read_page` (accessibility read) | `get_page_text` |

The caller (the runner) captures the state at the moment the assertion runs and
hands it in; `jev-assert` does not drive the browser itself.

## Scope the state to the assertion

A whole-page capture is often larger than the judgment needs and dilutes the
signal.
When the expectation concerns one region (a dialog, a toast, a confirmation
panel), capture that region's text rather than the entire page.
A tighter, relevant state gives Jev a sharper judgment and costs fewer tokens —
but never trim so far that the state can no longer answer the question, which
would turn a real `contradicts` into a spurious `null`.

## Freshness

Capture the state **after** the action under test has settled, not before.
An assertion about "the user sees a confirmation" over pre-action state answers
the wrong question.
When state can change asynchronously (a network round-trip, an animation), the
runner waits for the settle signal it already uses for locator assertions before
capturing — semantic assertions inherit the same timing, not a looser one.

## Common mistakes

- Passing a screenshot or image path. **Fix:** capture the a11y tree or page
  text; an image is `unobtainable`, never input.
- Capturing the whole page for a one-region assertion. **Fix:** scope to the
  relevant subtree.
- Capturing before the action settles. **Fix:** wait for the same settle signal
  a locator assertion would, then capture.
- Over-trimming until the state can't answer the question. **Fix:** keep enough
  context that a genuine failure reads as `contradicts`, not `null`.
