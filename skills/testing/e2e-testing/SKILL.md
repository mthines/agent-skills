---
name: e2e-testing
description: >
  Plans, generates, runs, and heals end-to-end tests using Playwright Test
  Agents (Planner, Generator, Healer) and the official `@playwright/mcp`
  server. Drives a spec-first feature-flow loop, proposes `data-testid`
  source diffs only when accessibility-tree locators fail, and stays
  token-aware via snapshot mode and `--last-failed` reruns. Use when adding
  E2E coverage, verifying a user journey, hardening a flaky flow, or wiring
  Playwright MCP into a repo. Triggers on "test this flow", "add e2e",
  "verify the user journey", "write e2e test", "feature test", "playwright
  agents", "/e2e-testing".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: slash-command
  tags:
    - e2e
    - playwright
    - playwright-mcp
    - test-agents
    - spec-first
    - locators
    - token-economy
    - browser-automation
---

# E2E Testing

Drive end-to-end tests through Playwright's MCP-backed Test Agents — Planner,
Generator, Healer — released in Playwright 1.56 (Oct 2025).
The user writes (or approves) a Markdown feature spec; agents generate the
test, run it against a real browser via the accessibility tree, and self-heal
when locators drift.

> **This `SKILL.md` is a thin index.**
> Decision rules live in [`rules/*.md`](./rules) and load on demand.
> Worked references (agent reference, MCP tool catalog, pyramid math) live
> in [`references/*.md`](./references).
> Literal boilerplate the skill emits lives in [`templates/*.md`](./templates).
> Do not preload everything — load only what the current phase asks for.

---

## When to use

Reach for this skill when any of the following is true:

- A feature has user-facing flow that integration tests cannot fully cover.
- A bug repros only through real navigation (multi-page, auth, real network).
- A flake needs a Healer pass instead of a manual locator hunt.
- The repo has no `@playwright/mcp` wiring yet and needs Phase 0 setup.

Do **not** reach for this skill when:

- A unit or component test would catch the same bug — defer to
  [`tdd`](../../quality/tdd/SKILL.md) and the layer rule in
  [`rules/layer-decision.md`](./rules/layer-decision.md).
- The change is a pure refactor with no behavioural surface.
- You are adding test infrastructure unrelated to a real flow.

---

## Phase 0 — Preflight (mandatory gate)

Before any agent loop, verify the repo is wired for Playwright Test Agents.
Halt and ask the user before installing anything.

Run these checks (read-only):

```bash
# 1. Playwright + MCP server installed?
jq '.devDependencies | keys[]' package.json | grep -E '@playwright/(test|mcp)'

# 2. Test-agent artefacts present?
ls specs/ tests/seed.spec.ts playwright.config.ts 2>/dev/null
```

Decision table:

| State                                       | Action                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Both deps present + artefacts exist         | Proceed to Phase 1.                                                     |
| Deps missing                                | **Halt.** Print install plan, ask permission before running.            |
| Deps present, artefacts missing             | **Halt.** Print `npx playwright init-agents --loop=claude`, ask first.  |
| Playwright present but version `< 1.56`     | **Halt.** Test Agents require 1.56+. Ask permission to upgrade.         |

Print the exact commands; do not run them silently.
The install plan template is in [`templates/install-plan.md`](./templates/install-plan.md).

---

## Phase 1 — Spec-first feature flow

The agent loop is **spec → generate → run → heal**.
The spec is human-readable Markdown, not code.
Full rules: [`rules/spec-first-flow.md`](./rules/spec-first-flow.md).

```
specs/<flow>.md   ─┐
                   ├─→  Generator  ─→  tests/<flow>.spec.ts  ─→  run  ─→  pass?
                   │                                                       │ no
                   │                                                       ▼
                   └────────────────────  Healer  ←──────────────  failing test
                                              │
                                              ▼
                                  patched test or `data-testid` proposal
```

Two entry points:

1. **Spec already drafted by the user.**
   Skip the Planner.
   Run the Generator on `specs/<flow>.md`.
2. **App exists, no spec yet.**
   Run the Planner against the live app to draft `specs/<flow>.md`.
   User reviews the Markdown plan before generation.

Use the Markdown template in [`templates/spec.md`](./templates/spec.md).

### Locator ladder (when generating or healing)

The Generator and the Healer both walk the accessibility tree.
Pick locators in this order — never skip a rung:

1. `getByRole('button', { name: 'Save' })` — accessibility-tree native.
2. `getByLabel`, `getByPlaceholder`, `getByText` — user-facing strings.
3. `getByTestId('save-draft')` — escape hatch only.

`data-testid` is a source change, not a test workaround.
When the Healer cannot find a stable locator at rungs 1–2, propose a source
diff that adds `data-testid` to the component, and offer the diff for user
approval before patching the test.
Full rules and decision criteria: [`rules/locator-strategy.md`](./rules/locator-strategy.md).

