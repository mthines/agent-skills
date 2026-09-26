---
title: pr-reviewer — posting (Step 4)
impact: HIGH
tags:
  - pr-reviewer
  - posting
  - write-path
  - reference
---

# pr-reviewer — posting (Step 4)

**Read this before Step 4 only when this run is going to write.** Under `--dry-run`,
`--isolated`, `--review-sha`, and inside a `--fanout` finder/lens/verifier/synthesis worker, this
run never posts anything and never needs to load this file — the write procedure, the sticky
report, the review object, the run-state record, and the code-learned memory writes below are
gated on an actual `POST`/`PATCH` happening. The agent body's own Step 4 router names this
condition explicitly.

This file owns 4a–4d verbatim, including every incident narrative and access-path branch: moving
them out of the agent body does not condense or drop any of the protection they encode.

---

## Step 4: Post the review

A run writes **three** things, with three different lifetimes:

| Object | Lifetime | Carries |
| --- | --- | --- |
| **Sticky report comment** — one PR issue comment | **Rewritten in place** every run | The whole report body: headline, sections, `Review details` accordion — and nothing machine-private |
| **Review** — `POST /pulls/{n}/reviews`, `event: "COMMENT"` | **Append-only**, at most one per run, and only when it carries new inline comments | The run's new inline comments; the body is a marker-only pointer (no visible prose — the report lives in the sticky) |
| **PR-state record** — one LoreKit record (Step 0.7) | **Overwritten in place** every run | The run history and everything the next run needs to compute a delta |

The split follows what each payload *is*. An inline comment is a conversation anchor whose state
lives in resolve/reply, so rewriting it would destroy the thread history that
`thread-resolution.md` and `comment-relevance-memory.md` learn from — those stay append-only. The
report is a **snapshot of current state**, and posting a fresh copy of it every run leaves the PR
carrying N contradictory snapshots, the oldest of which is the one a reader meets first — so the
report is rewritten. Machine state is neither: it is read by exactly one consumer, this agent's
next run, so it lives in a store rather than in a comment a human has to scroll past.

Three writes, three independent failures — and none of them cascades. A run that cannot write
the sticky still records its state, so the next run keeps its delta. A run that cannot record
its state still posts its review, and the next run recovers the baseline from the sticky's
footer (Step 0.7). Order them sticky → review → state, and report each outcome separately in
Step 5.

### 4a. Update the sticky report

