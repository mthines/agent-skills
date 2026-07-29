---
title: Comment Relevance Memory — LoreKit-backed per-repo reviewer signal learning
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - implement-suggestion
  - self-improvement
  - lorekit
  - comment-relevance
  - reviewer-signal
---

# Comment Relevance Memory

This rule governs how the reviewer pipeline **remembers which comments were
relevant** (acted on) and which were **not relevant** (dismissed via "won't fix"
or silently ignored at merge) — and then applies those accumulated signals to
bias future reviews on the same repository.

The goal is the same as Cursor's ongoing improvement loop: a reviewer that
learns from resolved and dismissed threads grows progressively more precise on a
specific codebase, surfacing fewer noise comments and more actionable ones.

---

## Why this exists

Every repository has quirks: patterns that look suspicious in the abstract but
are intentional by design, null-checks that are guaranteed upstream, style
choices that differ from the rubric defaults.
A static reviewer flags all of these every time.
A learning reviewer accumulates the dismissal signal and stops flagging them.

The three resolution outcomes that carry signal:

| Outcome | Signal | How to detect |
| --- | --- | --- |
| **Fixed** — author pushed a commit that addresses the comment | Comment was relevant; reinforce the detection class | Author commit touches `(path, line ± 5)` after comment posted; or `implement-suggestion` applied the comment (`verdict: applied`) |
| **Won't fix** — author explicitly declines the comment | Comment was not relevant for this codebase; consider suppressing | Author replies "won't fix", "by design", "intentional", "not going to change", "nwf", "n/a"; or 👎 reaction from the author |
| **Ignored at merge** — PR merges with the comment unresolved, no acknowledgement | Weak not-relevant signal; accumulate before suppressing | PR state transitions to `MERGED`; thread still open; no fix commit; no explicit decline |

---

## Scope

Comment-relevance memories live in LoreKit under the tag `loop::reviewer-comment-relevance`.
They use **two scopes**:

| LoreKit scope | When written | When read |
| --- | --- | --- |
| `repo::{owner}/{repo}` | Default — the relevance signal is almost always repo-specific | At the start of every review run (Step 0.7 in `reviewer`, Step 1.0 in `pr-reviewer`) |
| `global` | Only for universal patterns that transcend any codebase (rare) | At the start of every review run |

Derive `{owner}/{repo}` from the `origin` remote, lowercased (strip a trailing
`.git`).
No git remote → use `global` only.

### Key format

```
reviewer-comment-relevance::<category>:<claim-gist>
```

Where:
- `category` = the Conventional Comments prefix (e.g. `suggestion`, `issue`, `nitpick`).
- `claim-gist` = a 3–6 word stable slug describing the finding class (e.g.
  `null-check-guaranteed-upstream`, `map-vs-record-preference`).

Keys MUST NOT encode `file:line` coordinates — those drift.
They MUST encode the structural pattern so the signal accumulates across files
and commits.

---

## Relevance memory record schema

Each entry stored to LoreKit carries:

```json
{
  "fingerprint": "<category>:<claim-gist>",
  "relevance": "relevant | not-relevant | weak-not-relevant",
  "reason": "<one-line: why this verdict was reached — resolution method>",
  "resolution_method": "fixed | wont-fix | ignored-at-merge",
  "examples": ["<owner>/<repo>#<n> comment <id>"],
  "seen_count": 1,
  "status": "active | promoted | retired",
  "expires": "<ISO 8601, default: now + 180 days>"
}
```

The `seen_count` field follows the standard UPDATE contract: every re-sighting
of the same `fingerprint` with the same `relevance` direction increments
`seen_count` by 1 and refreshes `expires`.
Opposite-direction sightings (a previously "not-relevant" pattern that gets
fixed in a later PR) are flagged as contradictions, not silently overwritten.

---

## Read — loading memories into the review pipeline

### When to read

Both `reviewer` (Step 0.7) and `pr-reviewer` (equivalent step before Step 1.1)
read comment-relevance memories as part of their lesson-read fan-out.

Add these two calls to the existing narrow-to-broad lesson read:

```
# Narrow-to-broad fan-out — repo-specific wins over global on conflict.
# Silent no-op if memory.* not connected.
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::reviewer-comment-relevance"], limit: 50 }
memory.list { scope: "global",               tags: ["loop::reviewer-comment-relevance"], limit: 50 }
```

Merge both lists (`repo::` wins on key collision).
Skip any entry whose `expires` is in the past.

### How to apply

For each loaded memory with `relevance: not-relevant` or `relevance: weak-not-relevant`:
- Match its `fingerprint` against the current run's raw findings.
  A match is: same `category` prefix AND the `claim-gist` is semantically
  equivalent to the finding's one-line claim.
