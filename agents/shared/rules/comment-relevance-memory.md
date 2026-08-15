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

**Line tolerance is per-producer and the two values are not a mistake.** The GitHub Action
(`scripts/record-comment-relevance.mjs`) uses `± 10`; the agent-executed gh-api fallback
(`outcome-learning.md § Step 4`) uses `± 5`. They are separate implementations measuring separate
runs, and each doc line states the tolerance of the path it describes. Do not "reconcile" them to a
single number without changing the corresponding implementation — the script's `hasFixCommit` and
`outcome-learning.md`'s Step 4 snippet are the two sources of truth.


| Outcome | Signal | How to detect |
| --- | --- | --- |
| **Fixed** — author pushed a commit that addresses the comment | Comment was relevant; reinforce the detection class | `implement-suggestion` applied the comment (`verdict: applied`); or an author commit touches the commented region after the comment **and** the thread is resolved or the author acknowledged it. A region touch with the thread still open is **indeterminate** — record nothing (`outcome-learning.md § Signal (c) requires corroboration`). |
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

```text
reviewer-comment-relevance::<category>:<claim-gist>
```

Where:
- `category` = the Conventional Comments prefix (e.g. `suggestion`, `issue`, `nitpick`).
- `claim-gist` = the first 6 surviving words of the comment body, in source order,
  kebab-joined (e.g. `null-check-guaranteed-upstream`, `map-vs-record-preference`).
  "Surviving" is defined by the algorithm below — it is a mechanical truncation,
  not a summary you compose.

The key MUST be **exactly two colon-separated segments after the bucket prefix**:
`<category>:<claim-gist>`. Nothing else.

Keys MUST NOT encode **any coordinate** — not `file:line`, and not a PR number,
comment id, commit SHA, thread id, or run index. Every coordinate drifts or is
unique-per-occurrence, which silently breaks the accumulation this whole loop
depends on: a key that is unique per comment never reaches `seen_count ≥ 3`, so
suppression never fires and the memory is inert. Coordinates belong in the
record's `examples` field (see the schema below), never in the key.

```text
# ✅ RIGHT — a structural fingerprint that accumulates across files, commits, and PRs
reviewer-comment-relevance::suggestion:clinerules-link-not-added
reviewer-comment-relevance::issue:null-check-guaranteed-upstream

# ❌ WRONG — encodes PR + comment-id coordinates; unique per occurrence, never accumulates.
#    This is the observed drift that produced 2–3 duplicate rows per comment on
#    dash0hq/dash0 and left the relevance loop non-functional there.
reviewer-comment-relevance::pr16855-3758467267-clinerules-link-not-added
reviewer-comment-relevance::pr16855-3758467267-clinerules-link-not-added-wontfix
```

**Derive the key mechanically, not from memory of the comment.**
`fingerprint()` in [`scripts/record-comment-relevance.mjs`](../../../scripts/record-comment-relevance.mjs)
is the **normative implementation** — the GitHub Actions write path runs it, so an
agent that derives differently produces a second key for the same comment and the
`seen_count` splits. Follow its steps exactly; do not paraphrase the comment.

1. `category` — the Conventional Comments prefix at the start of the body
   (`issue`, `suggestion`, `nitpick`, `nit`, `question`, `praise`, `chore`),
   matched case-insensitively and followed by `:` or `(`. `nit` normalises to
   `nitpick`. **No prefix ⇒ `suggestion`**, not "no category".
2. `claim-gist` — from the body, in this order: drop fenced code blocks, then
   inline code spans, then URLs; replace every non-alphanumeric character with a
   space; lowercase; delete the stop-words (the script's list is normative — do
   not re-invent it); collapse whitespace.
3. Take the **first 6 surviving words in source order** and kebab-join them. This
   is positional truncation, not selection of the 6 most meaningful words — the
   leading `issue`/`suggestion` word survives the stop-list and will normally be
   the first token, which is expected and matches the script.
4. Nothing survives ⇒ `general-finding`.

Re-deriving descriptively per run is what makes the slug wobble; running this
transform makes the same comment yield the same key every time, so LoreKit's
server-side dedup increments `seen_count` in place. When the body is long or
ambiguous, execute `fingerprint()` rather than emulating it.

