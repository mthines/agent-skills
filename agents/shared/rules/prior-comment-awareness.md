---
title: Prior-comment awareness — dedup against existing review history + anti-flip-flop
impact: HIGH
tags:
  - pr-reviewer
  - dedup
  - incremental
  - flip-flop
---

# Prior-comment awareness

A PR review rarely starts from a blank slate.
In an incremental review (a second pass after a push), a `--watch` loop (`/implement-suggestion --watch`), or any Self-Review re-run, the agent may produce findings it already produced — or worse, findings that *contradict* ones it produced or the author already resolved.

"Recommend X → later revert X → re-recommend X" is the single most-reported complaint about automated reviewers in the 2026 field studies.
Bugbot reads prior PR comments as context specifically to prevent this flip-flop.
This rule implements that same state-awareness.

---

## When this step runs

| Agent | When | Scope |
| --- | --- | --- |
| `pr-reviewer` (cross or self, PR exists) | **Default ON** — at the start of Step 1, before any finding is produced | All incremental and first-pass runs on an existing PR |

When a PR does not yet exist (branch-only self review without an open PR), skip this step entirely.

---

## Step: fetch existing PR comment state

Run once at Step 1, after Step 0.5 (authorship check) and before Step 1.1 (diff acquisition):

```bash
REPO=${PR_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
BOT_LOGIN=$(gh api user --jq .login)

# All existing review comments on this PR (all authors)
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq '.[] | {id, path, line, body, user_login: .user.login, in_reply_to_id}' \
  > /tmp/prior-comments.json

# Comments authored by this agent (bot login)
BOT_COMMENTS=$(jq --arg login "$BOT_LOGIN" '[.[] | select(.user_login == $login)]' /tmp/prior-comments.json)

# Resolved threads (those with a reply or a 👍 reaction on the bot's comment)
# Use the already-documented outcome-learning.md Step 2 pattern for resolution check
```

Store `BOT_COMMENTS` and `/tmp/prior-comments.json` for use in the dedup and anti-flip-flop checks below.

---

## Dedup against prior bot comments

A new proposed finding is a **duplicate** of a prior bot comment when:

| Condition | Action |
| --- | --- |
| Same `(path, line ± 2)` AND same Conventional-Comments prefix | **DROP** the new finding — it was already said |
| Same `(path, line ± 2)` AND different prefix | **Keep** the new finding — a different lens on the same line is additive |
| Same pattern / claim but on a different line (code moved) | **Keep** — the location changed; re-flagging is valid |

The `± 2` tolerance handles minor line-number drift from the author's subsequent commits.

Log dedup drops:

```text
[prior-comment] DROP src/foo.ts:42 — suggestion: already posted in prior review (comment #12345)
```

Count in the Quality Gate summary: `Prior-comment dedup drops: N`.

---

## Anti-flip-flop state

The flip-flop invariant: **the agent MUST NOT reverse a previously accepted or resolved suggestion.**

A suggestion is **accepted / resolved** when any of the following hold:

1. The commented line was subsequently changed in a commit after the comment was posted (outcome-learning signal c).
2. The PR thread for the comment is marked resolved.
3. The PR author replied "fixed", "done", "addressed", "resolved", or a similar acknowledgement.

Check each new proposed finding against prior accepted / resolved suggestions:

```bash
# Check if the bot previously suggested OPPOSITE of current new finding
# e.g., bot said "use Map here" (resolved) → now bot says "use Record here"
```

This is a semantic check, not a grep.
The agent must evaluate: "Does my new finding contradict a prior finding that was acted on?"

If yes → **DROP** the new finding unconditionally.
Log the drop:

```text
[anti-flip-flop] DROP src/foo.ts:55 — new suggestion contradicts resolved prior comment #12345 (previously suggested `Map`, author applied it; now re-suggesting `Record`)
```

This drop is NOT subject to override or confidence gate.
A contradiction with a resolved suggestion is dropped regardless of confidence score.
The finding may be surfaced in the terminal output for human review, but it is never posted.

---

## What "accepted / resolved" includes

| State | Counts as resolved |
| --- | --- |
| Author pushed a commit touching `(path, line ± 5)` after comment | Yes |
| Thread explicitly marked resolved on GitHub | Yes |
| Author replied with acknowledgement text | Yes |
| Author replied with disagreement / explanation and no fix | **No** — the author challenged the finding; re-flagging in a later pass is allowed |
| 👎 reaction by the author | **No** — dismissal means the finding was wrong, not accepted; the noise lesson fires, but re-flagging is not prevented (the agent should have dropped it originally, and the outcome-learning loop handles that) |

---

## Sub-agent re-runs

When this rule executes inside a sub-agent (e.g., a review dispatched by an orchestrator), the sub-agent does NOT receive the SessionStart memory-load priming that the main session gets.
The sub-agent MUST therefore perform the Step 1.0 memory read itself — never assume the relevance and lesson memories were pre-loaded.
The companion relevance-memory read (see `comment-relevance-memory.md § Read`) is a mandatory real `mcp__lorekit__memory_list` tool call; treat a thrown tool error as "not connected" for this run, but never infer disconnection without attempting the call.

---

## Hardening incremental and --watch paths

For incremental review passes (a new diff pushed, a `--watch` iteration):

1. Always re-fetch `/tmp/prior-comments.json` at the start of each iteration.
2. Treat the prior comment state as the ground truth for dedup and anti-flip-flop.
3. Do NOT assume the prior payload artifact (`.agent/pr-review/...payload.json`) is the complete picture — the author may have replied or resolved threads since that artifact was written.

The prior-comment fetch is cheap (one `gh api` call); always re-run it rather than relying on stale state.

---

## Carry-forward of deferred findings