---

## Phase 2 — Token-aware execution

Playwright MCP defaults to **snapshot mode** (accessibility tree, text-only).
Do not enable `--caps=vision` unless an explicit pixel-level concern exists.
Full rules: [`rules/token-budget.md`](./rules/token-budget.md).

Defaults the skill prescribes:

- Snapshot mode (no vision) for all agent calls.
- Run only the changed spec on iteration: `npx playwright test --last-failed`.
- Run the Healer **only on failure**, not on every save.
- Reuse `storageState` from `tests/seed.spec.ts` to skip auth on every run.
- Cap the heal loop at three attempts per failing test before escalating.

---

## Phase 3 — Verification

After the Generator produces a test:

1. Run the test once against the live app.
   It must pass on first run, or the Healer must converge in ≤ 3 attempts.
2. Invoke [`test-provenance-guard`](../../quality/test-provenance-guard/SKILL.md) on
   the generated file to ensure the test imports production code instead
   of a private re-implementation.
3. Open `playwright.config.ts` and confirm `trace: 'on-first-retry'` is set
   so a future failure produces a trace bundle.

If the heal loop fails to converge:

- Invoke `confidence(analysis)` on the test failure.
- If confidence is below 90%, escalate to the user with the trace, the spec,
  and the proposed locator changes — do **not** keep healing blindly.

---

## Decision flow at a glance

| Signal                                                       | Do                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| Bug fixable by a unit or component test                      | Use [`tdd`](../../quality/tdd/SKILL.md), not this skill.                 |
| Multi-page user flow, auth, or real network involved         | Spec-first feature flow (Phase 1).                            |
| Flaky existing test                                          | Healer pass only; do not rewrite without spec context.        |
| Locator unstable, no stable role / label                     | Propose `data-testid` diff (rule: locator-strategy).          |
| Repo missing Playwright or MCP                               | Phase 0 halt + ask permission.                                |
| Heal loop > 3 attempts                                       | Stop, run `confidence(analysis)`, escalate.               |
| Test passes on first run, never seen failing                 | Run `test-provenance-guard` before declaring done.            |

---

## Composes with

- [`tdd`](../../quality/tdd/SKILL.md) — owns the unit and component layers.
  This skill defers to it for anything below E2E.
- [`test-provenance-guard`](../../quality/test-provenance-guard/SKILL.md) — runs after
  Generator output to catch tests-by-construction.
- [`confidence`](../../quality/confidence/SKILL.md) — gate when the heal loop fails.
- [`holistic-analysis`](../../analysis/holistic-analysis/SKILL.md) — if a flow is failing
  for reasons no test rewrite can fix, step back instead of patching.
- [`playwright-trace-analyzer`](../../analysis/playwright-trace-analyzer/SKILL.md) —
  consume the trace produced by a failed test on retry.

---

## References

- [`references/playwright-agents.md`](./references/playwright-agents.md) —
  Planner / Generator / Healer reference, inputs, outputs, invocation.
- [`references/mcp-tool-catalog.md`](./references/mcp-tool-catalog.md) —
  the `@playwright/mcp` tool surface, grouped by category.
- [`references/pyramid-2026.md`](./references/pyramid-2026.md) — testing
  pyramid math in 2026, with the AI-generation caveat.

## Templates

- [`templates/spec.md`](./templates/spec.md) — feature-flow Markdown spec.
- [`templates/seed.spec.ts`](./templates/seed.spec.ts) — auth and storage
  bootstrap, produces `storageState`.
- [`templates/playwright.config.ts`](./templates/playwright.config.ts) —
  opinionated config: snapshot mode, traces on first retry, projects per
  browser, parallel CI defaults.
- [`templates/install-plan.md`](./templates/install-plan.md) — Phase 0 halt
  message with the exact commands to install Playwright + MCP.

---

## Anti-patterns (one-liner — full list in [`rules/anti-patterns.md`](./rules/anti-patterns.md))

- Writing E2E for logic a unit test catches.
- Running the Healer on every save.
- Patching the test with brittle CSS selectors instead of proposing a
  `data-testid` diff.
- Enabling `--caps=vision` without a pixel-level requirement.
- Ignoring Healer suggestions and keeping a `.skip()` in CI.
- Generating tests against a stub server, not the real app.

---

## Definition of done

- [ ] Phase 0 preflight passed or installs were user-approved.
- [ ] `specs/<flow>.md` exists and the user reviewed it.
- [ ] `tests/<flow>.spec.ts` passes against the live app.
- [ ] `test-provenance-guard` reports no violations on the new test.
- [ ] `playwright.config.ts` has `trace: 'on-first-retry'`.
- [ ] If a `data-testid` was added, it is in the source diff and committed.
