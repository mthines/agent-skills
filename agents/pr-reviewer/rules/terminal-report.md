---
title: pr-reviewer — terminal report reference
---

<!--
  Moved verbatim out of `agents/pr-reviewer.md` § Step 3. The agent body routes here; this file
  owns the layout. Heading levels are `##` / `###` because the text moved unchanged, and the
  template's own `## PR Review — PR #<n> (<repo>)` heading is part of the OUTPUT, not of this
  document's structure.

  This is the ONE terminal-output template. Three near-copies of the posted report body drifted
  into a remembered average across five production runs, which is why `render-report.mjs` owns
  that markup now; the terminal output has no renderer, so one copy IS the guard here.
-->

## Step 3 — the terminal report

Produce two views before posting: a summary with the gate table, then numbered detail cards.
Always include the run mode and delta context in the header:

Pick the presentation by verdict (see *Gate states*): **PASS** (all clear) when every gate is ✅; **WARN** when no hard gate fails (Gates 4/5 all ✅) and neither tri-state gate — Prior review feedback, Code review — is ❌, but at least one graded gate — Description vs. code, CI, Prior review feedback, or Code review — is ⚠️ (still a PASS verdict); **FAIL** when Gate 4 or Gate 5 fails or the Prior review feedback or Code review gate is ❌ (CI never fails it).

All three presentations share **one** template; only the `**Verdict**` line and the allowed Status
glyphs differ, both tabulated under it. (Three near-copies is what drifted into a remembered
average on the posted body before `render-report.mjs` took that over; terminal output has no
renderer, so one copy is the guard.)

```markdown
## PR Review — PR #<n> (<repo>)

**Title**: <PR title>
**Author**: @<login>
**Base ← Head**: <base> ← <head>
**Intent**: <one-line from Step 1.3>
**Run mode**: <full | incremental (delta: N lines since PRIOR_SHA_SHORT) | incremental-quick (delta: N lines since PRIOR_SHA_SHORT)>
**Depth**: tier <deep | standard | quick> · capability <checkout | tarball | diff-only>

### Gate Status

| Gate | Status | Details |
|---|---|---|
| Description vs. code | <glyph> | <details> |
| Prior review feedback   | <glyph> | <details> |
| Documentation        | <glyph> | <details> |
| Self-review signals  | <glyph> | <details> |
| Code review          | <glyph> | <details> |

**Verdict**: <the line for this presentation, from the table below>

[rest of sections follow]
```

Three columns in every presentation, matching the posted body
(`report-rendering.md § Rules for table cells`) — the old PASS copy dropped Details, so the
all-clear run said least about what had been checked. The *selector* above, never this table,
decides the presentation:

| Gate | Glyphs it may show | Details cell |
|---|---|---|
| Description vs. code | ✅ ⚠️ | mismatch text (≤ 120 chars) on ⚠️; empty on ✅ |
| Prior review feedback | ✅ ⚠️ ❌ | `<N> unresolved review thread(s)` on ⚠️/❌; empty on ✅ |
| Documentation | ✅ ❌ | finding text on ❌; empty on ✅ |
| Self-review signals | ✅ ❌ | finding text on ❌; empty on ✅ |
| Code review | ✅ ⚠️ ❌ | `See inline comments`, or finding text, on ⚠️/❌; empty on ✅ |

Any gate may also show `⏭️` under `--skip-gates` (*Gate states*). Gate 2 (CI) is not a row, as in
the posted body; its state goes in the Quality Gate block's CI line below.

| Presentation | `**Verdict**` line |
|---|---|
| PASS | `PASS` |
| WARN | `No blocking issues — <WARN_GATE_COUNT> warning(s): <WARN_REASONS>.` |
| FAIL | `FAIL — <SEVERITY_TALLY>. Blocking: <FAIL_REASONS>.` |

The WARN line carries no `PASS` token. Seven production sightings
(`reviewer-lessons::gate-table-says-pass-while-contract-says-fail`) showed that a WARN row reading
`PASS — no blocking issues, <N> warning(s)` beside a harness `VERDICT: FAIL` (forced by
`ACTIONABLE >= 1`, independent of gate severity) reads to a human as an unexplained contradiction —
a PASS banner with no green check. Dropping the word rather than annotating it is the sighting-7
conclusion: there is then nothing to reconcile. This line **must stay byte-identical** to
`report-rendering.md`'s WARN headline (`Reviewed your changes — no blocking issues,
**<WARN_GATE_COUNT> warning(s)**: <WARN_REASONS>.`, modulo the `**Verdict**:` vs. `Reviewed your
changes —` lead) — the Step 3 terminal report and the posted body must never re-diverge the way
they did before this fix landed (see L1 `G33`). `VERDICT` (PASS/WARN/FAIL, the presentation
selector) stays a distinct concept from this printed line — Step 4a's `VERDICT` binding explains
why the two must not be conflated.

`FAILING_GATE_COUNT` counts only hard-failing gates — a ⚠️ row (Description vs. code, Prior review feedback, or Code review) is never included, even when another gate is ❌.

All three presentations continue with:

```markdown
### Inline Findings Summary

