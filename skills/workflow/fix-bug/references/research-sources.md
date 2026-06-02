---
title: Research Sources — Bug-Fixing with AI Agents (2024–2026)
tags:
  - research
  - sources
  - apr
  - swe-bench
  - reproducible
---

# Research Sources

Curated references behind every technique in `/fix-bug`. Grouped by topic, with the rule files
that cite each source. Use this file as a starting point for further reading; each entry
includes a one-line description of what to expect.

## Contents

- [Anthropic — Claude Code & agent design](#anthropic--claude-code--agent-design)
- [SWE-bench, SWE-agent, automated program repair](#swe-bench-swe-agent-automated-program-repair)
- [Counterexample-guided patching (CEGIS)](#counterexample-guided-patching-cegis)
- [Reproduction-first / failing-test patterns](#reproduction-first--failing-test-patterns)
- [Bisection and regression localisation](#bisection-and-regression-localisation)
- [Telemetry-closed-loop verification](#telemetry-closed-loop-verification)
- [Failure-class taxonomies](#failure-class-taxonomies)
- [Practitioner blogs and tooling](#practitioner-blogs-and-tooling)

---

## Anthropic — Claude Code & agent design

Cited in: [`SKILL.md`](../SKILL.md), [`rules/preflight.md`](../rules/preflight.md),
[`rules/independent-verification.md`](../rules/independent-verification.md),
[`rules/bug-notes-ledger.md`](../rules/bug-notes-ledger.md).

| Source | Why it matters |
|--------|----------------|
| [Best practices for Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices) | The canonical "how to drive Claude Code" guide. Read-before-write principle, sub-agent isolation, separating planning from implementation. |
| [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | Source of the **separate generator from grader** principle (verifier agent), the **read context before acting** rule (pre-flight), and the **deterministic init** pattern. |
| [Effective context engineering for AI agents (Sep 2025)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Source for **memory as structured note-taking** — the bug-notes ledger pattern. Survives compaction across sessions. |
| [Building effective agents](https://www.anthropic.com/research/building-effective-agents) | Foundational patterns for agentic workflows: orchestrator-workers, evaluator-optimizer (verifier), routing. |
| [anthropics/cwc-long-running-agents](https://github.com/anthropics/cwc-long-running-agents) | Working repo demonstrating the long-running-agent harness — `init.sh`, `claude-progress.txt`, `feature-list.json`. The bug-notes ledger is modelled after these. |
| [Claude Cookbook — context engineering](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) | Concrete code examples of the structured-note pattern. |

---

## SWE-bench, SWE-agent, automated program repair

Cited in: [`rules/reproduction.md`](../rules/reproduction.md),
[`rules/independent-verification.md`](../rules/independent-verification.md).

| Source | Why it matters |
|--------|----------------|
| [SWE-bench Verified harness](https://www.swebench.com/SWE-bench/) | The canonical evaluation harness for AI bug-fixing. Built around `FAIL_TO_PASS` and `PASS_TO_PASS` — every patch must turn a failing test green without breaking any previously passing test. The verifier in Phase 7 implements this contract. |
| [SWE-agent NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/file/5a7c947568c1b1328ccc5230172e1e7c-Paper-Conference.pdf) | Trace analysis of high-scoring agents on SWE-bench. "Create new file → add reproduction code → run with python" is the most popular triple of actions. The Reproduction Lock phase is modelled on this. |
| [SWT-Bench (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/file/94f093b41fc2666376fb1f667fe282f3-Paper-Conference.pdf) | Test-writing benchmark — formalises the "write the test before the fix" phase as distinct from patch generation. |
| [RepairAgent (ICSE 2025)](https://software-lab.org/publications/icse2025_RepairAgent.pdf) | Finite-state machine APR agent. Source of the **failure-class routing** idea — different bug classes need different sub-routines. |
| [LLM-APR survey (arXiv 2506.23749, 2025)](https://arxiv.org/html/2506.23749v1) | 2025 survey of LLM-based automated program repair. Reports the +15-30% improvement of CEGIS-style refinement over single-shot generation on Defects4J. |

---

## Counterexample-guided patching (CEGIS)

Cited in: [`rules/autonomous-handoff.md`](../rules/autonomous-handoff.md),
[`templates/bug-fix-pack.md`](../templates/bug-fix-pack.md).

| Source | Why it matters |
|--------|----------------|
| [LLM-CEGIS-Repair (AAAI 2025)](https://github.com/pmorvalho/LLM-CEGIS-Repair) | Formalises the hypothesis → test → counterexample → revise loop. The Bug Fix Pack's 3-round refinement contract is this loop, capped. |
| [Aider lint-test docs](https://aider.chat/docs/usage/lint-test.html) | Production implementation: Aider's `/test-first` loops up to 10 times with the failing test as concrete feedback. |

---

## Reproduction-first / failing-test patterns

Cited in: [`rules/reproduction.md`](../rules/reproduction.md).

| Source | Why it matters |
|--------|----------------|
| [SWE-agent paper (above)](https://proceedings.neurips.cc/paper_files/paper/2024/file/5a7c947568c1b1328ccc5230172e1e7c-Paper-Conference.pdf) | Trace evidence that high-scoring agents reproduce before fixing. |
| [SWE-bench Verified (above)](https://www.swebench.com/SWE-bench/) | The `FAIL_TO_PASS` / `PASS_TO_PASS` test-pair contract. |
| [SWT-Bench (above)](https://proceedings.neurips.cc/paper_files/paper/2024/file/94f093b41fc2666376fb1f667fe282f3-Paper-Conference.pdf) | Treats test generation as a phase distinct from patch generation. |

For the test-writing mechanics themselves, the `/tdd` skill is the source of truth — see
[`skills/quality/tdd/SKILL.md`](../../../quality/tdd/SKILL.md). For the layer decision (unit / component /
integration / E2E), see [`skills/testing/e2e-testing/rules/layer-decision.md`](../../../testing/e2e-testing/rules/layer-decision.md).

---

## Bisection and regression localisation

Cited in: [`rules/preflight.md`](../rules/preflight.md), [`rules/reproduction.md`](../rules/reproduction.md).

| Source | Why it matters |
|--------|----------------|
| [git-bisect documentation](https://git-scm.com/docs/git-bisect) | Canonical reference for `git bisect run`. Converts an unbounded search into log₂(n) test invocations. |
| [Gun.io 2025 bisect guide](https://gun.io/news/2025/05/git-bisect-debugging-guide/) | Practitioner walk-through of `git bisect run` with a deterministic repro. |
| [awesome-cursor-skills — systematic-debugging](https://github.com/spencerpauly/awesome-cursor-skills/blob/main/resources/systematic-debugging/SKILL.md) | Cursor-flavoured debugging skill that mandates bisect for regressions. |

---

## Telemetry-closed-loop verification

Cited in: [`rules/telemetry-verification.md`](../rules/telemetry-verification.md).

| Source | Why it matters |
|--------|----------------|
| [Datadog Watchdog Faulty Deployment Detection](https://docs.datadoghq.com/watchdog/faulty_deployment_detection/) | Vendor pattern for tagging deploys and polling for rate decay. The Phase 8 procedure mirrors this. |
| [Sentry + Datadog collaborative bug-fixing](https://blog.sentry.io/collaborative-bug-fixing-with-datadog/) | End-to-end flow from error detection through deploy verification. |
| Dash0 — uses OpenTelemetry semantic conventions; query the `service.version` / `deployment.version` attributes for release filtering. See the dash0 OTEL skills referenced in `/ai-engineering`. |

---

## Failure-class taxonomies

Cited in: [`SKILL.md`](../SKILL.md) Phase 0 (bugClass inference).

| Source | Why it matters |
|--------|----------------|
| [Seven Pernicious Kingdoms (NIST)](https://samate.nist.gov/SSATTM_Content/papers/Seven%20Pernicious%20Kingdoms%20-%20Taxonomy%20of%20Sw%20Security%20Errors%20-%20Tsipenyuk%20-%20Chess%20-%20McGraw.pdf) | Off-the-shelf bug taxonomy — input validation, API abuse, security features, time and state, errors, code quality, encapsulation, environment. The `bugClass` enum draws from this. |
| [RepairAgent (above)](https://software-lab.org/publications/icse2025_RepairAgent.pdf) | Demonstrates routing strategy by bug class (race needs scheduler instrumentation; null-deref needs contract-boundary inspection). |
| [LLM-APR survey (above)](https://arxiv.org/html/2506.23749v1) | Class-conditional repair effectiveness — same model, very different success rates by class. |

---

## Practitioner blogs and tooling

Cited in passing across rule files.

| Source | Why it matters |
|--------|----------------|
| [Aider documentation](https://aider.chat/docs/) | Production AI coding agent with mature test-loop mechanics. |
| [Cursor / Composer docs](https://docs.cursor.com/) | Production assistant with similar agent-loop architecture. |
| [Cognition Labs blog (Devin)](https://cognition.ai/blog) | Long-running agent design notes. |
| Hamel Husain — [hamel.dev](https://hamel.dev/) | Evals for AI coding agents; LLM-as-judge bias mitigation. |
| Simon Willison — [simonwillison.net](https://simonwillison.net/) | Practitioner notes on LLM tooling, prompt patterns, debugging workflows. |
| Lilian Weng — [lilianweng.github.io](https://lilianweng.github.io/) | LLM agent surveys; covers planning, memory, tool use. |
