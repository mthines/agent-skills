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

Pick the body by verdict, exactly as in Step 3 (see *Gate states*): **PASS** (all clear), **WARN** (hard Gates 4/5 ✅ and at least one graded gate — Description vs. code, CI, Prior review feedback, or Code review — is ⚠️, none ❌; still a PASS verdict), or **FAIL** (Gate 4 or Gate 5 fails, or Prior review feedback / Code review is ❌). Gate 2 (CI) is excluded from the failing-gate count in every case.

#### REPORT_BODY payload

One JSON object. **It is data, not markdown.** Anything with a count, a link, or a shape a
documented consumer parses is supplied *structured* and derived by the renderer — you never write
the count, never write the link, never format the run-mode or footer line. That is deliberate: each
of those was a real defect before it became derived.

**Required — scalars.** Prose only; no counts, no links, no parsed shapes:

| Key | Content |
| --- | --- |
| `HEADLINE` | The one-line verdict sentence (see *Headlines* below). |
| `GATE_DESCRIPTION_STATUS` · `GATE_PRIOR_STATUS` · `GATE_DOCS_STATUS` · `GATE_SELFREVIEW_STATUS` · `GATE_CODEREVIEW_STATUS` | One of `✅` `⚠️` `❌` `⏭️`. Gate 2 (CI) is not a row — it renders via `CI_NOTE`. |
| `GATE_DESCRIPTION_DETAILS` · `GATE_PRIOR_DETAILS` · `GATE_DOCS_DETAILS` · `GATE_SELFREVIEW_DETAILS` · `GATE_CODEREVIEW_DETAILS` | The Details cell. **Single line, no `\|`, ≤ 120 chars** — all three enforced; the full finding belongs in an inline comment. |
| `MEMORIES_SUMMARY` | The **indexed half only** — `<MEMORIES_READ_COUNT> indexed`, or `not connected`. Never write ` · <N> used`: the renderer derives that from `MEMORIES_USED`'s length and rejects a payload that supplies its own, reports fewer indexed than used, or pairs `not connected` with a non-empty `MEMORIES_USED`. |
| `QUALITY` | Must begin `produced <N> → posted inline <N> …`. |
| `INTEGRATIONS` | Names + versions + spec URLs, or `not activated`, or `skipped (incremental-quick)`. |
| `OPTIMALITY_LOG` · `STANDARDS_LOG` | Must begin `ran` or `skipped (reason)` so the run-state parses. |
| `SKIPPED_FILES` | A list, or `none`. |

**Required — `RUN`**, the object the footer line and the `Run mode` line are both derived from:

```json
{ "RUN": { "mode": "full", "sha": "c3ceb87", "prior_sha": "70cf147", "delta_lines": 256 } }
```

- `mode` — `full` · `incremental` · `incremental-quick` · `zero-delta`.
- `sha` / `prior_sha` — **exactly 7 lowercase hex chars** (`${SHA:0:7}`). `prior_sha` is required for
  every mode except `full`. The renderer rejects a longer sha, which is what stops one report
  carrying a 40-char sha in the footer and a 7-char sha in a prose line.
- `delta_lines` — integer, required unless `mode` is `zero-delta`.

The `Run mode` line renders as `<mode> · <N> lines in delta`, which is the shape
`reviewer-report-ingest.md` parses. Extra colour goes in the optional `RUN_NOTE` scalar and is
appended after it, so the parseable prefix survives.

**Optional — structured.** Omit a key to omit its whole block. Counts are **derived from array
length**, so there is no count to supply and none to get wrong:

