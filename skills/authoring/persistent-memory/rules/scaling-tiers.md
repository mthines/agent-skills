---
title: Scaling Tiers — Markdown to Managed Memory Layers
impact: MEDIUM
tags:
  - scaling
  - architecture
  - sqlite
  - vector-db
  - mem0
  - letta
  - zep
---

# Scaling Tiers

## Contents

- [The four tiers](#the-four-tiers)
- [Graduation signals](#graduation-signals)
- [Tier 1 — Markdown (default)](#tier-1-details-this-skill-default)
- [Tier 2 — Markdown + SQLite FTS](#tier-2--markdown--sqlite-fts)
- [Tier 3 — Markdown + local vector DB](#tier-3--markdown--local-vector-db)
- [Tier 4 — Managed memory layer](#tier-4--managed-memory-layer)
- [LoreKit — the self-improvement loop backend](#lorekit--the-self-improvement-loop-backend)
- [Tier-agnostic principles](#tier-agnostic-principles)
- [Anti-graduations](#anti-graduations)

Memory engineering is over-tooled by default. Most users will live on
Tier 1 forever. Graduate one tier at a time, and only when a concrete
signal forces it.

## The four tiers

| Tier | Backend                                            | Capacity (per scope)    | Search           | Multi-user | Infra cost      |
| ---- | -------------------------------------------------- | ----------------------- | ---------------- | ---------- | --------------- |
| 1    | Plain markdown (this skill, default)               | ≤ ~500 entries          | grep / INDEX     | No         | $0              |
| 2    | Markdown + SQLite FTS index                        | ≤ ~5,000 entries        | Keyword (FTS5)   | No         | $0 (local file) |
| 3    | Markdown blobs + local vector DB (Chroma, Qdrant)  | ≤ ~50,000 entries       | Semantic + keyword | No       | Local infra     |
| 4    | Managed memory layer (Mem0, Letta, Zep)            | Millions, multi-tenant  | Semantic + graph | Yes        | SaaS + API      |

The skill ships **Tier 1** by default and documents the migration
recipes here.

## Graduation signals

Move from Tier 1 to Tier 2 when:

- A single scope's INDEX has been consolidated below 200 lines, yet
  `entries/` still contains > 500 files.
- The user is grep-ing entries directly (and the grep is becoming the
  bottleneck).
- A specific keyword search returns too many false positives in the
  INDEX summaries.

Move from Tier 2 to Tier 3 when:

- The user wants semantic recall ("what did we discuss about my mom's
  health") and keyword search misses obvious matches.
- Multiple scopes need to be queried together as one logical bucket.
- INDEX-only loading no longer gives the host skill enough context.

Move from Tier 3 to Tier 4 when:

- Multiple users / agents need to share memory.
- The deployment is production, not personal.
- You need cross-session memory consolidation as a managed service
  (graph relationships, automatic deduplication, hosted SLA).
- You are willing to pay an external dependency and accept a SaaS in
  the data path.

**Do not skip tiers.** Going from markdown directly to a hosted vector
service introduces operational complexity you may not need. Each tier
solves a specific scaling problem; promote one signal at a time.

## Tier 1 details (this skill, default)

- Storage: filesystem.
- Read: load INDEX (≤ 200 lines), fetch entries on demand.
- Write: extract candidates → ADD / UPDATE / DELETE / NOOP → persist.
- Search: grep over INDEX summaries; grep over entry bodies as
  fallback.
- Failure mode: INDEX rot when consolidation is overdue. Recall
  degrades gracefully — entries are still there, just harder to find.

## Tier 2 — Markdown + SQLite FTS

Keeps markdown as the source of truth; adds a SQLite FTS5 index next
to it for fast keyword search.

```text
<storage-root>/<scope>/
├── INDEX.md
├── entries/
├── archive/
├── AUDIT.log
└── index.sqlite      # FTS5 index over entries/*.md (rebuildable)
```

### Migration recipe (Tier 1 → Tier 2)

1. Install SQLite (already shipped with macOS, most Linux).
2. Build the FTS5 schema:

   ```sql
   CREATE VIRTUAL TABLE entries USING fts5(
     id, scope, type, tags, body, created, updated, tokenize='porter unicode61'
   );
   ```

3. For each file in `entries/`, parse frontmatter + body, insert one
   row.
4. Update the read pipeline: when the user queries with a keyword, run
   FTS5 first, fall back to grep on miss.
5. Update the write pipeline: every ADD / UPDATE upserts a row.
6. The SQLite file is **derived** — it can be rebuilt from `entries/`
   at any time. Add a `rebuild-index.sh` script that walks the
   directory and reinserts every row.

### Pros and cons

- ✅ Still markdown-first. The user can delete `index.sqlite` and
  rebuild it.
- ✅ Fast keyword search at the cost of a single local file.
- ❌ No semantic search. "Mom's health" still misses "Mary's blood
  pressure".

## Tier 3 — Markdown + local vector DB

Adds a local embedding store (Chroma, Qdrant local mode) for semantic
recall. Markdown remains the source of truth.

```text
<storage-root>/<scope>/
├── INDEX.md
├── entries/
├── archive/
├── AUDIT.log
├── index.sqlite      # FTS5 (keyword)
└── vector/           # Local Chroma / Qdrant volume
```

### Migration recipe (Tier 2 → Tier 3)

1. Pick an embedding model (`all-MiniLM-L6-v2` for cheap local;
   `text-embedding-3-small` for a hosted call). Document the choice.
2. Pick a local vector DB:

   - **Chroma** — Python-first, embeds-in-process, easiest setup.
   - **Qdrant** — Rust-based, persistent, supports payload filters.
   - **LanceDB** — file-based columnar, no separate process.

3. Build the collection schema with payload fields: `id`, `scope`,
   `type`, `tags`, `created`.
4. Walk `entries/`, embed each body, upsert vector + payload.
5. Update the read pipeline: for natural-language queries, vector
   search first (top-k); fall back to FTS5 on low similarity scores.
6. Vector DB is also **derived** — re-embeddable from `entries/`.

### Pros and cons

- ✅ Semantic recall.
- ✅ Still local, still markdown-first.
- ❌ Embedding cost on every ADD / UPDATE (negligible locally, real
  for hosted models).
- ❌ Embedding-model drift: if the model changes, re-embed everything.

## Tier 4 — Managed memory layer

When personal markdown stops fitting the deployment. Examples:

| Provider | Strengths                                                                | Tradeoffs                                            |
| -------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| **LoreKit** | MCP-native shared agent memory (Supabase-backed); scope partitioning + tags; local (`.lorekit/`) or hosted `remote` mode; **the backend the self-improvement loops use** | Hosted default (or self-host); read/write split by token permission |
| **Mem0** | Production-ready, extraction + update pipeline, graph variant, SDK-first | Hosted (or self-host with Postgres); learning curve  |
| **Letta** (formerly MemGPT) | Stateful agents, virtual-memory architecture (core / recall / archival), full runtime | Heavyweight — agents run *inside* Letta             |
| **Zep**  | Temporal knowledge graph, message + summary memory, evals built-in       | Server component; opinions about session model      |

### Migration recipe (Tier 3 → Tier 4)

1. **Export markdown to JSONL.** One JSON line per entry with
   `id`, `scope`, `type`, `tags`, `body`, `created`, `updated`.
2. **Map to the provider's schema.**

   - Mem0: each line becomes a `Memory` with `metadata = {scope, type,
     tags}`.
   - Letta: each line becomes a `passage` in archival memory; the
     INDEX becomes a core memory block (≤ 2 KB).
   - Zep: each line becomes a `Message` or `Fact` in a session keyed
     by scope.

3. **Keep markdown as the audit copy** for the first 90 days. The
   provider becomes the source of truth only after you verify reads
   and writes match.
4. **Adapt the host skill's pointer** to call the provider's SDK
   instead of `Skill("persistent-memory", "read <scope>")`.
5. **Decommission `entries/`** only after the rollback window passes.

### When to choose which provider

- **Multi-user SaaS, mature SDK, OAuth-style auth wanted** → Mem0.
- **Single-agent or single-team, want full stateful agent runtime** →
  Letta.
- **Need temporal reasoning across sessions out of the box** → Zep.

## LoreKit — the self-improvement loop backend

The **self-improvement loops** in this repo (`autonomous-workflow`, `fix-bug`,
`batch-linear-tickets`, `implement-suggestion`, `ci-auto-fix`, `test-auto-fix`,
`e2e-pr-stabilizer`, `optimize-approach`, `ideate`, and the `pr-reviewer`
agent) run their fast tier on **LoreKit**, a Tier-4 managed
memory layer, rather than on this skill's markdown store. This section is the
implementation reference those loops point to; the operational read/write skill
is `lorekit-memory` (installed via `npx @lorekit/cli install`), which wraps
LoreKit's `memory.*` MCP tools.

Personal, topic-scoped memory (`parenting`, `relationship-anna`, …) stays on
Tier 1 markdown by default — LoreKit is the loops' backend, not a forced
migration for personal scopes.

### The tools

| Tool | Use | Permission |
|------|-----|------------|
| `memory.list`   | List lessons for one scope (newest first, tag filter) | read |
| `memory.search` | Full-text search across scopes (supports `repo::owner/*`) | read |
| `memory.read`   | Read one lesson by scope + key | read |
| `memory.write`  | Store or update a lesson (same scope + key updates in place) | read+write |

Write tools need a `lk_rw_*` / `lk_wo_*` token; read tools need `lk_rw_*` /
`lk_ro_*`. An authorization failure is reported once and not retried. If the
`memory.*` tools are not connected at all, the loop is a silent no-op.

### Scope model

LoreKit partitions by a canonical `scope` string (`::` is the only separator;
segments are lowercased):

```text
global                              universal principles
repo::{owner}/{repo}                this repository's lessons
branch::{owner}/{repo}::{branch}    short-lived, this branch only
```

The loops map their two former `persistent-memory` tiers onto scope:

| Former `persistent-memory` tier | LoreKit scope |
| ------------------------------- | ------------- |
| `home` (universal, cross-repo)  | `global` |
| `project-shared` (committed, repo-bound) | `repo::{owner}/{repo}` |

`branch::` is reserved and unused by the loops. `{owner}/{repo}` derives from
the `origin` remote, lowercased, trailing `.git` stripped. **Where a `repo::`
lesson physically lives — LoreKit's hosted server (`remote`, the default) or a
local `.lorekit/` directory, and whether it commits to the repo — is LoreKit's
own control model** (`lorekit doctor` prints the resolved mode). The loop only
selects the scope; it never creates directories or commits files. This replaces
the old `project-shared` opt-in ceremony (a human hand-creating
`<repo>/memory/<scope>/`) — LoreKit's mode is the new control point.

### Bucket = tag + key namespace

LoreKit's partition axis is repo/branch/global, not named buckets like
`aw-lessons`. Each loop keeps its lessons separate with a **tag** and a **key
namespace**:

- Tag: `loop::<skill>-lessons` (e.g. `loop::fix-bug-lessons`). Reads filter by
  it; writes always include it.
- Key: `<skill>-lessons::<kebab-slug>` (e.g.
  `fix-bug-lessons::async-repro-flake`). Same `scope` + `key` overwrites in
  place — the mechanism behind recurrence counting.

### Read / write shape

```text
# Read narrow-to-broad (skips silently if memory.* not connected):
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::<skill>-lessons"], limit: 50 }
memory.list { scope: "global",               tags: ["loop::<skill>-lessons"], limit: 50 }

# Dedup, then write to the classified scope:
memory.search { q: "<lesson keywords>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }
memory.write {
  scope: "<global | repo::{owner}/{repo}>",
  key:   "<skill>-lessons::<slug>",
  value: "<lesson body — markdown with a meta comment>",
  tags:  ["loop::<skill>-lessons", "source::<trigger>"],
  source_agent: "<agent>", trigger: "<stuck-loop | end-of-run | …>"
}
```

### Lesson schema

The five mandatory lesson fields (`phase`, `trigger-context`, `seen_count`,
`status`, `expires`) — see [Lesson-scope entries](./write-pipeline.md#lesson-scope-entries) —
are unchanged; they now travel inside the LoreKit `value` (markdown) as a
`meta:` comment rather than markdown frontmatter. The recurrence contract is the
same: an UPDATE to an entry that carries a `seen_count` field MUST increment
`seen_count` by 1 and refresh `expires`, so a recurring lesson reaches the
`seen_count >= 3` promotion gate. LoreKit deduplicates on write and owns its own
storage, so there is **no `INDEX.md`, no 200-line cap, and no `consolidate`
pass** — expiry (the `expires` field, ignored on read once past) is the decay
mechanism.

### Migration note

The loops previously stored lessons as markdown under `~/.agent-memory/<scope>/`
(home) and `<repo>/memory/<scope>/` (project-shared). Those directories are no
longer written by the loops. A team wanting to carry forward existing lessons
can export each `entries/*.md` to a `memory.write` call under the mapped scope
(`home` → `global`, `project-shared` → `repo::{owner}/{repo}`), preserving the
`meta:` fields inside the LoreKit `value`.

## Tier-agnostic principles

Across every tier:

- Markdown remains the **canonical** format until Tier 4 explicitly
  migrates away. Even at Tier 3, the markdown is authoritative; the
  vector DB is an index.
- Every write must preserve the consent preview, the never-store list,
  and the AUDIT.log. These are not optional at any tier.
- The user can always grep their memory at Tiers 1–3. Losing this is
  the defining downgrade of Tier 4.
- Embeddings are not memory. The bodies are. Treat embeddings as a
  rebuildable index.

## Anti-graduations

Do not move tiers because:

- "Markdown feels dated." It is the format with the most longevity.
- "The Mem0 demo looks cool." Demos are not your workload.
- "We might need scale someday." Premature scaling.

Move tiers only because a concrete signal (entry count, query
latency, multi-user, semantic-recall miss rate) forces it.