**Digits inside a gist are legitimate.** `fingerprint()` preserves them, so
`issue:500-responses-not-retried` and `suggestion:4096-byte-buffer-configurable`
are correct keys. Do not strip a number that is part of the claim — stripping it
makes the agent's key diverge from the script's for the same comment, which is
the exact split this rule exists to prevent. Only *coordinate shapes* are banned.

**Self-check before every write:** STOP and re-derive `<category>:<claim-gist>` if
the key you are about to write hits any row below — each matches a coordinate, not
a claim.

| # | Test against the key | Catches |
| - | -------------------- | ------- |
| 1 | `/\bpr[-_#]?\d+/i` | `pr16855`, `pr-103` |
| 2 | `/#\d+/` | `#16855` |
| 3 | `/\d{9,}/` | comment ids, thread ids, run ids |
| 4 | `/\b(?=[0-9a-f]{7,40}\b)(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]+\b/i` | commit SHAs (7–40 char hex run carrying **both** a letter and a digit) |
| 5 | more than one `:` in the segment after the bucket prefix | `file:line` |

No row fires on a digit that belongs to the claim: rows 1–2 require a `pr`/`#`
prefix, row 4 needs a hex run carrying both a letter and a digit (requiring only a
digit would re-match any 7-digit number, since digits are hex characters — that is
why `1048576` is clean, and why a hypothetical all-numeric short SHA is accepted
rather than widen the row back out), and row 3's bound
is set at 9 because that is where GitHub's numeric ids start (comment, review,
and run ids are 9–10 digits) and above where real claims land — `65535` (port),
`86400` (seconds), `120000` (ms), and `1048576` (bytes) are all shorter. If a
claim genuinely needs a 9-digit-or-longer number, do not encode it: spell the
magnitude in words (`four-gib-allocation-cap`, not `4294967296-byte-cap`), which
is the better gist anyway. If you have encoded a coordinate, move it to the
record's `examples` field.

**Existing rows are not migrated.** Most rows written before this rule carry a
bare gist with no `<category>:` segment (at the time of writing, 59 of 70 rows in
`repo::mthines/agent-skills`). Re-keying them in place is deliberately **not**
attempted: a bulk rewrite would have to re-derive `category` from comment bodies
that are no longer fetched, and a wrong guess is worse than no row. Instead the
old keys are left to lapse — they are never re-sighted under the new derivation,
so their TTL expires them, while the correctly-keyed row for the same finding
class accumulates from `seen_count: 1`. Expect a one-TTL window in which a
finding class is represented by both an old and a new row; suppression simply
takes longer to arm for those classes and nothing is lost.

---

## Relevance memory record schema

Each entry stored to LoreKit carries:

```json
{
  "fingerprint": "<category>:<claim-gist>",
  "relevance": "relevant | not-relevant | weak-not-relevant | indeterminate",
  "reason": "<one-line: why this verdict was reached — resolution method>",
  "resolution_method": "fixed | wont-fix | ignored-at-merge | uncorroborated-touch",
  "examples": ["<owner>/<repo>#<n> comment <id>"],
  "seen_count": 1,
  "status": "active | promoted | retired",
  "expires": "<ISO 8601, default: now + 60 days>"
}
```

The `seen_count` field follows the standard UPDATE contract: every re-sighting
of the same `fingerprint` with the same `relevance` direction increments
`seen_count` by 1 and refreshes `expires`.
Opposite-direction sightings (a previously "not-relevant" pattern that gets
fixed in a later PR) are flagged as contradictions, not silently overwritten.

### `indeterminate` — a record that counts toward nothing

`indeterminate` is the fourth relevance value and the only **non-directional** one. It is written
when the evidence is real but does not decide direction — today, exactly one case: a region touch on
a thread that merged unresolved with no acknowledgement (`resolution_method:
uncorroborated-touch`, `outcome-learning.md § Signal (c) requires corroboration`).

It exists because "write nothing" discards the observation, not just the direction. A repo where
signal (c) never corroborates then looks identical to a repo with no activity, and the gap is
invisible precisely where it matters.

Three hard properties:

1. **It counts toward neither promotion gate.** Not the `≥ 3 concordant not-relevant` suppression
   bar, not the `≥ 3 concordant relevant` reinforcement bar. It is diagnostic only.
