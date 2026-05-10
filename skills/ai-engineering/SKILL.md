---
name: ai-engineering
description: >
  Reviews and guides LLM/AI application engineering: prompt writing,
  system-prompt design, prompt caching and token cost, multimodal
  inputs (vision/audio/PDFs), RAG, agent loops and tool design,
  resilience (rate limits, retries, fallbacks), memory and long-running
  state, model migration and version pinning, evals, testing (mocks,
  VCR, snapshots), safety and prompt-injection defence, and
  observability. Synthesises 2025-2026 practices from primary provider
  docs (Anthropic, OpenAI, Google), OWASP LLM Top 10, and practitioners
  (Hamel Husain, Eugene Yan, Chip Huyen). Use when designing prompts,
  structuring system prompts, optimising token cost, building RAG or
  agents, writing evals or tests, hardening for rate limits and outages,
  migrating models, or auditing existing AI code. Triggers on "review my
  prompt", "design a system prompt", "optimise tokens", "set up RAG",
  "build an agent", "handle rate limits", "migrate to a new model",
  "write evals", "test my prompt", "audit AI code", "/ai-engineering".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags:
    - ai-engineering
    - llm
    - prompt-engineering
    - multimodal
    - rag
    - agents
    - evals
    - testing
    - guardrails
    - observability
---

# AI Engineering

Prescriptive guidance for building and reviewing LLM/AI applications.
Thirteen orthogonal concerns — load only the rules the current task
needs.

> **This `SKILL.md` is a thin index.** Detailed rules live in
> `rules/*.md` and load on demand.
> Curated source URLs live in `references/primary-sources.md`.
> Date-flagged changes since 2024 live in `references/recent-changes.md`.
> Literal scaffolding lives in `templates/`.

---

## Mode Detection

Parse `$ARGUMENTS` (first token) and detect the mode:

| Mode       | Default | Trigger                                                                       |
| ---------- | ------- | ----------------------------------------------------------------------------- |
| `guide`    | **yes** | Default. Open question ("how should I …", "what's the best way to …").        |
| `review`   |         | `$0 == "review"`, or a file/path is supplied as `$ARGUMENTS`.                 |
| `design`   |         | `$0 == "design"`, or "scaffold a prompt / system prompt / eval".              |

State the detected mode and the area(s) in scope before continuing:

```
Mode: review
Areas: prompt-writing, system-prompt-design
Targets: src/agents/triage.ts (system prompt at L24-78)
```

---

## Area Routing

Map the user's request to one or more rule files.
Load **only** the rules listed for the matched area(s).

| Area                            | Rule file                                                                          | Load when                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Writing user prompts            | [`rules/prompt-writing.md`](./rules/prompt-writing.md)                             | "improve this prompt", few-shot questions, output format, CoT, structured outputs.    |
| Designing system prompts        | [`rules/system-prompt-design.md`](./rules/system-prompt-design.md)                 | Persona, tool docs, ordering, refusals, agent stop conditions.                       |
| Token cost / latency            | [`rules/token-optimization.md`](./rules/token-optimization.md)                     | Prompt caching, model routing, batching, streaming, max_tokens.                      |
| Multimodal                      | [`rules/multimodal.md`](./rules/multimodal.md)                                     | Image/audio/PDF inputs, vision-vs-OCR, voice agents, image token costs.              |
| Retrieval-augmented generation  | [`rules/rag.md`](./rules/rag.md)                                                   | Chunking, embeddings, hybrid search, reranking, query rewriting.                     |
| Agents & tool use               | [`rules/agents-and-tools.md`](./rules/agents-and-tools.md)                         | Tool schemas, agent loops, parallel tool calls, error recovery, workflow vs agent.   |
| Resilience                      | [`rules/resilience.md`](./rules/resilience.md)                                     | Rate limits (429), retries with jitter, circuit breakers, fallback chains, timeouts, idempotency. |
| Memory & long-running state     | [`rules/memory-and-state.md`](./rules/memory-and-state.md)                         | Conversation summarisation, structured memory, vector memory, memory tools, compaction. |
| Model migration & versioning    | [`rules/model-migration.md`](./rules/model-migration.md)                           | Pin snapshots vs aliases, A/B a new model, deprecations, cross-provider migration, rollback. |
| Evaluation                      | [`rules/evals.md`](./rules/evals.md)                                               | Golden sets, LLM-as-judge, regression CI, error analysis.                            |
| Testing (engineering)           | [`rules/testing.md`](./rules/testing.md)                                           | Unit/integration tests, mocks, VCR cassettes, snapshot tests, CI cost discipline.    |
| Safety & guardrails             | [`rules/safety-and-guardrails.md`](./rules/safety-and-guardrails.md)               | Prompt injection, jailbreaks, output validation, PII, scope control.                 |
| Observability & versioning      | [`rules/observability-and-versioning.md`](./rules/observability-and-versioning.md) | Tracing, prompts-as-code, A/B releases, rollback.                                    |