**Under `--dry-run`, render but do not post.** Build `REPORT_BODY` exactly as below, write it to
`$(scratchRoot())/<run-id>/report-body.md`, and skip the `POST`/`PATCH` call. See
[`rules/pipeline.md`](./pipeline.md#--dry-run) for the full artifact layout.

Bind the two values Step 4 introduces before rendering:

| Variable | Value |
| --- | --- |
| `VERDICT` | `PASS` / `WARN` / `FAIL` — the **presentation variant** chosen in Step 3, the one that selects the body template. Not the printed advisory verdict: Step 3's WARN template prints `**Verdict**: No blocking issues — <N> warning(s)`, which carries no `PASS` token, and recording `PASS` in the state record for a WARN run would misreport the run's own severity to the next reader regardless of what the printed line says. |
| `HEAD_SHA_SHORT` | `${HEAD_SHA:0:7}` (Step 1.2). |

`OPEN_BOT_COMMENT_IDS_JSON` — the comment ids in `OPEN_BOT_COMMENTS[]` **as it stands after Step
2.9c**, `[]` when the gate is clean — is bound here too, but it is not a rendering input: it is
state, and Step 4c writes it as `open_thread_ids` for the next run's `RESOLVED_SINCE_PRIOR`.

#### Build the payload, then run the renderer

`REPORT_BODY` is **not** written by hand. Assembling the renderer payload from `context.json` (`prepare-review.mjs`'s output, extended with the `context.render.*` passthrough bag below) and `judgments.json`, then running [`render-report.mjs`](../scripts/render-report.mjs), is [`finalize.mjs`](../scripts/finalize.mjs)'s job — the same renderer `finalize.mjs --replay-fixtures` verifies byte-identical against every `report-body/*.expected.md` fixture (AC-11). Your job is the judgment inputs, not the markup — this split exists because hand-rendering failed repeatedly in production (five observed runs, `mthines/lorekit#482`, `#492` ×3, `#495`, each read a correct spec and posted a marker-less, accordion-less report, because the layout lived in three ~85%-identical templates and got averaged into a remembered shape rather than copied). Layout is not a judgment call, so it is no longer yours.

```bash
resolve() {  # portable readlink -f
  [ -e "$1" ] || return 1
  ( cd "$(dirname "$1")" && t=$(basename "$1")
    while [ -L "$t" ]; do d=$(readlink "$t"); cd "$(dirname "$d")" || return 1; t=$(basename "$d"); done
    printf '%s/%s\n' "$(pwd -P)" "$t" )
}

AGENT_MD=$(resolve "${CLAUDE_AGENT_FILE:-$HOME/.claude/agents/pr-reviewer.md}" || echo "")
if [ -z "$AGENT_MD" ]; then
  abort "cannot locate this agent definition — CLAUDE_AGENT_FILE is unset and no
$HOME/.claude/agents/pr-reviewer.md install exists. If you were dispatched by a caller that handed
you this file's path directly (see 'Locating this agent's own files' above), that caller was
required to export CLAUDE_AGENT_FILE before this step and did not. THIS IS
A HARD STOP, not a cue to compose the report body yourself: an abort here is recoverable next run,
a hand-written report that drifts from the template is a defect every consumer of this report then
inherits (reviewer-report-ingest.md's parser, the shape-guard workflow, the next run's own re-read).
Report the error verbatim and stop — see the fallback contract two paragraphs below."
fi
FINALIZE="$AGENT_SUPPORT/pr-reviewer/scripts/finalize.mjs"
[ -f "$FINALIZE" ] || abort "finalize.mjs not found at $FINALIZE (resolved from $AGENT_MD)"
# Bound here for reuse below (§ The bytes that get posted) — a direct render-report.mjs
# re-render, the one caller that still needs the bare renderer rather than the whole pipeline.
RENDER="$AGENT_SUPPORT/pr-reviewer/scripts/render-report.mjs"

node "$FINALIZE" \
  --context /tmp/review-context.json --judgments /tmp/judgments.json --out-dir /tmp/finalize \
  || abort "finalize.mjs failed — report the stderr verbatim; never compose the body by hand"
REPORT_BODY=$(cat /tmp/finalize/report-body.md)
```

`--out-dir` receives `finalize-result.json`, `report-body.md`, and `inline/*.md` (one file per posted finding). A non-zero exit is `render-report.mjs` rejecting the payload — an unknown key, a missing required slot, an invalid gate glyph, a smuggled `**Verdict**` line, or a template that lost its marker or accordion — report the error and post nothing. **If `finalize.mjs` cannot be resolved or fails, do not fall back to composing the body by hand** — that is the exact failure this replaces: report the error verbatim in Step 5 alongside the payload it was given, post the inline findings (Step 4b still applies), and leave the sticky untouched. A missing report is recoverable; a malformed one that consumers then parse is not.

**What the model still supplies**, via `judgments.json` (schema:
[`schemas/judgments.schema.json`](../schemas/judgments.schema.json), enforced by
`validate-judgments.mjs`):

| Field | Content |
| --- | --- |
| `summary` | The report's top-level `SUMMARY` scalar (≤ 240 chars) — the one line of prose `finalize.mjs` cannot derive from the candidates. |
| `gates.gate1` | Description-vs-code judgment (Gate 1). |
| `gates.gate4` | Self-review-signals judgment (Gate 4). |
| `gates.gate5` | Docs judgment (Gate 5). |
| `candidates[]`, `threads[]`, `lenses[]`, `memory` | Everything Steps 2/2.4–2.9c produced. `finalize.mjs` computes thresholds, the defer band, suppression, placement, caps, and the gates/verdict from these — it invents none of it. |

There is no second, hand-assembled JSON file: every slot the old manual payload table listed (`RUN.tier`, `RUN.depth`, `IMPACT`, `WITHHELD`, `MEMORIES_USED[]`, `FINDINGS[]`, … — full list at `report-rendering.md` § REPORT_BODY payload) is read straight off `context.json` and `judgments.json` by `finalize.mjs`. `context.render.*` is the one passthrough bag for facts `finalize.mjs` was never scoped to compute (`FIX_ALL_URL` — § Fix-with-Agent0 buttons, above — `MEMORIES_SUMMARY`, `INTEGRATIONS`, `SKIPPED_FILES`, `RUN_ANOMALY`, `carriedForward`): set these on `context.json` before invoking `finalize.mjs`, never post-patch the rendered body.

**Assert these seven things on `REPORT_BODY` immediately before the write, whatever produced it.**
The renderer guarantees them, so on the normal path this is redundant — and that is the point: it is
the only check that survives the renderer being **bypassed**, which is the failure this whole
section exists to prevent. A check that runs only inside the thing it is guarding guards nothing.

```bash
grep -q '<!-- PR_REVIEWER_REPORT -->' <<< "$REPORT_BODY" || abort "report body lost the marker"
# The accordion check needs LINE ADJACENCY, which grep cannot express portably. Two traps:
#   grep -qz '<details>\n<summary>…'   → \n is the letter n in a BRE; matches "<details>n<summary>…"
#   grep -qz $'<details>\n<summary>…'  → a newline in a pattern is a pattern SEPARATOR, so this is
#                                        an OR of {<details>, <summary>…} and passes on either alone
# Both read as correct and neither is. `grep -Pqz` works but is GNU-only. Use awk.
printf '%s\n' "$REPORT_BODY" | awk '
  /^<details>$/ { getline nxt; if (nxt ~ /^<summary>Review details/) ok = 1 }
  END { exit ok ? 0 : 1 }
' || abort "no Review details accordion"
grep -q '<details open>' <<< "$REPORT_BODY" && abort "accordion is pre-expanded"
grep -q '\*\*Verdict\*\*' <<< "$REPORT_BODY" && abort "advisory verdict is terminal-only"
# The `### ` headline is what makes a report identifiable as a report at a glance — and it is the
# one shape an inline finding never uses (a finding opens with its Conventional-Comments prefix and
# a bold title). A report that lost it reads as a long comment.
grep -q '^### ' <<< "$REPORT_BODY" || abort "no ### headline — the report has no report shape"
# The shared attribution footer, built by comment-spine.mjs's footerLine() and identical on both
# surfaces. It carries the reviewed sha, which a sticky has no commit_id for, plus the freshness
# stamp that used to sit in its own <sub>Updated …</sub> line.
grep -q '^<sup>`pr-reviewer` · commit `' <<< "$REPORT_BODY" \
  || abort "no attribution footer — provenance and the freshness cue are both missing"
# The last gate: is this still renderer output, or has the markup been re-encoded in transit?
# Run the shared checker rather than re-deriving its signatures as greps — it is the same function
# both renderers call, so this cannot drift away from them.
printf '%s\n' "$REPORT_BODY" > /tmp/report-body.md
node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --check /tmp/report-body.md \
  || abort "body is no longer renderer output (see stderr) — post the rendered bytes verbatim"
```

On any `abort`: post no report object, name the failing assertion in the Step 5 output, and stop.
Do not repair the body by hand — a body that fails these was not built from the template, and
editing it into shape reintroduces exactly the drift the renderer removes.

#### The bytes that get posted are the renderer's bytes

Everything above runs **before** the body leaves the shell — a complete guarantee on the `gh` path, which posts from the file (`--field body=@/tmp/report-body.md`) and never re-reads the text, but **not** on the MCP path: `add_issue_comment` and `add_comment_to_pending_review` take the body as a tool-call **argument**, so the text has to be reproduced into that argument — a copy no shell performs, no assertion above covers, and nothing downstream re-checks.

That copy is a real failure site, not a theoretical one: on `mthines/agent-skills#165` all six artifacts of one run — the sticky and all five inline comments — arrived with the button markup HTML-escaped and wrapped in a double-backtick code span, so every button rendered as a wall of literal text with a dead link. The renderer had emitted them correctly; the corruption entered after its last post-condition, and the run's own report parsed fine because the markers and footers survived.

**The cause is the relay, not the copy — and that took measurement to establish.** The first diagnosis here blamed reproducing the body by hand ("reformatting a long HTML line is the hazard") and was wrong: posting the renderer's exact bytes through this path reproduces the damage identically, and posting a *short*-URL button by hand does not. What the relay rewrites is a long unbroken run — over ~140 chars it wraps the run in a code span, which closes the `href` and escapes the markup after it. `agent0-fix-links.md` § *Relay length limit* has the measured table. Three obligations, and the first is now the load-bearing one:

1. **Check before the write, and withhold the buttons rather than post them broken.** No amount of
   faithful copying saves an over-budget URL:

   ```bash
   # WHO REWRITES THE BODY decides whether to ask at all. The MCP path carries the body as a
   # tool-call argument and rewrites long URLs; the `gh` path sends a FILE and rewrites nothing.
   # Bind this from the access path already resolved for the sticky write (§ When the sticky
   # cannot be written) — same run, same answer, do not re-probe.
   # Derive the repo rather than assuming $RESOLVED_REPO is in THIS shell — an empty one probes
   # `repos/`, 404s, and reports "no gh" on a session where gh works (github-access.md § Step 0
   # names it as the caller variable not to assume). Default to `mcp` when the probe is
   # inconclusive: withholding is recoverable, a mangled button is not. Deliberately NOT § Step
   # 0's "undecided, defer" rule — the write is in this block, so there is nothing to defer to.
   TARGET_REPO="${RESOLVED_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)}"
   ACCESS_PATH=mcp
   [ -n "$TARGET_REPO" ] && command -v gh >/dev/null 2>&1 \
     && gh api "repos/$TARGET_REPO" --jq .full_name >/dev/null 2>&1 \
     && ACCESS_PATH=gh
   [ "$ACCESS_PATH" = "mcp" ] && WRITE_IS_RELAYED=1

   # Exit 1 is a fix link over budget — the remedy removes it. Exit 3 is some OTHER long URL
   # (a cited doc, an asset path): --no-fix-links would not remove it, so re-rendering is a
   # loop with no exit. Post as rendered and name the mangled link in the run line.
   if [ -n "$WRITE_IS_RELAYED" ]; then
     node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --relay-check /tmp/report-body.md
     case $? in
       1) RERENDER_WITH_NO_FIX_LINKS=1 ;;   # re-render, post that, and say so in the run line
       3) NOTE_MANGLED_LINK=1 ;;            # not remediable here — post, and note it
     esac

     # 1 wins over 3 when a body carries BOTH kinds — one remediable URL makes the RUN remediable,
     # not the body clean — so the exit-3 condition can SURVIVE the withhold. RE-RENDER, then ask
     # again, or a mangled citation goes unnamed on exactly the runs that had two problems.
     # The re-render is the point: re-asking the SAME file returns the same 1 forever, so a
     # second --relay-check on an unchanged body can never reach 3 and this branch would be dead
     # code that reads as coverage. The inline block at Step 2.8 already does it this way.
     if [ -n "$RERENDER_WITH_NO_FIX_LINKS" ]; then
       jq '.payload | del(.FIX_ALL_URL)' /tmp/finalize/finalize-result.json > /tmp/report-payload.nofix.json
       node "$RENDER" /tmp/report-payload.nofix.json > /tmp/report-body.md \
         || abort "re-render without the fix link failed — nothing on stdout, nothing to post"
       node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --relay-check /tmp/report-body.md
       rc=$?
       [ "$rc" -eq 3 ] && NOTE_MANGLED_LINK=1
     fi
   fi

   # Same lever, different failure: the markup is fine but the button's image is not there.
   # Exit 3 is inconclusive (network), NOT a missing asset — post as rendered on 3.
   node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --assets-check /tmp/report-body.md
   case $? in
     1) RERENDER_WITH_NO_FIX_LINKS=1 ;;   # 404 or wrong content-type — a broken-image icon
     3) : ;;                              # unreachable network — do not withhold on a guess
   esac
   ```

   Exit 0 (`relay-safe`) posts as rendered. Exit 1 means re-render with `--no-fix-links` — both renderers omit the button when the URL slot is absent, so the report is unchanged apart from the affordance. **Exit 3 is not a withhold**: the over-budget URL is not a fix link, so the remedy cannot reach it, and treating 3 as 1 re-renders a body that fails the identical check with nothing left to try. Do **not** shorten the prompt to fit: a `fix-this` link spends 106 chars before the prompt starts (in body chars, `&amp;` included), and a button that opens a session with no idea what to fix is worse than none.

   **The `if` is the whole feature.** Every fix link is over the 140-char budget by construction (`agent0-fix-links.md § Relay length limit` — the floor is 164), so an *unconditional* `--relay-check` withholds the buttons on **every run of every repo**, including the `gh` runs where nothing would have been mangled — which is how a default-on affordance shipped and then never rendered once. That the outcome is path-specific was stated in this very paragraph as prose (*"on the `gh` path the buttons post intact and stay"*) while the block above it asked unconditionally: a rule the shell does not execute is a rule the run does not follow. Gate the *question*, not just the sentence about it.
2. **Reproduce the file byte-for-byte.** Read `/tmp/report-body.md` and pass exactly what it contains. Never wrap anything in backticks, never escape `<` or `>`, never re-wrap a long line, never re-indent. The body is already final; there is nothing left to format. This is no longer the diagnosis, but it is still the only way the check above means anything.
3. **Verify after the write, and repair once.** The backstop for whatever `--relay-check` does not predict. Fetch the comment back and diff it against the file. A sticky is editable, so a mismatch is fixable — `PATCH` it once with the correct bytes and note the repair in the Step 5 output:

   ```bash
   # after the write, with $STICKY_COMMENT_ID known
   gh api repos/$RESOLVED_REPO/issues/comments/$STICKY_COMMENT_ID --jq .body > /tmp/posted-body.md
   diff -q /tmp/report-body.md /tmp/posted-body.md \
     || echo "posted body differs from the rendered body — PATCH once with the file, then re-diff"
   ```

   On the **inline** surface there is no repair: comments are append-only and this agent never edits
   one. So the check runs **before** the write there — see Step 2.8 — and a comment that cannot be
   reproduced faithfully is dropped and logged, exactly like a render failure.


**The write itself is `execute-write-plan.mjs`'s `sticky.upsert` op** (self-tested, AC-3): `PATCH` the known `comment_id`, or `POST` a fresh comment when none is known, passing the exact bytes verified above (`report-body.md`) — never a re-read, never a re-composition. On any write failure — including a stale cached `comment_id` — it degrades to posting the compact pointer body rather than losing the write silently. **It does not yet re-scan the PR for an existing marker-bearing comment before degrading** (a known gap, not a silent one): the cached id is an optimisation from the state record, not an authority, and a `404` on it is the first evidence the comment is gone. On the MCP path, the op → tool mapping and the "no update-comment tool" degradation are in [`rules/pipeline.md`](./pipeline.md#write-plan-op--mcp-tool-map).

Exactly **one** sticky per PR. If Step 0.7 somehow found more than one marker-bearing comment, patch the newest and leave the others — never delete a comment, and never create a second sticky when one exists.

#### The report has exactly one host

`REPORT_BODY` — anything carrying `<!-- PR_REVIEWER_REPORT -->` — goes into the sticky issue comment and **nowhere else**. It is never placed in a review body, never in a reply on an inline thread, and never posted twice in one run. A review body is append-only, so a report placed there is a permanent snapshot: twenty runs leave twenty contradictory full reports, the oldest of which is the one a reader meets first, and the "one edited comment" model is gone even though every other rule was followed. Step 4b's pre-flight rejects the payload mechanically; this is the rule it enforces.

#### Two different reasons the sticky can go unwritten

Before touching the access path, check for a **caller policy refusal** — distinct from, and checked
before, the **access-path capability** table below:

```bash
STICKY_WRITE_FORBIDDEN=false
STICKY_WRITE_FORBIDDEN_REASON=""
```

Set `STICKY_WRITE_FORBIDDEN=true` when the invoking context — the system prompt, harness guardrails, or explicit instructions from whatever dispatched this run — forbids writing to `/issues/{n}/comments`, **for any reason other than the access path being technically unable to do it**. The two failure classes are not the same thing and do not get the same diagnosis:

| Failure class | Example | Row to use |
| --- | --- | --- |
| Access-path incapability | no `gh` token, MCP path has no comment-update tool, the read 401s | The capability table below |
| Caller policy refusal | an orchestrator's own guardrails ban `POST /issues/{n}/comments` on principle, even though the credentials in hand could do it | This one |

**This is the gap that caused ad-hoc report bodies on `mthines/lorekit#514`–`#518`.** An earlier version of this agent had no branch for "the write would succeed but I've been told not to attempt it", so a run in that situation did not recognise it as an instance of "the sticky cannot be written" at all — it fell through to improvising a full report's worth of prose directly into the review body, in whatever shape it invented that run. **Never do that.** A caller policy refusal is routed identically to an access-path failure: skip the write attempt entirely, set `STICKY_WRITE_FORBIDDEN_REASON` to the plain-language restriction (e.g. `"caller guardrails forbid POST to /issues/{n}/comments"`), and go straight to `DEGRADED_POINTER_BODY` in Step 4b — a policy refusal is never a reason to hand-write anything, any more than a 401 is.

#### When the sticky cannot be written

The two writes above are a repo-scoped `POST` and `PATCH` on `/issues/{n}/comments`. When
`STICKY_WRITE_FORBIDDEN == true`, skip straight to the matching row below without attempting either
write. Otherwise resolve the access path once per `agents/shared/rules/github-access.md § Step 0`,
then apply this table — and note that **no branch permits a second full report**:

| Situation | Do this |
| --- | --- |
| `gh` path, `STICKY_COMMENT_ID` known (from the record or the marker scan) | `PATCH` it (above), with the stale-id re-scan on a `404`. |
| `gh` path, no sticky and `STICKY_READ_FAILED != true` | `POST` one (above). |
| `STICKY_READ_FAILED == true` | **Post no report object at all.** The marker scan failed, so this run cannot tell whether a sticky exists, and creating one is a coin-flip on duplicating it. Keep the run's inline findings — Step 4b still applies — render `REPORT_BODY` into the Step 5 terminal report, and state `Sticky not updated — could not read the PR's comments (<error>).` This row is reachable only when the fallback rung ran (Step 0.7): a record that supplied `sticky_comment_id` never sets this flag. |
| MCP path, no sticky exists | Create it once with `add_issue_comment`. |
| MCP path, sticky exists but no comment-update tool is available (`github-access.md § Gaps`) | **Do not create a second one.** Post the compact `DEGRADED_POINTER_BODY` (Step 4b) instead and state `Sticky exists but this access path cannot edit an issue comment — report not updated in place.` |
| No GitHub access path | Nothing is posted. `github-access.md § No path` applies: say so precisely, never claim the report was updated. |
| `STICKY_WRITE_FORBIDDEN == true` | **Do not attempt the write — this is a policy refusal, never phrase it as an API or access error.** Post the compact `DEGRADED_POINTER_BODY` (Step 4b) instead, with `DEGRADED_REASON` set to `STICKY_WRITE_FORBIDDEN_REASON`, and state in the Step 5 report: `Sticky writes disabled by caller policy — report not persisted in place.` |

**The table above is exhaustive: every row is a mechanical fact about the access path, and nothing else defers the write.** The five conditions below have each been improvised by a run as a reason to stand down, and none of them is one:

| Not a reason | Why it is not |
| --- | --- |
| The sticky's author login is not this run's `ME` | The marker is the identity (`reviewer-report-ingest.md § Identifying a report`), and Step 0.7 matches on it *only*, deliberately, because `ME` is unresolvable on some access paths. There is exactly one sticky per PR and this agent owns it whichever login last wrote it. `PRIOR_REPORT_AUTHOR` is **diagnostic only** — it feeds dedup (Step 1.0) and thread resolution (Step 2.9c); it is never a permission check, and "I did not edit another author's comment" is a courtesy rule this agent does not have. |
| The verdict is unchanged since the prior run | The sticky is not a notification, it is the current state of the review. Its footer SHA is the next run's delta baseline (Step 0.7's fallback rung reads it), so a skipped rewrite on an unchanged verdict silently pins the baseline to an older commit and the next run re-reviews code it already cleared. |
| The run produced no new inline findings | That governs the **review** object (Step 4b), which is the one thing gated on new inline findings. The sticky is rewritten on **every** run, findings or none — that is what "rewritten in place every run" means. |
| Another bot already reviews this PR | This agent's report is keyed to its own marker and cannot collide with another bot's comment. Another reviewer's presence changes nothing about whether this review's own state gets persisted. |
| It is the caller's own PR (self relation) | `REVIEW_RELATION` (Step 0.5) changes framing only — the pipeline, the gates, the verdict, and every write are identical in both relations. |

The observed failure this list exists for: a run that could not resolve its support tree concluded *"the existing sticky report (by `dash0-dev[bot]`) already reflects this PASS-with-warnings verdict. I did not duplicate it or edit the bot's comment"*, hand-wrote its findings into the terminal, and left the baseline pinned. Two invented rules — don't edit another author's comment, don't rewrite an unchanged verdict — combined into a silent no-op on the one artifact the next run depends on. If a
situation is not a row in the table above, **write the sticky**.

**The delta logic survives every branch**, because it no longer lives on the object that failed to write. Whichever non-writing branch fired, Step 4c still records this run's state, so the next run has its baseline, its carry-forward and its run history in full. That is the whole reason the state moved: under the old model a run that could not patch the sticky had to smuggle a truncated ledger out on an append-only review body, through a three-rung reduction ladder sized against a 1500-character budget — and even then it lost every deferred and anchorless finding, because a pointer has no report body to carry them.

What a degraded run now costs is exactly one thing: **the report is not on GitHub this run.** The review still posts if there are inline findings (Step 4b), `REPORT_BODY` is printed verbatim in the Step 5 terminal output, the reason is named, and the next successful run rewrites the sticky from state that never went missing.

### 4b. Post the review (conditionally)

**Under `--dry-run`, build the payload, run every assertion below, write the result to
`$(scratchRoot())/<run-id>/inline-comments.json`, and skip the `POST` call** — the assertions
still run, because a dry-run that skips its own safety checks would rehearse a broken payload as
if it were a rehearsed-safe one.

Build the payload and confirm it is safe **before** the API call.

**Mechanical home:** `finalize.mjs`'s renderer calls (`render-comment.mjs` per inline finding,
`render-pointer.mjs` for the review's own top-level body) and `execute-write-plan.mjs`'s
`review.create` step. Every property the old hand-written `payload_is_safe(payload)` re-verified is
now enforced **by construction**, upstream of this step, not re-checked after the fact:

| Was hand-checked by `payload_is_safe` | Now enforced by |
|---|---|
| `event == "COMMENT"` | `execute-write-plan.mjs` hardcodes `event: "COMMENT"` literally on the POST — never a model-supplied field, so it cannot drift |
| `side ∈ {RIGHT, LEFT}`, comment shape | `validate-judgments.mjs`'s schema, upstream of `finalize.mjs` |
| Conventional-Comments prefix, the attribution footer, fingerprint-marker singularity, the 320-char prose cap and 2000-char body cap (fix button and `(unverified: …)` tag stripped first), `UNVERIFIED_MAX` | `render-comment.mjs`'s own fail-closed `bad()` assertions — a comment that fails any of these never reaches the write-plan, since `finalize.mjs`'s `renderVia()` only writes the file when the render exits 0 |
| Review body: report-marker-free, ledger-free, `PR_REVIEWER_POINTER`-prefixed, link-free, 600-char cap | `render-pointer.mjs`'s own fail-closed assertions (§ POINTER_BODY) |
| `comments` posted as a real JSON array, never a stringified one | `execute-write-plan.mjs` writes the whole payload to a scratch file and posts it with `--input` — `gh api`'s `--field`/`--raw-field` always serialize a value as a JSON *string*, which 422s the reviews endpoint as `"[...]" is not an array` (the fix five independent `reviewer-lessons` converged on, 2026-08-31 sweep); mutation-tested by its own self-test |

The retired function re-verified all of this by hand, *after* rendering, as a second copy of rules
the renderers already enforce — which is exactly what let an improvised, hand-composed body slip
past it undetected on `dash0hq/dash0#18451` (a hand-built permalink with an empty owner/repo slug,
under every length budget, carrying neither a report marker nor a ledger, so nothing in the
duplicate copy caught it). A second copy of a rule cannot catch a payload that never went through
the first copy at all.

**If you must build a payload without `finalize.mjs`** (the MCP fallback — see
[`rules/pipeline.md`](./pipeline.md)): run `render-comment.mjs` per comment and
`render-pointer.mjs` for the review body directly, and treat a non-zero exit as unsafe. Do not
re-derive the checks as a second, driftable copy — a body that did not come from the renderers is
unsafe by definition, not by re-inspection. Post with `--input`, exactly as `execute-write-plan.mjs`
does — never react to a 422 by reshaping `comments`, and never retry blind: it can still mean the
request reached GitHub, so re-read `pulls/$PR_NUMBER/reviews` for a review at `$HEAD_SHA` carrying
`<!-- PR_REVIEWER_POINTER -->` before retrying, or a transient-looking failure turns into a
double-post.

If the payload is unsafe (a renderer exited non-zero, or the review-body/comment-shape contract
above is otherwise violated), abort and surface the reason in the terminal report. Do not attempt
to auto-fix the payload.

**When to post.** Exactly one condition:

> `INLINE_COMMENTS_JSON` is non-empty.

New inline findings need a review object to ride on — that is a GitHub API fact, not a policy
choice — so a run with something new to say at the code posts one review carrying all of it. A run
with nothing new to say at the code posts **nothing**: it rewrites the sticky, records its state,
and stops.

That is the whole rule, and the three conditions it replaces were all notification devices:
`no prior report existed`, `the verdict worsened` (`RANK[VERDICT] > RANK[PRIOR_VERDICT]`), and
`a new blocking fingerprint appeared`. Each posted a review with **no inline comments** purely so
GitHub would send a notification, because editing a comment sends none. Between them they put one
extra object on the PR timeline per meaningful state change, and on a `review-loop` convergence —
where the verdict legitimately moves PASS → WARN → PASS as findings are applied and re-checked —
that is what a reader experiences as the reviewer commenting repeatedly.

**The cost is stated plainly rather than mitigated:** a verdict that worsens with **zero** new
inline findings now updates the report silently. That case is real — a gate can degrade on
another bot's new thread, a lost doc, or red CI without this reviewer having a line of code to
point at — and the author learns about it the next time they look at the report rather than from
a notification. It is one deletion away from returning: re-add a second condition here and the
`escalation` pointer form in `render-pointer.mjs`. It is deliberately *not* wired to a config
flag; a knob nobody sets is a second code path nobody tests.

**Same-head sibling pre-flight — run immediately before the POST, never earlier.** Two runs of
this agent can overlap on one PR (a push burst, a re-trigger, a harness race), and any duplicate
check evaluated at run start is check-then-act: the sibling posts *during* this run. So re-read
now, at the last possible moment:

```bash
# One paginated read. A marker-carrying review at THIS run's HEAD_SHA, submitted after Step 1.1's
# fetch, is a concurrent sibling of this same automation.
SIBLING=$(gh api repos/$RESOLVED_REPO/pulls/$PR_NUMBER/reviews --paginate \
  --jq '[.[] | select(.commit_id == "'"$HEAD_SHA"'" and ((.body // "") | contains("<!-- PR_REVIEWER_POINTER -->")))] | last // empty')
```

When a sibling is found: **dedupe, never suppress wholesale.** Fetch the sibling's inline comments
(`pulls/{n}/comments`, filtered on its `pull_request_review_id`) and drop from
`INLINE_COMMENTS_JSON` every finding a sibling comment already covers at the same
`(path, line ± 2)` with the same prefix — the 2.5b rule applied against comments that did not
exist when 2.5b ran. Post whatever remains (observed in practice: same-head siblings produce
*disjoint* findings, so suppressing the whole batch drops real defects — including blocking ones);
if nothing remains, post no review, and either way say in Step 5 that a sibling was detected and
how many findings it absorbed. This guard costs one read on every posting run and is the only
duplicate check that sees the sibling, because it is the only one that runs after the sibling
existed.

**`POINTER_BODY` is not written by hand either — the same discipline as `REPORT_BODY` applies.**
Build a small JSON payload and run it through
[`scripts/render-pointer.mjs`](../scripts/render-pointer.mjs), resolved the same way as
`FINALIZE` in Step 4a. A hand-authored pointer is exactly as prone to drift as a hand-authored
report — the ad-hoc headlines observed on `mthines/lorekit#514`–`#518` were what a run wrote
*instead of* the documented pointer forms when it had no deterministic path to fall back to.

There are exactly two forms, selected by `FORM` in the payload — never invent a third (the retired
`no_prior` and `escalation` forms existed only to carry a notification-only review, which *When to
post* above no longer has a caller for):

| `FORM` | When | Required keys | Renders |
| --- | --- | --- | --- |
| `"pointer"` | The ordinary case: new inline findings, sticky written | `HEAD_SHA` | `<!-- PR_REVIEWER_POINTER -->` — **marker-only**. An HTML comment renders as nothing in GitHub, so the review shows only its inline comments; the count and the `[Full report]` link live in the sticky, the one host for report content. |
| `"degraded"` | Same, but Step 4a could not write the sticky (§ *When the sticky cannot be written*, either reason) | `HEAD_SHA`, `FINDINGS_COUNT`, `HEADLINE_LINE`, `DEGRADED_REASON` | The marker plus the headline it could not deliver — never the report, never a ledger. |

**Every** pointer carries `<!-- PR_REVIEWER_POINTER -->` — the renderer refuses to emit a body
without it, and it is the only thing on a review object that identifies it as this agent's (the
identity fallback reads `.user.login` off it when `/user` is unreachable). It carries no run
state: prior-run detection reads the PR-state record, and its GitHub fallback reads the sticky.

