---
title: Self-Improvement Loop — ci-auto-fix Episodic Lessons
impact: HIGH
tags:
  - self-improvement
  - memory
  - lessons
  - ci-auto-fix
  - verdicts
  - regression-detection
  - promotion
  - lorekit
  - meta
---

# Self-Improvement Loop (ci-auto-fix)

`/ci-auto-fix` improves across runs through the same **two-tier loop** as
`autonomous-workflow` and `fix-bug`. This file is the ci-auto-fix-specific
contract: which scope, which read / write points, the promotion gate, and — most
importantly — the **extra guardrails** this skill needs that the others do not.
The **shared** lesson-record schema and the base entrenchment guards are
canonical in
[`../../../workflow/autonomous-workflow/rules/self-improvement-loop.md`](../../../workflow/autonomous-workflow/rules/self-improvement-loop.md)
— read that for the full design; this file states only what differs.

The fast tier runs through **LoreKit's `memory.*` MCP tools** (surfaced by the
`lorekit-memory` skill). If those tools are **not connected**, the whole fast
tier is a silent no-op (log one line, continue).

## Contents

- [Why the extra guardrails](#why-the-extra-guardrails)
- [Scope](#scope)
- [Read lessons (Phase 3)](#read-lessons-phase-3)
- [Write lessons (Phase 8 / 9)](#write-lessons-phase-8--9)
- [Lesson promotion (raised bars)](#lesson-promotion-raised-bars)
- [Entrenchment guards (ci-auto-fix additions)](#entrenchment-guards-ci-auto-fix-additions)

---

## Why the extra guardrails

ci-auto-fix is a good memory host — it makes two recurring classification calls
(the Phase 3 **verdict** and the Phase 8 **regression** decision) with a
deterministic feedback signal (post-push CI goes green or does not). But it has
two properties that make naïve lessons *riskier* here than in fix-bug, so the
loop is deliberately more conservative:

1. **Weak per-run observability of the verdict.** The verdict is inferred from CI
   logs alone — there is no repro to test a hypothesis against. A universal
   lesson like "this error signature is always `dep-bug`" can be wrong a large
   fraction of the time yet still accrue `seen_count`, and each wrong run burns a
   real CI cycle. → **Verdict lessons are biased to the `repo::{owner}/{repo}`
   scope** (a repo's own recurring failure shapes are far more reliable than a
   cross-repo generalization) and carry a **raised promotion bar
   (`seen_count >= 5`)**.
2. **Fuzzy regression signatures that churn.** The "new vs cosmetic failure"
   call in [`regression-detection.md`](./regression-detection.md) keys on error
   text that drifts with every ecosystem update. → **Regression lessons are
   tagged `status: volatile` and expire in 30 days** (not the default 90) so
   stale signatures decay fast.

---

## Scope

LoreKit's partition axis is **scope** — `global` or `repo::{owner}/{repo}`
(`::` is the only separator; segments lowercased). The loop's bucket becomes a
**tag** + a **key namespace**, and its two tiers map onto scope:

- **Bucket → tag + key.** Every lesson carries the tag `loop::ci-auto-fix-lessons`;
  every key lives in the `ci-auto-fix-lessons::` namespace (e.g.
  `ci-auto-fix-lessons::dep-bug-lockfile-drift`).
- **Scopes (two, used together):**
  - **`global`** — universal, cross-repo. Default for **universal**
    *regression-shape* lessons (a cosmetic-vs-new pattern that holds across
    repos). **Not** the default for verdict lessons — see guardrail 1.
  - **`repo::{owner}/{repo}`** — this repository's lessons. Default for
    **verdict** lessons and any repo-specific failure shape. LoreKit's mode
    (remote / local `.lorekit/`) decides whether these are private,
    dashboard-synced, or committed — the loop only selects the scope. There is
    **no filesystem opt-in ceremony**.
  - `branch::{owner}/{repo}::{branch}` is reserved and **not used** by this loop.
- **trigger-context key:** `<verdict> : <workflow-name> : <failing-step> : <error-signature>`
  for verdict lessons; `<regression-shape> : <error-signature-delta>` for
  regression lessons. The `error-signature` is the first ~3 normalized lines of
  the failure (same normalization the regression rule uses).

Derive `{owner}/{repo}` from the `origin` remote, lowercased (strip a trailing
`.git`). No git remote → use `global` only.

Lesson record schema is the shared one. The metadata a filesystem store would
keep in frontmatter travels inside the `value` markdown as a top
`<!-- meta: phase=.. seen_count=.. confidence=.. status=.. expires=..
trigger-context=".." -->` comment. Set `phase:` to `3` (verdict) or `8`
(regression). Regression lessons additionally set `status: volatile` and
`expires: <created + 30 days>`.

Note: ci-auto-fix is dispatched by `/create-pr` and `autonomous-workflow`
Phase 7 as **its own** subagent (not `aw-executor`), so it does **not** inherit
`aw-lessons` — this loop is the only learning surface for its CI-diagnosis
decisions.

---

## Read lessons (Phase 3)

**Anchor:** `lessons-read`

At the **start of Phase 3 (Classify the failure)** — after the logs are
summarized (Phase 1) and the workflows are understood (Phase 2) but before the
verdict is chosen — load lessons narrow-to-broad:

```text
# Silent no-op if memory.* not connected.
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::ci-auto-fix-lessons"], limit: 50 }
memory.list { scope: "global", tags: ["loop::ci-auto-fix-lessons"], limit: 50 }
# Optional — when the failing workflow / step / signature is known:
memory.search { q: "<workflow-name + failing-step + error-signature keywords>", scopes: ["repo::{owner}/*", "global"], limit: 10 }
```

1. Union the matches. Match verdict lessons on
   `<workflow-name>:<failing-step>:<error-signature>`; match regression lessons
   on `<error-signature-delta>`. Load full entries only for matches. **Skip any
   lesson whose `expires` is in the past.** `repo::` wins on conflict.
2. Apply matches as **inputs**: a verdict lesson biases which verdict the
   evidence most likely fits; a regression lesson biases the Phase 8
   cosmetic-vs-new call. Neither overrides the log evidence in front of you.
3. Lessons are **advisory** — they never relax the confidence gate
   ([`confidence-gate.md`](./confidence-gate.md)), never shrink the Phase 8
   revert-on-new-failure rule, and **never** vote for a soft-refusal action
   (runner-image bump, dependency major-version change) without that action
   re-passing its own gate. See guardrail below.
4. Record applied lessons in the plan artifact (`.agent/{branch}/ci-auto-fix-plan.md`)
   under a `Lessons applied` note, marking the source scope in parentheses.

LoreKit owns storage server-side and dedups on write — no consolidation pass.
Stale beliefs decay through `expires`, not a line-count sweep.

Log:

```markdown
- [TIMESTAMP] Phase 3: lorekit(memory.list repo::{owner}/{repo} loop::ci-auto-fix-lessons) — N verdict lessons matched, applied
- [TIMESTAMP] Phase 3: lorekit(memory.list global loop::ci-auto-fix-lessons) — M regression lessons matched
- [TIMESTAMP] Phase 3: lorekit — memory.* not connected, continuing
```

---

## Write lessons (Phase 8 / 9)

**Anchor:** `lessons-write`

| Write point | When | Lesson captures |
| ----------- | ---- | --------------- |
| **Phase 8 — regression reverted** | A new failure appeared and the last commit was reverted | The strongest negative signal: the verdict or fix was wrong. Capture the mis-verdict (what it was classified vs what the revert implies) and, if the "new failure" was actually cosmetic, a **regression lesson** (`status: volatile`, 30-day expiry) |
| **Phase 9 — CI green** | The fix landed and all checks passed | An UPDATE to any verdict lesson read at Phase 3 that led here — a working verdict classification, accruing `seen_count` toward the raised bar |
| **Phase 9 — escalated / max-iterations** | `flaky`/`unsure` escalation, or the 4-iteration cap hit | A pattern this skill could not resolve — captured so the next run on the same signature escalates faster |

Classify + **dedup first**, then dispatch (note the **verdict → `repo::`**
default):

```text
# 1. Look for a near-duplicate across the scopes that could hold it.
memory.search { q: "<key words of the lesson>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }

# 2a. Regression-shape lesson that generalizes → global (volatile, 30-day expiry).
memory.write { scope: "global", key: "ci-auto-fix-lessons::<slug>", value: "<body>", tags: ["loop::ci-auto-fix-lessons", "source::regression"], source_agent: "ci-auto-fix", trigger: "regression-reverted" }

# 2b. Verdict lesson, or any repo-specific failure shape → this repo's scope.
memory.write { scope: "repo::{owner}/{repo}", key: "ci-auto-fix-lessons::<slug>", value: "<body>", tags: ["loop::ci-auto-fix-lessons", "source::verdict"], source_agent: "ci-auto-fix", trigger: "ci-green | escalated" }
```

- **No filesystem opt-in ceremony.** The loop just picks the scope; LoreKit's
  mode decides whether a `repo::` lesson is private, synced, or committed. Verdict
  lessons are still biased to `repo::` — that is guardrail 1, not a storage
  concern.
- **Privacy pre-flight is NOT optional** (a CI-diagnosis lesson never needs
  secrets; the bar is stricter for `repo::` writes since a repo scope is
  team-visible).
- **Applied-lesson UPDATE contract.** An UPDATE to an entry that carries a
  `seen_count` field MUST increment `seen_count` by 1 and refresh `expires`.
  Same scope + key overwrites in place.
- **Never** write a lesson that encodes a check-weakening action (skip, disable,
  `continue-on-error`, `--no-verify`) — those are hard-refused in
  [`anti-patterns.md`](./anti-patterns.md) and a lesson can never smuggle one in.

Log (include scope + verdict + CI outcome):

```markdown
- [TIMESTAMP] Phase 9: lorekit(memory.write repo::{owner}/{repo} ci-auto-fix-lessons::<slug>) — 1 verdict lesson (UPDATE, seen_count→5) — CI green
- [TIMESTAMP] Phase 8: lorekit(memory.write global ci-auto-fix-lessons::<slug>) — 1 regression lesson (ADD, volatile, expires+30d) — reverted
```

---

## Lesson promotion (raised bars)

**Anchor:** `lesson-promotion`

Promotion bars are **higher than the default `seen_count >= 3`** because of the
observability and churn risks above:

| Lesson kind | Promotion-eligible at | Rationale |
| ----------- | --------------------- | --------- |
| **Verdict** (`phase: 3`) | `seen_count >= 5` (or `status: structural`) | Log-only inference is noisy; require more confirmations |
| **Regression** (`phase: 8`, volatile) | `seen_count >= 3` | Standard bar, but the 30-day expiry means it must recur *often* to survive to promotion |

Surface the scope-appropriate suggestion — never act silently:

- `global` → `/create-skill diagnose ci-auto-fix --symptom "<title>"`
- `repo::{owner}/{repo}` → `Skill("docs", "update --add-rule '<title>' --source lorekit:repo::{owner}/{repo}/ci-auto-fix-lessons::<slug>")`

`ci-auto-fix` has no `rules/diagnostic-surface.md`, so
`/create-skill diagnose ci-auto-fix` reads the SKILL.md H2 sections (phases,
verdicts, anti-patterns) as its fallback surface plus the
`loop::ci-auto-fix-lessons` lessons as evidence, and emits one confidence-gated
diff — applied only at `confidence(analysis) ≥ 90 %` with explicit user
confirmation. On success, set the lesson `status: promoted` via a `memory.write`
UPDATE to the same scope + key.

---

## Entrenchment guards (ci-auto-fix additions)

The five canonical guards apply unchanged (advisory-only; recurrence-gated
promotion; every lesson expires and the read step ignores expired ones — LoreKit
dedups on write, no consolidation pass; contradictions flagged; privacy
pre-flight never bypassed). Two ci-auto-fix-specific additions:

6. **A lesson can never authorize a check-weakening or soft-refusal action.**
   Runner-image bumps, dependency major bumps, and anything on the
   [`anti-patterns.md`](./anti-patterns.md) refusal list still require their own
   confidence gate (and, for soft-refusals, explicit user approval) on **this**
   run — a lesson only ever biases the *verdict*, never pre-authorizes the *fix*.
7. **Verdict lessons default to `repo::{owner}/{repo}`; regression lessons are
   volatile.** This is not a stylistic choice — it is the mitigation for the two
   failure modes in [Why the extra guardrails](#why-the-extra-guardrails). Do not
   relax it to match the other loops.