`evals.md` covers product-quality measurement (golden sets, LLM-as-judge).
`testing.md` covers engineering-correctness tests (mocks, VCR, snapshots).
Load both when the user asks "how do I test this?" without specifying.

**Observability composition.**
When the area is `Observability & versioning` and the task involves OTEL
wiring or attribute naming, invoke the dash0 OTEL skills via `Skill()`
**before** answering — they hold the source of truth for spans and
`gen_ai.*` semconv:

- `Skill("otel-instrumentation", ...)` — SDK setup, exporters, span shape.
- `Skill("otel-semantic-conventions", ...)` — attribute naming and
  spec validation.

If neither skill is in the available-skills list, fall back to the
inline guidance in `rules/observability-and-versioning.md` and the OTEL
spec.

If the user does not name an area, ask one batched clarifying question
listing the thirteen options before loading rules.

---

## Workflow

### `guide` (default)

1. Identify the area(s) from the user's request (use the table above).
2. Load the matched rule file(s).
3. Answer using the rules.
   Cite the source URLs from `references/primary-sources.md` when a claim
   is non-obvious or model-version-specific.
4. If the rule references a date-flagged change, also load
   [`references/recent-changes.md`](./references/recent-changes.md) and
   call out the date in the answer.

### `review`

1. Read the target file(s) supplied in `$ARGUMENTS`.
2. Detect which areas the file touches (prompt strings, system prompts,
   tool schemas, retrieval pipelines, eval scripts, …).
3. Load the matching rule file(s).
4. Produce findings as a numbered list, each with:
   - **What** — the issue, with `path:line`.
   - **Rule** — the rule file + section that's violated.
   - **Fix** — concrete change, with a code snippet when ≤ 10 lines.
5. End with a "Top 3 fixes" prioritised by impact.

Do not edit the file in `review` mode unless the user asks for fixes.

### `design`

1. Confirm the artefact: prompt, system prompt, or eval rubric?
2. Ask the user — in **one** message — for:
   - The task the prompt drives.
   - The model family (Claude / GPT / Gemini / open).
   - Any hard constraints (latency budget, output schema, refusal scope).
   - Whether tool use is in scope.
3. Load the relevant rule(s) and the matching template:
   - System prompt → [`templates/system-prompt-skeleton.md`](./templates/system-prompt-skeleton.md).
   - Tool definition → [`templates/tool-description.md`](./templates/tool-description.md).
   - Eval rubric → [`templates/eval-rubric.md`](./templates/eval-rubric.md).
   - Golden-set seed → [`templates/golden-set.md`](./templates/golden-set.md).
4. Fill in the template.
   Annotate **why** each section exists (one inline comment per section,
   not a full essay).

---

## Required Reading by Area

Load on demand — do not preload.

| Area                      | Files                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Prompt writing            | [`rules/prompt-writing.md`](./rules/prompt-writing.md)                                          |
| System prompts            | [`rules/system-prompt-design.md`](./rules/system-prompt-design.md)                              |
| Token cost                | [`rules/token-optimization.md`](./rules/token-optimization.md)                                  |
| Multimodal                | [`rules/multimodal.md`](./rules/multimodal.md)                                                  |
| RAG                       | [`rules/rag.md`](./rules/rag.md)                                                                |
| Agents                    | [`rules/agents-and-tools.md`](./rules/agents-and-tools.md)                                      |
| Resilience                | [`rules/resilience.md`](./rules/resilience.md)                                                  |
| Memory & state            | [`rules/memory-and-state.md`](./rules/memory-and-state.md)                                      |
| Model migration           | [`rules/model-migration.md`](./rules/model-migration.md)                                        |
| Evals                     | [`rules/evals.md`](./rules/evals.md)                                                            |
| Testing                   | [`rules/testing.md`](./rules/testing.md)                                                        |
| Safety                    | [`rules/safety-and-guardrails.md`](./rules/safety-and-guardrails.md)                            |
| Observability             | [`rules/observability-and-versioning.md`](./rules/observability-and-versioning.md)              |
| Source URLs               | [`references/primary-sources.md`](./references/primary-sources.md)                              |
| Date-flagged changes      | [`references/recent-changes.md`](./references/recent-changes.md)                                |
| System prompt template    | [`templates/system-prompt-skeleton.md`](./templates/system-prompt-skeleton.md)                  |
| Tool description template | [`templates/tool-description.md`](./templates/tool-description.md)                              |
| Eval rubric template      | [`templates/eval-rubric.md`](./templates/eval-rubric.md)                                        |
| Golden-set template       | [`templates/golden-set.md`](./templates/golden-set.md)                                          |