`DEGRADED_REASON` is **required** on the degraded form and must name which branch fired — an
access-path limitation quoted from the actual error, or the caller-policy sentence from *Two
different reasons the sticky can go unwritten* — the renderer refuses an empty or missing one, since
a degraded pointer with no stated cause reads as unexplained data loss to whoever finds it later.
`HEADLINE_LINE` is the single verdict sentence from `REPORT_BODY` — the first non-marker,
non-banner line, and nothing after it; the renderer rejects one carrying the report marker, for the
same reason a report body may never be posted here (a marker on a review object is how a consumer
following `reviewer-report-ingest.md` starts treating a pointer as a report). A degraded run with no
inline findings posts nothing at all — the report reaches the user through the Step 5 terminal
output alone, and the state record is still written, so nothing is lost for the next run.

**If the renderer cannot be resolved or fails, do not fall back to composing the pointer by hand**
— report the error verbatim in the Step 5 output along with the payload you built, and do not post
a review this run.

`STICKY_URL` is bound from the 4a response's `html_url`, in whichever branch ran, and is used only
by Step 4c's state record — no review body links to it any more. A run that reaches 4b without it
still posts a valid pointer; only the state record's `sticky_url` is left empty.

The six non-negotiables:
1. `event` is always `"COMMENT"` — never `"APPROVE"`, `"REQUEST_CHANGES"`, or omitted.
2. The reviews endpoint is the **only** way inline comments are posted; `gh pr comment` is still
   forbidden. `POST /issues/{n}/comments` is permitted for the sticky report **and nothing else**.
