---
title: pr-reviewer — report rendering reference
impact: HIGH
tags:
  - pr-reviewer
  - rendering
  - report-body
  - reference
---

# pr-reviewer — report rendering reference

The shapes `pr-reviewer` Step 4 posts, in one place: the sticky report body and its payload, the
headline forms, every optional section, and the inline-comment array.

**This is reference, not procedure.** Step 4a / 4b / 4c own *when* each write happens and in what
order; this file owns *what each one looks like*. Load it at Step 4, when there is a payload to
build — not at the start of a run.

**Most of it is enforced, not trusted.** The layout lives in
[`../templates/report-body.md`](../templates/report-body.md) and is filled by
[`../scripts/render-report.mjs`](../scripts/render-report.mjs), which fails closed on an unknown
key, a missing required slot, an invalid gate glyph, a smuggled `**Verdict**` line, or a template
that lost its marker or accordion. Where this file and the renderer disagree, **the renderer is
right** and this file is the bug — it exists so a run knows which payload to build, never so a run
can hand-render a body.

Heading levels are `###` / `####` because this text moved verbatim out of `pr-reviewer.md` § Step 4,
and both the renderer and the L1 guards match some of these headings as literal strings.

## Contents

- [REPORT_BODY format (the sticky comment)](#reportbody-format-the-sticky-comment)
  - [REPORT_BODY payload](#reportbody-payload)
  - [The shared footer — one line, both surfaces](#the-shared-footer--one-line-both-surfaces)
  - [`RUN.tier` and `RUN.depth` — the depth declaration](#runtier-and-rundepth--the-depth-declaration)
  - [The three groups inside the accordion](#the-three-groups-inside-the-accordion)
  - [Headlines](#headlines)
- [The Gate 3 open threads: the count on the summary, the list in the accordion](#the-gate-3-open-threads-the-count-on-the-summary-the-list-in-the-accordion)
  - [`OPEN_THREADS_SUFFIX` — the counter on the summary](#openthreadssuffix--the-counter-on-the-summary)
  - [`OPEN_THREADS_LIST` — the bullets, inside the accordion](#openthreadslist--the-bullets-inside-the-accordion)
  - [The accordion is the renderer's job, not yours](#the-accordion-is-the-renderers-job-not-yours)
- [INLINE_COMMENTS_JSON format](#inlinecommentsjson-format)

---

### REPORT_BODY format (the sticky comment)

This is `REPORT_BODY` — the body of the **sticky comment** (Step 4a). It is **not** the review's
pointer body (Step 4b), and no template on this page may be posted as a review body. Every template
below is rendered fresh each run and replaces the sticky's previous content wholesale. Nothing is
appended to the rendered body — the run history is a LoreKit record (Step 4c), not a hidden block
at the bottom of the report.

**This section was called "Review body format", and that name was the bug.** An agent composing a
review body looked up "review body format", found these templates, and posted the report as the
review body — `F-report-in-review-body`, handed to it by the heading. The old name is not coming
back; `reviewer-report-ingest.md` cites this section by its current title.

The `<sup>` footer line varies by run mode. It renders **inside** the `Review details`
accordion — the first line of the accordion body, immediately after the `<summary>` and before the
gate table — not at the top level of the review body:
- `full` mode: `<sup>Reviewed for commit \`HEAD_SHA\`.</sup>`
- `incremental` or `incremental-quick`: `<sup>Incremental review for commit \`HEAD_SHA\` (delta since \`PRIOR_SHA_SHORT\`).</sup>`

The `Review details` `<details>` block has the same structure on PASS, WARN, and FAIL, but each verdict
template embeds its **own** gate-table variant — PASS renders every gate ✅, WARN renders ✅/⚠️, and
FAIL renders ✅/⚠️/❌. Use the table from the template matching the chosen verdict; a PASS (all-✅)
table must never be rendered on a WARN or FAIL body. Fill in the actual values.
The `<sup>` footer depends on run mode (substituted before posting):
- `full`: `<sup>Reviewed for commit \`HEAD_SHA\`.</sup>`
- `incremental` / `incremental-quick`: `<sup>Incremental review for commit \`HEAD_SHA\` (delta since \`PRIOR_SHA_SHORT\`).</sup>`
- Zero-delta short-circuit: `<sup>No code changes since \`PRIOR_SHA_SHORT\` — gate checks only for commit \`HEAD_SHA\`.</sup>`

Pick the body by verdict, exactly as in Step 3 (see *Gate states*): **PASS** (all clear), **WARN** (hard Gates 4/5 ✅ and at least one graded gate — Description vs. code, Prior review feedback, or Code review — is ⚠️, none ❌; still a PASS verdict), or **FAIL** (Gate 4 or Gate 5 fails, or Prior review feedback / Code review is ❌). Gate 2 (CI) is informational-in-`Run` and is excluded from both the failing-gate and warning-gate counts in every case.

#### REPORT_BODY payload

One JSON object. **It is data, not markdown.** Anything with a count, a link, or a shape a
documented consumer parses is supplied *structured* and derived by the renderer — you never write
the count, never write the link, never format the run-mode or footer line. That is deliberate: each
of those was a real defect before it became derived.

**Required — scalars.** Prose only; no counts, no links, no parsed shapes:

| Key | Content |
| --- | --- |
| `VERDICT` | `PASS` · `WARN` · `FAIL`. The renderer **cross-checks it against the gate table** and rejects a disagreement — see *Headlines* below. |
| `SUMMARY` | One sentence about the **change**, ≤ 240 chars, single line. It is the only part of the headline region that needs judgment; the glyph, the counts, and the blocking subset are all derived. |
| `GATE_DESCRIPTION_STATUS` · `GATE_PRIOR_STATUS` · `GATE_DOCS_STATUS` · `GATE_SELFREVIEW_STATUS` · `GATE_CODEREVIEW_STATUS` | One of `✅` `⚠️` `❌` `⏭️`. Gate 2 (CI) is not a row — it renders via `CI_NOTE`. |
| `GATE_DESCRIPTION_DETAILS` · `GATE_PRIOR_DETAILS` · `GATE_DOCS_DETAILS` · `GATE_SELFREVIEW_DETAILS` · `GATE_CODEREVIEW_DETAILS` | The Details cell. **Single line, no `\|`, ≤ 120 chars** — all three enforced; the full finding belongs in an inline comment. |
| `MEMORIES_SUMMARY` | The **indexed half only** — `<MEMORIES_READ_COUNT> indexed`, or `not connected`. It counts all three record families (relevance rules, knowledge, hotspot), because `MEMORIES_USED` does. Never write ` · <N> used`: the renderer derives that from `MEMORIES_USED`'s length and rejects a payload that supplies its own, reports fewer indexed than used, or pairs `not connected` with a non-empty `MEMORIES_USED`. |
| `QUALITY` | Must begin `produced <N> → posted inline <N> …`. |
| `INTEGRATIONS` | Names + versions + spec URLs, or `not activated`, or `skipped (<reason>)` — e.g. `skipped (tier: quick)`. |
| `OPTIMALITY_LOG` · `STANDARDS_LOG` · `MEASURABILITY_LOG` | Must begin `ran` or `skipped (reason)` so the run-state parses. |
| `SKIPPED_FILES` | A list, or `none`. |

**Required — `RUN`**, the object the footer line, the `Run mode` line, and the top-level freshness
cue are all derived from:

```json
{ "RUN": { "mode": "full", "sha": "c3ceb87", "prior_sha": "70cf147", "delta_lines": 256, "at": "2026-08-15T09:12:00Z", "tier": "deep", "depth": "checkout" } }
```

- `mode` — `full` · `incremental` · `incremental-quick` · `zero-delta`.
- `sha` / `prior_sha` — **exactly 7 lowercase hex chars** (`${SHA:0:7}`). `prior_sha` is required for
  every mode except `full`. The renderer rejects a longer sha, which is what stops one report
  carrying a 40-char sha in the footer and a 7-char sha in a prose line.
- `delta_lines` — integer, required unless `mode` is `zero-delta`.
- `at` — **required**, an ISO-8601 UTC timestamp ending in `Z` for this run (`date -u
  +%Y-%m-%dT%H:%M:%SZ`), the same format `runs[].at` already uses in the Step 0.7 state record.
  Feeds the shared footer's `updated <stamp> UTC` clause (below) — never write it yourself.
- `tier` — optional, `deep` · `standard` · `quick` (see [`depth-routing.md`](./depth-routing.md)).
- `depth` — optional, `checkout` · `tarball` · `diff-only` (see [`workspace.md`](./workspace.md)).

#### The shared footer — one line, both surfaces

The footer is built by [`comment-spine.mjs`](../scripts/comment-spine.mjs)'s `footerLine()`, which
`render-comment.mjs` calls too, and it renders **below** the `Review details` accordion:

```markdown
<sup>`pr-reviewer` · commit `bde3c2f` · full review · [how these findings are produced](…) · updated 2026-08-15 09:12 UTC</sup>
```

It replaced three things that each solved part of the same problem separately: a run-mode footer
sentence and a `Reviewed by the pr-reviewer agent` line, both *inside* the collapsed accordion, and
a standalone `<sub>Updated … UTC</sub>` line under the headline. A reader of the closed report saw
no attribution and no reviewed commit, and the inline findings had no footer at all — so neither
surface said who was speaking or which commit was read, which is most of why the two read as
unrelated bots. Cursor's own footer is the one cue that makes its report and its inline comments
recognisably the same tool; this is that cue, and it is one function so the two cannot drift.

Three properties are load-bearing:

- **`commit \`<sha>\`` is matchable on its own.** A sticky is an issue comment and has no
  `commit_id`, so this is the only record of what was reviewed — and it is what `pr-reviewer`'s own
  fallback rung reads to recover a delta baseline when its state record is unusable
  ([`reviewer-report-ingest.md § Footer SHA`](../../shared/rules/reviewer-report-ingest.md)). The
  run descriptor is a *phrase* (`full review`, `incremental review, delta since \`70cf147\``,
  `no code changes since \`70cf147\`, gate checks only`) precisely so the sha is not in the line twice.
- **It is outside the accordion, and below it.** Visible on the collapsed comment, on every run —
  including a run that touches only the report and posts no review (Step 4b has one posting
  condition, and this is not it). Below rather than above so the head region stays the headline plus
  the worklist.
- **The `updated` stamp is derived from `RUN.at`, never authored.** Editing a GitHub comment sends
  **no notification**, so the "edited" tag was the only trace that a rewritten report had changed,
  and seeing when meant opening the edit history. One run produces one wall-clock moment, which is
  why it lives in `RUN` beside the sha rather than as its own scalar that could disagree with it.

The run line renders as `<mode> · <N> lines in delta`, which is the shape
`reviewer-report-ingest.md` parses — and, since the `**Run**` group heading now carries the label,
that shape is also the line's whole anchor. Extra colour goes in the optional `RUN_NOTE` scalar and
is appended after it, so the parseable prefix survives.

**`RUN_NOTE` is routing colour; `RUN_ANOMALY` is a caveat about coverage.** They are two slots
because they are two different claims, and conflating them cost a real report its most important
sentence: a compare-range pollution notice — which changed *what the review actually covered* —
rode at the tail of the longest line in the accordion, after `depth checkout`, and went unread.

| Slot | Renders | Use it for |
| --- | --- | --- |
| `RUN_NOTE` | appended to the run line after the parseable prefix | why the router chose this tier — `blast_radius=high · semver_delta=major`, `27 files touched` |
| `RUN_ANOMALY` | its own line directly under the run line, prefixed `⚠️` by the renderer | something that changed what this run reviewed — a polluted compare range, a capability cap, a truncated fetch |

The renderer rejects a `RUN_NOTE` containing `⚠️` (that is an anomaly wearing colour's clothes) and
a `RUN_ANOMALY` that supplies its own leading glyph (the renderer owns it, so a supplied one
doubles). Both are single-line.

#### `RUN.tier` and `RUN.depth` — the depth declaration

A shallow review that renders the same report as a deep one is the failure Phases A and C exist to
fix: nobody can tell which they got, so the review's silence is read as coverage it never had.
These two slots put both facts on the `Run mode` line, **after** the parseable
`<mode> · <N> lines in delta` prefix, so the ingest grammar is untouched:

```markdown
**Run**

incremental · 84 lines in delta · tier standard · depth tarball (no git history)
```

- `tier` is the routing outcome from [`depth-routing.md`](./depth-routing.md) — `deep`, `standard`,
  or `quick`.
- `depth` is the workspace capability from [`workspace.md`](./workspace.md) — `checkout`,
  `tarball`, or `diff-only`. The renderer expands the label:
  `tarball` → `tarball (no git history)`, and `diff-only` →
  `diff-only — consumer, type, and test verification unavailable`, because `diff-only` is the value
  whose consequences a maintainer must not have to look up.

Two pairings are rejected:

| Rejected | Why |
| --- | --- |
| `tier` that disagrees with `mode` (`full`↔`deep`, `incremental`↔`standard`, `incremental-quick`↔`quick`) | A report cannot claim a deep review while rendering an incremental mode; one of the two is wrong and the run must not pick which. |
| `depth: diff-only` with `tier: deep` | A deep review is not *obtainable* without a checkout — the consumer, type, and test rungs all need one. `depth-routing.md` caps a `diff-only` run at `standard`; this is that cap enforced mechanically. |

Both are optional, so a run that has not routed (or a caller on an older payload) renders the line
exactly as before. Supply them on every routed run: an omitted `depth` asserts full capability by
default, which is the failure Phase A exists to fix.

**Optional — structured.** Omit a key to omit its whole block. Counts are **derived from array
length**, so there is no count to supply and none to get wrong:

| Key | Shape | Notes |
| --- | --- | --- |
| `OPEN_THREADS` | `[{path, line, url?, ask, blocking?, author?, is_bot?}]` | The renderer builds the bullet `- ` + a link whose text is `` `path:line` `` and whose target is `url`, then ` — ask`, then an author tag `` (bot · `author`) `` or `` (human · `author`) `` when `is_bot`/`author` are supplied (omitted when they are not); it derives `Open review threads (N)` and the `<summary>` suffix, and appends ` (K blocking)` only when some item has `blocking: true`. `is_bot` is a boolean (thread author's GitHub type is `Bot`); `author` is the login, code-wrapped by the renderer so it does not `@mention`. A missing `url` renders unlinked inline code, never a broken link. |
| `RESOLVED_SINCE` | `{count, sha}` | Suppressed at `count: 0`. Rejected when `OPEN_THREADS` is empty — with Gate 3 clean the counter belongs in its Details cell. |
| `MEMORIES_USED` | `[{key, url?, note?, kind?, evidence?}]` | One bullet per applied memory, under `MEMORIES_SUMMARY`. `kind` is `knowledge` · `hotspot` · `rule` ([`memory.md`](./memory.md)) and renders as a bold prefix; when any entry supplies one, the summary's `used` half gains a per-kind breakdown (`3 used (1 knowledge · 1 hotspot · 1 rule)`) derived from the array. `evidence` is an array of the PR numbers a `rule` was learned from, rendered `<sup>evidence #88 #91 #97</sup>`; a `rule`-kind entry with an empty `evidence` array is **rejected** — a suppression rule with no evidence trail is exactly the unauditable suppression `memory.md` forbids. Omit `evidence` entirely on the other two kinds. |
| `IMPACT` | `{telemetry?, symbols?, dependencies?, overlaps?}` | The consequence-note accordion from [`impact-graph.md`](./impact-graph.md). `symbols` is `[{name, path, change, consumer_files, verified_unaffected, findings}]` — `change` is `signature` · `body` · `removed`; `dependencies` is `[{name, from, to, delta, usage_sites, url?}]`; `overlaps` is `[{pr, author, path, symbol?, url?}]`; `telemetry` is one plain line ([`telemetry.md`](./telemetry.md)). The renderer derives the `<summary>` counts, builds every link from `url`, and joins the three bullet groups into **one** list. It rejects `verified_unaffected + findings > consumer_files` and states any untraced remainder in the bullet, so a partial trace can never render as a complete one. |
| `WITHHELD` | `[{prefix, body, reason, path?, line?, url?}]` | The `unobtainable` findings from [`verification-receipt.md`](../../shared/rules/verification-receipt.md) — re-framed, not dropped. `reason` is **required** (which rung was unavailable); `prefix` must be `suggestion` or `question` and any other value is rejected, because nothing was verified so nothing is asserted. Renders in its own collapsed accordion with `<sup>(unverified: <reason>)</sup>`. |
| `ADDITIONAL_FINDINGS` | `[{path, line, url?, prefix, body, confidence}]` | `prefix` is a Conventional-Comments prefix; `confidence` an integer 0–100. |
| `LOW_CONFIDENCE_FINDINGS` | `[{…same…}]` | Advisory only (`reviewer-report-ingest.md`). |
| `OPTIMALITY_CARDS` | `[markdown, …]` | The one place model-authored markdown remains, because a card is a multi-line block with its own table. Each must contain a `### Optimality proposal — <path>:<line>` heading, which the renderer checks. |
| `PARTIAL_REVIEW` | `{calls, scanned, total}` | Integers; emits the tool-budget banner. |
| `FINDINGS` | `[{title, path, line?, url?, tier, blocking?}]` — the findings this run **posted inline**. Three renderings come from this one array: the headline's count and glyph (`### 🟠 4 findings — 1 blocking`), the visible findings index above the accordions, and the `Severity — ` tally (`🔴 1 critical · 🟠 2 high`, glyph paired with its word per WCAG 1.4.1). `title` is the **same string `render-comment.mjs` put on that comment's first line**, which is what makes an index row and the comment it links to recognisably the same finding. `tier` is required and enumerated (`critical` · `high` · `medium` · `low`); a `\|` in `title` is rejected (it would split the row). The renderer also rejects a `FINDINGS` length that disagrees with `QUALITY`'s `posted inline <N>` — they are the same number stated twice. |

**Optional — scalars:** `CI_NOTE` (Gate 2's substance — which checks are red and on what),
`VERIFIED_NOTE` (what this run checked itself), `QUALITY_DROPPED`, `RUN_NOTE`, `RUN_ANOMALY`
(the two are not interchangeable — see *`RUN.tier` and `RUN.depth`* above), `FIX_ALL_URL`
(opt-in — the Agent0 "Fix all" deep link, validated `http(s)` and bare of `)`; the renderer turns
it into a linked button above the accordion, rendered only when supplied, i.e. when the
`--fix-links` mode is on — see `agents/shared/rules/agent0-fix-links.md`).


#### The three groups inside the accordion

The accordion used to be **nine flat `**Label** — value` lines at identical visual weight**, and on
a typical run four of them said nothing happened while costing exactly as much vertical space as the
ones that did. Reading it meant reading all nine to find the two that mattered.

Nothing was removed. The same lines are grouped by **the question each answers**, and the payload is
unchanged apart from the new `RUN_ANOMALY` slot — the grouping is entirely renderer-derived:

| Group | Heading | Holds | Rendered when |
| --- | --- | --- | --- |
| Attention | `**Needs attention**` | the gate table, then `Open review threads` | the heading only when a gate row is ⚠️ or ❌; the table always |
| Found | `**Found**` | `Quality`, `Dropped`, `Severity`, `Optimality`, `Standards`, `Measurability`, `Verified` | always (`QUALITY` is required, so the group is never empty) |
| Run | `**Run**` | the run line, the `⚠️` anomaly line, `Skipped files`, `Integrations`, `CI`, `Memories` + its bullets | always |

Three properties are load-bearing rather than cosmetic, and L1 `G25` asserts each:

- **The group headings are the only bold lines left inside the accordion.** In-group labels are
  plain (`Quality — `, `CI — `), so the eye lands on the two or three headings first. Re-bolding an
  in-group label puts it back at the heading's weight and undoes the grouping.
- **`**Needs attention**` asserts something, so it renders only when a gate is not ✅.** Over an
  all-✅ table it would say the opposite of what the table says. **Gate 2 (CI) is deliberately not
  consulted** — it warns and never fails, so a red build must not label the gate table; CI lives in
  the `Run` group with the rest of the run context.
- **A lens with nothing to report is named once in a footnote**, never on a line of its own.

#### Quiet lenses collapse into a footnote

```markdown
<sup>Nothing to report — standards (1 doc), optimality (3 judged), measurability (4 paths classified), integrations (not activated), severity, 0 files skipped.</sup>
```

Six slots are collapsible, and **emptiness is read from each one's own documented grammar** — never
guessed from prose length or a bare substring search:

| Slot | Quiet when | Footnote entry |
| --- | --- | --- |
| `STANDARDS_LOG` | begins `skipped`, or contains `0 finding(s)` | `standards (<N> doc[s]>)` · `standards (skipped)` |
| `OPTIMALITY_LOG` | begins `skipped`, or contains both `0 proposal(s)` and `0 withheld` | `optimality (<N> judged)` · `optimality (skipped)` |
| `MEASURABILITY_LOG` | begins `skipped`, or contains both `0 missing` and `0 unlinked` | `measurability (<N> paths classified)` · `measurability (skipped)` |
| `INTEGRATIONS` | exactly `not activated`, or begins `skipped` | `integrations (not activated)` · `integrations (skipped)` |
| `SKIPPED_FILES` | exactly `none` | `0 files skipped` |
| `FINDINGS` | empty, so no tier was posted | `severity` |

Two rules follow, and both are enforced:

- **A lens renders as its own line xor a footnote entry — never both, never neither.** Both would
  say the same thing twice; neither would silently drop a lens's run-state, which is what the
  always-render shape was paying vertical space to avoid.
- **An unrecognised value renders its own line.** The fallback is *more* visible, never silence: a
  producing rule that changes its wording loses the collapse, not the information.

You still supply these slots exactly as before — required, prose, one line each. Whether a value is
worth a line is the renderer's decision, not the run's, precisely so two runs with the same state
render the same report.

**Do not write a markdown link into a structured field.** `path`, `ask`, `body`, `key` and `note`
carry text, not markup — the renderer builds the link from `url`. Markdown link syntax in any of
them is rejected, because that is how a link once shipped caged inside a code span and rendered as
dead monospace text.

**Backticks: banned in the identifier fields, kept in the prose ones.** `path` and `key` are wrapped
in a code span by the renderer, so a backtick inside one would terminate that span — rejected.
`ask`, `body` and `note` are prose and **may** carry inline code, because `ask` is another bot's
lead line reproduced "truncated, not paraphrased" (Step 1.0) and those lead lines name symbols in
backticks. Rejecting them there would abort the render on exactly the input this agent is told to
supply.

**Unknown keys are a hard error**, at the top level and inside every object. A typo'd or
misremembered name exits 1 and the run posts no report — so does a v1-shaped payload (`FOOTER_LINE`,
`RUN_MODE`, `MEMORIES`, or any `*_COUNT`), and the error names the replacement.

There is no way to add a section: every rendered block comes from the template. If a run has
something to say that no slot covers, it belongs in the Step 5 terminal output.

#### Headlines

**The headline is derived, not written.** Supply `VERDICT`, `FINDINGS[]`, `SUMMARY`, and the reasons
array; the renderer builds the region. There is no `HEADLINE` slot — it was the most-read line in
the report and the only one checked merely for non-emptiness, which is how a headline matching none
of the documented forms shipped on `dash0hq/dash0#18362`.

The rendered region is a `### ` heading, then the summary sentence, then the reasons, then an
optional advisory note:

| Condition | Heading |
|---|---|
| `FINDINGS` non-empty | `### <worst-tier glyph> <N> findings — <K> blocking` (the ` — <K> blocking` clause is dropped at `K == 0`, never rendered as `0 blocking`) |
| empty, `VERDICT: PASS` | `### ✅ No issues found` |
| empty, `VERDICT: WARN` / `FAIL` | `### <verdict glyph> No findings — <M> gates need attention` |

**It counts findings, not gates.** The old headline counted gate statuses (`1 error, 2 warnings`)
while the inline comments were findings, with nothing reconciling the two numbers — which is most of
why the report and the inline surface read as unrelated. The number a PR author acts on is the
finding count, so it leads; gate state is named in the reasons line below it. `<N>` is
`FINDINGS.length` and `<K>` is the `blocking` subset, so neither can disagree with the findings
index directly beneath.

`### ` is also the report's identity marker: an inline finding never uses a heading
(`comment-shape.md § Shape` forbids one and uses a bold title line instead), so a reader can tell
the two surfaces apart without reading a marker. The renderer refuses to emit a body with no `### `
line.

**`VERDICT` is cross-checked against the gate table and a disagreement is rejected.** Any ❌ implies
`FAIL`; otherwise any ⚠️ implies `WARN`; otherwise `PASS`. Gate 2 (CI) has no table row —
`CI_NOTE` is its whole surface — and `CI_NOTE` **never counts as a gate**: CI is a timing/branch
fact, not a signal about the diff, and a red or pending check can never move the verdict away from
what the five real gates already say — a `PASS` may carry a populated `CI_NOTE`. A `reviewer-lessons` entry records a
posted gate table reading PASS while the run's own contract said FAIL; the gates decide, and a
mismatch now stops the render rather than shipping the contradiction.

Never open the headline with ``Reviewed `<sha>` —``; that is Step 4b's degraded pointer body (the
ordinary pointer is marker-only), and grafting it onto a report is how the report ended up in a
review body.

`SUMMARY` — one sentence, ≤ 240 chars, single line, about **the change** rather than about the
report. It is the only part of this region that needs judgment.

`FAIL_REASONS` / `WARN_REASONS` — **arrays** of terse noun phrases (≤ 8 words each), the important
bit distilled from each ❌ (resp. ⚠️) gate's Details, derived from the gate and never a copy of the
cell, most-severe first. The renderer joins them and renders `**Blocking:** …` on a FAIL or
`**Warnings:** …` on a WARN, keeping the first two and appending `; +<k> more` beyond that — the
~140-char bound expressed as a list bound, so it cannot be exceeded by wording.

`FAIL_REASONS` carries **one phrase per ❌ gate**, which the renderer enforces, and CI is never
among them because CI cannot be ❌. Warning gates on a FAIL run are named in the accordion, not
here.

**The advisory note.** When `LOW_CONFIDENCE_FINDINGS` is non-empty the renderer adds
`<sub><N> advisory finding(s) below the confidence bar — see *Less certain* below.</sub>`, derived
from the array. It renders on every verdict, not only PASS: the reason it exists is that a headline
must not overstate cleanliness while advisory `issue:` entries sit below it, and that is as true of
a WARN as of a PASS.

| Gate | ❌ reason phrase (FAIL_REASONS) | ⚠️ note phrase (WARN_REASONS) |
|---|---|---|
| Prior review feedback | `<K> unanswered blocking review thread(s)` | `<N> open review thread(s)` |
| Documentation | `docs missing for <thing>` · `<N> doc gap(s)` | — |
| Self-review signals | `debug logs left in` · `leftover TODO/stub` | — |
| Code review | `<K> blocking finding(s) (see inline)` | `<N> non-blocking finding(s)` |
| Description vs. code | — (soft gate — warns, never fails) | `description omits <thing>` |
| CI (Gate 2) | — (**informational-in-`Run`, never a gate** — see *Gate states*) | — (never a warning gate either; the substance renders as a `Run` line via `CI_NOTE`) |

The old `FAIL_BLOCKING_SUFFIX` slot is retired: the blocking-finding count now rides inside the
Code-review entry of `FAIL_REASONS` (`(see inline)`), so the pointer is kept without a second clause.

`PARTIAL_BANNER` is the review-body slot for the tool-budget stop condition. Omit the
placeholder entirely on a complete run — the line disappears and the body starts at the summary
sentence. When the budget was exhausted, substitute exactly one line, followed by a blank line:

```markdown
⚠️ **Partial review — tool budget exhausted after \<N\> calls; \<M\> of \<T\> files scanned.**
```

It sits directly under the `<!-- PR_REVIEWER_REPORT -->` marker, above the headline, so a
truncated run can never be read as a complete PASS.
This is the only prose permitted outside the templates, and it is permitted because the stop
condition requires it in both the terminal report and the review body.

### The Gate 3 open threads: the count on the summary, the list in the accordion

Gate 3's open-thread state renders across **two** slots, and the split is the contract:

| Slot | Where | What it carries |
| --- | --- | --- |
| `OPEN_THREADS_SUFFIX` | appended to the `Review details` `<summary>` — **always visible** | the open count and, on ❌, the blocking subset |
| `OPEN_THREADS_LIST` | **inside** the accordion, immediately after the gate table | the per-thread bullets and the `resolved since` progress |

**The counter rides on the `<summary>` rather than on a line of its own.** The summary is already
visible when the report is collapsed *and* it is the control the reader clicks, so putting the count
there costs zero vertical space and makes the label name its own destination. A separate notice
paragraph would restate what the headline already says (`FAIL_REASONS` / `WARN_REASONS` carry a
Prior-bot-feedback phrase in both non-passing states) and would point one line down the page at the
accordion — two sentences to convey a click target that is already on screen. Do not reintroduce
one.

Render **both** slots whenever Gate 3 (`Prior review feedback`) is ⚠️ or ❌ — i.e. whenever
`OPEN_BOT_COMMENTS[]` is non-empty — in the FAIL template *and* the WARN template alike; substitute
**both** as empty on ✅ and `⏭️`, leaving the bare `<summary>Review details</summary>`. Rendering one
without the other is a guard failure (`F-report-hand-rendered`): a suffix alone advertises a
list that is not there, and a list alone is invisible in the collapsed report.

Downgrading a non-blocking open thread to ⚠️ must not make it invisible: the verdict softens, the
worklist does not shrink, so both slots follow the open set rather than the verdict.

#### `OPEN_THREADS_SUFFIX` — the counter on the summary

Substitute one of two forms, chosen by the gate's status — the blocking subset is named only when
there is one, because `(0 blocking)` is noise on a gate that is not blocking anything:

```markdown
 — <N> open review threads (<K> blocking)
```

On ⚠️ (nothing blocking), the parenthetical is dropped:

```markdown
 — <N> open review threads
```

Rules for the suffix:
- **It is a suffix, not a line.** It renders inside the `<summary>` tag, directly after
  `Review details`, producing e.g. `Review details — 2 open review threads (1 blocking)`. Plain text
  only — no `<sup>`, no bold, no nested block elements, none of which GitHub renders in a
  `<summary>`.
- **`<N>` is the full open count**, never the blocking subset — the worklist size is what the
  reader is being told. `<K>` is the blocking unanswered subset, the part that actually moves the
  verdict. Use the singular `thread` at exactly 1. Never render `(0 blocking)`.
- **Nothing else may be appended to the summary.** It has exactly one job: name the actionable
  worklist inside. Run-state diagnostics — memories, run mode, quality, integrations, optimality,
  standards — render as their own lines *inside* the accordion and never as summary tags. The
  retired `MEMORIES_USED_SUFFIX` is the cautionary case: it duplicated `MEMORIES_SECTION`'s own
  header and spent the report's one scannable line on `(0 memories used)`.

#### `OPEN_THREADS_LIST` — the bullets, inside the accordion

Substitute one entry per item in `OPEN_BOT_COMMENTS[]` **as it stands after Step 2.9c**
(order: same file grouped, then by line), using the `path:line`, `url`, and `ask` fields from
Step 1.0:

```markdown
**Open review threads (<N>)**RESOLVED_SINCE_SUFFIX

- [\`packages/cli/README.md:680\`](<url>) — bound \`LocalStore.search\` the way \`RemoteStore\` is (bot · \`cursor\`)
- [\`packages/cli/src/install.mjs:291\`](<url>) — add the missing parity test for the event roster (human · \`umanwizard\`)
- [\`packages/cli/src/core/lessons.mjs:843\`](<url>) — cap \`LocalStore.search\` per-prompt walk (bot · \`cursor\`)
```

Rules for the list:
- **No nested `<details>`.** It is already inside the `Review details` accordion; a second collapse
  would put the worklist two clicks from the reader. The bold lead line is its whole heading, and
  `<N>` there is the same full open count as `OPEN_THREADS_SUFFIX` — the two must agree.
- **The list always renders every open thread**, on ⚠️ exactly as on ❌. Never drop a thread from it
  because it is non-blocking; only the suffix's framing changes with severity.
- **`RESOLVED_SINCE_SUFFIX` reports progress here, next to the list it describes.** Substitute
  ` <sup><RESOLVED_SINCE_PRIOR> resolved since \`<PRIOR_SHA_SHORT>\`</sup>` only when
  `RESOLVED_SINCE_PRIOR > 0`; substitute nothing otherwise (never `0 resolved`). The clause names
  no noun — it reads `4 resolved since \`abc1234\`` — so there is nothing to pluralise and `1
  resolved since` is correct at exactly 1. It stays off the `<summary>`, which takes plain text only
  and is reserved for the worklist count. When Gate 3 is ✅ this whole slot is omitted, so the counter moves into
  Gate 3's Details cell instead — see *Rules for table cells*.
- **Every `path:line` is a Markdown link** to the thread's `html_url`, with the truncated `ask`
  after an em-dash. If an item's `url` is missing (older fetch, or the permalink could not be read),
  render its `path:line` as inline code with no link rather than a broken link, and keep the `ask`.
- **Each bullet names who opened the thread and whether they are a bot or a human.** The renderer
  appends `` (bot · `<author>`) `` or `` (human · `<author>`) `` from the item's `is_bot` / `author`
  fields (Step 1.0). This is the fix for the report calling a human reviewer's thread a "bot
  thread": the aggregate wording is author-neutral ("review thread") and the per-thread tag carries
  the distinction. The login is code-wrapped, not an `@mention`, so re-rendering the sticky each run
  never pings the reviewer. When a payload omits the fields the tag is dropped, never guessed.
- **A resolved thread is removed, never ticked.** The list renders only what is still open. Because
  the sticky is rewritten each run, the list shrinks as threads close, and it disappears entirely
  when Gate 3 goes ✅ — which is the omit rule above, applied per item instead of all-or-nothing.
- **Plain bullets, not task-list checkboxes.** The list is machine-owned: it is regenerated from
  `isResolved` on every run, so a `- [ ]` box would offer a control whose tick means nothing
  (`isResolved` is the authority — `prior-comment-awareness.md § Thread state`), gets overwritten by
  the next patch, and would contradict Gate 3's ❌ or ⚠️ while it survived. Do not reintroduce
  checkboxes.
- **Actionable-only** — the unresolved threads and nothing else; never restate the gate table,
  tally, or other findings. It is a rendering of Gate 3 state, not a new finding, so it is never
  auto-applied or ingested (`reviewer-report-ingest.md`).

**The three accordion summaries are written for a PR author, not for the pipeline.** They used to
read `Additional findings (3) — cleared review, not inlined`, `Low-confidence findings (1)`, and
`Optimality review (1) — is this the best approach?`. "Cleared review" means *passed the verifier*,
and every author reads it as *dismissed* — so the one accordion holding real, verified findings was
labelled as the one holding nothing. The pipeline vocabulary (`cleared`, `deferred`, `below-bar`,
`produced → posted inline`) stays in the state record, the diagnostics, and the terminal report,
where the audience is the operator. `reviewer-report-ingest.md` keys on these literals, so a reword
here changes that grammar in the same commit — which is exactly what its own rule requires.

`OPTIMALITY_SECTION` renders the Step 2.4c proposals. Omit the placeholder entirely when there
are no proposals — the quiet early-exit must stay quiet. Otherwise substitute:

```markdown
<details>
<summary>Is there a better approach? (<OP>)</summary>

### Optimality proposal — src/api/client.ts:180

> **Reuse \`withRetry()\` instead of hand-rolling a retry loop**

| | Approach |
| --- | --- |
| **Now** | A hand-rolled retry loop with a fixed 200 ms sleep. |
| **Better** | Have you considered \`withRetry()\` from \`src/lib/retry.ts\`, already used by the other three clients? |

**Why it's better** · _codebase-fit_ — one backoff policy instead of four, and it already honours the abort signal.
**Trade-off** · none material — \`withRetry\` is a drop-in with the same call shape.
**Evidence** · \`withRetry\` — \`src/lib/retry.ts:14\`, 3 call sites

<sub>Intent: Retry transient upstream failures. · Blast radius: \`src/api/client.ts\` only · Confidence: 88%</sub>

</details>
```

One card per proposal, at most 2, from
`skills/quality/optimize-approach/templates/proposal.template.md`. Keep the headline a crisp
statement, but frame the **Better** row as a question — cross-review context asymmetry. Proposals
are **never** posted as inline comments and never affect the gate table or the verdict.

`ADDITIONAL_FINDINGS_SECTION` renders the deferred findings from Step 2.9b — the findings that
cleared every quality gate but did not fit the inline caps. Omit the placeholder entirely when
`DEF == 0`; otherwise substitute:

```markdown
<details>
<summary><DEF> more findings — verified, too minor to comment on</summary>

- `src/api/client.ts:214` — issue: retry loop re-sends the request body after a 413. (confidence 92)
- `src/api/client.ts:260` — suggestion: extract the backoff calculation; it is duplicated below. (confidence 84)

</details>
```

One line per deferred finding: path:line, prefix, the one-line body, and the confidence score.
Sort by prefix priority, then descending confidence. This section is the reason a placement cap
is allowed to exist — never drop a cleared finding instead of listing it here.

`LOW_CONFIDENCE_SECTION` renders the near-miss `issue` / `suggestion` findings deferred at Step 2.7
(`per-comment-confidence.md § Drop vs. defer`) — grounded and receipt-checked, but scored just under
the confidence bar. It is **advisory**: these findings were not confident enough to inline, so they
are surfaced for a human to weigh, never auto-applied (`reviewer-report-ingest.md § Low-confidence
findings are advisory`). Omit the placeholder entirely when `CADV == 0`; otherwise substitute:

```markdown
<details>
<summary>Less certain (<CADV>) — advisory, below the confidence bar</summary>

- `src/api/client.ts:88` — issue: this early-return may skip the audit log write. (confidence 76)
- `src/api/client.ts:132` — suggestion: consider hoisting the client construction out of the loop. (confidence 71)

</details>
```

One line per advisory finding: path:line, prefix, the one-line body, and the confidence score, in
the same shape as `Additional findings`. Sort by prefix priority, then descending confidence. These
findings are distinct from `Additional findings` (which are *cleared* findings merely over the inline
cap) and must not be mixed into that section — the two carry different confidence guarantees.

**Carried anchorless entries.** Entries carried from the prior review body per
`prior-comment-awareness.md § Carry-forward of anchorless findings` render in their own section —
a carried gate finding in the gate-status table's Details cell, a carried optimality card in
`OPTIMALITY_SECTION`, a carried 2.4d run-state on the `Standards — ` log line — each
suffixed ` (carried from <PRIOR_SHA_SHORT>)`. The suffix is mandatory: it is the only
thing distinguishing a finding this run verified from one it merely preserved because the owning
step was skipped. A carried entry never changes the gate table's ✅/⚠️/❌ status, which Step 1.8
always sets from the current PR state, and never affects the verdict.

`MEMORIES_SECTION` is the persistent memory block inside `Review details`, the last entry in the
`Run` group (replacing the old applied-only list). It **always renders** — never omit the slot. `LOREKIT_CONNECTED` selects which
of the two shapes below it takes, so a reader always sees either both counts or an explicit
`not connected`, not only when something fired.

- **Connected** (`LOREKIT_CONNECTED=true` — the `mcp__lorekit__memory_list` attempt succeeded) — a header line, followed (only when `MEMORIES_USED_COUNT > 0`) by one bullet per
  entry in `APPLIED_MEMORIES[]` (Step 2.2), each a pressable LoreKit link so the reader can open the
  exact memory and see why a finding was dropped, downgraded, or promoted:

  ```text
  Memories — <MEMORIES_READ_COUNT> indexed · <MEMORIES_USED_COUNT> used

  - [`issue:missing-abort-signal`](<url>) — promoted, seen 3×
  - [`nitpick:map-vs-record-preference`](<url>) — downgraded, seen 2×
  ```

  When `MEMORIES_USED_COUNT` is 0, render only the header line (`… indexed · 0 used`), no bullets.
  This is the **rendered** shape, not the payload: supply `MEMORIES_SUMMARY: "<N> indexed"` and the
  `APPLIED_MEMORIES[]` bullets as `MEMORIES_USED`, and the renderer derives ` · <N> used` from that
  array — so `MEMORIES_USED_COUNT` is never typed by hand and can never disagree with the bullets.
- **Not connected** (`LOREKIT_CONNECTED=false` — the `mcp__lorekit__memory_list` tool call still errored after the Step 1.0 retries were exhausted, or the tool was unavailable: not in the agent's `tools:` grant, or the LoreKit MCP server did not connect this session so the tool is unregistered — `No such tool available`) — render exactly `Memories — not connected`, no bullets.
  This shape MUST NOT appear when the read was merely skipped or assumed, nor off a single transient throw — it only appears after a genuine failed attempt that survived retries.

`MEMORIES_READ_COUNT` is how many memory records were loaded into the index — relevance rules
(Step 1.0) **plus** knowledge and hotspot records (Step 1.2a), the three families
[`memory.md`](./memory.md) defines. `MEMORIES_USED_COUNT` = `|MEMORIES_USED|`, how many actually
fired (a relevance drop, downgrade or promote; a knowledge fact or hotspot counter that reached a
finder). Indexed is always ≥ used — a run can index memories and apply none — and the renderer
enforces it, so the two halves must count the same three families: a relevance-only `indexed`
beside a `used` that includes a hotspot fails the whole report closed. The bullet count MUST equal
`MEMORIES_USED_COUNT`.

Build each `<url>` from the memory's retained `scope` + `key`, per
`comment-relevance-memory.md § Linking applied memories in the report` — the
`lorekit link "<scope>" "<key>"` CLI when it is on `PATH`, else the documented
`{base}/lore?scope=<enc>&lesson=<enc>` construction (`base` = `LOREKIT_APP_URL` or
`https://lorekit.io`), else a plain-text `` `<scope> · <key>` `` identifier — never a
fabricated URL.

**There is no memories tag on the `<summary>`.** The retired `MEMORIES_USED_SUFFIX` appended
` (<N> memories used)` there, restating the `Memories` line a few lines below and spending the
report's one scannable line on a number that is `0` on most runs. The template has no such slot and the renderer
rejects the key, so this is now impossible rather than merely forbidden.

#### The accordion is the renderer's job, not yours

The `Review details` `<details>` wrapper, the absence of an `open` attribute, the order of the
lines inside it, and the fact that the gate table sits within it rather than above it are all
properties of [`templates/report-body.md`](../templates/report-body.md). The renderer
asserts each one as a post-condition and exits non-zero if a template edit breaks it, so there is
nothing here for a run to remember, get wrong, or be guarded against. `F-report-accordion-flattened`
and `F-report-accordion-expanded` are now render-time errors rather than review-time findings.

The visible surface of a report is therefore whatever the template leaves outside the accordion:
the marker, an optional partial-review banner, the headline, and the collapsed `<summary>` lines of
the optional `<details>` blocks. A harness-appended attribution footer may also appear; it is not
authored here and must not be suppressed or reproduced.

Rules for table cells:
- Gate 2 (CI) is excluded from the table — GitHub's checks section shows it.
- The table is always three columns — `| Gate | Status | Details |` — on the PASS (all-clear),
  WARN, and FAIL bodies alike.
- Details column: plain text only, max 120 chars per cell.
- When a gate PASSES (✅), its Details cell shows the short static description of what the gate
  checks, verbatim from the table below.
  Two exceptions, both on Gate 3, and neither changes the ✅ status or the variant selection:
  - When Gate 3 passed on **unverified** thread state (state unavailable or the thread map
    incomplete — see *Gate 3*), its Details cell holds
    `thread state unavailable — <N> comment(s) unverified` instead of the static description.
  - When Gate 3 passed under `RESOLUTION_UNAVAILABLE`, its Details cell holds
    `<N> thread(s) certified done but still open — no resolve path this run.` **This wins over both
    other exceptions.** The threads are open on GitHub; a cell claiming otherwise is the same
    report-disagrees-with-GitHub failure the carve-out exists to surface, inverted. This is also the
    only place the count reaches the author — the Step 5 terminal report is not a surface they see.
  - When Gate 3 passed and `RESOLVED_SINCE_PRIOR > 0`, its Details cell holds
    `All review threads resolved — <RESOLVED_SINCE_PRIOR> closed since \`<PRIOR_SHA_SHORT>\`.`
    `OPEN_THREADS_LIST` — where the counter normally renders — is omitted whenever Gate 3
    is ✅, so without this the run that clears the **last** open thread reports no progress at all,
    which is the run with the most progress to report. The unverified text wins if both apply: an
    unread thread map is the more important thing to say.
- When a gate WARNS (⚠️) or FAILS (❌), its Details cell shows the specific finding text (max 120
  chars — truncate; the full finding lives in the inline comment), exactly as before.
  Gate 3 is the one exception in both non-passing states: its cell stays terse —
  `<N> unresolved review thread(s) — see the thread list below` — because the finding text is the
  linked checklist, which lives in `OPEN_THREADS_LIST` a few lines further down this same accordion
  and would not survive the 120-char cap. The pointer wording is the same on ⚠️ and ❌; only
  `OPEN_THREADS_SUFFIX` on the summary changes framing between them.
- `⏭️` is a valid Status value in **every** body variant — PASS, WARN, and FAIL — in addition to the
  values each variant's table shows. It appears only under `--skip-gates`, for Gates 1 / 3 / 4 / 5,
  and its Details cell holds the carried prior text plus its `(carried from …)` suffix when Step 2.5c
  dispositioned the row `CARRY`, and `not evaluated this run` otherwise (see *Gate states*).
  A `⏭️` row never counts toward `FAILING_GATE_COUNT` and never selects the WARN or FAIL variant.

Static descriptions (shown verbatim in the Details cell when the gate is ✅):

| Gate | Static description (shown on ✅) |
| --- | --- |
| Description vs. code | The description matches what the diff does. |
| Prior review feedback | Earlier review comments are resolved. |
| Documentation | The change is documented well enough to follow. |
| Self-review signals | No debug logs, leftover TODOs, or unreviewed stubs. |
| Code review | The multi-lens review found no blocking issues. |

- Headline finding-count substitution: `N` = total surfaced findings = `F` (posted inline) +
  `DEF` (deferred); `K` = blocking count = inline findings decorated `(blocking)` per
  `conventional-comments.md` (Step 2.9) — NOT the `issue:` prefix count, since a non-blocking
  `issue:` is not blocking (see *Gate states*).
  These reuse the Quality-line values already computed at Step 2.9b — no separate counter.
- `WARN_GATE_COUNT` = the number of gates showing ⚠️ in this run — Description vs. code,
  Prior review feedback, and/or Code review, so 0 to 3. CI is deliberately excluded from this set:
  it is informational-in-`Run`, not a graded gate, so a CI-only red or pending check with all other
  gates ✅ correctly renders `**0 warning(s)**` and a clean PASS headline — CI is a timing/branch
  fact, not a signal about the diff, and the orchestrators already own CI convergence. It counts ⚠️ gates on a **FAIL** run too, not only a
  WARN run, so the Step 3 terminal FAIL verdict's `SEVERITY_TALLY` can report warnings alongside
  errors. (`SEVERITY_TALLY` is a **terminal-only** term now — see
  [`terminal-report.md`](./terminal-report.md); the posted headline counts findings.)
  The top-level WARN headline leads with `WARN_GATE_COUNT`, not the finding count `N`, so it reads
  correctly even when there are zero inline findings (a Description-vs-code-only warning).
  `WARN_GATE_COUNT` does not appear in the accordion gate table, which renders per-gate ✅/⚠️ marks
  rather than a count; its rendered uses are the Step 3 terminal WARN/FAIL verdict lines and the
  Step 3 terminal WARN/FAIL verdict lines. It no longer reaches the posted headline, which counts
  findings and names gate state in its reasons line instead.
- Never add rows, sections, or prose outside the template above (except the four `<details>`
  blocks — `Review details`, `Optimality review`, `Additional findings`, and
  `Low-confidence findings` — the three group headings, the `MEMORIES_SECTION` and
  `OPEN_THREADS_LIST` slots and the `Nothing to report` footnote inside `Review details`, the
  `OPEN_THREADS_SUFFIX` tag on its `<summary>`, and the `PARTIAL_BANNER`, `FINDINGS_INDEX` and
  `FOOTER_SUP` lines — all of which are slots in the template, not added prose).
  Besides the headline region (headline, `SUMMARY`, reasons, advisory note), the banner, the
  findings index, and the footer — all renderer-derived or renderer-validated, never hand-composed
  — **no** prose of the agent's own is permitted at the top level of the body.
- Praise findings are dropped entirely — do not add them to the table, inline comments, or body prose.

### INLINE_COMMENTS_JSON format

A valid JSON array. Each entry **must** include `side`, and **`body` is never hand-written** — it is
the stdout of [`render-comment.mjs`](../scripts/render-comment.mjs), one invocation per finding:

```bash
RENDER_COMMENT="${AGENT_MD%/pr-reviewer.md}/pr-reviewer/scripts/render-comment.mjs"
BODY=$(node "$RENDER_COMMENT" /tmp/finding-1.json) || abort "finding 1 did not render"
```

Resolve `$RENDER_COMMENT` from `$AGENT_MD` with the same `resolve()` idiom Step 1.2 uses for
`CLASSIFY` — a bare relative path only happens to work when the shell's cwd is this repo's own
checkout. The script fails closed and prints nothing on stdout when it rejects a payload, so a
finding that does not conform is **dropped and logged**, never posted half-formed. The payload keys
are in [`comment-shape.md § The payload`](../../shared/rules/comment-shape.md); do not compose the
body yourself, and do not repair one the renderer rejected — a body that fails its checks was not
built from the payload, and editing it into shape reintroduces exactly the drift the renderer
removes.

**Every finding you post inline also becomes one `FINDINGS[]` entry in the report payload**, carrying
the same `title` you gave the renderer. That is what makes the report's index and the inline comments
one worklist instead of two unrelated numbers, and the report renderer rejects a `FINDINGS` length
that disagrees with `QUALITY`'s `posted inline <N>`.

```json
{
  "path": "relative/file/path",
  "line": <integer RIGHT-side line number>,
  "side": "RIGHT",
  "body": "<the renderer's stdout, verbatim>"
}
```

For multi-line comments, also include `start_line` and `start_side`:

```json
{
  "path": "relative/file/path",
  "start_line": <first RIGHT-side line>,
  "start_side": "RIGHT",
  "line": <last RIGHT-side line>,
  "side": "RIGHT",
  "body": "conventional-comments formatted body"
}
```

Use `[]` if no surviving inline findings.
The `side` field is required by the GitHub API — omitting it returns HTTP 422.

The reference renderings live in `scripts/eval/fixtures/inline-comment/*.expected.md` — readable
markdown, diffed by L1 (`G46`), and the answer to "what is an inline finding supposed to look like".