2. **It is never a contradiction.** Having no direction, it cannot oppose one; a later directional
   sighting of the same fingerprint supersedes it without flagging.
3. **It never influences a review.** `§ Read` loads directional memories only — an `indeterminate`
   entry must not drop, downgrade, or promote a finding.

Its whole purpose is to make a silent gap countable. Treat a fingerprint accumulating
`indeterminate` records as a signal that the corroboration path is not firing in this repo, and
report it at consolidation time — never as evidence about the finding itself.

---

## Read — loading memories into the review pipeline

### When to read

Both `reviewer` (Step 0.7) and `pr-reviewer` (equivalent step before Step 1.1)
read comment-relevance memories as part of their lesson-read fan-out.

Add these two calls to the existing narrow-to-broad lesson read.
**This read is a mandatory attempt — issue it as a real `mcp__lorekit__memory_list` tool call, not documentation shorthand.**
Only a real tool error (thrown exception, or tool not listed in the agent's `tools:` grant) may suppress the call; never infer "not connected" without attempting it.
When this rule is applied inside a sub-agent, the sub-agent does NOT receive the SessionStart memory-load priming that the main session gets, so it MUST perform this read itself — never assume memories were pre-loaded.

```text
# Narrow-to-broad fan-out — repo-specific wins over global on conflict.
# Issue each line as a real mcp__lorekit__memory_list tool call.
# view="summary" returns the index (key, tags, updated_at, value_bytes, preview)
# instead of every body — see the availability note directly below.
mcp__lorekit__memory_list: scope="repo::{owner}/{repo}" tags=["loop::reviewer-comment-relevance"] limit=50 view="summary"
mcp__lorekit__memory_list: scope="global"               tags=["loop::reviewer-comment-relevance"] limit=50 view="summary"
```

**`view` requires LoreKit ≥ the release carrying lorekit#464.** Read the live
`mcp__lorekit__memory_list` schema first; if it does not list `view`, omit the parameter and take
the full bodies. A tool error naming `view` as unknown is handled the same way — retry that one
call without it. Neither case is evidence the backend is down, so neither may count toward the
retry budget below or set the backend not-connected.

**On a tool error, retry before declaring the backend down.** A thrown MCP error on the first call
is far more often a momentary transport hiccup than a real outage, and treating one blip as
terminal is what makes the `Memories — not connected` line flap between otherwise-identical runs.
Retry up to **2 more times** (3 attempts total) with a short backoff, then treat the backend as not
connected. The one error that must NOT be retried is a hard "tool unavailable" (the tool is absent
from the caller's `tools:` grant, or the LoreKit MCP server did not connect this session — it
surfaces as `No such tool available: mcp__lorekit__memory_list`): there is nothing to wait for, the
remedy is environmental, and it is a genuine "not connected". Any attempt that returns without a
tool error — **including an empty list** — is a success; stop retrying. This is the same contract
`pr-reviewer.md § Step 1.0` states, restated here rather than cross-referenced because a caller
applying this rule standalone must not end up with a weaker one.

Merge both lists (`repo::` wins on key collision).
Skip any entry whose `expires` is in the past.

**Then resolve the bodies.** `view: "summary"` returns the index, and the index is NOT enough to
apply a verdict: the key carries only the fingerprint (`<category>:<claim-gist>`), while
`relevance`, `seen_count`, `resolution_method` and `status` all live in the record body. So for
every entry whose fingerprint matches one of this run's raw findings, fetch the body before
applying anything:

```text
# One call per fingerprint-matched entry.
mcp__lorekit__memory_read: scope="<the entry's scope>" key="<the entry's key>"
```

This fetch happens **after** the run's raw findings exist, because the selector is a fingerprint
match against them — there is nothing to match earlier. In `pr-reviewer` that is Step 2.2.

Skip the fetch entirely in two cases, neither of which consumes budget:

- **The list read was not a summary read.** If the caller omitted `view` — because the server does
  not support it, or because it chose not to — the bodies are already in hand and there is nothing
  to resolve. In `pr-reviewer` this is `SUMMARY_VIEW == false`.
- **`value_bytes` ≤ 200**, in which case the `preview` already carried the whole record.

A failed read drops that one entry and is non-blocking — never treat it as a disconnection.
An entry whose body was not fetched — a failed read, or an exhausted budget — has no verdict and
must not produce a drop, downgrade, or promote; treat it as absent rather than guessing from the
preview.

**Budget.** A caller that bounds its memory reads should give this fetch the larger share. In
`pr-reviewer` the two read sites draw on one shared `MEMORY_READ_BUDGET`: Step 1.2d (lesson bodies)
may spend at most half of it, and this fetch may spend the whole remainder, including anything 1.2d
left unused. The asymmetry is deliberate — a missing relevance verdict changes what gets POSTED,
while a missing lesson only changes emphasis. When the pool is exhausted, the unfetched entries are
simply absent, per the rule above.

**Keep the coordinates.** Retain each entry's `scope` and `key` (the LoreKit
memory coordinates) alongside its `fingerprint`, `relevance`, and `seen_count` —
the report builds a pressable dashboard deep link from `scope` + `key` for every
memory that actually influences the review (see
[Linking applied memories in the report](#linking-applied-memories-in-the-report)).
`memory.list` / `memory.read` / `memory.search` return no per-memory `id`, so
`scope` + `key` are the only identifiers a link can be built from.

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

**Record every memory that fires.** Whenever a loaded memory produces a DROP,
DOWNGRADE, or PROMOTE against a real finding this run, append a record to an
`APPLIED_MEMORIES[]` list:

```json
{ "fingerprint": "<category>:<claim-gist>", "action": "drop | downgrade | promote", "seen_count": <n>, "scope": "<lorekit scope>", "key": "<lorekit key>" }
```

A memory that was loaded but matched nothing is **not** recorded — it did not
influence the review. `APPLIED_MEMORIES[]` is what the report links (see
[Linking applied memories in the report](#linking-applied-memories-in-the-report)).

Log all applied memories in a `Relevance memory` row in the Quality Gate summary:

```text
Relevance-memory drops:      <D>  (not-relevant, seen ≥ 3)
Relevance-memory downgrades: <DG> (not-relevant, seen 1–2)
Relevance-memory promotes:   <P>  (relevant, seen ≥ 2)
```

Announce active suppression memories in one line before the review pipeline runs:

```text
Relevance memories active: 3 suppressions, 1 promotion (repo:mthines/console)
```
So the user knows the pipeline has been influenced.

---

## Linking applied memories in the report

When a loaded memory actually **influences** the review — it produced a DROP,
DOWNGRADE, or PROMOTE against a real finding this run — the report MUST make it
pressable so the reader can open the exact memory in LoreKit and see why the
pipeline was biased. This turns "relevance-memory drops: 3" from an opaque count
into three links the user can click through and audit.

**Only applied memories are linked.** Use `APPLIED_MEMORIES[]` from the apply step.
A memory that was loaded but fired against nothing is never linked — it did not
influence the review. If `APPLIED_MEMORIES[]` is empty, the block still renders
its header line (`… · 0 used`) and no bullets, per
[Render shape](#render-shape); the numeric Quality Gate counts stand alone.

### Resolving each link

A LoreKit memory's dashboard deep link opens its detail sheet in the `/lore`
Explorer. It is built from the memory's `scope` + `key` per LoreKit's documented
[deep-link contract](https://lorekit.io/docs/deep-links). That contract
enumerates every Explorer parameter — `scope`, `q`, `range`, `owner`, `filters`,
`tags`, `view`, `archived`, and `lesson` — and `lesson` is the only one that
opens a single memory. There is no `?memoryId=` parameter, and the read tools
expose no `id` to put in one, so never build a link from either. For each entry
in `APPLIED_MEMORIES[]`, resolve its URL in this order:

1. **Preferred — let the LoreKit CLI build it.** When the `lorekit` CLI is on
   `PATH`, run `lorekit link "<scope>" "<key>"` (alias `url`). It prints the exact
   URL to stdout — nothing else — and honours `LOREKIT_APP_URL` / `--base` for
   self-hosted dashboards, so encoding is never hand-rolled:

   ```bash
   lorekit link "repo::acme/widget" "reviewer-comment-relevance::suggestion:null-check-guaranteed-upstream"
   ```

2. **Fallback — construct the URL directly.** When the CLI is unavailable,
   build `{base}/lore?scope=<enc(scope)>&lesson=<enc({scope,key})>`, where
   `enc(v) = encodeURIComponent(JSON.stringify(v))` (the exact inverse of the
   dashboard's `useUrlState` read — a raw `?scope=global` silently means "all
   scopes"), and `base` is the `LOREKIT_APP_URL` environment variable, else
   `https://lorekit.io`. For scope `global`, key
   `reviewer-comment-relevance::nitpick:map-vs-record-preference` this yields:

   ```text
   https://lorekit.io/lore?scope=%22global%22&lesson=%7B%22scope%22%3A%22global%22%2C%22key%22%3A%22reviewer-comment-relevance%3A%3Anitpick%3Amap-vs-record-preference%22%7D
   ```

**Never fabricate a URL** — both paths derive it deterministically from the
memory's real `scope` + `key`; if neither `scope` nor `key` is known, render the
memory as plain text `` `<scope> · <key>` `` with no hyperlink.

### Render shape

A persistent **Memories** block headed by the read and used counts, followed —
only when at least one memory fired — by one bullet per applied memory. Each bullet is a
Markdown link whose text names the `fingerprint`, the action taken, and the recurrence count,
so multiple memories render as multiple independently-pressable links:

```markdown
**Memories** — <read> read · <used> used

- [`suggestion:null-check-guaranteed-upstream`](https://…) — dropped, seen 4×
- [`nitpick:map-vs-record-preference`](https://…) — downgraded, seen 2×
- [`issue:missing-abort-signal`](https://…) — promoted, seen 3×
```

The bullet count MUST equal the `used` count — the number of memories that fired this run (drops +
downgrades + promotes). A mismatch means an applied memory was dropped from the list instead of
linked. When nothing fired, render only the header line (`… · 0 used`). Which report surface renders
this block is the consuming agent's contract — `pr-reviewer` renders it inside the posted review
body's `Review details` block (Step 4), where the collapsed title also headlines the `used`
count.

---

## Write — capturing resolution outcomes

### Who writes

There are three write paths, each covering a different point in the PR lifecycle:

| Writer | When it fires | Signal quality |
| --- | --- | --- |
| **GitHub Actions workflow** (`reviewer-comment-relevance.yml`) | At the moment a reviewer resolves a thread; at PR merge for open threads | **Highest fidelity** — real-time, covers every thread regardless of whether an agent was involved |
| **`implement-suggestion`** (Phase 7 / `--watch`) | After the skill applies or rejects a comment | High — has the full `/critical` + `/confidence` verdict without extra API calls |
| **`pr-reviewer`** via `thread-resolution.md` | On every re-review (a commit-triggered second+ pass), when a prior own-thread is fixed or declined | High — real code state at re-review time; also resolves the GitHub thread (see [`thread-resolution.md`](./thread-resolution.md)). `pr-reviewer`-only — `reviewer` never writes to GitHub |
| **`reviewer` / `pr-reviewer`** via `outcome-learning.md` | Post-merge via `/review-outcomes <pr>` or `--watch` tail step | Fallback — used when neither of the above paths were active |

The paths are **additive**: the same fingerprint may be written multiple times with
consistent `relevance` values, which LoreKit deduplicates by incrementing `seen_count`.
Conflicting directions (e.g. one path says `relevant`, another says `not-relevant` for the
same fingerprint) are surfaced as contradictions for user review, not silently resolved.

### GitHub Actions webhook path

The logic lives as a **reusable GitHub Actions workflow** in this repository
(`.github/workflows/reviewer-comment-relevance.yml`).
Any repository using the `reviewer` or `pr-reviewer` agents can reference it
with a single `uses:` line — no need to copy any script or workflow logic.

**Installation (two steps):**

1. Copy `plugins/pr-relevance-memory/templates/pr-relevance-caller.yml` to
   `YOUR_REPO/.github/workflows/pr-relevance-memory.yml`.
   This is a ~30-line caller workflow that extracts event data from the webhook
   payload and delegates to the reusable workflow via:
   ```yaml
   uses: mthines/agent-skills/.github/workflows/reviewer-comment-relevance.yml@main
   ```
2. Add `LOREKIT_API_KEY` to the repo's **Settings → Secrets and variables → Actions**.
   Without it the workflow is a graceful no-op — it won't fail CI.

Updates to the classification logic propagate automatically to all callers when
the `@main` reference is used (or pin to a tag for stable behaviour).

**Two triggers the caller wires up:**

**`pull_request_review_thread: resolved`** (mode `thread-resolved`) —
Fires the moment a reviewer resolves a thread.
The script fetches the thread's replies and checks for:
1. 👎 reaction from the PR author on the root comment → `not-relevant / wont-fix`
2. "Won't fix / by design / n/a / out of scope" language in any reply → `not-relevant / wont-fix`
3. A commit after the comment that touches `(path, line ± 10)` → `relevant / fixed`
4. Thread resolved with none of the above → `relevant / fixed` (human accepted)

**Check 3** is sound in this mode, and only in this mode: the trigger is the resolution event, so the
thread is resolved by construction and the corroboration
``outcome-learning.md § Signal (c) requires corroboration`` demands is present. The same region-touch
test is **not** sound on the post-merge fallback path, which has no such guarantee.

The same `WONT_FIX_RE` drift reaches **check 3** whenever the declined thread's region was also
edited — and declines commonly arrive with nearby edits. Check 3 still satisfies the corroboration
rule (resolved **and** touched), so it is sound as defined; but "sound" is not an exemption from the
matcher drift below.

**Check 4 is not signal (c) at all** and that argument does not reach it. There is no region touch,
so resolution is the *sole* evidence rather than corroboration of anything. It is retained as
pre-existing behaviour, but note what it infers over: `pr-reviewer` Step 2.9c resolves threads it
classified `declined` as well as `fixed` / `acknowledged`, so a decline whose wording misses
`WONT_FIX_RE` — a different matcher, free to drift from Step 2.9c's phrase list — resolves, fires
this trigger, and records `relevant / fixed` for a finding the author rejected. Not introduced here
and not fixed here; flagged so the next change to either matcher knows the two are coupled.

**`pull_request: closed` (merged)** (mode `pr-merged`) —
Fires when a PR merges.
Sweeps the PR's review threads and records `weak-not-relevant / ignored-at-merge` for the ones it
cannot account for otherwise.

**What `modePrMerged` actually skips** (`scripts/record-comment-relevance.mjs`), and it is only two
things, both REST-derivable:

- A thread with a **won't-fix reply** (`WONT_FIX_RE`) — the decline is the record.
- A thread with a **commit touching its region** since the comment — but only when the root comment
  has a resolvable anchor (`path` non-empty and `line > 0`, where `line` falls back to
  `original_line`). A **file-level** comment has neither, so the touch check never runs for it and it
  is always swept as `ignored-at-merge`, however the author dealt with it. This skip is load-bearing in
  a way it was not before: such a thread is **indeterminate**, not "already captured". The region
  was edited, so `ignored-at-merge` is a claim the evidence does not support; and the first trigger
  (`thread-resolved`) never fired for it unless it was also resolved. Skipping it writes nothing,
  which is the correct outcome — see
  ``outcome-learning.md § Signal (c) requires corroboration``.

**Known gap — resolved-with-no-touch double-writes.** The sweep has **no resolved-state check**, and
cannot get one from the endpoint it reads: the script fetches `/pulls/{n}/comments`, and GitHub does
not expose thread resolution in the REST comments list (the script says so at its own skip block).
So a thread resolved with **no region touch** is recorded twice, on the same fingerprint:

- **Resolved with no matching decline phrase** — `thread-resolved` mode's check 4, the "human
  accepted" fallthrough — takes `relevant / fixed` from the first trigger and then
  `weak-not-relevant / ignored-at-merge` from this sweep. Two **opposite** directional records; per
  § Relevance memory record schema they surface as a contradiction rather than resolving.
- **Declined by a 👎 reaction rather than a reply** — check 1 — takes `not-relevant / wont-fix` and
  is *also* swept, because the sweep inspects replies and never reactions. Same direction, so no
  contradiction, but one event counts twice toward the `≥ 3` suppression bar.

This predates the corroboration rule and is **not** fixed here. Closing it needs the same GraphQL
`reviewThreads` query `outcome-learning.md § Step 3b` adds — a change to the committed script, not
to this document. It is recorded rather than papered over because the alternative is a doc that
claims a protection the implementation does not provide.

Until then the Action path is dormant: `.github/workflows/reviewer-comment-relevance.yml` is still
uncommitted (see the availability note in [`memory-buckets.md`](./memory-buckets.md)), so this is a
spec defect awaiting a fix, not a live source of contradictory records.

**What the reusable workflow does:**
- Checks out `mthines/agent-skills` to get `scripts/record-comment-relevance.mjs`.
- Runs it with the event-specific inputs passed by the caller.
- Writes to LoreKit via `npx @lorekit/cli memory write`:
  ```bash
  npx @lorekit/cli memory write \
    --scope "repo::{owner}/{repo}" \
    --key "reviewer-comment-relevance::{category}:{claim-gist}" \
    --value '{"fingerprint":"...","relevance":"...","resolution_method":"...","reason":"...","seen_count":1,"status":"active","expires":"..."}' \
    --tags "loop::reviewer-comment-relevance,source::{resolution_method}" \
    --source-agent "github-actions/reviewer-comment-relevance"
  ```
- LoreKit's server-side deduplication increments `seen_count` on re-write of the same key.

See `plugins/pr-relevance-memory/README.md` for the full installation guide and effect table.

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

```text
# Classify scope: almost always repo-specific.
# Universal pattern (e.g. "defensive null-checks are always over-flagged"
# regardless of codebase) → global; anything citing a repo-specific
# symbol, path, or pattern → repo::{owner}/{repo}.

# Deduplicate first.
memory.search { q: "<fingerprint slug>", scopes: ["repo::{owner}/{repo}", "global"], limit: 5 }

# Write (UPDATE if exists, ADD otherwise).
memory.write {
  scope: "repo::{owner}/{repo}",   # or "global" for universal patterns
  key: "reviewer-comment-relevance::<category>:<claim-gist>",   # NO pr#/comment-id/sha — see § Key format
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

- Signal (c) — fix commit touches `(path, line ± 5)` **and** the thread is resolved, `implement-suggestion` recorded `verdict: applied`, or the author acknowledged → write `relevant / fixed`. A bare region touch on an open thread is indeterminate: **write nothing** (`outcome-learning.md § Signal (c) requires corroboration`). This path is the one the in-run re-scan predicate routes downgraded threads into, so an uncorroborated write here would land exactly the record that guard prevents.
- Signal (a) — 👎 reaction from the PR author → write `not-relevant / wont-fix`.
- Signal (b) — author reply correcting the finding, no fix commit → write `not-relevant / wont-fix`.
- PR merged with thread open, no fix, no decline → write `weak-not-relevant / ignored-at-merge`.

Use the same `memory.write` call format above, with `source_agent: "pr-reviewer"` and `trigger: "post-merge-outcome"`.

---

## Promotion rule

When a `fingerprint` accumulates **≥ 3 concordant `not-relevant`** records
(same direction — all `not-relevant` or `weak-not-relevant`), the pattern is
**suppression-eligible**:

Surface a one-line suggestion — never act silently:

```text
Relevance memory "<fingerprint>" has been suppressed 3+ times in <repo>.
Promote to a permanent repo filter?  Consider adding to .github/review.yaml:
  filters:
    - category: <category>
      claim: "<claim-gist pattern>"
```

When a `fingerprint` accumulates **≥ 3 concordant `relevant`** records, it is
**reinforcement-eligible**:

```text
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
| review-config `filters:` | Relevance-memory filtering runs at Step 2.2, filter suppression at Step 2.3. A finding that survives Step 2.2 (seen < 3 times, only downgraded) is still eligible for filter suppression at Step 2.3. A finding dropped at Step 2.2 never reaches Step 2.3 — filter suppression is a no-op for already-dropped findings. Both mechanisms are complementary: memory is adaptive (learned), filters are explicit (configured). |

---

## What this rule does not do

- Change the confidence threshold gate (`per-comment-confidence.md`) per-run.
- Replace the `review-outcomes` bus — that bus drives the `reviewer-lessons` promotion; this rule drives per-comment relevance suppression/reinforcement.
- Store raw comment bodies or author names — only the structural fingerprint and
  aggregated counts.
- Bypass the two-gate validation in `implement-suggestion` — relevance memories
  are advisory inputs to Phase 3 classification only.
- Auto-edit the review config (`.github/review.yaml`) — promotion is always surfaced as a suggestion, never
  applied without the user confirming.
