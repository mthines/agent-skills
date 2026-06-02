---
title: Token Optimisation — Caching, Routing, Batching, Latency
impact: HIGH
tags:
  - tokens
  - cost
  - prompt-caching
  - model-routing
  - batch-api
  - streaming
---

# Token Optimisation

Five levers, in priority order: **caching, routing, batching, output
control, streaming**.
Apply caching first — it's the largest single saver and works on every
above-threshold prompt.

## Contents

- Prompt caching — minimums per provider
- Cache breakpoint placement (and the 4-breakpoint rule)
- Cache invalidators (Anthropic, 2025)
- TTL choice — 5 minutes vs 1 hour
- Model routing — 60/30/10 cascade
- Batch API
- Output control (max_tokens, stop, schemas)
- Streaming and cache pre-warming
- Token counting tools per provider
- Common mistakes

## Prompt caching — minimums (2025-2026)

| Provider  | Auto / explicit                | Minimum prompt tokens to cache                        |
| --------- | ------------------------------ | ----------------------------------------------------- |
| Anthropic | Explicit (`cache_control`)     | 1024 (Sonnet 4.5/3.7, Opus 4/4.1), 2048 (Sonnet 4.6, Haiku 3.5), 4096 (Opus 4.6/4.7, Haiku 4.5). |
| OpenAI    | Automatic                      | ≥ 1024 tokens. No code change needed.                 |
| Google    | Explicit (Context Caching API) | Per-model thresholds in the Gemini docs.              |

Cache hit economics:

- Anthropic: read at **0.10×** input price.
- OpenAI: read at **0.50×** input price.
- Latency drop: up to **80%** on hit.

Sources:
[Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[OpenAI prompt caching](https://openai.com/index/api-prompt-caching/).

## Cache breakpoint placement

Place the `cache_control` breakpoint on the **last block whose content is
byte-identical across requests**.
A breakpoint on a timestamp, request ID, or per-user block produces zero
hits.

```text
[ tools                ]  ← stable across all sessions
[ system prompt        ]  ← stable across all sessions
[ retrieved KB excerpt ]  ← stable per topic — cache_control here
[ today's date         ]  ← volatile — never cache after this
[ user message         ]
```

Anthropic supports up to **4 breakpoints** per request.
Use them when sections invalidate at different cadences (e.g., tools
weekly, system daily, retrieved KB hourly).

## Cache invalidators (Anthropic, 2025 docs)

These flip the cache for the rest of the message, silently:

- Adding or removing a tool (any change to `tools[]`).
- Toggling `tool_choice`.
- Toggling images on or off in any message.
- Toggling `thinking` parameters (extended / adaptive).
- Toggling web-search enablement.

Implication: **never flip these mid-conversation**.
Decide at session start.
Audit your code path for `if (env.DEBUG) addTool(...)` patterns — they
double your input cost in production.

## TTL choice — 5 minutes vs 1 hour

| TTL    | Write cost  | Use when                                                                         |
| ------ | ----------- | -------------------------------------------------------------------------------- |
| 5 min  | 1.25× base  | **Default.** Conversation cadence, interactive sessions.                         |
| 1 hour | 2× base     | Traffic gaps > 5 min; very large prompts; rate-limit pressure.                   |

Place 1-hour blocks **before** 5-minute blocks in the prompt — Anthropic
honours the longer TTL only for the prefix up to the next breakpoint.

## Model routing

The pricing-vs-capability tiers are wide.
Cascading routes save ~50% vs uniform top-tier.

Default mix:

| Tier               | Share       | Use for                                                              |
| ------------------ | ----------- | -------------------------------------------------------------------- |
| Haiku-class        | ~60%        | Classification, extraction, retrieval, simple summarisation.         |
| Sonnet-class       | ~30%        | Coding, multi-step reasoning, agent loops, structured generation.    |
| Opus-class         | ~10%        | Hard reasoning, planning, deep analysis, escalations.                |

Pattern: try Haiku, escalate on validator failure or low confidence.
See `evals.md` for the validator step.

Source: [Augment Code — AI Model Routing Guide](https://www.augmentcode.com/guides/ai-model-routing-guide).

## Batch API

Use the Batch API for any non-real-time job:

- 50% discount on **both** input and output.
- Up to 10,000 requests per batch.
- 24h SLA (typically minutes for small batches).
- Stacks with prompt caching.

Eligible workloads:

- Eval runs (golden set across N prompt variants).
- Bulk summarisation, extraction, classification.
- Content moderation backfills.
- Embedding generation for new corpora.

Anthropic uses inline `requests[]`; OpenAI uses uploaded files.
Source: [Anthropic Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing).

## Output control

Output tokens dominate cost on most modern pricing.
Example: Opus 4.7 charges $25/MTok output vs $5/MTok input — a 5×
asymmetry.

Always set:

- `max_tokens` — explicit upper bound. Tail latency drops too.
- `stop` — sequences that terminate generation.
- A schema (Structured Outputs / tool schema) — bounds verbosity.

Reject the default `max_tokens` of the SDK; it is almost always too high.

## Streaming

Streaming does not reduce total tokens.
It reduces **perceived** latency — TTFT (time-to-first-token) drops from
seconds to ~hundreds of ms.

When to stream:

- Any user-visible response.
- Any agent step where a downstream step depends on a partial output
  (rare — usually wait for the full message).

Combine with **cache pre-warming** (`max_tokens: 0` request) for known
prefixes before user traffic, especially after a deployment.

## Multimodal token costs

Image, audio, and PDF inputs are billed differently and typically cost
more per "useful unit" than text.
See [`multimodal.md`](./multimodal.md) for sizing rules and the
provider-specific token formulas — especially the rule about resizing
images to ≤ 1568 px before upload.

## Token counting

Count with the **provider's own tokenizer** during development:

| Provider  | Tooling                                            |
| --------- | -------------------------------------------------- |
| Anthropic | `client.messages.count_tokens()`                   |
| OpenAI    | `tiktoken` (correct encoder for the target model)  |
| Google    | `model.count_tokens()`                             |

Approximating with character counts misestimates by 20–40% on code/JSON.

## Common mistakes

- **Long system prompt without caching.**
  **Fix:** add `cache_control` to the last stable block.
- **Volatile content (per-user data) before stable content.**
  **Fix:** reorder: stable first, volatile last.
- **Toggling tools or `thinking` mid-conversation.**
  **Fix:** decide at session start.
- **Uniform-Opus.**
  **Fix:** cascade Haiku → Sonnet → Opus, gated by validator.
- **Synchronous calls for embarrassingly-parallel work.**
  **Fix:** Batch API.
- **No `max_tokens` set.**
  **Fix:** set tight bounds; output is the dominant cost.
