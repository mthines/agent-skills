---
title: RAG — Chunking, Hybrid Search, Reranking, Query Rewriting
impact: HIGH
tags:
  - rag
  - retrieval
  - embeddings
  - hybrid-search
  - reranking
---

# Retrieval-Augmented Generation

Six rules.
Apply chunking and hybrid search first; reranking second; query
rewriting only when retrieval is still missing the mark.

## Contents

- Chunking: recursive 512 tokens with 20–30% overlap
- Hybrid search (BM25 + dense, fused with RRF)
- Reranking (top-20 → cross-encoder → top-5)
- Query rewriting (LLM rewrite, HyDE, multi-query)
- Domain-tuned embeddings
- Separate eval for retrieval and generation
- Common mistakes

## 1. Default chunking: recursive 512 tokens, 20–30% overlap

The Feb 2026 chunking benchmark (50 academic papers, 7 strategies) ranks
recursive 512-token splitting **first** at 69% accuracy.
Semantic chunking ranked 54% on the same corpus.

Defaults:

- Chunk size: **512 tokens**.
- Overlap: **20–30%** (≈100–150 tokens).
- Splitter: recursive — split on paragraph, then sentence, then word.

When to deviate:

- Very short docs (FAQs, snippets) → smaller chunks (128–256).
- Code → split by function/class boundary, not by token count.
- Tables → keep the whole table in one chunk; split docs around it.

Sources:
[Mayhemcode — RAG Implementation Guide](https://www.mayhemcode.com/2025/12/rag-implementation-guide-embedding.html),
[Firecrawl — Best Chunking Strategies 2025](https://www.firecrawl.dev/blog/best-chunking-strategies-rag).

## 2. Hybrid search — never vector-only

Always combine **BM25** (sparse, exact-string) with **dense vectors**
(semantic).
Dense-only retrieval misses:

- Product IDs, error codes, SKUs.
- Proper nouns.
- Rare technical terms not well-represented in embedding training data.

Hybrid lifts precision/recall **15–25%** over either alone.
Fuse with **Reciprocal Rank Fusion (RRF)**:

```text
score(doc) = sum over retrievers of 1 / (k + rank_i(doc))
```

`k = 60` is the standard constant.

Source: [Superlinked — Optimising RAG with Hybrid Search & Reranking](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking).

## 3. Always rerank: top-20 → cross-encoder → top-5

Initial retrieval optimises **recall**.
Reranker optimises **precision**.
Passing all 20 raw chunks to the LLM wastes tokens and dilutes attention.

Pattern:

```text
query
  → hybrid search → top-20 candidates
  → cross-encoder rerank
  → top-5 → LLM
```

Common rerankers (2025-2026):

- Cohere Rerank 3.5
- BGE-Reranker-v2
- Jina Reranker

Latency: 50–200ms for top-20 reranking.
Skip only if SLA precludes it; never skip "to save tokens" — the saved
input cost is dwarfed by the quality loss.

## 4. Query rewriting when queries are short or conversational

Two patterns:

| Pattern               | What it does                                                        | When                                          |
| --------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| **LLM rewrite**       | Cheap LLM rephrases the user's query for retrieval.                 | Conversational queries, chat sessions.        |
| **HyDE**              | LLM generates a hypothetical answer; embed *that* for retrieval.    | Sparse, ambiguous queries; up to +42pp gain.  |
| **Multi-query**       | Generate 3–5 variants, retrieve each, fuse with RRF.                 | High-stakes recall; willing to pay 3-5× cost. |

Source: [Haystack — HyDE](https://docs.haystack.deepset.ai/docs/hypothetical-document-embeddings-hyde).

For image-heavy or layout-heavy documents (PDFs, scans, screenshots),
also load [`multimodal.md`](./multimodal.md) before deciding on a
chunking strategy — vision-vs-OCR and layout-aware extraction are
covered there.

For "remember facts about the user" rather than "search a corpus",
load [`memory-and-state.md`](./memory-and-state.md) — that's a
different problem.

## 5. Domain-tuned embeddings

Domain-tuned embeddings outperform general-purpose by **20–40%** on
retrieval accuracy:

- Medical / clinical → MedEmbed, BioMistral embeddings.
- Legal → Legal-BERT or domain-fine-tuned variants.
- Code → CodeT5+, Voyage-code, OpenAI text-embedding-3-large with code.

Re-evaluate the SOTA every 1–2 quarters.
The leaderboard moves fast — a model that was best 6 months ago is
rarely still best.

## 6. Evaluate retrieval and generation **separately**

| Stage       | Metric                        | What it tells you                                 |
| ----------- | ----------------------------- | ------------------------------------------------- |
| Retrieval   | recall@5, recall@10, MRR      | "Did we get the right chunks?"                    |
| Reranker    | nDCG@5, MRR                   | "Did we rank them right?"                         |
| Generation  | faithfulness, answer-relevance | "Did the answer use the chunks correctly?"        |
| End-to-end  | task accuracy                 | "Did the user get the right answer?"              |

A bad answer with **good retrieval** is a prompt or generation problem
— fix the prompt.
A bad answer with **bad retrieval** is an indexing/retrieval problem —
fix chunking, hybrid weighting, or query rewriting.

Conflating them wastes weeks.
See `evals.md` for the eval harness pattern.

Source: [Eugene Yan — LLM Patterns](https://eugeneyan.com/writing/llm-patterns/).

## Common mistakes

- **Vector-only retrieval.**
  **Fix:** add BM25, fuse with RRF.
- **Passing all top-20 chunks to the LLM.**
  **Fix:** rerank to top-5.
- **Semantic chunking by default.**
  **Fix:** recursive 512 + 20–30% overlap; benchmark before switching.
- **Re-using last quarter's embedding model without re-eval.**
  **Fix:** quarterly review against a held-out test set.
- **One end-to-end metric to rule them all.**
  **Fix:** measure retrieval and generation separately.
- **No overlap between chunks.**
  **Fix:** 20–30% overlap to avoid boundary information loss.
