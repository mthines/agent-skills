---
title: Recent Changes — Date-Flagged Updates Since 2024
impact: MEDIUM
tags:
  - reference
  - changelog
  - dates
---

# Recent Changes

Date-flagged guidance changes since 2024.
Cite the date when applying or contradicting older advice.

## Contents

- August 2024 — OpenAI Structured Outputs
- Q4 2024 — OpenAI automatic prompt caching
- Q1 2025 — Anthropic 1-hour cache TTL
- Mid 2025 — CoT regression on reasoning models (Wharton)
- Q3 2025 — Anthropic adaptive thinking
- 2025 — OWASP LLM Top 10 v2025 retains injection at #1
- February 2026 — New chunking benchmark reorders defaults

---

## August 2024 — OpenAI Structured Outputs

OpenAI launched Structured Outputs (`response_format` with strict JSON
Schema, 100% conformance via constrained decoding).
Replaces best-effort JSON mode for code-consuming outputs.

[Announcement](https://openai.com/index/introducing-structured-outputs-in-the-api/)

## Q4 2024 — OpenAI prompt caching becomes automatic

OpenAI prompt caching auto-enables at ≥ 1024 prompt tokens.
No API change required.
Cache reads at ~0.50× input cost.

[Announcement](https://openai.com/index/api-prompt-caching/)

## Q1 2025 — Anthropic 1-hour cache TTL

Anthropic added a 1-hour TTL option for prompt caching (2× write
multiplier).
Use only when traffic gaps exceed 5 minutes, prompts are very large,
or rate-limit pressure justifies it.
5-minute TTL remains the default.

[Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

## Mid 2025 — CoT regression on reasoning models

Wharton GAIL Tech Report 2 (Jun 2025) and follow-up evals:

- Adding "let's think step by step" to o3-mini, o4-mini, or Claude with
  extended/adaptive thinking yields ~3% accuracy gain at 20–80% latency
  cost.
- On intuition-style tasks, CoT can drop accuracy by up to 36 absolute
  points.
- For non-reasoning models on multi-step tasks, CoT remains valuable.

Implication: do **not** add CoT to reasoning models.
Trust the model's own thinking surface.

[Wharton GAIL Tech Report 2](https://gail.wharton.upenn.edu/research-and-insights/tech-report-chain-of-thought/)
[Mind Your Step (arXiv 2410.21333)](https://arxiv.org/html/2410.21333v1)

## Q3 2025 — Anthropic adaptive thinking

Adaptive thinking on Opus 4.6+ / Sonnet 4.6+ became the recommended
default, replacing manual extended-thinking budgets.
Internal evals show adaptive beats fixed budgets on cost and quality.

**Cache caveat:** toggling `thinking` parameters mid-conversation
invalidates the entire cached prefix.
Decide at session start.

[Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)

## 2025 — OWASP LLM Top 10 v2025

LLM01:2025 retains **Prompt Injection** at #1.
Indirect injection (via retrieved documents, tool results, images,
audio) elevated as the dominant attack vector with multimodal inputs.

Implication: classify retrieved content too — not just user input.
A single guardrail is insufficient — apply defence-in-depth.

[OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

## February 2026 — Chunking benchmark reorders defaults

A new benchmark (50 academic papers, 7 strategies) ranks recursive
512-token splitting **first** at 69% accuracy.
Semantic chunking ranked 54% on the same corpus.

Implication: earlier "semantic chunking is best" guidance is outdated
for general document corpora.
Default to recursive 512 + 20–30% overlap; benchmark before deviating.

[Mayhemcode — RAG Implementation Guide](https://www.mayhemcode.com/2025/12/rag-implementation-guide-embedding.html)
[Firecrawl — Best Chunking Strategies 2025](https://www.firecrawl.dev/blog/best-chunking-strategies-rag)
