---
title: pr-reviewer — the run's LoreKit writes (Steps 4c and 4d)
impact: HIGH
tags:
  - pr-reviewer
  - posting
  - memory
  - write-path
---

# pr-reviewer — the run's LoreKit writes (Steps 4c and 4d)

`finalize.mjs` queues no LoreKit op, so these two writes are yours on every non-`--dry-run` run, after `execute-write-plan.mjs` returns.

## 4c. Record the run state

The last write of the run, and **unconditional**: it runs whatever 4a and 4b did, including on a
run that posted no review, could not write the sticky, or was refused the write by caller policy.
Skipping it costs the *next* run its delta.

**The one exception is `--dry-run`**, which writes 4a/4b/4c to scratch
(`$(scratchRoot())/<run-id>/state.json`, mirroring the shape below) and issues no
`mcp__lorekit__memory_write` call at all — the A/B harness and the shadow run depend on nothing
accumulating between repeat runs of the same PR.

Build the record from the values this run already holds and write it to the scope and key bound in
Step 0.7:

```text
# Issue as a real mcp__lorekit__memory_write tool call.
mcp__lorekit__memory_write:
  scope    = "<STATE_SCOPE>"                       # branch::{owner}/{repo}::{head}
  key      = "<STATE_KEY>"                         # ci-state::pr-review-<n>
  value    = "<the JSON object below, serialised>"
  tags     = ["ci::pr-review-state"]
  kind     = "bus"
  host     = "reviewer"
  ttl_days = 7
  origin_repo = "<RESOLVED_REPO>"
  origin_pr   = <PR_NUMBER>
  origin_commit = "<HEAD_SHA>"
  origin_branch = "<HEAD_REF>"
  cited    = <finalize-result.json's citedRefs, verbatim>   # jq -c '.citedRefs' <out-dir>/finalize-result.json
```

**`cited` credits the memories that shaped this review.**
LoreKit records each ref as a citation of that memory by this PR's state record, and the memory's detail sheet shows it as `Cited · credited N×`.
Pass `finalize.mjs`'s `citedRefs` exactly as written — it holds `scope::key` for every `memory.lessons_used[]` entry and every relevance rule that acted this run, and nothing else.
Never build the list by hand, never add a memory you only read, and pass `[]` when it is empty.
A ref LoreKit cannot resolve is dropped silently and never fails the write.

```text
# correct: the refs finalize computed from judgments.memory
cited = ["repo::acme/widget::hotspot::src/api/client.ts", "repo::acme/widget::reviewer-comment-relevance::rule::correctness:nil-deref:-@src/jobs/sync.ts"]

# incorrect: every memory the run loaded — a citation means "this shaped the review", not "this was in context"
cited = ["repo::acme/widget::hotspot::src/api/client.ts", "global::reviewer-lessons::prefer-guard-clauses", "repo::acme/widget::knowledge::retryRequest@src/api/client.ts"]
```

```bash
# Same scope+key is an UPDATE, so this is one row per PR forever — never one per run.
NEW_STATE=$(jq -c \
  --arg sha "$HEAD_SHA" --arg mode "$RUN_MODE" --arg verdict "$VERDICT" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg sticky_url "$STICKY_URL" --arg login "${PRIOR_REPORT_AUTHOR:-$ME}" \
  --argjson pr "$PR_NUMBER" \
  --argjson sticky_id "${STICKY_COMMENT_ID:-null}" \
  --argjson ids "$OPEN_BOT_COMMENT_IDS_JSON" \
  --argjson carried "$CARRIED_FINDINGS_JSON" \
  --argjson diag "$DIAGNOSTICS_JSON" \
  --argjson round "$(jq -c --arg sha "${HEAD_SHA:0:7}" \
                       'if .payload.RUN.sha == $sha then (.round // {open: null, blocking: null}) else {open: null, blocking: null} end' \
                       /tmp/finalize/finalize-result.json 2>/dev/null || echo '{"open": null, "blocking": null}')" '
  {v: 1, commit: $sha, data: {
     pr: $pr,
     sticky_comment_id: $sticky_id,
     sticky_url: $sticky_url,
     bot_login: $login,
     runs: (((.data.runs // []) + [{sha: $sha, mode: $mode, verdict: $verdict, at: $at,
                                     open: $round.open, blocking: $round.blocking}]) | .[-50:]),
     open_thread_ids: $ids,
     carried_findings: ($carried | .[:50]),
     diagnostics: ($diag | del(.optimality_cards))
  }}' <<< "${PR_STATE:-{\}}")
```

The two caps (`runs` 50, `carried_findings` 50) apply **on every write**,
even when the input is already short — a cap that only fires when someone remembers it is not a cap.

