---
title: Detox — Legacy and Migration Notes
impact: MEDIUM
tags:
  - detox
  - legacy
  - migration
  - react-native
  - reference
---

# Detox — Legacy and Migration Notes

## Contents

- [What Detox is and why it persists](#what-detox-is-and-why-it-persists)
- [When to keep an existing Detox suite](#when-to-keep-an-existing-detox-suite)
- [When to migrate to Maestro](#when-to-migrate-to-maestro)
- [Migration sequencing](#migration-sequencing)
- [Cost benchmarks](#cost-benchmarks)
- [Sources](#sources)

## What Detox is and why it persists

Detox is Wix's **gray-box** mobile E2E framework.
It instruments the app at build time so the test runner can read
internal RN state — JavaScript thread idle, network in-flight,
animation status — and synchronise actions to that state.

The reward: per-flow execution is fast and flake rates sit < 2% on
stable RN versions.
The cost: Detox patches the build, ties native versions to specific
Detox releases, and introduces a tax on every RN upgrade.

A Detox setup that breaks during an RN upgrade typically costs 1–2
days of senior-engineer time.
Teams running 3–4 major RN upgrades per year with a brittle Detox
suite pay that tax repeatedly — which is the dominant reason teams
have moved off Detox in 2025–2026.

## When to keep an existing Detox suite

Keep Detox in place when **all** of these are true:

- The suite is green and has been stable across at least one RN upgrade.
- The flake rate is < 2% over the last 30 days.
- The team has live in-house Detox expertise — the engineer who set
  it up is still around.
- Critical revenue or auth flows depend on synchronisation behaviours
  Maestro's black-box approach cannot replicate (e.g. asserting on a
  background JS-thread idle before tapping).

If any of those conditions fails, the migration cost-benefit flips.

## When to migrate to Maestro

Migrate when any of these is true:

- A recent RN upgrade broke the suite, and the fix burned > 1 day.
- The flake rate is > 5% — every additional flake is a deferred
  Detox-version pin.
- New engineers cannot onboard onto the Detox suite without a senior
  buddy.
- The team has standardised on Expo and wants the EAS Workflow
  `maestro-cloud` job (no GitHub Actions glue).
- The CI bill for retries is non-trivial — Maestro's < 1% flake rate
  removes most of the retry surface.

## Migration sequencing

Migrate **flow-by-flow**, not all at once.
Big-bang rewrites gamble a working safety net.

Recommended order:

1. **Inventory** — list every Detox flow with its last-30-day flake
   rate and last-modified date. Sort: brittle + stale at the top.
2. **Establish parallel infrastructure** — install Maestro CLI, add
   `.maestro/`, wire the EAS `e2e` build profile and the
   `maestro-cloud` job. The Detox suite stays running.
3. **Migrate one flow at a time** — pick the flakiest first. Keep the
   Detox version of the flow green until the Maestro version runs in
   CI.
4. **Cut over per flow** — once the Maestro flow is green for a week,
   delete the Detox flow.
5. **Decommission Detox** — only after every flow has crossed over,
   remove `detox` from `devDependencies`, the build patches, and the
   CI job.

Anti-pattern:
deleting `e2e/` (the conventional Detox folder) and creating
`.maestro/` in the same PR.
That gambles the safety net the Detox suite still provides.

## Cost benchmarks

Approximate, drawn from public migration write-ups
(see [Sources](#sources)):

| Metric                                          | Detox                | Maestro              |
| ----------------------------------------------- | -------------------- | -------------------- |
| Per-flow execution                              | 8–12 s               | 12–18 s              |
| Flake rate (steady-state RN versions)           | < 2%                 | < 1%                 |
| Setup time (greenfield)                         | 4–8 h                | < 1 h                |
| RN-upgrade tax (major version)                  | 1–2 senior-eng days  | < 30 minutes         |
| CI-time (suite of ~50 flows, 4 shards)          | 6–9 min              | 8–12 min             |

Trade-off summary: Detox is faster per flow; Maestro is faster
end-to-end once you account for upgrade tax and flake-driven retries.

## Sources

- [Detox vs. Maestro flake comparison — maestro.dev](https://maestro.dev/insights/detox-vs-maestro-reducing-flakiness-react-native)
- [Detox vs. Maestro vs. Appium 2026 — PkgPulse](https://www.pkgpulse.com/blog/detox-vs-maestro-vs-appium-react-native-e2e-testing-2026)
- [Best Detox alternatives — Autonoma](https://getautonoma.com/blog/detox-alternatives-react-native)
- [Choosing between Maestro and Detox — Jupiter Money](https://life.jupiter.money/choosing-between-maestro-and-detox-on-jupiter-qa-automation-7b94e6f8759d)
