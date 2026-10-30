---
title: pr-reviewer — run modes and prior-run detection (Steps 0.7 and 0.8)
impact: HIGH
tags:
  - pr-reviewer
  - state-record
  - incremental
---

# pr-reviewer — run modes and prior-run detection (Steps 0.7 and 0.8)

**Read at Step 0.7 by every run** (under `--isolated`, only *Run modes* and the first paragraph of Step 0.7). Owns the run-mode table, the PR-state record, the GitHub fallback rung, the run-mode bindings, the first-run bindings, and the Step 0.8 zero-delta fast path. Rationale: [`../references/agent-body-rationale.md`](../references/agent-body-rationale.md).

## Contents

- [Run modes](#run-modes)
- [Step 0.7: Prior run detection](#step-07-prior-run-detection)
  - [The PR-state record](#the-pr-state-record)
  - [Read the record](#read-the-record)
  - [The GitHub fallback rung — baseline only](#the-github-fallback-rung--baseline-only)
  - [Bind the run-mode inputs](#bind-the-run-mode-inputs)
  - [First run](#first-run)
  - [What no longer happens here](#what-no-longer-happens-here)
- [Step 0.8: Fast zero-delta pre-check (before the expensive fetch pipeline)](#step-08-fast-zero-delta-pre-check-before-the-expensive-fetch-pipeline)

---

## Run modes

Two axes, bound at different steps and reported separately:

| Axis | Values | Bound at | What it decides |
|---|---|---|---|
| **Run mode** | `full` · `incremental` · `incremental-quick` · *(zero-delta)* | Step 0.7, fast-pathed at 0.8, refined at 1.2b | **What is reviewed** — the full PR diff, or the delta since the last reviewed SHA. |
| **Depth tier** | `deep` · `standard` · `quick` | Step 1.2b ([`depth-routing.md`](./depth-routing.md)) | **How hard it is looked at** — which lenses run, which finders run, how many escalation traces, whether a Tier-2 receipt is mandatory. |

They correspond one-to-one on the happy path (`full`↔`deep`, `incremental`↔`standard`,
`incremental-quick`↔`quick`) and the renderer rejects a report where they disagree, except a size-scaled first run ([`depth-routing.md` § Size scaling](./depth-routing.md#size-scaling)) — two axes, not
one, because **scope and depth are independently wrong**: a 15-line mutex change is a small scope
that needs deep looking, and a 400-line generated-file refresh is a large scope that needs almost
none. Phase C routes on what the change *is*, not only on how big it is — see
[`depth-routing.md`](./depth-routing.md) for the five inputs and the
first-match-wins table. A third fact is orthogonal to both: `DEPTH_CAPABILITY` (Step 1.1b) is what
the *runner* could give this run — a checkout, a tarball, or nothing but the diff — which caps the
tier (a `diff-only` run can never be `deep`) and is declared in the report, since a shallow review
that renders like a deep one is the failure Phases A and C exist to fix.

The run modes themselves, chosen automatically in Step 0.7 (fast-pathed at Step 0.8 for a re-review
whose `HEAD_SHA` has not moved):

| Mode | When | What runs |
|---|---|---|
| `full` | No prior review found, OR `--full` passed, OR delta > 100 lines, OR new files in delta, OR high-stakes paths touched (classifier-owned list + repo `high_stakes_paths:`), OR **a propagation shape in the delta** (governing doc + restatements — Step 1.2b), OR **cumulative delta since the last full review > `FULL_REFRESH_DELTA` (150) lines**, OR **≥ `FULL_REFRESH_RUNS` (3) incremental reviews since the last full review**, OR **no prior full review is recorded** (including every run on the Step 0.7 fallback rung, which recovers a baseline but no history) | Tier `deep`: every finder, holistic broad + targeted escalation (budget-capped), optimality. Gate 4 and inline review scan the full PR diff. |
| `incremental` | Prior review found, delta 11–100 lines, no new files, no high-stakes paths, no propagation shape | Tier `standard`: every finder, holistic broad pass (2.4) skipped; **targeted escalation (2.4b) runs on the delta findings (cap 3) when the delta carries a risky content shape** (`ESCALATE_IN_INCREMENTAL`, Step 1.2b). measurability (2.4e) runs on the delta files. Inline review and Gate 4 scan the delta diff only. All other gates run on the full PR state. |
| `incremental-quick` | Prior review found, delta ≤ 10 lines, no new files, no high-stakes paths, no propagation shape | Tier `quick`: correctness, quality, and description finders only. Holistic broad pass (2.4) and the consumer-impact and dependency finders skipped; measurability (2.4e) runs on the delta files; **targeted escalation (2.4b) still runs (cap 3) when the delta carries a risky content shape**. Inline review and Gate 4 scan the delta diff only. All other gates run on the full PR state. |
| *(zero-delta)* | Prior review found, zero lines changed, no new files | Gate checks only (no inline review). Announced and handled as a special case of `incremental-quick`. Detected at Step 0.8 (identical `HEAD_SHA`, no fetch pipeline spent) or, on a rebase/amend that changes `HEAD_SHA` without an authored delta, at Step 1.2b. |

Findings carried forward from a prior run's `Additional findings` list are re-admitted in **every** mode, including the incremental ones — they were already found on the full diff, so scanning only the delta does not lose them (`prior-comment-awareness.md § Carry-forward of deferred findings`).

Gate checks (Step 1.8) always run against the full PR state in every mode — CI, prior review feedback, and description adequacy apply to the whole PR regardless of how small the latest commit is. Gate 4 (self-review signals) is the only gate that scans the delta diff in incremental modes.

`--full` forces `full` mode regardless of delta size.

## Step 0.7: Prior run detection

**Under `--isolated`, skip the LoreKit state-record read entirely.** Bind `PRIOR_RUN=none`,
`IS_RE_REVIEW=false`, and `RUN_MODE=full` unconditionally, and do not fall back to the sticky
comment's footer SHA either — an isolated run's whole point is first-run semantics on **every**
invocation, so its baseline never depends on what a previous run in the same series left behind.
See [`rules/pipeline.md`](./pipeline.md#--isolated).

This step answers two questions that used to be answered by the same object, and separating
them is most of what this step now is:

| Question | Source |
| --- | --- |
| **What happened on the previous run?** — baseline SHA, run-mode history, open threads, deferred findings, anchorless diagnostics | The **PR-state record** in LoreKit (below) |
| **Where does the report live?** | The **sticky comment** on GitHub, located by its marker (Step 4a) |

State once rode inside the sticky's body and was re-parsed from rendered Markdown, so a heading
rename lost the baseline; it now lives in a store built for state.

### The PR-state record

One record per PR, overwritten in place on every run (Step 4c). It is a **state record**, not
a lesson — parsed and branched on rather than weighed as advice — so it follows the state-record
conventions in the `lorekit-setup` skill (`rules/ci-state-records.md`), not the lessons grammar:

```bash
# Scope: the head branch, so the record decays with the branch it describes and never
# competes with lessons in the `repo::` scope an agent's SessionStart injection reads.
# Key: one per PR, overwritten — never one per run (the cardinality rule).
STATE_SCOPE="branch::${RESOLVED_REPO}::${HEAD_REF}"
STATE_KEY="ci-state::pr-review-${PR_NUMBER}"
```

| Property | Value | Why |
| --- | --- | --- |
| Tag | `ci::pr-review-state` | The state-record namespace. Deliberately **not** `loop::…`, which is the lessons grammar and would make this record readable as advice. |
| Kind / host | `kind: bus`, `host: reviewer` | Set explicitly: `kind`/`host` are inferred only from `loop::` tags, so a `ci::` tag leaves them NULL. Buys `lorekit list --kind bus --host reviewer`. |
| Scope | `branch::{owner}/{repo}::{head}` | Per-PR state that should disappear with the branch. |
| TTL | **7 days**, passed on every write | The countdown restarts on each write, so it measures how long *this PR* has been quiet, not how old the record is. A merged or abandoned PR self-cleans. |

The value is one JSON object with a version stamp:

```json
{
  "v": 1,
  "commit": "c3ceb87",
  "data": {
    "pr": 123,
    "sticky_comment_id": 2145678901,
    "sticky_url": "https://github.com/o/r/pull/123#issuecomment-2145678901",
    "bot_login": "claude[bot]",
    "runs": [{ "sha": "70cf147", "mode": "full", "verdict": "FAIL", "at": "2026-08-15T09:12:00Z", "open": 4, "blocking": 1 }],
    "open_thread_ids": [123, 456],
    "carried_findings": [
      { "path": "src/api/client.ts", "line": 214, "prefix": "issue", "body": "retry loop re-sends the request body after a 413.", "confidence": 92, "first_seen_sha": "70cf147" }
    ],
    "diagnostics": {
      "gate_rows": [{ "gate": "Documentation", "status": "❌", "details": "no docs for the new retry policy" }],
      "standards": { "ran": true, "docs_scanned": 4, "finding_count": 1 },
      "skipped_files": [],
      "partial": false
    }
  }
}
```

| Field | Feeds | Notes |
| --- | --- | --- |
| `v` | the unknown-version fallback | Required. An unrecognised value takes the **first-run path and says so** — it never guesses at a shape. |
| `commit` | provenance | The `HEAD_SHA` the writing run reviewed; same value as `runs[-1].sha`. |
| `sticky_comment_id` · `sticky_url` | Step 4a | A **cache, never an authority** — Step 4a re-scans by marker when absent or the `PATCH` 404s (a human can delete a comment any time). |
| `bot_login` | the identity ladder | This agent's own login, read off its own sticky — rung 2 of `prior-comment-awareness.md § fetch existing PR comment state`, keeping dedup and Step 2.9c working when `/user` 401s. |
| `runs[]` | `PRIOR_SHA`, `LAST_FULL_SHA`, `INCR_RUNS_SINCE_FULL`, Step 5, the report's `Progress` row | Oldest first, **capped at 50** — drop from the front. `open`/`blocking` are finalize's `round` (Step 4c). Nothing branches on `verdict`. |
| `open_thread_ids` | `RESOLVED_SINCE_PRIOR` | Gate 3's open set after the writing run's Step 2.9c. **Top-level, not per-run** — current state, not history. |
| `carried_findings[]` | `CARRIED_FINDINGS` | The deferred findings from Step 2.9b, **structured**. Capped at 50. |
| `diagnostics` | `PRIOR_DIAGNOSTICS` | The anchorless outputs, structured. A legacy `optimality_cards` field is dropped on the next write. |

**The record is bounded by construction**, so there is no truncation ladder: 50 runs at ~110
bytes, 50 findings at ~200 bytes, and 2 cards at ~1 KB sit an order of magnitude under the 64 KB
value cap. Enforce the three caps on write (Step 4c).

### Read the record

Read the record in **every** mode, including `--full` — a prior run's deferred and anchorless
findings are not re-derivable from the diff, and `--full` changes only `RUN_MODE = "full"` (which is
what makes Step 1.2b's delta triage skip, since it keys on the mode, not the baseline). **Do not
blank `PRIOR_SHA` under `--full`**: triage already skips on the mode alone, so blanking it only costs
the `(carried from …)` suffix its value — the ledger era needed a second variable
(`PRIOR_REVIEW_SHA`) to compensate, which this avoids.

```text
# Issue as a real mcp__lorekit__memory_read tool call.
mcp__lorekit__memory_read: scope="<STATE_SCOPE>" key="<STATE_KEY>"
```

**A miss is not an error** — the first run on any PR misses, and that is the defined first-run path.
Distinguish three outcomes:

| Outcome | `STATE_STATUS` | Then |
| --- | --- | --- |
| A record came back and its `v` is `1` | `read` | Bind everything from `data` (below). |
| No such record, or one past its expiry | `miss` | First run, or an expired/purged record. Take the fallback rung below. |
| The tool threw, or `v` is unrecognised | `unavailable` | Take the fallback rung below, and say which of the two happened. |

Retry a thrown error up to **2 more times** (3 attempts total) with a short backoff before settling
on `unavailable` — a single transient throw is a timeout far more often than an outage — except a
hard "tool unavailable" error (`No such tool available: mcp__lorekit__memory_read`, meaning the tool
is ungranted or the LoreKit MCP server never connected this session), where there is nothing to wait
for. This read shares Step 1.0's backend, so record the outcome once and let Step 1.0 reuse it rather
than re-probing. An unrecognised `v` is never parsed — fall back and log it, since a shape this run
does not understand is more dangerous read than ignored.

**An expired record is a miss, not a baseline.** LoreKit expires a record by marking it, not
deleting it on a schedule, and with no merge-purge event that is the *normal* end state of every
dormant PR — so a stale record is worse than a missing one, since the first-run path is a defined,
exercised code path and acting on seven-day-old carried findings is neither. Take the fallback rung
and log it distinctly — `PR-state record expired at <date> — treating as absent.`

### The GitHub fallback rung — baseline only

On `miss` or `unavailable`, one GitHub call recovers the one piece of state whose absence is
expensive — the delta baseline — so an environment with no LoreKit still gets incremental
reviews instead of paying a full pass on every push:

```bash
# Matched by MARKER ONLY, never by author login — `ME` is unavailable on some access paths (Step
# 0.5), where a login-keyed filter silently matches nothing and every run creates a fresh report.
# `last` is defensive — there must only ever be one.
if STICKY=$(gh api repos/$RESOLVED_REPO/issues/$PR_NUMBER/comments --paginate \
  --jq '[.[] | select((.body // "") | contains("<!-- PR_REVIEWER_REPORT -->")) ] | last // empty'); then
  STICKY_READ_FAILED=false
else
  STICKY_READ_FAILED=true
  STICKY=""
fi
# Normalise the empty read to a JSON literal ONCE — `null` needs no escaping, `//` handles it,
# and there is no brace for a retype to drop (an inline `"${STICKY:-{\}}"` once did, and cost
# four `jq: parse error` failures in a row on the one rung that recovers the delta baseline).
[ -n "$STICKY" ] || STICKY=null

STICKY_COMMENT_ID=$(jq -r '.id // empty' <<< "$STICKY")
STICKY_URL=$(jq -r '.html_url // empty' <<< "$STICKY")
PRIOR_REPORT_AUTHOR=$(jq -r '.user.login // empty' <<< "$STICKY")

# The reviewed SHA from the body's footer line, anchored on `commit \`<sha>\`` alone so it
# matches all three run-mode forms (full/incremental/zero-delta) — anchoring on "review for
# commit" instead once missed two of the three.
PRIOR_SHA=$(sed -n 's/.*commit `\([0-9a-f]\{7,40\}\)`.*/\1/p' \
  <<< "$(jq -r '.body // ""' <<< "$STICKY")" | tail -1)
```

**A failed read is not an empty read** — the two are indistinguishable in the output (`--jq`
reduces a successful read to a single object or an empty string, never an array), so the **exit
status is the only signal**, which is why the call is wrapped in `if` rather than inspected
afterwards. Retry once on failure; if it still fails, keep `STICKY_READ_FAILED=true` and carry it
into Step 4a, which takes the no-duplicate path.

**Recovered:** `PRIOR_SHA` (⇒ `incremental` still available), `STICKY_COMMENT_ID` / `STICKY_URL`
(⇒ the report updates in place, not duplicated), `PRIOR_REPORT_AUTHOR` (⇒ dedup and Step 2.9c still
work), and `IS_RE_REVIEW = true`. **Not recovered:** `CARRIED_FINDINGS`, `PRIOR_DIAGNOSTICS`,
`open_thread_ids`, and the run-mode history — they stay empty/absent, and an empty `LAST_FULL_SHA`
is precisely what makes Step 1.2b promote the run to `full`, the documented safe direction.

Both halves are announced, since a run that silently dropped carry-forward looks identical to one
that had nothing to carry: on `miss` with a sticky found, `PR-state record absent — baseline
\`<PRIOR_SHA_SHORT>\` recovered from the sticky; running full, with no carry-forward.`; on
`unavailable`, the same with `PR-state record unreadable (<reason>)`; on `miss` with no sticky and
`STICKY_READ_FAILED == false`, `No prior review found — running full review.`; and on `miss` with
no sticky and `STICKY_READ_FAILED == true`, `Prior-run state unknown — neither the PR-state record
nor the PR's comments could be read; running full, with no carry-forward.`

This is the **only** GitHub fetch prior-run detection makes, and it runs only when the record is
unusable. The legacy rungs it replaces — a `pulls/{n}/reviews` scan for a pre-sticky report body,
and a second scan for a `<!-- PR_REVIEWER_POINTER -->` review carrying a truncated ledger — are
both gone: neither can recover anything the record does not already hold, and the degraded path no
longer needs to carry state, since a run that cannot write the sticky still writes its record (Step
4c). A PR whose only report predates the sticky is treated as a first run.

### Bind the run-mode inputs

On `STATE_STATUS == "read"`, bind from `data` — no parsing, no fallback ladders:

```bash
STATE_STATUS="read"   # the full record was read; Step 0.8's fast path keys on this
PRIOR_SHA=$(jq -r '.data.runs | last.sha // ""'        <<< "$PR_STATE")
PRIOR_VERDICT=$(jq -r '.data.runs | last.verdict // ""' <<< "$PR_STATE")
PRIOR_OPEN_THREAD_IDS=$(jq -c '.data.open_thread_ids // []' <<< "$PR_STATE")
STICKY_COMMENT_ID=$(jq -r '.data.sticky_comment_id // empty' <<< "$PR_STATE")
STICKY_URL=$(jq -r '.data.sticky_url // empty'          <<< "$PR_STATE")
PRIOR_REPORT_AUTHOR=$(jq -r '.data.bot_login // empty'  <<< "$PR_STATE")

# head sha of the most recent full-mode run; "" when none is recorded.
LAST_FULL_SHA=$(jq -r '[.data.runs[] | select(.mode == "full")] | last.sha // ""' <<< "$PR_STATE")

# incremental runs since that full pass (all of them when no full pass is recorded).
INCR_RUNS_SINCE_FULL=$(jq -r '
  .data.runs as $all
  | ([range(0; ($all | length)) | select($all[.].mode == "full")] | last) as $i
  | if $i == null then ($all | length) else (($all | length) - 1 - $i) end' <<< "$PR_STATE")
```

Save `$PR_STATE` to a file and pass it as `prepare-review.mjs --state <file>`, or it routes a re-review as a first run.

`PRIOR_SHA` is both the delta-triage baseline and the provenance of everything carried — one
variable for both, now bound in every mode. `PRIOR_SHA_SHORT` (`${PRIOR_SHA:0:7}`) is what the
`(carried from …)` suffix renders in every mode, so it can no longer degrade to `(carried from )`;
on the rare hand-edited record with no `runs[]` at all, render `(carried from an unknown revision)`
rather than an empty parenthetical.

`CARRIED_FINDINGS` = `data.carried_findings`, re-admitted per `prior-comment-awareness.md § Carry-
forward of deferred findings`, in **every** mode including `--full`. `PRIOR_DIAGNOSTICS` =
`data.diagnostics`, re-admitted per `prior-comment-awareness.md § Carry-forward of anchorless
findings` at Step 2.5c, also every mode, as **input context, never a verdict shortcut** — Step 1.8
still evaluates every gate against the current PR state, and a carried entry survives into this
run's body only when Step 1.8 / 2.4d confirm it or the owning step was skipped this run.
`RUN_MODE = "incremental"`, subject to upgrade in Step 1.2b, unless `--full` was passed (stays
`full`, Step 1.2b skips on the mode alone). `IS_RE_REVIEW = true`.

Announce: `PR-state record read (<R> run(s), baseline \`<PRIOR_SHA_SHORT>\`) — <C> deferred finding(s), <G> open gate finding(s) carried forward.`

### First run

On `STATE_STATUS == "miss"` with no sticky found, bind the first-run values explicitly — each one
has a reader that would otherwise assert something this run could not check:

```bash
RUN_MODE="full";        PRIOR_SHA="";          PRIOR_VERDICT=""
PRIOR_OPEN_THREAD_IDS="[]"; LAST_FULL_SHA="";  INCR_RUNS_SINCE_FULL=0
CARRIED_FINDINGS="[]";  PRIOR_DIAGNOSTICS="{}"
STICKY_COMMENT_ID="";   STICKY_URL="";         PRIOR_REPORT_AUTHOR=""
IS_RE_REVIEW=false;     RESOLVED_SINCE_PRIOR=0
```

`RESOLVED_SINCE_PRIOR` is otherwise assigned only in Step 2.9c, skipped on a first pass — yet three
render sites read it unconditionally, so `0` suppresses the counter rather than leaving it unbound
when Gate 3 is already ⚠️/❌ from other bots' open threads. **`IS_RE_REVIEW` is the "has this PR been
reviewed before" flag** — true whenever a record was read **or** a sticky was found, so the fallback
rung does not cost the run its thread reconciliation (keying it off `CARRIED_FINDINGS` or
`PRIOR_DIAGNOSTICS` instead would skip reconciliation on exactly the fallback path, where nothing is
carried but the PR has certainly been reviewed before).

`PRIOR_SHA`, `RUN_MODE`, `PRIOR_DIAGNOSTICS`, `LAST_FULL_SHA` and `INCR_RUNS_SINCE_FULL` are bound
on **every** path above, including `--full` (where Step 1.2b does not read the last two) — an unset
value is not the same as a bound empty one. `ME` is **not** read in this step: the sticky is matched
on its marker alone, so prior-run detection keeps working where `/user` is unreachable. Do not
reintroduce a `.user.login` filter here, and never call `gh api user` anywhere in the run — reading
`.user.login` **off** a found object is different and required (see `PRIOR_REPORT_AUTHOR`, which
Step 1.0 consumes).

### What no longer happens here

Retired deliberately, not lost: the `<!-- PR_REVIEWER_LEDGER … -->` body block and `DEGRADED_LEDGER`'s reduction ladder (the record holds the history, written whatever the sticky does); the `pulls/{n}/reviews` legacy-report/pointer-ledger fetches and the `PRIOR_REVIEW` / `PRIOR_BODY` / `LEDGER_SOURCE` / `POINTER_LEDGER_BODY` names; `PRIOR_REVIEW_SHA` (the record supplies the SHA in every mode); `PRIOR_BLOCKING_FINGERPRINTS`; and `PRIOR_RUN_STATE_UNKNOWN` (`STATE_STATUS` + `STICKY_READ_FAILED` say it).

## Step 0.8: Fast zero-delta pre-check (before the expensive fetch pipeline)

Step 1.2b's delta triage already has a zero-delta short-circuit, but it fires only after Step 1.0's
memory fan-out, Step 1.1's diff/file fetch, and Phase A/B's workspace checkout and impact graph have
already run and been paid for — a multi-minute cost an unmoved-branch re-review (a `/review`
comment, a scheduled re-check, another bot's comment) pays for nothing. This step catches that case
**before** any of it starts, using only values Step 0.5 and Step 0.7 already bound:

```bash
# EARLY_HEAD_SHA: Step 0.5's PR_META, zero extra cost. PRIOR_SHA: Step 0.7. FLAG_FULL: Step 0 —
# `--full` always forces `full` mode, and this fast path must not silently override that.
# Compare on a 7-char prefix: the GitHub fallback rung's PRIOR_SHA comes from the sticky footer
# (comment-spine.mjs enforces exactly 7 chars) while the PR-state record's may be the full
# 40-char headRefOid, and EARLY_HEAD_SHA is always the full 40 chars — a raw `==` would leave the
# fast path permanently dead against the footer source. STATE_STATUS == "read" restricts the fast
# path to the full-record path: the fallback rung recovers PRIOR_SHA but not PRIOR_DIAGNOSTICS, so
# a fast-path run there would carry Gates 4/6 forward from nothing and must fall through to Step
# 1.2b instead, where an empty LAST_FULL_SHA promotes it to full.
if [[ "$FLAG_FULL" != true && "$STATE_STATUS" == "read" && -n "$PRIOR_SHA" && "${EARLY_HEAD_SHA:0:7}" == "${PRIOR_SHA:0:7}" ]]; then
  FAST_ZERO_DELTA=true
else
  FAST_ZERO_DELTA=false
fi
```

An identical commit has an empty diff against itself by construction, so no `compare` call proves
it — unlike the rebase/amend case Step 1.2b's blob-diff route still exists for (below). An empty
`PRIOR_SHA`, `FLAG_FULL == true`, or `STATE_STATUS != read` all proceed to Step 1 unchanged, for the
reasons in the comment above.

**On `FAST_ZERO_DELTA == true`:** set `RUN_MODE = "incremental-quick"`, `REVIEW_DIFF = ""`,
`HEAD_SHA = "$EARLY_HEAD_SHA"`, `DELTA_SOURCE = "identical HEAD_SHA (Step 0.8 fast path)"`, and
announce `HEAD_SHA unchanged since the last review (\`<HEAD_SHA short>\`) — skipping the memory
fan-out, workspace checkout, and impact graph; running gate checks only.` **Skip Step 1.0's memory
fan-out and Step 1.1's Phase A/B entirely** — nothing to operate on with an empty diff — and fetch
only what the gates still need:

- Prior comment state for Gate 3 **and** Step 2.9c: run `prior-comment-awareness.md § fetch
  existing PR comment state` **in full**, standalone (both the `pulls/{n}/comments` REST fetch —
  the source of `OPEN_BOT_COMMENTS[]`'s `url`/`ask`/`is_bot` and of `BOT_COMMENTS` — and the
  `reviewThreads { id isResolved }` state), binding `BOT_COMMENTS`, `RESOLVED_THREAD_IDS`,
  `COMMENT_TO_THREAD`, `OPEN_BOT_COMMENTS[]` exactly as that rule specifies — the `review-loop`
  convergence case (threads resolved/declined, re-run on an unmoved head) is precisely a fast-path
  run where thread reconciliation must still fire.
- CI status (`gh pr checks $PR_NUMBER $GH_REPO_FLAG`) for Gate 2's report line.
- PR title/body are already in `PR_META` (Step 0.5). Gates 1 and 5 (description-vs-code,
  documentation adequacy) both grade this text, so both re-compare it against
  `PRIOR_DIAGNOSTICS.gate_rows`'s carried verdict — an edited description needs no new commit, and
  an unchanged one carries both prior gate rows forward verbatim (`⏭️`, Step 1.8's table).
- Gates 4 and 6 (self-review signals, code review) carry forward unconditionally from
  `PRIOR_DIAGNOSTICS` — the code they graded has not moved, and neither reads the description.
- Relevance and lessons memory are **not** fetched: nothing for a lesson to calibrate against with
  no diff and no new findings possible. Report `Memories — skipped (zero-delta fast path)`,
  distinct from `not connected`, so a deliberate skip is never misread as an outage.
- Bind `DEPTH_TIER` per `depth-routing.md` — cheap, local, and every downstream template reads it,
  even though its impact-graph inputs (`BLAST_RADIUS`, `semver_delta`, `TRAFFIC_BAND`) are unset
  with Phase B skipped; benign, since with no inline review the tier only picks report templates.

Proceed directly to Step 1.8 (gate checks), then **Step 2.9c** (thread reconciliation runs on this
path — see its preamble), then Step 3 (no inline findings). Step 1.0, Step 1.1's Phase A/B, and
Step 2 never run.

**On `FAST_ZERO_DELTA == false`,** proceed to Step 1 exactly as before. Step 1.2b's own zero-delta
short-circuit remains as a second, later check for the one shape this fast path cannot see: a
**rebase or amend that reintroduces the same tree at a new SHA** (`HEAD_SHA` changes but the
authored delta is still zero once the blob-diff route resolves it) — this step only removes the
cost for the far more common unmoved-branch case, not a replacement for that logic.
