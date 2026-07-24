---
title: LoreKit Backend — Shared, Hosted Lessons over MCP
impact: HIGH
tags:
  - backend
  - lorekit
  - mcp
  - lessons
  - shared-memory
  - cross-machine
  - ci
---

# LoreKit Backend

An optional, hosted backend for this skill. When LoreKit is configured, the
four operations (`write` / `read` / `consolidate` / `forget`) run against
LoreKit's MCP tools instead of the local markdown filesystem — **without
changing the call contract**. Every host skill keeps calling
`Skill("persistent-memory", "<op> <scope> --tier <t>")`; only where the bytes
land changes.

LoreKit is a Supabase-backed MCP server for shared agent memory. It exists to
fix the one thing the markdown backend cannot: lessons written on one machine
(or in CI) are invisible everywhere else. With LoreKit, a lesson the `aw`
agent learns on a laptop is read by the same agent in CI, on a teammate's
machine, and in the next session — because storage is a database reached over
one authenticated MCP endpoint, not a `~/.agent-memory/` directory.

> This is a **Tier-4 managed backend** in the scaling ladder
> ([`scaling-tiers.md`](./scaling-tiers.md)) — but a light one: LoreKit stores
> scoped, keyed lessons, not a general graph/agent runtime. Markdown stays the
> default; adopt LoreKit only when cross-machine / CI / team sharing is the
> concrete signal.

---

## Contents

