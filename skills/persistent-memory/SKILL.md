---
name: persistent-memory
description: >
  Persists context across conversations as plain markdown so every
  future session can enrich a topic-scoped memory (e.g. `parenting`,
  `relationship-anna`, `work-history`, `project-acme`). Four operations:
  `write` (extract candidates, resolve as ADD / UPDATE / DELETE / NOOP
  per Mem0), `read` (load a ≤ 200-line INDEX; fetch detail entries on
  demand per Claude Code's MEMORY.md pattern), `consolidate`
  (sleep-style merge + prune), `forget` (delete or redact with audit).
  Three storage tiers: home (`~/.agent-memory/<scope>/`, default),
  project-local (gitignored), project-shared (committed). Strict
  never-store list (passwords, API keys, JWTs, credit cards, SSNs,
  private keys); mandatory consent preview before write. Documents
  scaling from markdown → SQLite FTS → vector DB → managed memory
  (Mem0 / Letta / Zep). Triggers on "remember this", "save to
  memory", "recall memory", "load memory", "what do you remember
  about", "consolidate memory", "forget that", "/persistent-memory".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - memory
    - persistent-memory
    - long-term-memory
    - agent-memory
    - scope
    - markdown
    - progressive-disclosure
    - privacy
    - consent
    - consolidation
---

# Persistent Memory

Capture, recall, consolidate, and forget memories scoped to a user-chosen
topic (e.g. `parenting`, `work`, `relationship-anna`) as plain markdown
files, so any future conversation can pick up where the last one left off.

> **This `SKILL.md` is a thin index.** Operation pipelines, taxonomy,
> privacy rules, integration patterns, and scaling guidance live in
> `rules/*.md` and load on demand. Literal artefact templates live in
> `templates/*.md`. Worked examples and citations live in `references/*.md`.
> Read only what the current operation asks for.

---

## Mode Detection

Parse `$ARGUMENTS` (first token) and detect the operation:

| Operation     | Default | Trigger phrases                                                          |
| ------------- | ------- | ------------------------------------------------------------------------ |
| `write`       | **yes** | "remember", "save to memory", "add to memory", `$0 == "write"`           |
| `read`        |         | "recall", "load memory", "what do you remember about", `$0 == "read"`    |
| `consolidate` |         | "consolidate memory", "compress memory", `$0 == "consolidate"`           |
| `forget`      |         | "forget that", "delete memory", "redact", `$0 == "forget"`               |
| `list`        |         | "list memory", "what scopes do I have", `$0 == "list"`                   |

State the detected operation and resolved scope in one line before
continuing. Example:

```text
Operation: write
Scope: parenting
Storage tier: home (~/.agent-memory/parenting/)
```

If no scope is provided, ask once (single batched message) — never guess.

---

## Required Reading by Operation

Load on demand — do not preload.

| Operation     | Files                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `write`       | [`rules/storage-layout.md`](./rules/storage-layout.md), [`rules/write-pipeline.md`](./rules/write-pipeline.md), [`rules/memory-taxonomy.md`](./rules/memory-taxonomy.md), [`rules/privacy-and-consent.md`](./rules/privacy-and-consent.md) |
| `read`        | [`rules/storage-layout.md`](./rules/storage-layout.md), [`rules/read-pipeline.md`](./rules/read-pipeline.md) |
| `consolidate` | [`rules/consolidate-pipeline.md`](./rules/consolidate-pipeline.md), [`rules/memory-taxonomy.md`](./rules/memory-taxonomy.md) |
| `forget`      | [`rules/forget-pipeline.md`](./rules/forget-pipeline.md), [`rules/privacy-and-consent.md`](./rules/privacy-and-consent.md) |
| `list`        | [`rules/storage-layout.md`](./rules/storage-layout.md)                                         |
| integration   | [`rules/integration-with-skills.md`](./rules/integration-with-skills.md)                       |
| scaling       | [`rules/scaling-tiers.md`](./rules/scaling-tiers.md)                                           |
| pre-flight    | [`rules/quality-checklist.md`](./rules/quality-checklist.md), [`rules/anti-patterns.md`](./rules/anti-patterns.md) |

---

## Storage Layout (one-line summary; full rules in [`rules/storage-layout.md`](./rules/storage-layout.md))

Three tiers; the user picks per invocation, or accepts the default.

| Tier              | Path                              | Committed? | Default for                            |
| ----------------- | --------------------------------- | ---------- | -------------------------------------- |
| `home` (default)  | `~/.agent-memory/<scope>/`        | No         | Personal scopes (parenting, work)      |
| `project-local`   | `<repo>/.agent/memory/<scope>/`   | No (gitignore) | Per-project private notes          |
| `project-shared`  | `<repo>/memory/<scope>/`          | Yes        | Team-shared project knowledge          |

Per-scope directory layout (identical across tiers):

```text
<storage-root>/<scope>/
├── INDEX.md          # Curated, ≤ 200 lines; always loaded by `read`
├── entries/          # Individual memory entries; loaded on demand
│   └── <yyyy-mm-dd>-<slug>.md
├── archive/          # Consolidated / superseded entries (audit trail)
└── AUDIT.log         # Append-only ledger of write / consolidate / forget
```

---

## Core Workflow

Every operation is gated. Do not proceed to the next phase until the
prior phase's gate passes.

### `write` (default)

| Phase | Name                  | Rule                                                             | Gate                                                            |
| ----- | --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| 0     | Resolve scope + tier  | [`rules/storage-layout.md`](./rules/storage-layout.md)           | Scope name + storage tier confirmed; directory created          |
| 1     | Privacy pre-flight    | [`rules/privacy-and-consent.md`](./rules/privacy-and-consent.md) | No secrets / PII on the never-store list slip through           |
| 2     | Extract candidates    | [`rules/write-pipeline.md`](./rules/write-pipeline.md)           | Candidate list produced with type, confidence, source per item  |
| 3     | Compare to existing   | [`rules/write-pipeline.md`](./rules/write-pipeline.md)           | Each candidate tagged ADD / UPDATE / DELETE / NOOP              |
| 4     | Consent preview       | [`rules/privacy-and-consent.md`](./rules/privacy-and-consent.md) | User saw the diff and approved (unless `--auto` flag)           |
| 5     | Write + audit         | [`rules/write-pipeline.md`](./rules/write-pipeline.md)           | INDEX updated, entry files written, AUDIT.log line appended     |

### `read`

| Phase | Name             | Rule                                                       | Gate                                                          |
| ----- | ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| 0     | Resolve scope    | [`rules/storage-layout.md`](./rules/storage-layout.md)     | Scope directory exists; INDEX.md present (or report empty)    |
| 1     | Load INDEX       | [`rules/read-pipeline.md`](./rules/read-pipeline.md)       | INDEX content surfaced to current conversation                |
| 2     | On-demand fetch  | [`rules/read-pipeline.md`](./rules/read-pipeline.md)       | Detail entries fetched only when INDEX points to them         |

### `consolidate`

| Phase | Name             | Rule                                                                   | Gate                                                       |
| ----- | ---------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| 0     | Snapshot         | [`rules/consolidate-pipeline.md`](./rules/consolidate-pipeline.md)     | Pre-consolidation state captured (path + file count)       |
| 1     | Group + merge    | [`rules/consolidate-pipeline.md`](./rules/consolidate-pipeline.md)     | Semantically similar entries grouped; merge plan drafted   |
| 2     | Prune stale      | [`rules/consolidate-pipeline.md`](./rules/consolidate-pipeline.md)     | Entries past staleness cutoff flagged for archive          |
| 3     | Preview + apply  | [`rules/consolidate-pipeline.md`](./rules/consolidate-pipeline.md)     | User saw before / after summary and approved               |
| 4     | Rewrite INDEX    | [`rules/consolidate-pipeline.md`](./rules/consolidate-pipeline.md)     | INDEX reflects new state; AUDIT.log appended               |

### `forget`

| Phase | Name             | Rule                                                       | Gate                                                          |
| ----- | ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| 0     | Resolve target   | [`rules/forget-pipeline.md`](./rules/forget-pipeline.md)   | Memory id, slug, or query resolves to exactly one entry set   |
| 1     | Show + confirm   | [`rules/forget-pipeline.md`](./rules/forget-pipeline.md)   | User saw the entries and explicitly confirmed                 |
| 2     | Delete or redact | [`rules/forget-pipeline.md`](./rules/forget-pipeline.md)   | Entries removed (or redacted); INDEX + AUDIT.log updated      |

### `list`

Walk every storage tier the user has enabled, print every scope with
entry counts and last-updated timestamps. No writes.

---

## Integration With Other Skills

This skill is **slash-only** (`disable-model-invocation: true`) — its
description does not load into every session. Two ways to actually
invoke it:

1. **Explicit** — the user types `/persistent-memory write parenting`
   or `/persistent-memory read parenting`.
2. **Runtime, from a host skill** — the host skill's `SKILL.md`
   contains a one-line pointer block that calls
   `Skill("persistent-memory", "read <scope>")` when the host runs.

The second form is the canonical integration. Runtime `Skill()` calls
work regardless of `disable-model-invocation` — the skill only needs to
exist in `~/.claude/skills/`. See
[`rules/integration-with-skills.md`](./rules/integration-with-skills.md)
for the full contract and the literal snippet at
[`templates/pointer-snippet.md`](./templates/pointer-snippet.md).

| Pattern         | Token cost                | Magic | Best for                                       |
| --------------- | ------------------------- | ----- | ---------------------------------------------- |
| **Pointer**     | INDEX only, on skill load | None  | The default. Explicit, debuggable, no hook.    |
| **Hook**       | INDEX every session       | High  | Always-on scopes (e.g. a personal assistant).  |

For the parenting example: add one block to `parenting/SKILL.md`:

```markdown
> **Persistent memory:** Before responding, run
> `Skill("persistent-memory", "read parenting")` to load accumulated
> context for this scope.
```

---

## Scaling Tiers (full guidance in [`rules/scaling-tiers.md`](./rules/scaling-tiers.md))

| Tier | Backend                                        | Use when                                                                 |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| 1    | Plain markdown (this skill, default)           | ≤ ~500 entries per scope, single user, no semantic search needed         |
| 2    | Markdown + SQLite FTS index (this skill, opt-in) | Up to ~5k entries per scope, keyword search beats full-INDEX scan       |
| 3    | Markdown blobs + local vector DB (Chroma, Qdrant) | Semantic recall ("what did we discuss about X") matters                |
| 4    | Managed memory layer (Mem0, Letta, Zep)        | Multi-user, multi-tenant, > 10k entries, graph relationships, hosted SLA |

Graduate one tier at a time. The skill ships a migration recipe in
[`rules/scaling-tiers.md`](./rules/scaling-tiers.md) for moving from
markdown to SQLite, and from SQLite to a vector DB, without losing
entries.

---

## Core Principles

1. **Plain text, local-first.** Memory is markdown the user can read,
   edit, grep, and delete with standard tools. No proprietary format.
2. **Progressive disclosure.** INDEX is small and always loaded; detail
   entries load on demand. Modeled on Claude Code's MEMORY.md.
3. **Two-phase write.** Extract candidates first, then resolve each
   against existing entries with ADD / UPDATE / DELETE / NOOP. Modeled
   on Mem0's extraction + update pipeline.
4. **Consent before persistence.** Every write shows the user a diff
   preview unless `--auto` is passed; secrets and PII on the never-store
   list are refused outright.
5. **Forgetting is a feature.** A clear `forget` operation is part of
   the surface, not an afterthought. Required for privacy and for
   pruning entrenched mistakes (see Reflexion entrenchment warning).
6. **One scope, one purpose.** Resist mega-scopes ("life"). Split into
   `parenting`, `health`, `work` etc. so the INDEX stays under 200 lines.
7. **Markdown until it hurts.** Stay on Tier 1 until a concrete signal
   (search latency, INDEX bloat, multi-user) forces a graduation.

---

## Anti-patterns (one-liner — full list in [`rules/anti-patterns.md`](./rules/anti-patterns.md))

- Writing to memory without showing the user the diff first.
- Storing secrets, credentials, or government IDs (refuse outright).
- Mega-scopes that swell the INDEX past 200 lines.
- Letting the model auto-write without scope confirmation.
- Re-recording the same fact instead of UPDATE-ing the existing entry.
- Deleting an entry without an AUDIT.log line.
- Skipping consolidation forever — the INDEX rots and recall degrades.
- Committing `~/.agent-memory/` to a public repo.

---

## Definition of Done

A `write` run is done when:

- [ ] Scope and storage tier explicitly resolved (no defaults assumed silently).
- [ ] Privacy pre-flight passed (no never-store items in candidates).
- [ ] Candidate list shown to the user with ADD / UPDATE / DELETE / NOOP tags.
- [ ] User approved (or `--auto` flag was explicit).
- [ ] Entry files written; INDEX updated; AUDIT.log line appended.
- [ ] One-line summary delivered: "Saved N memories to <scope> (<tier>)."

A `read` run is done when:

- [ ] Scope resolved; if no INDEX exists, user is told the scope is empty.
- [ ] INDEX content is now in the conversation context.
- [ ] Detail entries are fetched only when the INDEX references them.

A `consolidate` run is done when:

- [ ] Before / after summary shown (entry count delta, INDEX line delta).
- [ ] User explicitly approved.
- [ ] AUDIT.log line appended with operation, timestamp, and counts.

A `forget` run is done when:

- [ ] Target entries shown verbatim before deletion.
- [ ] User confirmed (typed "yes" or `--confirm` flag).
- [ ] Entries removed (or redacted); INDEX updated; AUDIT.log line appended.