- On match:
  - `relevance: not-relevant` with `seen_count >= 3` → **DROP** the finding
    before it reaches the grounding step.
    Log: `[relevance-memory] DROP <file>:<line> — not-relevant pattern "<fingerprint>" seen <n> times (repo-suppressed)`.
  - `relevance: not-relevant` with `seen_count 1–2` → **DOWNGRADE** from
    `issue`/`suggestion` to `nitpick`; add the decoration `(repo-pattern, seen
    <n>×)` to the comment body.
    Log: `[relevance-memory] DOWNGRADE <file>:<line> — low-confidence not-relevant "<fingerprint>" (seen <n> times)`.
  - `relevance: weak-not-relevant` → no structural change; add `(seen ignored
    once, watch this)` as a private annotation in the terminal output only —
    never posted to GitHub.

For each loaded memory with `relevance: relevant` and `seen_count >= 2`:
- Match its `fingerprint` against the current run's raw findings.
- On match → **PROMOTE** the finding: if it would be a `nitpick`, upgrade to
  `suggestion`; add the decoration `(pattern reliably resolved, seen <n>×)` in
  the terminal output only — never posted.

Log all applied memories in a `Relevance memory` row in the Quality Gate summary:

```
Relevance-memory drops:      <D>  (not-relevant, seen ≥ 3)
Relevance-memory downgrades: <DG> (not-relevant, seen 1–2)
Relevance-memory promotes:   <P>  (relevant, seen ≥ 2)
```

Announce active suppression memories in one line before the review pipeline runs:
```
Relevance memories active: 3 suppressions, 1 promotion (repo:mthines/console)
```
So the user knows the pipeline has been influenced.

---

## Write — capturing resolution outcomes

### Who writes

There are three write paths, each covering a different point in the PR lifecycle:

| Writer | When it fires | Signal quality |
| --- | --- | --- |
| **GitHub Actions workflow** (`reviewer-comment-relevance.yml`) | At the moment a reviewer resolves a thread; at PR merge for open threads | **Highest fidelity** — real-time, covers every thread regardless of whether an agent was involved |
| **`implement-suggestion`** (Phase 7 / `--watch`) | After the skill applies or rejects a comment | High — has the full `/critical` + `/confidence` verdict without extra API calls |
| **`reviewer` / `pr-reviewer`** via `outcome-learning.md` | Post-merge via `/review-outcomes <pr>` or `--watch` tail step | Fallback — used when neither of the above paths were active |

The paths are **additive**: the same fingerprint may be written multiple times with
consistent `relevance` values, which LoreKit deduplicates by incrementing `seen_count`.
Conflicting directions (e.g. one path says `relevant`, another says `not-relevant` for the
same fingerprint) are surfaced as contradictions for user review, not silently resolved.

### GitHub Actions webhook path

The `.github/workflows/reviewer-comment-relevance.yml` workflow listens to two
GitHub events and calls `scripts/record-comment-relevance.mjs` to classify and write:

**Trigger 1 — `pull_request_review_thread: resolved`**

Fires the moment any reviewer resolves a thread on a PR.
The script fetches the thread's replies and checks for:
1. 👎 reaction from the PR author on the root comment → `not-relevant / wont-fix`
2. "Won't fix / by design / n/a / out of scope" language in any reply → `not-relevant / wont-fix`
3. A commit after the comment that touches `(path, line ± 10)` → `relevant / fixed`
4. Thread resolved with none of the above → `relevant / fixed` (human resolved = accepted)

**Trigger 2 — `pull_request: closed` (merged)**

Fires when a PR is merged.
The script sweeps all review threads, skips any that had a fix commit or a won't-fix reply
(already captured by Trigger 1), and records the rest as `weak-not-relevant / ignored-at-merge`.

**Required secret**: `LOREKIT_API_KEY` in the repository's Actions secrets.
Without it the workflow runs but skips the write (logs a graceful no-op).
The `GITHUB_TOKEN` auto-provided by Actions handles all `gh api` read calls.

The workflow writes via `npx @lorekit/cli memory write`:

```bash
npx @lorekit/cli memory write \
  --scope "repo::{owner}/{repo}" \
  --key "reviewer-comment-relevance::{fingerprint}" \
  --value '{"fingerprint":"...","relevance":"...","resolution_method":"...","reason":"...","seen_count":1,"status":"active","expires":"..."}' \
  --tags "loop::reviewer-comment-relevance,source::{resolution_method}" \
  --source-agent "github-actions/reviewer-comment-relevance"
```

LoreKit's server-side deduplication handles the `seen_count` increment when the same
key is written again — no additional lookup is needed from the workflow.

### What `implement-suggestion` writes (Phase 7 + watch re-flag)

For every comment processed in a run, after the Phase 7 report, emit a
relevance memory record alongside the existing `review-outcomes` bus write.
This is an **additional** write — it does not replace the `review-outcomes` emit.

Derive the `relevance` and `resolution_method` from the Phase 4 verdict:

| Phase 4 outcome | `relevance` | `resolution_method` |
| --- | --- | --- |
| `applied` — patch landed | `relevant` | `fixed` |
| `rejected-at-validation` — `/critical` Must-fix OR confidence < threshold | `not-relevant` | `wont-fix` |
| `deferred` — gate cleared, scoped out | `weak-not-relevant` | `ignored-at-merge` |
| `reverted-after-ci` — patch reverted after CI | `not-relevant` | `wont-fix` |