3. On API failure, do not fall back — report verbatim and stop.
4. Never post more than one review per run, and never more than one sticky per PR.
5. Never skip the sticky patch. The review is conditional; the report is not — the sticky must
   describe the current run in every case, including a run that posts no review. There are exactly
   two exceptions, and neither relocates the report: an access path that cannot write it
   (§ *When the sticky cannot be written*), which posts the degraded pointer instead, and a body
   that fails the pre-write assertion below (§ *Build the payload, then run the renderer*), which
   posts **no** report copy anywhere and reports the failing reason to the user.
6. Never skip the state write (Step 4c). It has **no** exceptions — not a failed sticky, not a
   skipped review, not a caller policy refusal. Each of those is a reason the *next* run needs the
   record more, not less.

Confirm the 4b response contains `state: "COMMENTED"` when a review was posted.

### 4c. Record the run state

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
  --argjson diag "$DIAGNOSTICS_JSON" '
  {v: 1, commit: $sha, data: {
     pr: $pr,
     sticky_comment_id: $sticky_id,
     sticky_url: $sticky_url,
     bot_login: $login,
     runs: (((.data.runs // []) + [{sha: $sha, mode: $mode, verdict: $verdict, at: $at}]) | .[-50:]),
     open_thread_ids: $ids,
     carried_findings: ($carried | .[:50]),
     diagnostics: ($diag | .optimality_cards = ((.optimality_cards // []) | .[:2]))
  }}' <<< "${PR_STATE:-{\}}")
```

The three caps (`runs` 50, `carried_findings` 50, `optimality_cards` 2) apply **on every write**,
even when the input is already short — a cap that only fires when someone remembers it is not a cap.

`CARRIED_FINDINGS_JSON` / `DIAGNOSTICS_JSON` are **this run's** outputs, not Step 0.7's:

| Field | Source | Note |
| --- | --- | --- |
| `carried_findings` | Step 2.9b's `Additional findings`, plus any surviving Step 0.7 entry | Posted-inline or resolved findings are dropped — they'd come back as duplicates. |
| `diagnostics.gate_rows` | Step 1.8's ⚠️/❌ rows | `✅` rows are not recorded. |
| `diagnostics.optimality_cards` | Step 2.4c's cards verbatim, or entries Step 2.5c dispositioned `CARRY` | Verbatim — a card is a multi-line block with its own table. |
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

### 4d. Record what this run learned about the code

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

**Both writes merge onto the record read at Step 1.2a — never write the rule file's literals.** Same
scope + key replaces the whole value, so a hotspot written as the template's `confirmed: 1` resets a
counter four PRs of history built. Rule 3 is the arithmetic: increment the counter this run earned,
union `classes[]`, append to the capped example lists, carry every untouched counter through.

Non-blocking, like 4c — a failed write is logged and the run continues. Report the counts in Step 5
(`Memory written: <K> knowledge, <H> hotspot`), **including the zeroes**: a deep-tier run that wrote
0 knowledge records means either nothing was traced or the write is broken, and the count is the
only place those two separate.

### The shapes: report body, headlines, sections, inline comments

`REPORT_BODY`'s payload keys, the headline forms, every optional `<details>` section, the Gate 3
slot pair, the gate-table cell rules, and `INLINE_COMMENTS_JSON` live in
[`agents/pr-reviewer/rules/report-rendering.md`](./report-rendering.md). Read it
here, at Step 4, when there is a payload to build.

It is reference rather than procedure, moved out of this step because it is ~480 lines that only
matter at posting time and nearly all of it is already enforced by the template and
`render-report.mjs`, so a third copy inline could only drift from them. The pre-write assertions in
4a stay here — they are the one check that survives the renderer being bypassed.

