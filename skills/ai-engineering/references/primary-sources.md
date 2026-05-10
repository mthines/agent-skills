---
title: Primary Sources — Curated URL Index
impact: MEDIUM
tags:
  - reference
  - sources
  - links
---

# Primary Sources

Cite these inline when a claim is non-obvious or model-version-specific.
Provider docs win over blog summaries.

## Contents

- Anthropic — prompting, caching, thinking, tools, agents, vision, memory
- OpenAI — prompting, structured outputs, caching, batch, rate limits
- Google — Gemini docs (caching, structured outputs, evals)
- Multimodal — vision, audio, PDF
- Resilience — rate limits, retries, idempotency
- Practitioners — Hamel Husain, Eugene Yan, Chip Huyen
- Research / surveys — CoT regression, few-shot dilemma, JSON schema
- Safety — OWASP LLM Top 10, prompt-injection cheat sheet
- Observability — OTEL spec + Dash0 (companion skills)
- Prompt versioning — PromptLayer
- RAG — chunking, hybrid search, HyDE

---

## Anthropic

- [Prompt engineering overview](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview)
- [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Use XML tags](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Adaptive thinking (Q3 2025+)](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
- [How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)
- [Implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)
- [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Building Effective Agents (research)](https://www.anthropic.com/research/building-effective-agents)
- [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- [The "think" tool](https://www.anthropic.com/engineering/claude-think-tool)
- [Vision](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Files API (PDF, DOCX)](https://platform.claude.com/docs/en/build-with-claude/files)
- [Models overview / pinning](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Rate limits](https://platform.claude.com/docs/en/api/rate-limits)

## OpenAI

- [Prompt engineering guide](https://developers.openai.com/api/docs/guides/prompt-engineering)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Introducing Structured Outputs in the API (Aug 2024)](https://openai.com/index/introducing-structured-outputs-in-the-api/)
- [API prompt caching announcement](https://openai.com/index/api-prompt-caching/)
- [Cookbook — prompt caching 201](https://developers.openai.com/cookbook/examples/prompt_caching_201)
- [Cookbook — Structured Outputs intro](https://developers.openai.com/cookbook/examples/structured_outputs_intro)
- [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits)
- [Model versioning](https://developers.openai.com/api/docs/models/versioning)
- [Vision](https://developers.openai.com/api/docs/guides/vision)
- [Realtime API (voice agents)](https://developers.openai.com/api/docs/guides/realtime)

## Practitioners

- [Hamel Husain — Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- [Hamel Husain — Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/)
- [Eugene Yan — LLM Patterns](https://eugeneyan.com/writing/llm-patterns/)
- [Eugene Yan — LLM-as-Judge won't save the product](https://eugeneyan.com/writing/eval-process/)
- [Chip Huyen — *AI Engineering* (book)](https://huyenchip.com/books/)
- [Chip Huyen — `aie-book` repo](https://github.com/chiphuyen/aie-book)

## Research / surveys

- [Wharton — Decreasing Value of CoT (Jun 2025, arXiv 2506.07142)](https://arxiv.org/abs/2506.07142)
- [Wharton GAIL Tech Report 2 — Chain of Thought](https://gail.wharton.upenn.edu/research-and-insights/tech-report-chain-of-thought/)
- [Mind Your Step — when CoT hurts (arXiv 2410.21333)](https://arxiv.org/html/2410.21333v1)
- [The Few-shot Dilemma — over-prompting (arXiv 2509.13196)](https://arxiv.org/html/2509.13196v1)
- [JSONSchemaBench (arXiv 2501.10868)](https://arxiv.org/abs/2501.10868)
- [Survey on LLM-as-Judge (arXiv 2411.15594)](https://arxiv.org/abs/2411.15594)
- [Justice or Prejudice? — LLM judge biases](https://llm-judge-bias.github.io/)
- [Position bias in LLM-as-Judge (IJCNLP 2025)](https://aclanthology.org/2025.ijcnlp-long.18.pdf)
- [Pink Elephant Problem — negative instructions](https://eval.16x.engineer/blog/the-pink-elephant-negative-instructions-llms-effectiveness-analysis)
- [Gadlet — Why positive prompts win](https://gadlet.com/posts/negative-prompting/)

## Safety / guardrails

- [OWASP LLM01:2025 — Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [Lakera — Indirect Prompt Injection](https://www.lakera.ai/blog/indirect-prompt-injection)

## Observability

- [OpenTelemetry — GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry — Tracing concepts](https://opentelemetry.io/docs/concepts/signals/traces/)

### Companion skills (invoked from the observability rule via `Skill()`)

- `/otel-instrumentation` (dash0) — wires OTEL into a service or
  refactors existing tracing. Source of truth for SDK setup, exporters,
  span shape, resource attributes.
- `/otel-semantic-conventions` (dash0) — validates span attributes
  against the spec, including `gen_ai.*`. Source of truth for attribute
  naming.

The ai-engineering observability rule must invoke both before answering
OTEL questions (see `rules/observability-and-versioning.md`).
Backend: Dash0.

## Prompt versioning

- [PromptLayer — Prompt Versioning](https://www.promptlayer.com/glossary/prompt-versioning/)
- [PromptLayer — A/B releases](https://docs.promptlayer.com/why-promptlayer/ab-releases)

## RAG

- [Superlinked — Optimising RAG with Hybrid Search & Reranking](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking)
- [Firecrawl — Best Chunking Strategies 2025](https://www.firecrawl.dev/blog/best-chunking-strategies-rag)
- [Mayhemcode — RAG Implementation Guide (Dec 2025)](https://www.mayhemcode.com/2025/12/rag-implementation-guide-embedding.html)
- [Haystack — HyDE](https://docs.haystack.deepset.ai/docs/hypothetical-document-embeddings-hyde)
- [Ragflow — RAG Review 2025: From RAG to Context](https://ragflow.io/blog/rag-review-2025-from-rag-to-context)

## Model routing

- [Augment Code — AI Model Routing Guide](https://www.augmentcode.com/guides/ai-model-routing-guide)
- [Caylent — Haiku 4.5 Deep Dive](https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity)
