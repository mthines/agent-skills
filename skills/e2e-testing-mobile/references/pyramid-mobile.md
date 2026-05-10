---
title: Testing Pyramid for Expo / React Native in 2026
impact: MEDIUM
tags:
  - testing-pyramid
  - mobile
  - jest
  - react-native-testing-library
  - maestro
  - reference
---

# Testing Pyramid for Expo / React Native in 2026

## Contents

- [Default ratios](#default-ratios)
- [Layer ownership](#layer-ownership)
- [The AI-generation caveat](#the-ai-generation-caveat)
- [The mobile-specific caveat — UI cost](#the-mobile-specific-caveat--ui-cost)
- [Cross-references](#cross-references)
- [Sources](#sources)

## Default ratios

The widely cited target — still the right starting point for mobile
in 2026:

| Layer            | Share | Purpose                                                      |
| ---------------- | ----- | ------------------------------------------------------------ |
| Unit             | ~70%  | Pure logic, no view, no nav. Fast, isolated. Jest.          |
| Component        | ~20%  | Single-component render + interaction. Jest + RNTL.         |
| Mobile E2E       | ~10%  | Critical user journeys end-to-end on a simulator or device. |

Treat the percentages as a **default bias**, not a quota.
Apps with heavy native modules (Bluetooth, sensors, payments) tilt
slightly more E2E.
Apps that are mostly forms-and-lists tilt slightly less.

This is the same shape as the web pyramid — the difference is the
tooling that owns each layer.

## Layer ownership

| Layer       | Skill / tool                                                                |
| ----------- | --------------------------------------------------------------------------- |
| Unit        | [`tdd`](../../tdd/SKILL.md) — Jest.                                         |
| Component   | [`tdd`](../../tdd/SKILL.md) — Jest + React Native Testing Library (RNTL).   |
| Integration | Jest + MSW (network) or Supertest with a real DB on the server side.       |
| Mobile E2E  | This skill — Maestro on a simulator / Maestro Cloud.                        |
| Web E2E     | [`e2e-testing`](../../e2e-testing/SKILL.md) — Playwright Test Agents.       |

The split prevents the most common mistake on mobile teams:
writing E2E for everything because RNTL feels "too slow to set up".
RNTL is fast, well-supported, and the right answer for any
single-screen behavioural assertion.

## The AI-generation caveat

LLM-generated React Native code passes its own LLM-generated unit
tests very cleanly.
Those tests share assumptions with the implementation and fail to
catch the bugs that show up in real flows.

Two practical implications:

1. Run [`test-provenance-guard`](../../test-provenance-guard/SKILL.md)
   on AI-authored unit and RNTL tests to catch tests-by-construction.
2. Spend slightly more E2E budget on AI-touched flows than on
   hand-written ones — the marginal return is higher.

This caveat is identical to the web counterpart in
[`../../e2e-testing/references/pyramid-2026.md`](../../e2e-testing/references/pyramid-2026.md).
It applies on mobile because the failure mode is in the LLM, not the
target platform.

## The mobile-specific caveat — UI cost

Mobile E2E is **more expensive** than web E2E per assertion:

- Build minutes (8–25 min on EAS Build per profile change).
- Simulator boot time (10–30 s cold).
- Maestro Cloud runner minutes (~$ per flow-second).

A web E2E run is essentially free at the per-test margin once the
suite is wired.
A mobile run carries a per-build floor.

That cost asymmetry is why this skill leans harder on:

- Build reuse (see [`../rules/token-budget.md`](../rules/token-budget.md)).
- Sharding only on Cloud, never locally.
- Single-flow iteration during development.

It is **not** a reason to lower the ~10% E2E share — the user-flow
coverage is exactly where mobile bugs hide.
It is a reason to spend that 10% deliberately.

## Cross-references

- Layer decisions:
  [`../rules/layer-decision.md`](../rules/layer-decision.md).
- Token discipline:
  [`../rules/token-budget.md`](../rules/token-budget.md).
- Web pyramid:
  [`../../e2e-testing/references/pyramid-2026.md`](../../e2e-testing/references/pyramid-2026.md).

## Sources

- [Complete Guide to Testing React Native Apps 2026 — RN Relay](https://reactnativerelay.com/article/complete-guide-testing-react-native-apps-2026-unit-tests-e2e-maestro)
- [Best React Native Testing Frameworks — maestro.dev](https://maestro.dev/insights/best-react-native-testing-frameworks)
- [Testing — React Native official docs](https://reactnative.dev/docs/testing-overview)
