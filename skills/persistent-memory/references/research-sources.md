---
title: Research Sources — Memory Systems For LLM Agents
impact: LOW
tags:
  - references
  - research
---

# Research Sources

Annotated bibliography for the design choices in this skill. Load only
if you want to dig deeper or justify a design decision.

## Contents

- [Memory architectures](#memory-architectures)
- [Memory types and taxonomy](#memory-types-and-taxonomy)
- [Extraction and update pipelines](#extraction-and-update-pipelines)
- [Consolidation and forgetting](#consolidation-and-forgetting)
- [Markdown-first systems](#markdown-first-systems)
- [Privacy and consent](#privacy-and-consent)

## Memory architectures

- **MemGPT / Letta** — virtual-memory architecture (core / recall /
  archival memory). The agent itself drives memory through tool calls
  (`core_memory_append`, `core_memory_replace`). Origin paper: Packer
  et al., "MemGPT: Towards LLMs as Operating Systems", 2023.
  Letta is the commercial evolution of MemGPT (rebranded 2024).
  Source: `letta.com/blog/letta-v1-agent`.

- **Mem0** — two-phase pipeline (Extraction → Update) with ADD /
  UPDATE / DELETE / NOOP operations resolved against existing
  memories. State-of-the-art accuracy with ~95% token reduction
  versus full-context approaches. Graph variant uses directed labeled
  graphs (entities as nodes, relationships as edges).
  Source: arXiv 2504.19413.

- **Memori** — persistent memory layer that treats memory as a data
  structuring problem; converts unstructured dialogue into semantic
  triples and conversation summaries.
  Source: arXiv 2603.19935.

- **Zep** — temporal knowledge graph for agents with built-in session
  modeling and evals. Production memory layer.

- **Claude Code MEMORY.md** — first 200 lines / 25KB auto-loaded from
  `~/.claude/projects/<project>/memory/MEMORY.md`; topic files load
  on demand. Plain markdown. Origin of the INDEX-plus-detail pattern
  this skill uses.
  Source: `code.claude.com/docs/en/memory`.

## Memory types and taxonomy

- **CoALA framework** (Princeton, 2023) — formalises four memory
  types: in-context (working), episodic, semantic, procedural.
- **Anatomy of Agentic Memory** — arXiv 2602.19320. Taxonomy and
  empirical analysis of evaluation limitations.
- **LangMem** — episodic / semantic / procedural split with
  hot-path vs background formation.
  Source: `langchain-ai.github.io/langmem/concepts/conceptual_guide/`.

## Extraction and update pipelines

- **Mem0** (above) — canonical reference for the two-phase pipeline
  this skill adopts.
- **Reflexion** — Shinn et al., 2023. Self-reflective agents store
  textual reflections in an episodic buffer. **Warning**: reflection
  can entrench mistakes; external validation needed. This skill
  mitigates with the `## History` block and the consent preview.
- **Focus agent** — intra-trajectory compression with autonomous
  prune decisions. Inspiration for the consolidate pipeline.

## Consolidation and forgetting

- **SCM: Sleep-Consolidated Memory** — arXiv 2604.20943. Offline
  consolidation cycles strengthen important associations and let
  the agent forget irrelevant detail. Inspired the
  `consolidate` operation in this skill.
- **Active Context Compression** — arXiv 2601.07190. Autonomous
  memory management policies. Worth reading before automating
  consolidation.
- **"The Memory Problem in AI Agents Is Half Solved"** — Moses Njau,
  Medium. The reading half is mature; the writing / managing half
  is hard. This skill leans on this framing.

## Markdown-first systems

- **Obsidian + Zettelkasten** — local-first plain markdown, bi-directional
  links, agent-readable. Validates the longevity of the format.
- **Claude Code CLAUDE.md hierarchy** — file-loading rules, `@path`
  imports, `.claude/rules/` with path-scoped frontmatter.
  Source: `code.claude.com/docs/en/memory`.

## Privacy and consent

- **"Privacy by Design for Gen AI: PII Redaction, Data Minimization,
  and Consent"** — Sopan Deole, 2025. Three pillars (redaction,
  minimization, consent) adopted in this skill.
- **OpenAI Privacy Filter** — context-aware PII labeling.
- **PII Redaction for MCP Servers** — practical patterns for blocking
  sensitive data at integration boundaries.
- **OWASP LLM01:2025** — prompt-injection defence; relevant to the
  extraction step (a hostile user input could try to trick the
  extractor into writing prompt-injection content).

## When to graduate to which provider

The scaling-tiers rule recommends provider choices based on workload:

- Mem0 — production-ready SDK, multi-tenant.
- Letta — stateful agent runtime, MemGPT lineage.
- Zep — temporal graph, session-first model.

See [`../rules/scaling-tiers.md`](../rules/scaling-tiers.md) for the
migration recipes.