| #  | File:Line          | Category    | Conf | Anchor |
|----|--------------------|-------------|------|--------|
| 1  | src/foo.ts:42      | suggestion  | 95%  | `const cache: Record<...> = {}` |

**Quality Gate**: produced <P>, carried forward <CF>, relevance-memory drops <RM>, filter drops <FL>,
materiality drops <MD>, dedupe drops <D>, grounding drops <G>, confidence drops <C> (threshold <T>),
confidence-deferred (advisory) <CADV>, shape drops <S>,
cleared <CL>, deferred over inline cap <DEF>, posted inline <F>,
anchorless carried <AC>, anchorless resolved <AR>,
memory bodies unread <MEMORY_BODIES_UNREAD>.
`<MEMORY_BODIES_UNREAD>` counts every candidate whose body the shared `MEMORY_READ_BUDGET` could
not fetch, at BOTH read sites: Step 1.2d lesson bodies that therefore could not match at 1.2e, and
Step 2.7b relevance bodies that therefore produced no suppress / downgrade / promote. It is 0 when the
pool never bound and when `SUMMARY_VIEW` is false (every body was already loaded).
`<CADV>` (near-miss issue/suggestion routed to the advisory body section) is reported separately
and is NOT part of the `<CL> − <DEF> == <F>` identity — advisory findings never cleared 2.7.
CI: PASS or WARN (check names if red or pending; never FAIL — see *Gate states*).
Standards conformance (2.4d):
  Status:             ran | skipped (trivial diff) | skipped (--no-standards) | skipped (tier: quick) | skipped (no governing docs found)
  Docs discovered:    <N> (total normative bullets: <B>)
  Docs dropped (cap): <D> (listed above)
  Conflicts surfaced: <CON>
  Findings emitted:   <FE>
When a standards finding conflicts with author-stated intent or an explicit review-config entry,
the author intent and config win; the conflict is surfaced in the diagnostics, not silently enforced.

Shape routing (1.2 / 1.2b):
  Shapes:             <PR or delta shapes, joined> | none
  High-stakes files:  <count> (<first 3 paths>)
  Delta source:       compare | blob-diff (…) | n/a (full mode)
  Escalate-in-incr.:  true | false | n/a

Optimality review (2.4c):
  Status:             ran | skipped (trivial diff) | skipped (--no-optimize) | skipped (tier: standard|quick) | skipped (skill not installed)
  Units judged:       <UN>
  Optimal:            <UO>
  Proposals:          <OP> (cap 2)
  Inline pointers:    <OPTR> (analysis_confidence ≥ 95 with a resolvable anchor)
  Applied:            0    (cross-review never applies)
  Withheld/reverted:  <OW>

### Optimality Review

Omit this section when `<OP> == 0`. Otherwise one card per proposal, rendered from
`skills/quality/optimize-approach/templates/proposal.template.md`.

`anchorless carried <AC>` and `anchorless resolved <AR>` are the `Anchorless carried: <C> · resolved: <R>`
counts from `prior-comment-awareness.md § Carry-forward of anchorless findings`; this terminal block is
their only rendering slot — the posted body has none, and Step 4 forbids prose outside its template.

`carried forward`, `cleared`, `deferred over inline cap`, `anchorless carried`, and `anchorless resolved` are emitted even when they are 0,
so the reader can see the steps ran (`per-comment-confidence.md § Logging`,
`prior-comment-awareness.md § Logging`). `<CL> - <DEF>` must equal `<F>`; if it does not, a
cleared finding was dropped somewhere it should not have been.

### Inline Finding Details

<one card per inline finding using pr-comment-card.template.md>
```

**Verdict (advisory — emitted in terminal only, not posted to GitHub):**

| Verdict | When |
|---|---|
| **Approve** | No issues, only nits/praise |
| **Approve with comments** | Suggestions, questions, nits, doc gaps |
| **Request changes** *(rare)* | Genuine blocker |

A finding only blocks if: broken behaviour, security (auth bypass/injection/secret leak/CSRF),
data loss/corruption, or misimplemented intent.

Run `Skill("confidence", "code")` against the overall verdict. Below 70% requires
re-reading changed files in full before posting.

---
