# `codebase-knowledge` — the standard shared cross-loop layer

`codebase-knowledge` is the one memory bucket every code-touching host in a repo
**shares by name**. It is why two loops wired independently — by different people,
in different sessions, on the same repo — still compound: they read and write the
*same* repo-scoped, structurally-keyed record of what the codebase has taught
every loop that touched it. A code-changing loop plans and edits with that history
in hand instead of blind, and because the loops that consume it also feed it, the
synergy appears even for a repo that wired a single host and nothing else.

Every other bucket is siloed by its `loop::<host>-lessons` tag and read only by its
own host. `codebase-knowledge` is the sanctioned exception, and it earns the
exception precisely because its key is structural (`symbol@path`, `path`) rather
than prose: a fixed name plus a structural key is what lets a loop wired by one
person be consumed by a loop wired by another. The taxonomy entry is
[`memory-buckets.md § Knowledge`](./memory-buckets.md); this file is the contract.

## The bucket

| Field | Value |
| --- | --- |
| **Tag** | `codebase-knowledge` |
| **Kind** | `signal` (a durable per-repo filter, read on every run that touches code) |
| **Scope** | `repo::{owner}/{repo}` — a codebase fact is repo-bound |
| **TTL** | ~90 days, refreshed on re-verification |
| **Keys** | `knowledge::<symbol>@<path>` — verified facts about one symbol (an invariant it holds, its consumer/dependent count, a defect it produced before, plus a capped `history[]` of findings); `hotspot::<path>` — per-file counters (`confirmed`, `missed`, `regressed`, `flaky`, `classes`, `confirmed_examples`, `last_touched_by`) |

The keys are **structural** on purpose: a key survives a rename of the *finding*
but not a rename of the *code*, which is exactly the sensitivity that lets a
different loop match it against the files it is about to touch. Set `kind: signal`
and `host` explicitly on every write — LoreKit infers them only from a `loop::`
tag, and this bucket is not tagged that way.

Both records are a **closed JSON object** (the `hotspot` and `knowledge` shapes in
[`pr-reviewer/rules/memory.md`](../../pr-reviewer/rules/memory.md) are the
reference), the value is that JSON and nothing else, and a `hotspot` field set is
shared across writers: `flaky` counts the times a test file was empirically flaky
then stabilised (written by `e2e-pr-stabilizer`), the way `confirmed` / `missed` /
`regressed` count review outcomes. A writer **increments only the counters it
earned this run and carries the rest through unchanged** — which is what lets a
`pr-reviewer` write and an `e2e-pr-stabilizer` write to the same `hotspot::<path>`
compose instead of clobber.

## Read side — automatic for any code-changing host

Wire the read at the host's **plan/apply seam**: the moment it holds the concrete
file/symbol list it will change (a plan's File Changes list, an apply pack, a
fix's target file). That is the moment the structural key becomes matchable.

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["codebase-knowledge"], limit: 100 }
# Keep only hotspot::<path> / knowledge::<symbol>@<path> whose <path> (and <symbol>)
# this run will actually touch. Apply them as PLANNING INPUTS: raise coverage on a
# hotspot, design around a known invariant / consumer count. They are advisory and
# re-verified against the code — never a reason to skip a step or suppress a finding.
```

Four rules make the read safe, and they are non-negotiable:

- **Structural and bounded.** Match the bucket's keys against the paths / symbols
  of *this* run and ignore the rest. Never load the whole bucket as advice — that
  reintroduces the noise the tag split exists to prevent.
- **Raises care, never lowers a bar.** A record can add coverage or bias a design
  choice. It can never skip a step, drop a finding, or lower a review tier. Absent
  records are **not** evidence of safety.
- **Advisory and stale-aware.** A cross-host fact carries the *writer's*
  `verified_at_sha`, not the reader's. Treat it as a consideration and re-verify
  against the code in front of you.
- **Read-only unless the host verifies.** Reading never obliges a write. A host
  writes back only what it actually verified, under the contract below.

Do **not** cross-read another host's `loop::<host>-lessons`: those are prose advice
tuned to that host's decisions, they re-key on rephrasing, and they carry no
structural anchor to match against.

## Write side — how the layer fills, and why many writers stay safe

`pr-reviewer` **Step 4d** is the reference **primary writer**: a full review traces
symbols and confirms findings, so it produces the richest facts (see
[`pr-reviewer/rules/memory.md`](../../pr-reviewer/rules/memory.md)). But the bucket
is **multi-writer** — any host that verifies a structural fact about a symbol or
file may contribute it back so the next loop reads it. That is what makes the
synergy automatic even on a repo with no dedicated reviewer: the loops that consume
the layer also feed it.

Multi-writer is safe **only** behind this contract. Bake in every bullet, or do not
wire the write:

- **Structural key from a real symbol/path list**, taken from the run's impact set
  or changed-file list — never composed from prose. A prose key accumulates nothing
  and no reader can match it.
- **`verified_at_sha` on every fact** — the HEAD this run verified it at. It is the
  whole mechanism the next reader uses to decide "fact stands" vs "re-verify"; an
  absent or stale SHA makes the fact permanently unverifiable, and it is dropped.
- **`source_agent` stamped** — which host verified it. Together with
  `verified_at_sha` this is what makes many writers safe: a reader sees who verified
  what, and when, so no writer silently overwrites another's provenance.
- **Only what THIS run actually verified**, grounded in the code — never a guess,
  and never a value about a person or a telemetry reading. A fact about code, keyed
  to code.
- **Merge, never clobber.** Read the existing record first; append to `history[]`
  or increment counters (each capped) and carry the rest through unchanged. A
  clobbered counter is indistinguishable from a first write.
- **Raise care, never suppress.** These records only raise priority/coverage on a
  file or symbol. They never lower a bar or silence a finding, and an absent record
  is never evidence of safety. Suppression, where a host needs it, lives in a
  different bucket behind verification (`reviewer-comment-relevance`).
- **Explicit `kind: signal` + `host`, a TTL (~90d), and the privacy pre-flight** —
  as every write in the LoreKit loops.

Because the name is fixed, the read is the same call in every host, and the write
follows one contract, **any two LoreKit-wired loops in the same repo compound
automatically** — the whole reason to standardize the name instead of letting each
host invent its own.

## Who reads and writes it here

| Host | Seam | Role |
| --- | --- | --- |
| `pr-reviewer` | Step 1.2a (read) / Step 4d (write) | Primary writer; reads on every review |
| `aw` | plan time, once File Changes is drafted | Reader (`autonomous-workflow/rules/self-improvement-loop.md § knowledge-read`) |
| `implement-suggestion` | apply seam, once the target files are known | Reader |
| `fix-bug` | fast-lane plan seam (`aw-create-plan`) | Reader |
| `ci-auto-fix` | the fix subagent, once the failing files are known | Reader |
| `optimize-approach` | plan mode, judging a plan's approach (aw-planner Phase 1) | Reader |
| `test-auto-fix` | Phase 2 (read) / Phase 6–7 (write) | Reader + writer |
| `e2e-pr-stabilizer` | Phase 7, on the CI-ratified verdict | Writer (`hotspot` `flaky`) |
| `holistic-analysis` | its verification output, best-effort | Writer-primary (no read) |

A reader that verifies a structural fact while doing its work may write it back
under the contract above; otherwise it reads only.