For `applied` verdicts, also check for explicit "won't fix" language in the
comment thread:

```bash
# Has the author or a team member explicitly declined?
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq ".[] | select(.in_reply_to_id == $COMMENT_ID) | .body" \
| grep -iE "(won.?t fix|wont fix|by design|intentional|nwf|not going to|n/a)"
```

If a decline phrase is found, override `relevance: not-relevant`, `resolution_method: wont-fix`
regardless of what Phase 4 decided for that comment.

Write the memory:

```
# Classify scope: almost always repo-specific.
# Universal pattern (e.g. "defensive null-checks are always over-flagged"
# regardless of codebase) → global; anything citing a repo-specific
# symbol, path, or pattern → repo::{owner}/{repo}.

# Deduplicate first.
memory.search { q: "<fingerprint slug>", scopes: ["repo::{owner}/{repo}", "global"], limit: 5 }

# Write (UPDATE if exists, ADD otherwise).
memory.write {
  scope: "repo::{owner}/{repo}",   # or "global" for universal patterns
  key: "reviewer-comment-relevance::<fingerprint>",
  value: "<record body as JSON or markdown>",
  tags: ["loop::reviewer-comment-relevance", "source::<resolution_method>"],
  source_agent: "implement-suggestion",
  trigger: "outcome-emit"
}
```

The write is **append-only and non-blocking** — it MUST NOT gate or delay the
Phase 7 report.
Silent no-op if `memory.*` tools are not connected.

### What `reviewer` / `pr-reviewer` write (post-merge fallback)

When the `outcome-learning.md` gh-api measurement step fires (post-merge via
`/review-outcomes <pr>` or at the tail of `--watch`), also emit a
comment-relevance memory for each measured comment:

- Signal (c) — fix commit touches `(path, line ± 5)` → write `relevant / fixed`.
- Signal (a) — 👎 reaction from the PR author → write `not-relevant / wont-fix`.
- Signal (b) — author reply correcting the finding, no fix commit → write `not-relevant / wont-fix`.
- PR merged with thread open, no fix, no decline → write `weak-not-relevant / ignored-at-merge`.

Use the same `memory.write` call format above, with `source_agent: "reviewer"` or
`source_agent: "pr-reviewer"` and `trigger: "post-merge-outcome"`.

---

## Promotion rule

When a `fingerprint` accumulates **≥ 3 concordant `not-relevant`** records
(same direction — all `not-relevant` or `weak-not-relevant`), the pattern is
**suppression-eligible**:

Surface a one-line suggestion — never act silently:

```
Relevance memory "<fingerprint>" has been suppressed 3+ times in <repo>.
Promote to a permanent repo filter?  Consider adding to .review.yaml:
  filters:
    - category: <category>
      claim: "<claim-gist pattern>"
```

When a `fingerprint` accumulates **≥ 3 concordant `relevant`** records, it is
**reinforcement-eligible**:

```
Relevance memory "<fingerprint>" has been resolved 3+ times in <repo>.
Pattern reliably gets fixed — confidence threshold can be lowered for this class.
```

Both promotions are advisory — the user decides whether to act.
The promotion suggestion fires once per `seen_count` crossing (at 3, not again
until 6).

---

## Interaction with existing rules

| Rule | Interaction |
| --- | --- |
| `prior-comment-awareness.md` | Dedup and anti-flip-flop run AFTER relevance-memory drops — a suppressed finding is never deduped (already gone). |
| `review-outcomes.md` | Relevance memories are a **parallel write** to the outcome bus — not a replacement. Both coexist in LoreKit. |
| `outcome-learning.md` | Post-merge gh-api signals write to BOTH `reviewer-lessons` (existing) AND `reviewer-comment-relevance` (new). |
| `per-comment-confidence.md` | Confidence gate runs on the surviving findings only — already-dropped findings skip the gate. |
| `finding-grounding.md` | Grounding runs on the surviving findings only. |
| `.review.yaml` `filters:` | Manual filters in `.review.yaml` take precedence over relevance-memory drops. They run first (Step 2.3), so a memory-suppressed finding that is ALSO in `filters:` is dropped by the filter — the memory records are not consumed for that finding. |

---

## What this rule does not do

- Change the confidence threshold gate (`per-comment-confidence.md`) per-run.
- Replace the `review-outcomes` bus — that bus drives the `reviewer-lessons` promotion; this rule drives per-comment relevance suppression/reinforcement.
- Store raw comment bodies or author names — only the structural fingerprint and
  aggregated counts.
- Bypass the two-gate validation in `implement-suggestion` — relevance memories
  are advisory inputs to Phase 3 classification only.
- Auto-edit `.review.yaml` — promotion is always surfaced as a suggestion, never
  applied without the user confirming.
