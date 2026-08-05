---
title: Self-Improvement Loop — Episodic Lessons + Promotion to Source
impact: HIGH
tags:
  - self-improvement
  - memory
  - lessons
  - episodic
  - promotion
  - lorekit
  - meta
---

# Self-Improvement Loop

The workflow gets better across runs through a **two-tier loop**. This file is
the single source of truth for the loop: the lesson schema, the read / write
triggers, the promotion gate, and the entrenchment guards. The phase rules
contain thin invocation blocks that reference the anchors here.

## Contents

- [Why two tiers](#why-two-tiers)
- [LoreKit in one screen](#lorekit-in-one-screen)
- [The lesson record](#the-lesson-record)
- [Fast tier — read lessons (Phase 1, Phase 3/4)](#fast-tier--read-lessons)
- [Fast tier — write lessons (Phase 4 stuck-loop, Phase 7 end-of-run)](#fast-tier--write-lessons)
- [Lesson promotion — slow tier](#lesson-promotion)
- [Entrenchment guards (load-bearing)](#entrenchment-guards-load-bearing)
- [Storage](#storage)
- [Disable](#disable)
- [Research basis](#research-basis)

---

## Why two tiers

A run that learns something — "the `ux` trigger didn't fire because the glob
missed `.tsx` in a nested dir" — needs somewhere to put that lesson so the
**next** run does better. There are two places it can go, and the loop uses
**both**, connected by a recurrence gate:

| Tier | Where | Cost | Reversible? | Changes behavior? |
| ---- | ----- | ---- | ----------- | ----------------- |
| **Fast (episodic)** | LoreKit lessons, tag `loop::aw-lessons` (via the `memory.*` MCP tools) | Cheap — one write per escalation / run | Yes — overwrite / expiry | **No** — advisory input to planning only |
| **Slow (procedural)** | The skill's own source, via `/create-skill diagnose` | Expensive — confidence-gated, user-approved diff | Yes — `git revert` | **Yes** — becomes an always-on rule / gate / trigger |

The fast tier captures lessons immediately and cheaply. A lesson only earns a
**permanent** change to the skill's source (the slow tier) once it has **proven
itself across runs** — recurrence is the cheap external-validation signal that
the lesson is real and not a one-off hallucination. This is the
episodic → procedural promotion path from the CoALA memory taxonomy, with the
confidence gate the literature insists on to prevent self-reinforcing error.

The fast tier runs through **LoreKit's `memory.*` MCP tools** (surfaced by the
`lorekit-memory` skill). If those tools are **not connected**, the whole fast
tier skips silently (log one line, continue). The slow tier
(`/create-skill diagnose`) is unaffected and still works on demand.

---

## LoreKit in one screen

LoreKit is a shared, persistent memory for agents, backed by an MCP server, so a
lesson learned on one machine (or in CI) is available to every agent everywhere
in the next session. The loop uses four tools:

| Tool | Claude Code name | Use |
|------|------------------|-----|
| `memory.list` | `mcp__lorekit__memory_list` | List lessons for one scope (newest first, tag filter) |
| `memory.search` | `mcp__lorekit__memory_search` | Full-text search across scopes (supports `repo::owner/*`) |
| `memory.read` | `mcp__lorekit__memory_read` | Read one lesson by scope + key |
| `memory.write` | `mcp__lorekit__memory_write` | Store or update a lesson (same scope + key updates in place) |

**Tool naming — do not hunt for a literal `memory.*` tool.** The `memory.list`
form is LoreKit's canonical (protocol-level) tool name and is what the pseudocode
blocks below use. **Claude Code exposes MCP tools server-prefixed with dots
replaced by underscores** — the actual callable names are
`mcp__lorekit__memory_list` / `_search` / `_read` / `_write` (right column).
There is no tool literally named `mcp__lorekit__memory.*`.

**Availability — sub-agents must be granted these tools explicitly.** A sub-agent
(`aw`, `aw-planner`, `aw-executor`, `aw-tester`, and the `pr-reviewer` agent)
gets **only** the tools listed in its own frontmatter
`tools:` — it does **not** inherit the parent session's MCP tools. Each of those
agents therefore lists the `mcp__lorekit__memory_*` tools it needs. If, despite
that, the tools are absent (LoreKit not installed, or a host that does not expose
them), the loop is a no-op — log one line and continue.

**CLI fallback (reads AND writes).** When the MCP tools are unavailable but a
shell is (all these agents have `Bash`), the whole loop can still run through the
`@lorekit/cli` commands. Read with `npx @lorekit/cli search "<keywords>" --json`
and `npx @lorekit/cli list --scope <scope> --json`; write with
`npx @lorekit/cli write "<scope>::<key>" "<body>" --tags loop::aw-lessons --source-agent <agent> --trigger <slug>`
(an upsert — same `scope::key` overwrites in place, mirroring `memory.write`).
Prefer the MCP tools when present; the CLI is the fallback. If neither is
available, skip silently.

**Scope** is LoreKit's partition axis — `global`, `repo::{owner}/{repo}`, or
`branch::{owner}/{repo}::{branch}` (`::` is the only separator; segments are
lowercased). The loop maps its two tiers onto scope:

| Loop tier (old `persistent-memory` name) | LoreKit scope |
| ---------------------------------------- | ------------- |
| **Universal** — follows the user across every repo (was `home`) | `global` |
| **Project-bound** — specific to the cwd repo (was `project-shared`) | `repo::{owner}/{repo}` |

`branch::` is reserved and **not used** by this loop. Where a `repo::` lesson
physically lives — LoreKit's hosted server (`remote`, the default) or on-disk
`.lorekit/` (`local`), and whether it syncs to the dashboard or commits to the
repo — is LoreKit's own control model (see `lorekit doctor` and the
`@lorekit/cli` README). **The loop only picks the scope; it never manages
storage, creates directories, or commits files.**

**Bucket = tag + key namespace.** LoreKit's scope axis is repo/branch/global,
not named buckets, so the loop keeps its lessons separate from other loops'
with a **tag** and a **key namespace**:

- Every `aw-lessons` lesson carries the tag `loop::aw-lessons`.
- Every key lives in the `aw-lessons::` namespace, e.g.
  `aw-lessons::ux-trigger-missed-nested-tsx`.

Reads filter by the tag; writes always include it. Same `scope` + `key`
overwrites in place — that is what makes recurrence (below) countable.

---

## The lesson record

A lesson is a LoreKit entry tagged `loop::aw-lessons`. It is **procedural**
memory — "how to do better next time" — not a fact about the user. The entry's
`value` is markdown; the metadata that a filesystem store would keep in
frontmatter lives in a `meta:` comment at the top of the value so the four
mandatory fields stay human-readable:

```markdown
<!-- meta: phase=<0-7> seen_count=1 confidence=<high|medium|low> status=active expires=<ISO 8601> trigger-context="<concrete signal — file glob, task type, tech>" source=system -->

# <one-line lesson title>

**What failed:** <concrete observable from the run>
**Why:** <root cause, if known; "unknown" is allowed>
**What to do next time:** <prescriptive, actionable, testable instruction>
**Promotion target:** <skill rule/phase this would harden if promoted, or "none">
```

Written with:

```text
memory.write {
  scope: <global | repo::{owner}/{repo}>,
  key:   "aw-lessons::<kebab-slug>",
  value: "<the markdown above>",
  tags:  ["loop::aw-lessons", "source::<trigger>"],
  source_agent: "aw",
  trigger: "<stuck-loop | end-of-run | …>"
}
```

The four bold fields are mandatory, and so are the five `meta` fields the loop
reads mechanically (`phase`, `seen_count`, `status`, `expires`,
`trigger-context`). `trigger-context` must be **concrete** (globs, task types,
tech names) — never "when it feels relevant" — so the read step in Phase 1 can
match it mechanically against the current task.

---

## Fast tier — read lessons

**Anchor:** `lessons-read`

Invoked at the **start of planning** (Phase 1) and again before
**implementation / testing** (Phase 3, Phase 4) so accumulated lessons bias the
work before mistakes repeat.

The read is **narrow-to-broad** — project-bound lessons from `repo::` first,
then universal lessons from `global` — merging the results:

```text
# (1) Project-bound lessons for this repo (skips silently if memory.* not connected).
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::aw-lessons"], limit: 50 }

# (2) Universal lessons that follow the user across every repo.
memory.list { scope: "global", tags: ["loop::aw-lessons"], limit: 50 }

# (3) Optional — when the task names a subsystem, error, or tool, add a search:
memory.search { q: "<subsystem or error keywords>", scopes: ["repo::{owner}/*", "global"], limit: 10 }
```

Derive `{owner}/{repo}` from the `origin` remote, lowercased (strip a trailing
`.git`). No git remote → read `global` only.

After the lessons load (union the matches):

1. Match each lesson's `trigger-context` against the current task (file globs,
   task type, tech). Consider the full entry only for matches — do not apply
   every entry. Scope-of-origin is not a match criterion; both scopes fire the
   same way. **Skip any lesson whose `expires` is in the past** — treat it as
   stale (see the entrenchment guards).
2. Treat each **matching** lesson's *"What to do next time"* as a
   **consideration** on the plan / implementation — apply it unless it
   conflicts with the user's stated intent or task-specific constraints.
   Record applied lessons in `plan.md` under a `## Lessons applied` note (Full
   Mode), noting the source scope in parentheses (e.g. `(repo)`) so reviewers
   can tell repo-specific guidance from universal.
3. Lessons are **advisory** — they bias the plan; they never silently change a
   gate, skip a phase, or override the user's intent. If a lesson conflicts
   with the user's stated intent, the user's intent wins and the conflict is
   surfaced. If a `repo::` lesson and a `global` lesson contradict, the
   `repo::` lesson wins (closer scope) — log the conflict.

There is no local INDEX to maintain: LoreKit manages its own storage
server-side and deduplicates on write, so the loop does not run a
consolidation pass. Stale beliefs decay through `expires` (guard #3), not a
line-count sweep.

Log:

```markdown
- [TIMESTAMP] Phase 1: lorekit(memory.list repo::{owner}/{repo} loop::aw-lessons) — N lessons matched, applied as constraints
- [TIMESTAMP] Phase 1: lorekit(memory.list global loop::aw-lessons) — M lessons matched
- [TIMESTAMP] Phase 1: lorekit — memory.* not connected, continuing
```

---

## Fast tier — write lessons

**Anchor:** `lessons-write`

A lesson is captured at the two points below. The end-of-run write includes a
brief **retrospective prompt** so friction is captured even on clean runs —
the dominant failure mode of this loop is *no capture at all* (cold-start),
and recurrence + expiry filter noise downstream:

| Write point | When | What to capture |
| ----------- | ---- | --------------- |
| **Phase 4 stuck-loop escalation** | The iteration cap was hit (and/or auto-replan ran) on the same failing area | What the failing area was, every hypothesis tried, what finally worked (or that it didn't), and the phase that should have caught it earlier |
| **Phase 7 end-of-run** | CI green, or user-approved stop, or a post-merge bug surfaces in the same session | Any durable lesson from the run — a missed trigger, a plan gap, a recurring fix pattern |

**Scope classification (load-bearing).** Before writing, classify each candidate
as **project-bound** or **universal** by looking at its `trigger-context`:

| Verdict | Signal | Scope |
| ------- | ------ | ----- |
| **Project-bound** | Trigger references a concrete cwd-repo path (`packages/foo/`, `apps/bar/`, `src/specific-file.ts`), a repo-specific package / Nx target / domain term that another repo could not plausibly have, or the lesson body cites a file that only exists here. | `repo::{owner}/{repo}` |
| **Universal** | Trigger is a glob with no repo prefix (`*.tsx`, `**/*.test.ts`), names a framework / tool / task type (React Native, Playwright, monorepo refactor) with no repo binding, or could re-derive in any sufficiently-similar repository. | `global` |

When ambiguous, default to **universal** (`global`) — it errs toward broader
reach; a misclassified universal lesson harms nothing in other repos because its
`trigger-context` still has to match. A misclassified project-bound lesson
written to `global` only adds a row that never matches elsewhere.

Then dispatch by verdict. **Deduplicate first** so a recurrence UPDATES in place
instead of piling up:

```text
# 1. Look for a near-duplicate across the scopes that could hold it.
memory.search { q: "<key words of the lesson>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }

# 2a. Universal lesson — always lands in global.
memory.write { scope: "global", key: "aw-lessons::<slug>", value: "<body>", tags: ["loop::aw-lessons", "source::<trigger>"], source_agent: "aw", trigger: "<trigger>" }

# 2b. Project-bound lesson — lands in this repo's scope.
memory.write { scope: "repo::{owner}/{repo}", key: "aw-lessons::<slug>", value: "<body>", tags: ["loop::aw-lessons", "source::<trigger>"], source_agent: "aw", trigger: "<trigger>" }
```

- **No filesystem opt-in ceremony.** With LoreKit the loop just picks the
  scope; LoreKit's mode decides whether a `repo::` lesson is private, synced to
  the dashboard, or committed to `.lorekit/`. The workflow never
  creates directories or commits lesson files — the "don't silently commit to
  the repo" concern that gated the old `project-shared` tier is now LoreKit's to
  honor, not the loop's.
- **The privacy pre-flight is NOT optional.** Lessons are about *workflow
  mechanics*, never product data — if a candidate lesson contains a credential,
  a customer name, a token, or any PII, it is **dropped, not written**. The bar
  is **stricter** for `repo::` writes — a repo scope is team-visible.
- **Dedup resolves each candidate as ADD / UPDATE.** Found the same situation
  under a key → reuse that **exact scope + key** and `memory.write` an updated
  body (same scope + key overwrites in place). A lesson that recurs resolves to
  **UPDATE**, which **bumps `seen_count`** and refreshes `expires` — it does not
  create a duplicate. This is what makes recurrence countable.
- **Applied-lesson UPDATE contract.** If a lesson read at the start of the run
  was applied and the failure it targets did not recur, write an UPDATE for
  that lesson — successful application counts as recurrence evidence. An UPDATE
  to an entry that carries a `seen_count` field MUST increment `seen_count` by 1
  and refresh `expires`. This is how a *working* lesson still reaches the
  `seen_count >= 3` promotion gate.
- **Retrospective prompt (Phase 7 / dispatcher exit-write).** Before writing,
  ask: was there friction, a surprise, a guess that paid off, a near-miss, or a
  companion that should have fired? Phrase each capture as an **observation**
  ("last run hit X") not a **rule** ("always do Y") — the read step applies
  observations as considerations, not constraints. Write nothing only when the
  retrospective surfaces nothing **and** no lesson was applied — empty lessons
  are noise. Phase 4 stuck-loop is failure-event-driven and does not need the
  retrospective.

Log (include the resolved scope in every line):

```markdown
- [TIMESTAMP] Phase 4: lorekit(memory.write global aw-lessons::<slug>) — UPDATE, seen_count→3
- [TIMESTAMP] Phase 7: lorekit(memory.write repo::{owner}/{repo} aw-lessons::<slug>) — ADD — project-bound
- [TIMESTAMP] Phase 7: lorekit — memory.* not connected, continuing
```

---

## Lesson promotion

**Anchor:** `lesson-promotion` (slow tier)

A lesson graduates from advisory note to permanent skill rule when it has
proven itself. Promotion is **suggested**, never automatic.

### Promotion trigger

After a `write` (Phase 4 or Phase 7), or after a `read` in Phase 1, check the
matched / written lessons. A lesson is **promotion-eligible** when **either**:

- `seen_count >= 3` — the same failure recurred across at least three runs, or
- the lesson's author tagged it `status: structural` because it reflects a
  design gap, not a one-off.

### What promotion does

For each eligible lesson, surface a one-line suggestion to the user — do **not**
act silently. The suggested target **depends on the lesson's scope**:

| Lesson scope | Promotion target | One-liner |
| ------------ | ---------------- | --------- |
| `global` (universal) | The skill's source — ships to every consumer | `Lesson "<title>" recurred N times. Promote to a permanent skill guard? Run:  /create-skill diagnose autonomous-workflow --symptom "<title>"` |
| `repo::{owner}/{repo}` (project-bound) | The repo's own docs — `CLAUDE.md` / `.claude/rules/` — ships to every teammate working in this repo | `Lesson "<title>" recurred N times in this repo. Promote to a repo rule? Run:  Skill("docs", "update --add-rule '<title>' --source lorekit:repo::{owner}/{repo}/aw-lessons::<slug>")` |

The split is load-bearing: a repo-specific behavior change does not belong in
the skill source (it would change every consumer's behavior for one repo's
quirk). Conversely, a universal behavior change does not belong in one repo's
`CLAUDE.md` (it would silo a fix that other repos also need).

When the user runs the global-scope promotion, Diagnose Mode reads the
`loop::aw-lessons` lessons as **evidence** (the full `seen_count` history and
prior contexts make the diagnosis far more accurate than a single-session
reflection), produces one confidence-gated unified-diff proposal against this
skill's source, and applies it only at `confidence(analysis) ≥ 90 %` **with
explicit user confirmation**. The gate and apply flow are unchanged — see
[`../../../authoring/create-skill/rules/diagnose-mode.md`](../../../authoring/create-skill/rules/diagnose-mode.md).

The `repo::` promotion path uses the `docs` skill (or equivalent) to draft the
repo-rule edit, gated by the same confidence + user-approval contract.

### After a successful promotion

Set the source lesson's `status: promoted` (via a `memory.write` UPDATE to the
same scope + key) so it stops re-suggesting, and record the commit / PR that
hardened the skill in the lesson body. The lesson stays as an audit trail of
*why* the rule exists.

---

## Entrenchment guards (load-bearing)

The central, well-documented risk of any reflective-memory loop is
**self-reinforcing error**: an agent wrongly concludes "approach X always
fails," stores it, avoids X forever, and never gathers the evidence to overturn
the false belief. These guards are non-negotiable:

1. **Lessons are advisory, never auto-applied to behavior.** A lesson biases
   the plan; it can never silently disable a gate, skip a phase, or change a
   cap. The **only** path from a lesson to changed workflow behavior is through
   the confidence-gated, user-approved `diagnose` apply.
2. **Recurrence gates promotion, not a single run.** `seen_count >= 3` (or an
   explicit `structural` tag) is required before promotion is even suggested.
   One bad run cannot rewrite the skill.
3. **Every lesson expires.** Default `expires` is 90 days from last sighting,
   carried in the lesson body and refreshed on each re-sighting (UPDATE). The
   read step **ignores expired lessons**, so stale beliefs decay instead of
   entrenching. A re-sighting refreshes `expires`; a belief no run re-confirms
   simply ages out of consideration.
4. **Contradiction is flagged, not overwritten.** A new lesson that contradicts
   an existing one is surfaced for review (the dedup search finds the prior
   entry) rather than silently winning.
5. **The privacy pre-flight is never bypassed.** Autonomous writes skip consent,
   never the never-store list — secrets / PII are dropped, not written.

---

## Storage

- **Backend:** LoreKit (`memory.*` MCP tools via the `lorekit-memory` skill).
- **Bucket:** tag `loop::aw-lessons` + key namespace `aw-lessons::<slug>`.
- **Scopes (two, used together):**
  - **`global`** — universal, cross-repo. The default for **universal**
    lessons; they follow the user across every repository. Always read; always
    available for writes.
  - **`repo::{owner}/{repo}`** — this repository's lessons. The default for
    **project-bound** lessons. LoreKit's mode (remote / local `.lorekit/`)
    decides whether these are private, dashboard-synced, or committed — the
    loop only selects the scope.
  - **`branch::{owner}/{repo}::{branch}`** — reserved for throwaway,
    branch-only notes. **Not written by this loop.**
- **Scope classification on write** — see [Fast tier — write lessons](#fast-tier--write-lessons).
  Universal → `global`; project-bound → `repo::{owner}/{repo}`.
- **Promotion targets differ by scope** — `global` → skill source via
  `/create-skill diagnose`; `repo::` → repo rules via the `docs` skill.
  See [Lesson promotion](#lesson-promotion).
- **Layout:** LoreKit owns storage server-side (or under `.lorekit/` in local
  mode) and deduplicates on write. There is no `INDEX.md`, no per-tier
  200-line cap, and no `consolidate` pass — expiry (guard #3) is the decay
  mechanism.

---

## Disable

The fast tier is fully optional and degrades silently:

- **Per-run:** disconnect LoreKit (`lorekit doctor` shows `off`, or the
  `memory.*` MCP tools are simply not connected). Every `read` / `write` then
  logs `memory.* not connected, continuing`.
- **Permanently:** remove the `memory.*` invocation blocks from
  [`phase-1-planning.md#lessons-read`](./phase-1-planning.md#lessons-read),
  [`phase-4-testing.md#lessons-write`](./phase-4-testing.md#lessons-write), and
  [`phase-7-ci-gate.md#lessons-write`](./phase-7-ci-gate.md#lessons-write), and
  delete the `lorekit-memory` rows from
  [`companion-skills.md`](./companion-skills.md#registry).

The slow tier (`/create-skill diagnose`) is independent and unaffected by
disabling the fast tier.

---

## Research basis

- **CoALA** (Princeton, 2023) — the episodic → semantic → procedural memory
  taxonomy this loop promotes along.
- **ExpeL / EvolveR** — distilling success-vs-failure trajectories into
  reusable, editable lessons; recurrence-across-runs as the signal.
- **Agentic Context Engineering** (Zhang et al., 2025, arXiv 2510.04618) —
  improve via *context adaptation*, not weight updates; update knowledge with
  **incremental structured deltas** (append a lesson) rather than wholesale
  rewrites, to avoid context collapse / brevity bias.
- **Reflexion** (Shinn et al., 2023) and the **self-reinforcing-error** warning
  (SSGM governance work; "LLM Agents Are Not Always Faithful Self-Evolvers") —
  the basis for the entrenchment guards above.

See also [`../../../authoring/persistent-memory/rules/scaling-tiers.md`](../../../authoring/persistent-memory/rules/scaling-tiers.md)
for how LoreKit fits the markdown → managed-memory scaling ladder. The
operational read/write skill is `lorekit-memory` (installed via
`npx @lorekit/cli install`), which wraps the `memory.*` tools this loop calls.

**Worked example.** A full lesson lifecycle (capture → recur 3× → promote →
apply) is traced in
[`../references/self-improvement-walkthrough.md`](../references/self-improvement-walkthrough.md).
