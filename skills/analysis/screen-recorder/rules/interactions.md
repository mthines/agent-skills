---
title: Interactions — Recipe Catalog and Selector Strategy
impact: HIGH
tags:
  - interactions
  - playwright
  - locators
  - recipes
---

# Interactions

An interaction is the script that runs after the page loads and before
the idle hold.
This rule enumerates the **named recipes** the skill accepts and the
**inline interaction grammar** the user can pass when no recipe fits.

## Contents

- Recipe catalog (table)
- Inline `multi` syntax
- Selector strategy (locator verdict table)
- Waiting strategy inside a recipe
- Examples (good + bad)
- Proposing a `data-testid` source diff
- Common mistakes

## Recipe catalog

Pass one of these names as the `interaction` input.
The skill substitutes the matching block into the generated script.

| Recipe                | Effect                                                                 | Notes                                                              |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `idle`                | No interaction; record the resting state.                              | Default. Use for entrance animations triggered on mount.            |
| `hover`               | `await target.hover()`                                                 | Captures hover-driven transitions.                                  |
| `click`               | `await target.click()`                                                 | Captures click-driven state changes (modals, menus).                |
| `focus`               | `await target.focus()`                                                 | Captures focus rings, autocomplete pops.                            |
| `tab-to`              | Press `Tab` until `target` is `:focus`.                                | Use to validate focus-order animations.                             |
| `scroll-into-view`    | `await target.scrollIntoViewIfNeeded()` then wait 500 ms.              | Use for scroll-driven timelines or in-view IntersectionObserver.   |
| `scroll-page`         | `await page.mouse.wheel(0, 800)`                                       | Generic page scroll — for scroll-tied animations.                   |
| `press <Key>`         | `await page.keyboard.press('<Key>')`                                   | E.g., `press Escape` to close a modal.                              |
| `type <text>`         | `await target.type('<text>', { delay: 50 })`                           | For typing reveal / autocomplete animations.                        |
| `drag-to <selector>`  | `await page.locator(src).dragTo(page.locator(dst))`                    | Use for drag-and-drop morphs.                                       |
| `navigate <path>`     | A single follow-up `page.click(href)` (same SPA).                      | For View Transitions across SPA routes.                             |
| `multi`               | Composes a list of the above; see below.                               | When one recipe is not enough.                                      |

## Inline `multi` syntax

When the caller needs more than one step, pass `multi` plus a `steps`
array. The skill iterates and emits the right Playwright calls:

```json
{
  "interaction": "multi",
  "steps": [
    { "action": "hover", "selector": "[data-testid=card]" },
    { "action": "wait",  "ms": 400 },
    { "action": "click", "selector": "[data-testid=card]" },
    { "action": "wait",  "ms": 1200 }
  ]
}
```

Allowed `action` values: `hover`, `click`, `focus`, `type`, `press`,
`scroll-into-view`, `scroll-page`, `wait`, `drag-to`.
Any other value is rejected — the skill will not eval arbitrary JS.

## Selector strategy

Reject brittle locators **before** running the script.

| Locator                                       | Verdict | Reason                                                                      |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `[data-testid="services-sidebar"]`            | ✅       | Stable, intent-named, decoupled from styling.                                |
| `role=button[name="Open settings"]`           | ✅       | Accessible-name based, survives restyle.                                     |
| `text=Open settings`                          | ⚠️       | Drifts with i18n; OK for English-only fixtures.                              |
| `.btn-primary`                                | ⚠️       | OK for unique utility classes; bad on shared classes.                        |
| `div > div:nth-child(3)`                      | ❌       | Structural CSS — first markup change breaks it. **Reject.**                  |
| `xpath=//div[contains(...)]`                  | ❌       | XPath drift; Playwright supports it but the skill rejects.                   |

When rejecting, print:

```text
Selector "<value>" looks brittle. Provide a data-testid or role-based
locator instead. Examples:
  [data-testid="services-sidebar"]
  role=button[name="Open settings"]
```

## Waiting strategy inside a recipe

Each recipe must do **deterministic** waits — never `waitForTimeout`
inside the interaction itself (only in the trailing idle hold).

| Need                                | Use                                                  |
| ----------------------------------- | ---------------------------------------------------- |
| Wait for element to appear          | `locator.waitFor({ state: 'visible' })`              |
| Wait for animation to finish        | `await target.evaluate(el => el.getAnimations().map(a => a.finished))` then `Promise.all(...)` |
| Wait for network idle               | `page.waitForLoadState('networkidle')`               |
| Wait for a specific selector to go  | `locator.waitFor({ state: 'hidden' })`               |
| Wait for a route change             | `page.waitForURL('**/path')`                         |

The trailing idle hold (Phase 5 of the script) covers the *visual*
tail-off so the viewer sees the animation complete; it should not be
used to mask flaky interactions.

## Examples

### Good — single recipe

```text
interaction: hover
selector: [data-testid="nav-collapse"]
duration: 2500
```

### Good — multi

```json
{
  "interaction": "multi",
  "steps": [
    { "action": "scroll-into-view", "selector": "[data-testid=hero]" },
    { "action": "wait", "ms": 200 },
    { "action": "hover", "selector": "[data-testid=hero-cta]" },
    { "action": "wait", "ms": 600 }
  ]
}
```

### Bad — raw JS

```text
interaction: "await page.evaluate(() => window.somethingClever())"
```

**Fix:** if no recipe fits, propose adding a named recipe — never run
arbitrary user-supplied JS.

### Bad — brittle selector

```text
selector: div.flex > div:nth-of-type(2) > button
```

**Fix:** add `data-testid` to the source and use it. The skill should
note "selector unstable — please add a `data-testid`" instead of
recording.

## Adding `data-testid` to source

If the user agrees, propose a one-line source diff (do not apply
unilaterally):

```diff
- <button onClick={openSettings}>Settings</button>
+ <button data-testid="open-settings" onClick={openSettings}>Settings</button>
```

Apply only after explicit user confirmation.
This is the same pattern the `e2e-testing` skill uses; it preserves
the locator ladder.

## Common mistakes

- **Running arbitrary user JS as the interaction.**
  Becomes a remote-eval vector.
  **Fix:** restrict to the recipe catalog and `multi`'s allowed actions.
- **Using `waitForTimeout` inside the interaction.**
  Hides race conditions.
  **Fix:** use deterministic waits; reserve `waitForTimeout` for the
  trailing idle hold only.
- **Mixing two interactions in one run.**
  Doubles the recording length, halves clarity.
  **Fix:** record twice and stitch in the report if needed.
- **Hover then immediate click on the same target.**
  Some hover transitions are interrupted by the click — record them
  separately and tag the artifacts.
