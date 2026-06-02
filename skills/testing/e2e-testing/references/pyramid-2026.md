---
title: Testing Pyramid in 2026
impact: MEDIUM
tags:
  - testing-pyramid
  - ratios
  - ai-generation
  - reference
---

# Testing Pyramid in 2026

## Contents

- [Default ratios](#default-ratios)
- [The AI-generation caveat](#the-ai-generation-caveat)
- [Layer ownership](#layer-ownership)
- [Sources](#sources)

## Default ratios

The widely cited target — still the right starting point in 2026:

| Layer         | Share | Purpose                                              |
| ------------- | ----- | ---------------------------------------------------- |
| Unit          | ~70%  | Pure logic, no DOM, no network. Fast, isolated.     |
| Integration   | ~20%  | Two-component seams (API + DB, BFF + service).      |
| E2E           | ~10%  | Critical user journeys end-to-end through a browser. |

Treat the percentages as a **default bias**, not a quota.
A team building heavily AI-generated UIs will spend more on E2E
(see below).
A team shipping a CLI will spend almost nothing on E2E.

## The AI-generation caveat

LLM-generated code passes its own LLM-generated unit tests very cleanly.
Those tests often share assumptions with the implementation, so they fail
to catch the bugs that show up in real flows.

The result: in repos with significant AI-authored code, the **E2E share
rises** because user flows are where divergence between mental model and
real behaviour shows up.

Two practical implications:

1. Run [`test-provenance-guard`](../../../quality/test-provenance-guard/SKILL.md) on
   AI-authored unit tests to catch tests-by-construction.
2. Spend slightly more E2E budget on AI-touched flows than on hand-written
   ones — the marginal return is higher.

## Layer ownership

| Layer       | Skill / tool                                            |
| ----------- | ------------------------------------------------------- |
| Unit        | [`tdd`](../../../quality/tdd/SKILL.md) — Vitest + RTL stack.      |
| Component   | [`tdd`](../../../quality/tdd/SKILL.md) — Vitest + RTL or Playwright component test. |
| Integration | Vitest + MSW or Supertest with a real DB.              |
| E2E         | This skill — Playwright Test Agents.                    |

The split prevents the most common mistake: writing E2E for everything
because the tooling makes it cheap.
It is not cheap — see [`rules/token-budget.md`](../rules/token-budget.md).

## Sources

- [Testing Pyramid 2026 — Testomat](https://testomat.io/blog/testing-pyramid-role-in-modern-software-testing-strategies/)
- [Unit vs Integration vs E2E Testing 2026 — Autonoma](https://www.getautonoma.com/blog/unit-vs-integration-vs-e2e-testing)
- [JavaScript Testing Frameworks 2026 — TestDino](https://testdino.com/blog/javascript-testing-frameworks)