| Key | Shape | Notes |
| --- | --- | --- |
| `OPEN_THREADS` | `[{path, line, url?, ask, blocking?, author?, is_bot?}]` | The renderer builds the bullet `- ` + a link whose text is `` `path:line` `` and whose target is `url`, then ` — ask`, then an author tag `` (bot · `author`) `` or `` (human · `author`) `` when `is_bot`/`author` are supplied (omitted when they are not); it derives `Open review threads (N)` and the `<summary>` suffix, and appends ` (K blocking)` only when some item has `blocking: true`. `is_bot` is a boolean (thread author's GitHub type is `Bot`); `author` is the login, code-wrapped by the renderer so it does not `@mention`. A missing `url` renders unlinked inline code, never a broken link. |
| `RESOLVED_SINCE` | `{count, sha}` | Suppressed at `count: 0`. Rejected when `OPEN_THREADS` is empty — with Gate 3 clean the counter belongs in its Details cell. |
| `MEMORIES_USED` | `[{key, url?, note?}]` | One bullet per applied memory, under `MEMORIES_SUMMARY`. |
| `ADDITIONAL_FINDINGS` | `[{path, line, url?, prefix, body, confidence}]` | `prefix` is a Conventional-Comments prefix; `confidence` an integer 0–100. |
| `LOW_CONFIDENCE_FINDINGS` | `[{…same…}]` | Advisory only (`reviewer-report-ingest.md`). |
| `OPTIMALITY_CARDS` | `[markdown, …]` | The one place model-authored markdown remains, because a card is a multi-line block with its own table. Each must contain a `### Optimality proposal — <path>:<line>` heading, which the renderer checks. |
| `PARTIAL_REVIEW` | `{calls, scanned, total}` | Integers; emits the tool-budget banner. |

**Optional — scalars:** `CI_NOTE` (Gate 2's substance — which checks are red and on what),
`VERIFIED_NOTE` (what this run checked itself), `QUALITY_DROPPED`, `RUN_NOTE`.

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

`HEADLINE` is one line, chosen by the Step 3 verdict:

- **PASS** (every gate ✅) — `✅ Reviewed your changes — no issues found.` The leading `✅` is the
  whole affirmation: no praise phrase, no extra emoji. When `CADV > 0`, append
  ` <CADV> advisory finding(s) below the confidence bar (see Low-confidence findings).` so the
  headline does not overstate cleanliness while advisory `issue:` entries sit below it.
- **WARN** — `Reviewed your changes — no blocking issues, **<WARN_GATE_COUNT> warning(s)**: <WARN_REASONS>.`
- **FAIL** — `Reviewed your changes — **<SEVERITY_TALLY>** need attention before human review. Blocking: <FAIL_REASONS>.`

Never open the headline with ``Reviewed `<sha>` —``; that is Step 4b's degraded pointer body (the
ordinary pointer is marker-only), and grafting it onto a report is how the report ended up in a
review body.

The FAIL headline leads with a fixed severity tally; the WARN headline leads with its warning
count. Both then name the important bit from each flagged gate — so a reader takes in *how bad* and
*why* in one glance without opening the accordion.

`SEVERITY_TALLY` (the **FAIL** headline and the Step 3 FAIL verdict only) — the count skeleton,
wrapped as one bold span by the headline (`**<SEVERITY_TALLY>**`), ordered errors-then-warnings.
Substitute `<FAILING_GATE_COUNT> error(s)`, and append `, <WARN_GATE_COUNT> warning(s)` only when
`WARN_GATE_COUNT > 0` (omit the warnings term at 0 — never render "0 warnings"). Pluralise each
noun against its own count (`1 error, 2 warnings`; `2 errors`).

**CI never appears in the tally.** There is no `CI failing` prefix and no CI token of any kind: red
CI is a ⚠️ like any other warning gate, so it is counted in `<WARN_GATE_COUNT>` and named in
`WARN_REASONS`. A CI failure can therefore no longer produce a FAIL on its own — with no failing hard
gate and no ❌ there is nothing to tally, and the run renders the WARN headline. The **WARN** headline
does not use `SEVERITY_TALLY` — with no errors it renders `**<WARN_GATE_COUNT> warning(s)**` directly.

`FAIL_REASONS` / `WARN_REASONS` — the important bit **distilled** from each ❌ (resp. ⚠️) gate's
Details into a terse noun phrase (≤ 8 words), derived from the gate, never a copy of the cell;
most-severe first, joined by `; `. `FAIL_REASONS` carries **one phrase per ❌ gate** — and CI is
never among them, because CI cannot be ❌ — so it matches the tally's *error* count, NOT the full tally:
the warning gates are counted in the tally but named only in the accordion, never in the FAIL
headline (so `1 error, 2 warnings` carries exactly one `FAIL_REASONS` phrase). `WARN_REASONS` carries
one phrase per ⚠️ gate. Keep the whole line to one sentence-plus-clause; cap the reasons at ~140
chars — if longer, keep the top two and append `; +<k> more`.

| Gate | ❌ reason phrase (FAIL_REASONS) | ⚠️ note phrase (WARN_REASONS) |
|---|---|---|
| Prior review feedback | `<K> unanswered blocking review thread(s)` | `<N> open review thread(s)` |
| Documentation | `docs missing for <thing>` · `<N> doc gap(s)` | — |
| Self-review signals | `debug logs left in` · `leftover TODO/stub` | — |
| Code review | `<K> blocking finding(s) (see inline)` | `<N> non-blocking finding(s)` |
| Description vs. code | — (soft gate — warns, never fails) | `description omits <thing>` |
| CI (Gate 2) | — (**warns, never fails** — see *Gate states*) | `CI red: <check names>` · `CI still pending` |

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

`OPTIMALITY_SECTION` renders the Step 2.4c proposals. Omit the placeholder entirely when there
are no proposals — the quiet early-exit must stay quiet. Otherwise substitute:

```markdown
<details>
<summary>Optimality review (<OP>) — is this the best approach?</summary>

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
<summary>Additional findings (<DEF>) — cleared review, not inlined</summary>

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
<summary>Low-confidence findings (<CADV>) — advisory, below the confidence bar</summary>

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
`OPTIMALITY_SECTION`, a carried 2.4d run-state on the `**Standards (2.4d)**` log line — each
suffixed ` (carried from <PRIOR_SHA_SHORT>)`. The suffix is mandatory: it is the only
thing distinguishing a finding this run verified from one it merely preserved because the owning
step was skipped. A carried entry never changes the gate table's ✅/⚠️/❌ status, which Step 1.8
always sets from the current PR state, and never affects the verdict.

`MEMORIES_SECTION` is the persistent memory block inside `Review details` (replacing the old
applied-only list). It **always renders** — never omit the slot. `LOREKIT_CONNECTED` selects which
of the two shapes below it takes, so a reader always sees either both counts or an explicit
`not connected`, not only when something fired.

- **Connected** (`LOREKIT_CONNECTED=true` — the `mcp__lorekit__memory_list` attempt succeeded) — a header line, followed (only when `MEMORIES_USED_COUNT > 0`) by one bullet per
  entry in `APPLIED_MEMORIES[]` (Step 2.2), each a pressable LoreKit link so the reader can open the
  exact memory and see why a finding was dropped, downgraded, or promoted:

  ```text
  **Memories** — <MEMORIES_READ_COUNT> indexed · <MEMORIES_USED_COUNT> used

  - [`issue:missing-abort-signal`](<url>) — promoted, seen 3×
  - [`nitpick:map-vs-record-preference`](<url>) — downgraded, seen 2×
  ```

  When `MEMORIES_USED_COUNT` is 0, render only the header line (`… indexed · 0 used`), no bullets.
  This is the **rendered** shape, not the payload: supply `MEMORIES_SUMMARY: "<N> indexed"` and the
  `APPLIED_MEMORIES[]` bullets as `MEMORIES_USED`, and the renderer derives ` · <N> used` from that
  array — so `MEMORIES_USED_COUNT` is never typed by hand and can never disagree with the bullets.
- **Not connected** (`LOREKIT_CONNECTED=false` — the `mcp__lorekit__memory_list` tool call still errored after the Step 1.0 retries were exhausted, or the tool was unavailable: not in the agent's `tools:` grant, or the LoreKit MCP server did not connect this session so the tool is unregistered — `No such tool available`) — render exactly `**Memories** — not connected`, no bullets.
  This shape MUST NOT appear when the read was merely skipped or assumed, nor off a single transient throw — it only appears after a genuine failed attempt that survived retries.

`MEMORIES_READ_COUNT` (Step 1.0) is how many relevance memories were loaded into the index;
`MEMORIES_USED_COUNT` = `|APPLIED_MEMORIES|`, how many actually fired (drops + downgrades +
promotes). Indexed is always ≥ used — a run can index memories and apply none. The bullet count MUST equal `MEMORIES_USED_COUNT`.

Build each `<url>` from the memory's retained `scope` + `key`, per
`comment-relevance-memory.md § Linking applied memories in the report` — the
`lorekit link "<scope>" "<key>"` CLI when it is on `PATH`, else the documented
`{base}/lore?scope=<enc>&lesson=<enc>` construction (`base` = `LOREKIT_APP_URL` or
`https://lorekit.io`), else a plain-text `` `<scope> · <key>` `` identifier — never a
fabricated URL.

**There is no memories tag on the `<summary>`.** The retired `MEMORIES_USED_SUFFIX` appended
` (<N> memories used)` there, restating `MEMORIES` a few lines below and spending the report's one
scannable line on a number that is `0` on most runs. The template has no such slot and the renderer
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
- `WARN_GATE_COUNT` = the number of gates showing ⚠️ in this run — Description vs. code, **CI**,
  Prior review feedback, and/or Code review, so 0 to 4. CI is in this set precisely because it warns
  and never fails: leaving it out made a CI-only red render `**0 warning(s)**`, which this file
  forbids. It counts ⚠️ gates on a **FAIL** run too, not only a
  WARN run, so the FAIL `SEVERITY_TALLY` can report warnings alongside errors.
  The top-level WARN headline leads with `WARN_GATE_COUNT`, not the finding count `N`, so it reads
  correctly even when there are zero inline findings (a Description-vs-code-only warning).
  `WARN_GATE_COUNT` does not appear in the accordion gate table, which renders per-gate ✅/⚠️ marks
  rather than a count; its rendered uses are the Step 3 terminal WARN/FAIL verdict lines and the
  top-level WARN and FAIL headlines (the latter via `SEVERITY_TALLY`).
- Never add rows, sections, or prose outside the template above (except the four `<details>`
  blocks — `Review details`, `Optimality review`, `Additional findings`, and
  `Low-confidence findings` — the `MEMORIES_SECTION` and `OPEN_THREADS_LIST` slots inside
  `Review details`, the `OPEN_THREADS_SUFFIX` tag on its `<summary>`, and the
  `PARTIAL_BANNER` line — all of which are slots in the template, not added prose).
  Besides the headline and the banner, **no** prose of the agent's own is permitted at the top
  level of the body.
- Praise findings are dropped entirely — do not add them to the table, inline comments, or body prose.

### INLINE_COMMENTS_JSON format

A valid JSON array. Each entry **must** include `side`:

```json
{
  "path": "relative/file/path",
  "line": <integer RIGHT-side line number>,
  "side": "RIGHT",
  "body": "conventional-comments formatted body"
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
