# Outcome Emit (Phase 7, and per `--watch` iteration)

Run after the Phase 7 report and the lessons write, once per processed comment.
Under `--watch`, run it at the end of every iteration for that iteration's comments, so a `reverted-after-ci` verdict is captured in the iteration where CI went red.
If LoreKit's `memory.*` tools are not connected, both writes are silent no-ops; the apply flow is unaffected.

Two separate, parallel writes per processed comment:

1. **`review-outcomes` bus** — one fingerprinted outcome record (tag `loop::review-outcomes`).
   Consumed only at promotion time by [`agents/shared/rules/outcome-learning.md`](../../../../agents/shared/rules/outcome-learning.md); schema in [`review-outcomes.md`](../../../../agents/shared/rules/review-outcomes.md).
2. **`reviewer-comment-relevance` memory** — one relevance signal (tag `loop::reviewer-comment-relevance`).
   Consumed by `pr-reviewer` at the start of every review run to suppress recurring noise and reinforce reliably-resolved patterns.
   Record schema and scope rules: [`agents/shared/rules/comment-relevance-memory.md § Write`](../../../../agents/shared/rules/comment-relevance-memory.md).

Reuse the per-comment `/critical` + `/confidence` result already in context — do not recompute.
Derive `verdict` / `relevance` from the Phase 4 decision:

| Phase 4 outcome | `verdict` (review-outcomes) | `relevance` (comment-relevance) | `resolution_method` |
| --- | --- | --- | --- |
| Gate cleared, patch landed | `applied` | `relevant` | `fixed` |
| `/critical` Must-fix raised OR `/confidence` below threshold | `rejected-at-validation` | `not-relevant` | `wont-fix` |
| Gate cleared but scoped out / deferred | `deferred` | `weak-not-relevant` | `ignored-at-merge` |
| Patch landed then reverted after CI failure | `reverted-after-ci` | `not-relevant` | `wont-fix` |

For `applied` verdicts, check the thread for the author's explicit decline (`won't fix`, `by design`, `intentional`, `nwf`, `n/a`, 👎 reaction):

```bash
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq ".[] | select(.in_reply_to_id == $COMMENT_ID) | .body" \
| grep -iE "(won.?t fix|wont fix|by design|intentional|nwf|not going to|n/a)"
```

If a decline phrase is found, override `relevance: not-relevant`, `resolution_method: wont-fix`.

Infer `source` from the comment author login per the heuristic in [`review-outcomes.md`](../../../../agents/shared/rules/review-outcomes.md).

```
# Write 1 — review-outcomes bus. Append-only, non-blocking.
memory.write { scope: "<global | repo::{owner}/{repo}>", key: "review-outcomes::<fingerprint-slug>", value: "<outcome record>", tags: ["loop::review-outcomes", "source::<verdict>"], source_agent: "implement-suggestion", trigger: "outcome-emit" }

# Write 2 — comment-relevance memory. Deduplicate first; UPDATE seen_count if exists, ADD otherwise.
# Scope: almost always repo::{owner}/{repo}; global only for universal patterns.
memory.search { q: "<fingerprint slug>", scopes: ["repo::{owner}/{repo}", "global"], limit: 5 }
# The key is EXACTLY `<category>:<claim-gist>` — never a pr#, comment id, SHA, or file:line.
# A coordinate key is unique per occurrence, so seen_count never accumulates and the signal
# is inert. Put coordinates in the record's `examples` field. Self-check: comment-relevance-memory.md § Key format.
memory.write { scope: "repo::{owner}/{repo}", key: "reviewer-comment-relevance::<category>:<claim-gist>", value: "<relevance record>", tags: ["loop::reviewer-comment-relevance", "source::<resolution_method>"], source_agent: "implement-suggestion", trigger: "outcome-emit" }
```

LoreKit owns storage server-side and dedups on write.
The `reviewer-comment-relevance` bucket has a 60-day default TTL, refreshed on each sighting.
The `review-outcomes` bucket has a 30-day volatile TTL.

Both writes are append-only and non-blocking — they never gate or delay the Phase 7 report.