`CARRIED_FINDINGS_JSON` / `DIAGNOSTICS_JSON` are **this run's** outputs, not Step 0.7's:

| Field | Source | Note |
| --- | --- | --- |
| `runs[-1].open` · `runs[-1].blocking` | `finalize-result.json`'s `round` | The review threads this run leaves open, and the blocking subset — the next run's `Progress` row. Copied, never recounted: finalize computes it with the report's own formula. `null` when finalize did not run, or when the file's `payload.RUN.sha` is not this run's head (a result left by an earlier run); the next run then skips this point. |
| `carried_findings` | Step 2.9b's `Additional findings`, plus any surviving Step 0.7 entry | Posted-inline or resolved findings are dropped — they'd come back as duplicates. |
| `diagnostics.gate_rows` | Step 1.8's ⚠️/❌ rows | `✅` rows are not recorded. |
| `diagnostics.standards` | Step 2.4d's run-state | `{ran, docs_scanned, finding_count}`. |
| `diagnostics.measurability` | Step 2.4e's run-state | `{ran, paths_classified, missing, unlinked}` — a `missing` finding itself carries via `carried_findings`, not here. |
| `diagnostics.skipped_files` · `diagnostics.partial` | Step 1.4 / the budget stop | Context-only for the next run, never re-rendered. |

Four rules: (1) **never on the critical path** — a failed write is logged with its error and the run
continues; Step 5 reports `PR-state record NOT written (<error>) — the next run will re-review in
full.` (2) **no secrets** — every field is built from an explicit allow-list (PR number, sha, mode,
verdict, login, comment ids, findings this run already published); never serialise an environment,
error body, or raw tool response. (3) **`ttl_days` on every write** — see below; omitting it
inherits whatever default the repo config sets for lessons, a number nobody chose for this record.
(4) **last write wins, no compare-and-swap** — two concurrent runs clobber each other's record; the
loser's state is one run stale, which widens the next delta (the safe direction), so this is
accepted rather than locked.

**The TTL is the cleanup mechanism, and needs nothing wired up.** `ttl_days: 7` on every write
recomputes `expires_at = now + 7d` each time, so the expiry measures how long this PR has been
quiet, not how old the record is; a merged, closed, or abandoned PR self-cleans in a week with no
integration, workflow, webhook, or cleanup pass — which matters, since most repositories have none
of those. A LoreKit-side GitHub-integration event on `pull_request: closed (merged)` could purge the
record at merge and would be a genuine improvement, but it is an **accelerant** on a mechanism that
already works, not the mechanism — it is not shipped, and every surface treats it as optional.

This agent does **not** purge, on either path: `mcp__lorekit__memory_delete` is deliberately absent
from its `tools:` grant, so a reviewer can never delete a memory as a side effect of reviewing.

## 4d. Record what this run learned about the code

The state record is about *this PR*. This step is about *this repository* — the half that outlives
the branch and reaches the next author who touches the same symbol.

Run the two writes in [`memory.md § Write — the two calls this agent makes
itself`](./memory.md#write--the-two-calls-this-agent-makes-itself): **knowledge**
for each symbol this run traced (deep tier only, cap 10) and **hotspot** for each file that carried
a confirmed finding, plus each file where Step 1.0's in-run signals recorded a `missed` (a human
caught something on a changed line this agent did not flag). Both are `mcp__lorekit__memory_write`
calls with `kind: "signal"`, `host: "reviewer"`, `ttl_days: 90` passed explicitly — a `ci::` tag
leaves both NULL and Step 1.0's read then cannot see what was written.

| Tier | What 4d writes |
| --- | --- |
| `deep` | knowledge + hotspot |
| `standard` · `quick` | **hotspot only** — a knowledge fact needs a traced symbol and a receipt, and neither tier produces one; writing an unverified fact is exactly the failure mode rule 1 of that section prevents. |

**Both writes take their `value` from `merge-memory-record.mjs`, run on one batch `memory_read` of
every key this step writes — never from the rule file's literals, and never from Step 1.2a's
summaries.** Same scope + key replaces the whole value, so a hotspot written as the template's
`confirmed: 1` resets a counter four PRs of history built. Rule 3 of that section is the procedure:
read every key in one `refs` call, run the script, write each `writes[]` value verbatim, and write
nothing for a key in `skipped[]`. A failed read means no 4d write this run.

Non-blocking, like 4c — a failed write is logged and the run continues. Report the counts in Step 5
(`Memory written: <K> knowledge, <H> hotspot, <S> skipped`), **including the zeroes**: a deep-tier run that wrote
0 knowledge records means either nothing was traced or the write is broken, and the count is the
only place those two separate.
