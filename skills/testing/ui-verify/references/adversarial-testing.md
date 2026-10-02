---
title: Rationale — the adversarial pass
impact: MEDIUM
tags:
  - ui-verify
  - adversarial
  - edge-cases
  - rationale
---

# Rationale — the adversarial pass

Read [`rules/adversarial.md`](../rules/adversarial.md) first; this file explains why it is shaped the way it is and where the catalog comes from.

## Why a separate pass, and not more specs

A spec is the PR's acceptance contract: 1 to 3 behaviours a reviewer would click through, run deterministically, and mapped to `green` / `red` by every caller (`review-loop` Step 1.6 among them).
Edge-case probes are exploratory: which ones apply depends on the surface the spec exposes, and their outcomes need triage (probe error, unconfirmed, finding).
Folding them into the spec would make the verdict noisy and the PR body long, and would fork the spec grammar, which `aw-tester` owns.
So the pass derives its probes from the spec at run time, reports in its own `adversarial:` block, and never touches `verdict`.

Probing only specs that passed follows from the same split: a happy path that already fails gives every probe a broken baseline, and its findings would be noise.

## Why Playwright scripts, and Chrome only for a subset

| Need | Playwright script | Playwright MCP | Claude in Chrome |
| --- | --- | --- | --- |
| Fail, abort, or delay one request | `page.route` + `route.fulfill` / `route.abort('timedout')` / a delayed `fulfill` | `browser_route` fulfils only; no abort or delay | none |
| Offline | `context.setOffline(true)` | `browser_network_state_set` | none |
| Deterministic screenshots | `page.screenshot({ animations: 'disabled', caret: 'hide', mask })` | `browser_take_screenshot` has no `mask`, `animations`, or `caret` | screenshots and GIFs, no masking |
| Locale, timezone, colour scheme, reduced motion | context options, `page.emulateMedia` | `browser_emulate_media`; no locale or timezone tool | none |
| Unattended in CI or an Agent0 sandbox | yes | yes | no — pauses on login and CAPTCHA, and `alert()` blocks it |
| Session | a test account's `storageState` | `--isolated` context | the user's real profile and logins |

A generated `@playwright/test` file covers every row, which is why the template is a script.
The Chrome driver stays available for the categories that need no interception, because `ui-verify` already supports it for fast local runs.
It runs the user's real profile, and Anthropic reports a residual prompt-injection success rate for browser agents even with mitigations, so the guardrails forbid touching cookies, signing out, or leaving the preview under that driver.

## Why these categories and oracles

The categories condense three standard heuristic sources into what applies to a web UI change:

- the Test Heuristics Cheat Sheet (Hendrickson, Lyndsay, Emery) — data-type attacks, web navigation (Back, Refresh, bookmarking, URL hacking), Interruptions, Count 0/1/Many, and Constraints;
- the Heuristic Test Strategy Model (Bach) — the SFDIPOT product factors, especially *Operations* (disfavoured, careless, or malicious use) and *Time* (pacing and concurrency);
- the Big List of Naughty Strings — whitespace, zero-width, RTL, emoji, and benign script injection.

Each oracle is a concrete, checkable condition rather than a judgment, because an agent's "this looks wrong" is not reproducible.
The severities use the same `critical` / `high` / `medium` / `low` vocabulary as the `severity` skill, so a caller can gate on them without a mapping.

## Why the guardrails look the way they do

- **Preview frontends often share a staging backend.** Probes therefore abort mutations to unlisted origins, stub configured side-effect endpoints, mark every persisted string with `ui-verify-adv`, and act destructively only on records the run created.
- **Benign injection only.** A console marker proves execution without doing harm. `alert()` blocks Playwright's and Chrome's automation, and an external `<script src>` would load third-party code into a shared environment.
- **Page content is untrusted.** A probed page is input to the agent, so text on it is never followed as an instruction, and page-derived text is never executed.
- **Budgets.** Anthropic's guidance for agents is to stop on explicit iteration limits; the probe, time, and image caps are those limits, and `status: partial` makes a cut-off visible instead of silent.

## Why a replay before reporting

Exploratory probes against a live preview flake: a cold cache, a slow cold start, or a shared backend changing underneath the run.
Replaying each finding once and reporting `reproduced: 2/2` keeps one-off noise in `unconfirmed`, where a reviewer can see it without being asked to act on it.

## Why every passed probe also gets an image

A findings-only report cannot tell "tested and robust" from "never tested".
The HTSM calls this the testing story: what was covered matters as much as what broke.
The `passed` list and its `after` images show the reviewer, for example, the validation message an empty submit produced.

## Sources

- Playwright — [Screenshots](https://playwright.dev/docs/screenshots), [`page.screenshot` options](https://playwright.dev/docs/api/class-page), [Mock APIs](https://playwright.dev/docs/mock), [Network](https://playwright.dev/docs/network), [`route.abort` error codes](https://playwright.dev/docs/api/class-route), [Emulation](https://playwright.dev/docs/emulation), [Clock](https://playwright.dev/docs/clock), [Accessibility testing](https://playwright.dev/docs/accessibility-testing), [Trace viewer](https://playwright.dev/docs/trace-viewer), [Best practices](https://playwright.dev/docs/best-practices).
- Playwright Test Agents — [docs](https://playwright.dev/docs/test-agents); the planner prompt requires edge cases, error handling, and negative scenarios.
- Playwright MCP — [README](https://github.com/microsoft/playwright-mcp) (tool list, `--caps`, `--isolated`; origin flags are "not a security boundary"). Playwright CLI — [README](https://github.com/microsoft/playwright-cli).
- Claude Code with Chrome — [docs](https://code.claude.com/docs/en/chrome). Piloting Claude in Chrome — [blog](https://claude.com/blog/claude-for-chrome) (prompt-injection rates with and without mitigations).
- Claude Code [best practices](https://code.claude.com/docs/en/best-practices) — give the agent a check it can run, such as a screenshot. Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — ground truth from the environment and explicit stopping conditions.
- [Test Heuristics Cheat Sheet](https://www.ministryoftesting.com/insights/test-heuristics-cheat-sheet). [Heuristic Test Strategy Model](https://www.satisfice.com/download/heuristic-test-strategy-model). [Big List of Naughty Strings](https://github.com/minimaxir/big-list-of-naughty-strings). OWASP [Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html) — client-side checks can be bypassed, so the server must re-validate.
- [gremlins.js](https://github.com/marmelab/gremlins.js) — seeded monkey testing; deliberately not used, because unscoped random clicks cannot honour the destructive-action guardrail.