---

## Core Principles

1. **Stable-prefix everything.**
   The single highest-leverage optimisation across cost, latency, and
   determinism is keeping the prompt prefix byte-identical across calls
   so it caches.
   Order: `tools → system → stable context → volatile context → user input`.
2. **Match the technique to the model class.**
   Reasoning models (o3, o4, Claude with adaptive thinking) regress under
   added chain-of-thought; non-reasoning models often need it.
   See `rules/prompt-writing.md`.
3. **Workflows beat agents until they don't.**
   A predefined control flow is cheaper, faster, and more debuggable than
   a model-driven loop.
   Build an agent only when the trajectory genuinely cannot be enumerated.
4. **Evals before optimisation.**
   You cannot tell whether a prompt change is an improvement without a
   golden set + regression run.
   Without traces in production, you have no eval inputs.
5. **Defence-in-depth for prompt injection.**
   OWASP LLM01:2025 ranks prompt injection #1.
   Layer input classifier + least-privilege tools + human approval on
   destructive actions + output validator.
   No single guardrail is sufficient — guardrail LLMs are themselves
   injectable.
6. **Right-size the model.**
   Route 60% Haiku-class / 30% Sonnet-class / 10% Opus-class with
   confidence-gated escalation.
   Uniform-Opus is rarely the right answer.
7. **Prompts are code.**
   Versioned in-repo, diffed in PR, gated by CI evals, A/B released.
   Anonymous prompt edits in production dashboards are a regression
   waiting to happen.
8. **Pin model snapshots in production.**
   Aliases auto-upgrade silently — the model that passed evals
   yesterday is not the model serving traffic today.
   See `rules/model-migration.md`.
9. **Plan for the failure modes, not the happy path.**
   Rate limits, provider outages, and tail latency hit every prod
   system.
   Honour `Retry-After`, jitter retries, fall back across models,
   key destructive tool calls for idempotency.
   See `rules/resilience.md`.

---

## Anti-patterns (one-liners — full coverage in each rule)

- "Be helpful and detailed" instructions — non-actionable.
- Volatile content (timestamps, user IDs) before stable content — kills caching.
- Adding "let's think step by step" to a reasoning model — measurable regression.
- Flipping `tools`, `tool_choice`, or `thinking` mid-conversation — silent cache flush.
- Vector-only retrieval (no BM25) — misses exact-string matches (IDs, error codes).
- Passing the top-20 chunks to the LLM without reranking — wastes tokens, dilutes attention.
- Single-judge LLM evals using the same model as the actor — silent self-preference inflation.
- Tool descriptions written for humans — agents pick the wrong tool.
- Building a multi-agent system before single-agent + workflow exhausts the design space.
- Toggling extended thinking mid-turn — invalidates the entire cached prefix.
- Sending full-resolution screenshots — resize to ≤ 1568 px first.
- Retrying on 429 without honouring `Retry-After` — wastes quota and triggers thundering herds.
- Pure exponential backoff with no jitter — every client retries at the same instant.
- Side-effectful tool calls without idempotency keys — retries double-charge.
- Model aliases (`claude-sonnet-4-7`) in production — auto-upgrade silently.
- Migrating models without a full golden-set run — regressions ship undetected.
- Truncating long conversations instead of summarising — drops context the model needs.
- Cross-user memory leakage — let the model fill in `user_id` and you have a privacy bug.

---

## Definition of Done

- [ ] Mode and areas stated up front.
- [ ] Only the matched rule file(s) loaded.
- [ ] Each finding cites `path:line` and the rule it violates.
- [ ] Source URLs cited when claims are model-version-specific or recent.
- [ ] In `design` mode, the produced artefact uses the matching template.
- [ ] In `review` mode, findings are prioritised; no edits without consent.
