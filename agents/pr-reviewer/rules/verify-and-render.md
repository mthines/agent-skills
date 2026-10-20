---
title: pr-reviewer — verify, score, render, and place (Steps 2.6b–2.9b)
impact: HIGH
tags:
  - pr-reviewer
  - verifier
  - inline-review
---

# pr-reviewer — verify, score, render, and place (Steps 2.6b–2.9b)

**Read at Step 2.6b by every run that reached Step 2.6.** Owns Phase E verification, scoring, the inline comment render and checks, Conventional Comments, and placement. Step 2.7b (memory suppression) runs between 2.7 and 2.8 and is in [`memory-steps.md`](./memory-steps.md).

## Contents

  - [2.6b Verify each candidate (Phase E)](#26b-verify-each-candidate-phase-e)
  - [2.7 Score the confirmed findings](#27-score-the-confirmed-findings)
  - [2.8 Comment shape — **rendered, not written**](#28-comment-shape--rendered-not-written)
  - [2.9 Conventional Comments](#29-conventional-comments)
  - [2.9b Placement](#29b-placement)

---

### 2.6b Verify each candidate (Phase E)

See [`agents/shared/rules/finding-verifier.md`](../../shared/rules/finding-verifier.md). Read it once,
here. The verifier is the *only* filter in the pipeline that judges whether a candidate is real,
and it is deliberately separated from the finders that produced them — see the polarity rule at
Step 2.

The verifier receives the candidate's `claim`, `bad_outcome`, `verify_by`, and anchor, plus the
workspace and the impact graph. It **never** receives which finder produced it, how many votes it
carries, the confidence bar, or anything else about the run — all of which would let it grade the
source rather than the claim.

It re-derives the claim from code and returns one of four verdicts:

| Verdict | Meaning | Disposition |
|---|---|---|
| `confirmed` | the check ran and reproduced the `bad_outcome` | scored at 2.7, posted |
| `contradicted` | the check ran and showed the claim is false (a guard the finder missed, a caller that already handles it) | **DROPPED, and logged with the reason in parentheses** — an unlogged contradiction is a lesson the loop never learns |
| `ambiguous` | the check ran and was inconclusive | capped at `question:`, never `(blocking)` |
| `unobtainable` | the check **could not run** — no workspace, no checker, no network for the changelog | **re-framed, not dropped**: capped at `suggestion:`/`question:`, decorated `(unverified: <reason>)`, and listed in `WITHHELD` (Step 4) |

`unobtainable` and `null` are different verdicts and collapsing them is a real defect: a check
that *ran* and found nothing drops the claim, while a check that *could not run* has established
nothing about it (`verification-receipt.md` § `unobtainable`). **Never reach `unobtainable`
without trying** — it names an unavailable rung, not an unattempted one.

**Risky-shape receipt mandate.** A behavioral `issue:` candidate anchored on a file in
`HIGH_STAKES_FILES`, or produced under a risky shape's checklist, must reach at least **Tier 2**
of `verification-receipt.md` (a semantic no-execution check — `tsc`, `go vet`, `cargo check`,
`pyright` — via `Skill("verify-behavior", "claim")`) whenever `TIER2_CHECKER` is non-empty, not
only Tier 1 grep. On these shapes a "plausible" claim is not enough to block a PR, and an executed
receipt is what turns a checklist hit into a defensible `(blocking)` finding.

The verifier runs in this turn under both topologies ([`dispatch-topology.md`](./dispatch-topology.md)):
reading the rule in the context that produced the candidate is the weaker but acceptable form.

### 2.7 Score the confirmed findings

The **rubric** lives in [`finding-verifier.md § The finding rubric`](../../shared/rules/finding-verifier.md):
`Final = 0.4 × Reproducible + 0.3 × Attributable + 0.3 × Actionable`. Severity is a separate axis
([`severity.md`](../../shared/rules/severity.md), applied in this same pass) and never folded into the score — how bad it is if real, and
whether it is real, are independent questions.

The **threshold** the score is compared against still lives in
`agents/shared/rules/per-comment-confidence.md`, which owns the per-type bar, the severity fan-out,
the defer band, the path-instruction injection, and the `(blocking)` decoration. Apply its
§ Drop vs. defer unchanged: at or above the bar the finding clears; a near-miss `issue`/`suggestion`
(score in `[max(threshold − 15, 50), threshold)`) is **deferred** to the `Low-confidence findings`
advisory body section (`LOW_CONFIDENCE_SECTION` in Step 4) rather than dropped; a
`question`/`nitpick` below threshold, or anything below the defer floor, is dropped. Advisory
findings never post inline, never enter `INLINE_COMMENTS_JSON`, never affect a gate or the verdict,
and are not carried forward. Track the deferred count as `CADV`
(`Confidence-deferred (advisory)`); it is **excluded** from the `<CL> − <DEF> == <F>` identity.

`Skill("confidence", "code")` remains the scoring path for candidates that did not come from a
finder — the `quick`-tier rubric output, the `ux` / `critical` / `--with` lenses — so nothing loses
a score when Phase E did not run on it. A finding with no score from **either** path is dropped:
an unscored finding cannot be compared to a threshold, and posting it would mean posting it
ungated.

### 2.8 Comment shape — **rendered, not written**

**Do not compose an inline comment body.** Build one JSON payload per surviving finding and render
it:

```bash
RENDER_COMMENT=$(resolve pr-reviewer/scripts/render-comment.mjs)   # same idiom as CLASSIFY, Step 1.2
BODY=$(node "$RENDER_COMMENT" /tmp/finding-1.json)
```

The payload keys are in [`comment-shape.md § The payload`](../../shared/rules/comment-shape.md): the
claim (`PREFIX`, `TIER`, `TITLE`, `BODY`, `BLOCKING`), the proof (`EVIDENCE[]` **or** `UNVERIFIED`,
never both), the patch (`FENCE`), the identity (`FP`, `SHA`), and the affordance (`FIX_URL`).
Everything a reader sees as structure — the tier label and its glyph, the bold title, the
decoration and its position, the evidence separators, the fingerprint marker, the button markup and
the shared footer — is derived from those fields.

Two payload rules are worth stating here because they are the ones a run gets wrong:

- **`TITLE` is required on `issue:` / `suggestion:` and rejected on the rest.** A claim needs a
  handle, because GitHub shows only a comment's opening in the Files rail, the timeline, and the
  notification email; a `nitpick:` needs to stay one line. It is a noun phrase ≤ 60 chars with no
  sentence punctuation.
- **`BODY` is ≤ 200 chars, ≤ 2 sentences, one paragraph.** The cap measures prose only — the title,
  the fence, the `Evidence:` line, the button, the footer and the marker are all excluded and
  separately bounded, because counting them would make every well-formed finding oversized.

**On rejection, drop and log — never repair.** The renderer prints nothing on stdout when it
refuses a payload, so a non-conforming finding cannot be posted half-formed. Log the payload and the
error verbatim in the Step 5 terminal output so the finding is recoverable by hand, and continue with
the rest of the review. Editing a rejected body into shape reintroduces exactly the drift the
renderer exists to remove: this surface had a prose contract and a `passes_shape()` function nothing
executed, and a real posted finding dropped three documented decorations at once.

**Check each body on the way out, because this surface has no repair.** Inline comments are
append-only and this agent never edits one, so a corrupted inline finding stays corrupted for the
life of the PR — unlike the sticky, which § *The bytes that get posted are the renderer's bytes*
can `PATCH`. Write each rendered body to a file and run the shared checker on it before it reaches
`add_comment_to_pending_review`:

```bash
node "$RENDER_COMMENT" /tmp/finding-$i.json > /tmp/finding-$i.md || { log; continue; }
node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --check /tmp/finding-$i.md \
  || { log "finding $i: body is not renderer output — dropped"; continue; }
# ONLY ask on a relayed write. The MCP path carries the body as a tool-call argument and rewrites
# long URLs; the `gh` path sends a file and rewrites nothing, so asking there withholds a button
# that would have posted intact. Every Fix-this link is over budget by construction (floor 188), so an
# unconditional check is a permanent, silent opt-out of the feature on every path
# (agent0-fix-links.md § Relay length limit). This block is a separate tool call from Step 4a, so
# resolve the path here with github-access.md § Step 0's own probe, as with $AGENT_MD above.
# Derive the repo HERE. $RESOLVED_REPO is bound once at Step 0.2 and this is a different tool
# call, so it is empty in this shell — and an empty one probes `repos/`, 404s, and reports "no
# gh" on a session where gh works, withholding the button on the very path this gate exists to
# protect. github-access.md § Step 0 names that variable as the one not to assume is bound.
TARGET_REPO="${RESOLVED_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)}"
# Default to `mcp`: an inconclusive probe must WITHHOLD (a mangled button is worse than none),
# so the fail-safe direction is "assume relayed", never "assume file". This is the one place
# that DEPARTS from § Step 0's "undecided, defer the probe" rule, deliberately: the write happens
# in this block, so there is no later step to defer to, and an undecided probe must still answer.
ACCESS_PATH=mcp
[ -n "$TARGET_REPO" ] && command -v gh >/dev/null 2>&1 \
  && gh api "repos/$TARGET_REPO" --jq .full_name >/dev/null 2>&1 \
  && ACCESS_PATH=gh
[ "$ACCESS_PATH" = "mcp" ] && WRITE_IS_RELAYED=1
# On a relayed write, an over-budget fix URL is mangled no matter how faithfully it is copied.
# Re-render this finding without FIX_URL rather than drop it — the finding is worth more than
# its button. Exit 3 is a long URL that is NOT a fix link, so dropping FIX_URL would not remove
# it: post as rendered and say so.
if [ -n "$WRITE_IS_RELAYED" ]; then
node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --relay-check /tmp/finding-$i.md
case $? in
  1) jq 'del(.FIX_URL)' /tmp/finding-$i.json > /tmp/finding-$i.nofix.json
     node "$RENDER_COMMENT" /tmp/finding-$i.nofix.json > /tmp/finding-$i.md \
       || { log "finding $i: re-render without the fix link failed — dropped"; continue; }
     log "finding $i: fix link withheld (relay would mangle it)"
     # 1 wins over 3 when a body carries BOTH kinds, so the exit-3 condition can SURVIVE the
     # remedy. Ask again on the re-rendered body or the mangled citation is never reported.
     node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --relay-check /tmp/finding-$i.md
     rc=$?
     if [ "$rc" -eq 3 ]; then
       log "finding $i: a cited link is also over the relay budget — posted as is"
     fi ;;
  3) log "finding $i: a cited link is over the relay budget and will be mangled — posted as is" ;;
esac
fi
# A reachable-looking button whose image 404s is a broken-image icon, not a button. Same re-render.
node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --assets-check /tmp/finding-$i.md
if [ $? -eq 1 ]; then
  jq 'del(.FIX_URL)' /tmp/finding-$i.json > /tmp/finding-$i.nofix.json
  node "$RENDER_COMMENT" /tmp/finding-$i.nofix.json > /tmp/finding-$i.md \
    || { log "finding $i: re-render without the fix link failed — dropped"; continue; }
  log "finding $i: fix link withheld (button asset unreachable)"
fi
```

Then reproduce that file **byte-for-byte** into the tool-call argument. A body that fails `--check`
is dropped and logged, exactly like a render failure — never posted, never repaired. A body that
fails `--relay-check` is posted **without its button**, because the button is the only part the
relay breaks and the finding still needs to reach the author.

The reference renderings are in `scripts/eval/fixtures/inline-comment/*.expected.md`.

### 2.9 Conventional Comments

See `agents/shared/rules/conventional-comments.md`. The prefix, the `(tier)` label, and the
`**(blocking)**` / `**(non-blocking)**` decoration are all built by the renderer from `PREFIX`,
`TIER` and `BLOCKING` — supply the fields, not the syntax. Line 1 stays machine-shaped
(`^<prefix> (<tier>):`) because `record-comment-relevance.mjs` reads the tier from exactly there.

### 2.9b Placement

See `agents/shared/rules/rubric-composition.md § Placement (Step 2.9b)`. Runs **after**
every quality gate, on findings that already cleared grounding, receipt, confidence, and shape.

Inline caps: **N per file** from the resolved profile (`balanced` = 5) and **20 total** — both
governing **non-blocking findings only**. A `(blocking)` finding (broken behaviour, security, data
loss, misimplemented intent) is exempt from both caps: it is always posted inline and never
deferred, so a genuinely weak PR surfaces every blocker at the code no matter how many there are
(`rubric-composition.md § Placement`). Place blocking findings first, then fill the remaining slots
with non-blocking findings ordered by prefix priority, then material before cosmetic, then descending
confidence score, then line number.

Non-blocking findings above a cap are **deferred, not dropped** — rendered in the review body under
`Additional findings` and excluded from `INLINE_COMMENTS_JSON`. A finding that cleared 2.7 is
never discarded by this step, and a blocking finding is never deferred. Report
`Deferred (over inline cap): <N>` in the diagnostics block.

Non-blocking findings also carry a **materiality** dimension (`rubric-composition.md § Materiality routing`).
At placement, `material` findings sort before `cosmetic` ones within a prefix, so cosmetic findings take an inline slot last and overflow into `Additional findings` first.
The docs-only cosmetic drop happens earlier, at the 2.3 filtering stage (pre-clearing, logged as `Materiality drops`), so no *cleared* finding is dropped here and the `<CL> − <DEF> == <F>` identity is untouched.