- [When this backend is active](#when-this-backend-is-active)
- [The mapping](#the-mapping)
- [Operation variants](#operation-variants)
- [Invariants preserved](#invariants-preserved)
- [Setup](#setup)

---

## When this backend is active

Resolve the backend once, at Phase 0 of every operation. The backend is
**LoreKit** when any of these is true (checked in order); otherwise it is the
default **markdown** backend and the standard pipelines apply unchanged:

1. Env `LOREKIT_MCP_URL` **and** `LOREKIT_TOKEN` are both set.
2. A `lorekit` server is present in the project's `.mcp.json`.
3. `~/.agent-memory/config.json` contains `{ "backend": "lorekit" }`.

State the resolved backend on the operation's status line:

```text
Operation: read
Scope: aw-lessons
Backend: lorekit (scope global)
```

If LoreKit is selected but its MCP tools are not connected, do **not** fall
back silently to markdown for a write (that would split a lesson store across
two backends). Report `LoreKit backend configured but MCP tools unavailable`
and stop the operation. Reads may degrade to "no lessons" and continue.

---

## The mapping

LoreKit's scope axis (`global | project | repo | branch`) is a **different
dimension** than this skill's *scope bucket* (`aw-lessons`, `parenting`). The
bucket becomes part of the LoreKit **key** and a **tag**; the *tier* becomes
the LoreKit **scope**.

| This skill | LoreKit | Notes |
|------------|---------|-------|
| tier `home` (cross-repo, per-user) | scope `global` | Follows the user across every repo — the token identifies the user |
| tier `project-shared` (team) | scope `repo::{owner}/{repo}` | Derived from the git `origin` remote, lowercased |
| tier `project-local` (private) | scope `branch::{owner}/{repo}::{branch}` | Short-lived, this branch only |
| scope bucket, e.g. `aw-lessons` | key prefix `aw-lessons::<slug>` **and** tag `skill::aw-lessons` | Lets `memory.list` / `memory.search` filter to one bucket |
| entry filename `<date>-<slug>.md` | key `<bucket>::<slug>` | The slug is the stable identity; the date is not part of the key |
| entry frontmatter + body | `value` (markdown, ≤ 64 KB) | Stored **verbatim**, including `seen_count`, `expires`, `status`, `phase`, `trigger-context`. LoreKit needs no schema change; this skill parses the frontmatter out of `value` when it needs those fields |
| `type` / `status` / `trigger-context` | mirrored into `tags` (`type::procedural`, `status::active`) | For query only — `value` frontmatter stays authoritative |
| `INDEX.md` (curated ≤ 200 lines) | the result of `memory.list` | LoreKit returns entries newest-first; summarize at read time |
| `archive/` | soft-archived rows (`memory.archive`) | Hidden from reads, listable/restorable |
| `AUDIT.log` | `created_at` / `updated_at` + `source_agent` / `trigger` on each row | LoreKit records provenance server-side |

Deriving `{owner}/{repo}` and `{branch}`: read the git `origin` remote and the
current branch, lowercase all segments (same rule as
[`scope-format`](https://github.com/mthines/lorekit/blob/main/docs/scope-format.md)).
No git remote → only `global` is available; `project-shared` / `project-local`
requests degrade to `global` with a one-line note.

---

## Operation variants

Every operation keeps its Phase 0–1 privacy pre-flight and consent gates
(see [`privacy-and-consent.md`](./privacy-and-consent.md)) — those run **before**
storage and are backend-independent. Only persistence and recall change.

### `read`

Replace "load INDEX + fetch entries" with a narrow-to-broad list, merged
(more specific scope wins on duplicate key):

```text
memory.list { scope: "branch::{owner}/{repo}::{branch}", tags: ["skill::<bucket>"] }   # if --tier project-local
memory.list { scope: "repo::{owner}/{repo}",             tags: ["skill::<bucket>"] }   # --tier project-shared / broad read
memory.list { scope: "global",                            tags: ["skill::<bucket>"] }   # --tier home
```

Each returned entry's `value` is the full lesson (frontmatter + body). The
two-tier fan-out the host skills already perform (`home` then `project-shared`)
maps directly onto listing `global` then `repo::{owner}/{repo}` — so the
`[ -f memory/<bucket>/INDEX.md ]` opt-in check is unnecessary under LoreKit
(an empty repo scope simply returns nothing). For a keyword query, use
`memory.search { q, scopes: ["repo::{owner}/*", "global"], tags: ["skill::<bucket>"] }`.

### `write`

Candidate extraction and ADD / UPDATE / DELETE / NOOP resolution are unchanged
(see [`write-pipeline.md`](./write-pipeline.md)); to find the match target, use
`memory.search` instead of grepping the INDEX. Then persist per op:

- **ADD** → `memory.write { scope, key: "<bucket>::<slug>", value, tags: ["skill::<bucket>", "type::<type>", "status::<status>"], source_agent, trigger }`.
- **UPDATE** → `memory.write` with the **same** `scope` + `key` and the updated
  `value`. LoreKit stores-or-updates in place, so this is the whole update.
  The `seen_count` / `expires` bump happens **inside `value`** exactly as the
  markdown backend does — the write-pipeline rule is unchanged.
- **DELETE** (supersede) → `memory.archive { scope, key }` (soft; the markdown
  backend's default is archive, not hard-delete), then `ADD` the successor.
- **NOOP** → no call.

`scope` is the tier-mapped scope; a `--tier project-shared` write with no git
remote degrades to `global` and says so.

### `consolidate`

1. `memory.list { scope, tags: ["skill::<bucket>"] }` — the snapshot.
2. Merge groups: `memory.write` the merged entry (same key as the survivor),
   `memory.archive` each superseded key.
3. Prune: `memory.archive` any entry past its `expires` (read from `value`
   frontmatter) — same staleness contract as markdown.
4. Reclaim: `memory.purge { retention_days }` permanently removes rows archived
   longer ago than the window. This is the LoreKit equivalent of clearing
   `archive/`; it is irreversible, so it stays behind the same consent gate.

### `forget`

- `--archive` (default) → `memory.archive { scope, key }`.
- `--hard-delete` → `memory.delete { scope, key, force: true }`.
- `--redact` → `memory.write` the same key with the body replaced by
  `[REDACTED at <ts>]` and a `redacted: true` frontmatter flag.

Resolution (by id / slug / NL query) and the show-then-confirm gate are
unchanged.

### `list`

`memory.list` per candidate scope (`global`, and `repo::{owner}/{repo}` when in
a repo), grouped by the `skill::<bucket>` tag, with row counts. No writes.

---

## Invariants preserved

The LoreKit backend changes storage only. These remain exactly as documented
elsewhere and must not be relaxed:

- **Privacy pre-flight + never-store list** run before any `memory.write`.
- **Consent preview** before persistence (unless `--auto`, which still prints
  the plan).
- **Lessons are advisory observations**, not rules; the lesson schema
  (`seen_count`, `expires`, `status`, `phase`, `trigger-context`) is stored
  verbatim in `value`, so the cross-file schema contract in
  [`integration-with-skills.md`](./integration-with-skills.md) and the
  `seen_count` UPDATE rule in [`write-pipeline.md`](./write-pipeline.md) are
  unchanged.
- **Auth tiers:** writes need an `lk_rw_*` token; a read-only `lk_ro_*` token
  can read but not write — a write attempt reports the authorization error and
  stops (it does not fall back to markdown).

---

## Setup

Install and verify with the LoreKit CLI (see the
[LoreKit repo](https://github.com/mthines/lorekit)):

```bash
npx @lorekit/cli install --endpoint https://<ref>.supabase.co/functions/v1/mcp --token lk_rw_<token>
npx @lorekit/cli doctor
```

`install` writes the `lorekit` MCP server into the project's `.mcp.json`
(activation path 2 above) and can scaffold the deterministic `lorekit-memory`
hooks. Alternatively export `LOREKIT_MCP_URL` + `LOREKIT_TOKEN` (activation
path 1) to make LoreKit the default for every scope on the machine, CI
included.