`pr-reviewer` defers findings that clear every quality gate but exceed the inline placement caps (`rubric-composition.md § Placement (Step 2.9b)`).
Deferral only works if the next run can still see them, and in `incremental` / `incremental-quick` mode it cannot re-derive them: those modes scan the **delta** only, so a finding deferred in run 1 on a file untouched since would be lost permanently.
Carry-forward closes that hole.

Run this immediately after the prior-comment fetch, in every mode:

1. Read the prior review body (the `<!-- PR_REVIEWER_REPORT -->` comment already fetched above) and parse its `Additional findings` section.
2. Re-admit each parsed entry into the current run's finding stream, tagged `carried-forward`, with its recorded confidence score.
3. Drop a carried entry when **any** holds:
   - Its `(file, line)` no longer exists in the current PR state, or the line's content changed since the review that deferred it (the finding was likely addressed).
   - It duplicates a finding produced fresh in this run (normal dedup, `§ Dedup against prior bot comments`).
   - It duplicates a prior **posted** comment (it was promoted inline in a later run).
4. A carried entry skips re-generation but **not** the gates: it re-enters at 2.6 grounding and flows through receipt, confidence, and shape again, because the code may have moved under it.
5. Placement (2.9b) then treats it like any other cleared finding, and its priority ordering is unchanged — so an unaddressed deferred `issue` outranks a fresh `nitpick` for the inline slots and eventually surfaces inline.

Report the count as `Carried forward: <N>` in the Quality Gate summary.

A finding can therefore be deferred across several incremental runs, but it can never be silently forgotten: it is either posted inline, still listed in the body, or dropped for a logged reason.

---

## Carry-forward of anchorless findings

`Additional findings` is not the only body-only output of a review pass.
A gate finding has **no inline anchor by design** — a `❌` on *Prior bot feedback*, *Documentation*, or *Self-review signals* exists only as a row in the gate-status table inside the `Review diagnostics` accordion.
Optimality proposals (2.4c) are rendered as body cards and never inline.
Standards findings (2.4d) cite a governing-doc `path:line` that is usually not in the diff at all.
None of these are re-derivable from the delta, and two of the three steps that produce them are **skipped** in `incremental-quick`.
Without this rule a re-review silently drops every one of them, and the PR conversation loses context the author still needs.

Run this at **Step 2.5c**, in every mode, over the `PRIOR_DIAGNOSTICS` parsed at `pr-reviewer.md § Step 0.7 → Parsing PRIOR_DIAGNOSTICS`.
It runs there — not next to the deferred-finding carry-forward at Step 0.7 — because every disposition below is decided against this run's outcomes from Step 1.8, Step 2.4c, and Step 2.4d, none of which exist yet at Step 0.7.

Each carried entry gets exactly one disposition:

| Condition | Disposition |
| --- | --- |
| The owning step ran this pass and reproduced the entry | **REPLACE** — the fresh entry wins; the carried copy is discarded (it is the same finding, freshly grounded). |
| The owning step ran this pass and did **not** reproduce it | **RESOLVE** — drop it, and log `resolved since <PRIOR_SHA_SHORT>`. This is the only path that removes a finding from the body. |
| The owning step was **skipped** this pass (2.4c/2.4d under `incremental-quick`, holistic under an incremental mode, `--no-optimize` / `--no-standards` / `--skip-gates`) | **CARRY** — re-render the prior entry verbatim in this run's body, suffixed `(carried from <PRIOR_SHA_SHORT>)`. Never let a skipped step read as a clean result. |
| The entry cannot be mapped to an owning step (unparseable or from an older template) | **DROP** with a log line; never re-render an entry you cannot attribute. |

Owning steps: gate rows → Step 1.8; optimality cards → Step 2.4c; standards findings → Step 2.4d; `Skipped files` → Step 1.2 / 2; `PARTIAL_REVIEW_BANNER` → the step that set it.

Hard rules:

1. **A carried gate row never sets a gate's status.** Step 1.8 evaluates every gate against the **current** PR state in every run mode, exactly as it does today. `PRIOR_GATE_STATE` is context for the *Details* text and for the resolve/carry decision — it can neither fail a passing gate nor pass a failing one.
2. **A carried entry never changes the verdict on its own.** Optimality has never blocked the verdict and still does not; standards findings keep their existing non-blocking behaviour.
3. **Carrying is not re-asserting.** A carried entry is re-rendered because its owning step did not run, not because it was re-verified. The `(carried from …)` suffix is mandatory so the author can tell the two apart.
4. **A `RESOLVE` requires the owning step to have actually run.** A step that was skipped can never resolve anything — that is the `CARRY` row, and conflating the two is how a still-broken gate silently disappears from the body.

Report the counts as `Anchorless carried: <C> · resolved: <R>` in the Quality Gate summary.

---

## Logging

The Quality Gate summary adds four rows:

```text
Prior-comment dedup drops: N  (already said in a prior review pass)
Anti-flip-flop drops:      M  (would contradict a resolved prior suggestion)
Carried forward:           K  (deferred by a prior incremental run, re-admitted)
Anchorless carried:        C  · resolved: R  (gate / optimality / standards findings from the prior body)
```

All four are emitted even when N = 0, M = 0, K = 0, C = 0, and R = 0, so the user can see the step ran.

---

## What this rule does not do

- Re-run outcome measurement — that is `outcome-learning.md`.
- Change how the review is posted — `pr-reviewer` posts one visible `COMMENT` review at Step 4 unconditionally, with no authorization gate.
- Apply when no PR exists yet (no prior GitHub state to reconcile).
- Drop a finding because an author *challenged* (not accepted) a prior finding — disagreement does not prevent re-flagging; outcomes do.
