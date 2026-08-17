---
title: pr-reviewer — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - pr-reviewer
  - meta
---

# pr-reviewer — Diagnostic Surface

## Contents

- [Source root](#source-root)
- [Phase model](#phase-model)
- [Existing guards per phase](#existing-guards-per-phase)
- [Failure taxonomy](#failure-taxonomy)
- [Hard invariants](#hard-invariants)
- [Artifacts](#artifacts)
- [Validators](#validators)

---

This file declares the contract `/create-skill diagnose pr-reviewer` reads to parameterize the generic Diagnose Mode procedure for this agent.

`pr-reviewer` is the single, unified PR review agent.
It reviews both its own PRs (self relation) and someone else's (cross relation), selected by a `REVIEW_RELATION` flag set at Step 0.5.
The pipeline is identical in both relations — same findings, same gates, same verdict — and only the framing differs: self mode drops the cross-review context-asymmetry hedging for direct phrasing.
It is **read-only**: it never auto-fixes, never applies an optimality rewrite, and never writes anywhere outside of `gh api pulls/{n}/reviews`, the single sticky report comment on `issues/{n}/comments`, and the `resolveReviewThread` GraphQL mutation on a re-review.
It rewrites **exactly one sticky report comment** per PR on every run, and posts **at most one visible `COMMENT` review** per run — only when there are new inline findings, it is the first run, the verdict worsened, or a new blocking fingerprint appeared. Inline comments are append-only and never edited or deleted. There is no pending/draft workflow, no `--publish` authorization gate, and no own-PR refusal.

The retired `reviewer` agent no longer exists; its own-work sub-modes were folded into this agent's self relation.
Auto-fix now lives only in `implement-suggestion` and `code-quality simplify` — an auto-fix attempt by `pr-reviewer` is a guard failure.

---

## Source root

`agents/`

`git apply` runs from this root. The agent body lives at `agents/pr-reviewer.md`; supporting rules live under `agents/pr-reviewer/`. Shared rules imported by the agent live under `agents/shared/`.

---

## Phase model

| Phase | Name | Rule / section | Gate |
| --- | --- | --- | --- |
| 0 | Raw-arguments read | [pr-reviewer.md § Step 0](../../pr-reviewer.md) | Raw arguments preserved verbatim; parent paraphrases ignored; PR reference parsed |
| 0.5 | Authorship pre-check — set review relation | [pr-reviewer.md § Step 0.5](../../pr-reviewer.md) | `REVIEW_RELATION` set to `self` when `author == current user`, else `cross`; the agent never refuses on relation |
| 0.7 | Prior run detection | [pr-reviewer.md § Step 0.7](../../pr-reviewer.md) | `RUN_MODE` (full / incremental / incremental-quick) chosen; the sticky report located by marker on `issues/{n}/comments` with the legacy `reviews`-body fallback; `PRIOR_SHA` / `PRIOR_VERDICT` / `PRIOR_OPEN_THREAD_IDS` / `PRIOR_BLOCKING_FINGERPRINTS` / `LAST_FULL_SHA` / `INCR_RUNS_SINCE_FULL` read from the run ledger (a sticky has no `commit_id`), all bound above the `--full` stop except the last two; `RESOLVED_SINCE_PRIOR` initialised to 0 on a first pass; `CARRIED_FINDINGS` and `PRIOR_DIAGNOSTICS` (`PRIOR_GATE_STATE` / `PRIOR_OPTIMALITY` / `PRIOR_STANDARDS` / `PRIOR_SKIPPED_FILES` / `PRIOR_PARTIAL`) parsed in every mode |
| 1.0 | Prior-comment awareness + memory load (default ON) | [shared/rules/prior-comment-awareness.md](../../shared/rules/prior-comment-awareness.md), [shared/rules/comment-relevance-memory.md](../../shared/rules/comment-relevance-memory.md) | Existing PR review comments **and review-thread state** fetched via `gh api`; `RESOLVED_THREAD_IDS` / `COMMENT_TO_THREAD` built with the pagination walk completed; dedup set, resolved-suggestion set, and `OPEN_BOT_COMMENTS[]` built from `isResolved`, never from reply prose; each open entry carries `blocking` (from the authoring bot's own decoration, read before the `ask` truncation strips it) and `answered` (a reply exists) for Gate 3's grading; `reviewer-lessons` + `reviewer-comment-relevance` memories loaded narrow-to-broad |
| 1.1 | Fetch PR data in parallel | [pr-reviewer.md § Step 1.1](../../pr-reviewer.md) | Metadata, diff, CI checks, prior reviews, and issue comments fetched concurrently; `state == "OPEN"` confirmed |
| 1.2 | Patch cache | [line-validity.md](./line-validity.md) | `/tmp/pr-files.json` populated with the full PR patch; sole source of line-validity truth; `HEAD_SHA` set |
| 1.2b | Delta triage (incremental modes only) | [pr-reviewer.md § Step 1.2b](../../pr-reviewer.md) | `DELTA_LINES` / `NEW_FILES` / `HIGH_STAKES` / `CUM_DELTA_LINES` computed; upgrade to `full` on any trigger — incl. the deep-lens-refresh triggers (`CUM_DELTA_LINES > FULL_REFRESH_DELTA`, `INCR_RUNS_SINCE_FULL >= FULL_REFRESH_RUNS`, or empty `LAST_FULL_SHA`); `REVIEW_DIFF` set |
| 1.2c | Diff-keyed lesson search (all modes) | [pr-reviewer.md § Step 1.2c](../../pr-reviewer.md) | One targeted `memory.search` keyed on changed paths, changed symbol names, and the synthesized intent + integrations; merged into the Step 1.0 pool; `INTENT_PHRASE` set (single derivation point) |
| 1.3 | Intent synthesis | [pr-reviewer.md § Step 1.3](../../pr-reviewer.md) | `INTENT_PHRASE` expanded into a 2–3 line intent summary (never re-derived; derived here only when Step 1.2c was skipped); uncertainty flagged on missing PR body |
| 1.5 | Pre-existing-issue separation | [pr-reviewer.md § Step 1.5](../../pr-reviewer.md) | Context-line findings tagged `[pre-existing]`; excluded from verdict |
| 1.6 | Lens loading | [shared/rules/rubric-composition.md](../../shared/rules/rubric-composition.md), [review-lens-contract.md](../../../skills/authoring/create-skill/rules/review-lens-contract.md) | Max 3 lenses; `lens-version: 1`; dedupe against auto-loaded |
| 1.7 | Review config load | [shared/rules/review-config.md](../../shared/rules/review-config.md) | Review-config hierarchy resolved (default `.github/review.yaml`, legacy root `.review.yaml` honoured, subtree `.review.yaml` overrides); absent config → `profile: balanced` (threshold 80, inline placement cap 5, no filters) |
| 1.7b | Standards discovery (default ON) | [shared/rules/standards-conformance.md](../../shared/rules/standards-conformance.md) | Reuses `review-config.md` upward walk to discover governing docs (`CLAUDE.md`, `.claude/rules/*.md`, `AGENTS.md`, root slice); merges review-config `standards:` entries (`.github/review.yaml` + subtree `.review.yaml`); applies 30,000-char nearest-first cap; logs drops; caches as `STANDARDS_DOCS`; skips on `--no-standards`, trivial-skip, or `incremental-quick` (the same three conditions Step 2.4d skips on) |
| 1.8 | Pre-merge gate checks | [pr-reviewer.md § Step 1.8](../../pr-reviewer.md) | Gates 1–5 evaluated against the full PR state; `--skip-gates` sets them `SKIPPED`; token-economy holistic-skip heuristic on ≥ 3 failing gates |
| 2 | Review (multi-rubric + personas) | [shared/rules/rubric-composition.md](../../shared/rules/rubric-composition.md) | `code-quality` always; `ux` on UI globs; `critical` on auto-engage / `--critical`; lenses; Personas 1–4 (Persona 4 skipped in `incremental-quick`) |
| 2.2 | Relevance-memory filtering | [shared/rules/comment-relevance-memory.md § Read](../../shared/rules/comment-relevance-memory.md) | Drop / downgrade not-relevant patterns; promote reliably-resolved ones; `APPLIED_MEMORIES[]` built for the review-body diagnostics |
| 2.3 | Filter suppression | [shared/rules/review-config.md § Filters](../../shared/rules/review-config.md) | Drop findings whose category is in the effective `filters:` list; runs before holistic; no-op when no review config is present; also the **materiality filter** — cosmetic nitpick/suggestion on a docs/comment-only incremental delta dropped here (pre-clearing, `Materiality drops`, never enters `<CL>`) |
| 2.4 | Holistic review (default ON in `full`) | [shared/rules/holistic-review.md](../../shared/rules/holistic-review.md), `Skill("holistic-analysis", "review")` | Runs unless `--no-holistic`, trivial-skip, token-economy skip, or an incremental run; findings mapped to `issue` (intent-mismatch) / `question` (system-fit, scope-creep) in cross relation |
| 2.4b | Targeted holistic escalation (default ON in `full`) | [shared/rules/holistic-review.md § Targeted escalation](../../shared/rules/holistic-review.md) | Parallel focused traces on context-dependent findings, cap 10; skipped by `--no-escalate` or when 2.4 was skipped |
| 2.4c | Optimality review (default ON in `full` / `incremental`) | [shared/rules/optimality-review.md](../../shared/rules/optimality-review.md), `Skill("optimize-approach", "report")` | **Report-only — cross-review never applies.** Runs unless `--no-optimize`, trivial-skip, or `incremental-quick`; 0–2 proposals rendered as review-body cards (full argument never inline); a proposal with `analysis_confidence` ≥ 95 and a resolvable anchor also leaves one short inline `suggestion:` pointer to its card; `analysis_confidence` ≥ 85 is the only confidence gate; never blocks the verdict |
| 2.4d | Standards conformance (default ON in `full` / `incremental`) | [shared/rules/standards-conformance.md](../../shared/rules/standards-conformance.md) | Runs unless `--no-standards`, trivial-skip, or `incremental-quick`; compares diff against governing-doc normative statements (`STANDARDS_DOCS` from Step 1.7b); emits `issue:` for violated never/must/always/do-not/forbidden and `suggestion:` for violated prefer-X-over-Y; every finding cites governing-doc `path:line` as grounding; passes all downstream gates (2.5–2.9b); author-intent and review-config explicit overrides win on conflict; never blocks verdict automatically |
| 2.5 | Dedupe + consolidate | [shared/rules/rubric-composition.md § Consolidation](../../shared/rules/rubric-composition.md) | Dedupe, group, priority-sort; **no cap, nothing dropped**; holistic claim wins on `(file, line)` collision; cross-surface **parity** findings collapsed to one enumerated finding (all sibling surfaces named) so a fix cannot leave a neighbour to re-flag |
| 2.5b | Prior-comment dedup | [shared/rules/prior-comment-awareness.md](../../shared/rules/prior-comment-awareness.md) | Drop findings already said in a prior review pass; anti-flip-flop on resolved suggestions |
| 2.5c | Anchorless carry-forward | [shared/rules/prior-comment-awareness.md § Carry-forward of anchorless findings](../../shared/rules/prior-comment-awareness.md) | Every `PRIOR_DIAGNOSTICS` entry given exactly one disposition (REPLACE / RESOLVE / CARRY / DROP); a `RESOLVE` requires the owning step to have run; carried entries re-rendered with the `(carried from …)` suffix |
| 2.6 | Finding grounding | [shared/rules/finding-grounding.md](../../shared/rules/finding-grounding.md) | Every backticked symbol grep-confirmed in changed file |
| 2.6b | Verification receipt | [shared/rules/verification-receipt.md](../../shared/rules/verification-receipt.md) | Behavioral claims need executed proof (grep / ast-grep / file-read); null result = DROP |
| 2.7 | Per-comment confidence | [shared/rules/per-comment-confidence.md](../../shared/rules/per-comment-confidence.md) | `Skill("confidence", "code")` weighted Final ≥ profile threshold (default 80) to post inline; receipt evidence fed in; a near-miss `issue`/`suggestion` (`[max(threshold−15,65), threshold)`) deferred to the `Low-confidence findings` advisory section, not dropped; `question`/`nitpick` below threshold dropped |
| 2.8 | Comment shape | [shared/rules/comment-shape.md](../../shared/rules/comment-shape.md) | ≤ 240 chars, ≤ 2 sentences, no headings, no bullets |
| 2.9 | Conventional Comments | [shared/rules/conventional-comments.md](../../shared/rules/conventional-comments.md) | Prefix prepended; `(blocking)` / `(non-blocking)` decoration appended |
| 2.9b | Placement | [shared/rules/rubric-composition.md § Placement (Step 2.9b)](../../shared/rules/rubric-composition.md) | Inline caps (profile per-file, 20 total) on **non-blocking** findings; `(blocking)` findings exempt — always inline, never deferred; non-blocking overflow deferred to the review body's `Additional findings`, never dropped; non-blocking **cosmetic** findings (wording/parity/formatting) sort after material within a prefix, so they take an inline slot last and overflow first (the docs-only cosmetic drop is the pre-clearing materiality filter at 2.3, not a placement drop) |
| 2.9c | Reconcile prior threads (re-review only) | [shared/rules/thread-resolution.md](../../shared/rules/thread-resolution.md) | Auto-resolve this agent's own fixed / declined / acknowledged threads via `resolveReviewThread`; remove the successfully-resolved from `OPEN_BOT_COMMENTS[]` and re-evaluate Gate 3's full tri-state (clearing the last unanswered blocking thread downgrades ❌ → ⚠️ without emptying the set); write outcomes to `reviewer-comment-relevance`; skipped on a first-pass review; runs before the verdict and before posting, and on the zero-delta path |
| 3 | Local proposal (terminal output) | [pr-reviewer.md § Step 3](../../pr-reviewer.md), [templates/pr-comment-card.template.md](../../templates/pr-comment-card.template.md) | Gate-status table + numbered cards; PASS / WARN / FAIL presentation chosen by gate states; advisory terminal verdict |
| 3.5 | Line validity pre-flight | [line-validity.md](./line-validity.md) | Every `(file, line)` falls inside a RIGHT-side diff hunk; retarget ≤ 3 lines or drop |
| 4a | Update the sticky report | [pr-reviewer.md § Step 4a](../../pr-reviewer.md) | Exactly one marker-bearing issue comment per PR — `PATCH` when `STICKY_COMMENT_ID` is set, `POST` otherwise; `STICKY_URL` captured from the response; ledger appended, older entries' per-run fields stripped, capped at 50; runs unconditionally, including on a run that posts no review |
| 4b | Post the review (conditionally) | [pr-reviewer.md § Step 4b](../../pr-reviewer.md) | `payload_is_safe` pre-flight; at most one `POST /pulls/{n}/reviews` with `event="COMMENT"` and a non-empty **pointer** body; posted only on new inline findings, first run, worsened verdict, or a new blocking fingerprint; `state: "COMMENTED"` confirmed when posted |
| 5 | Report | [pr-reviewer.md § Step 5](../../pr-reviewer.md) | Lead with "Updated report on PR #<n> — created | updated sticky · posted review | no review posted (reason)"; confirm `COMMENTED` when a review was posted and `sticky-only` when not; give the sticky URL; list gate verdicts, integrations, thread-resolution counts, and line-validity casualties |

There is no Auto-Fix phase, no optimality-apply phase, and no authorization gate.
The `reviewer` agent that once owned own-work Fix / Report / Self-Review sub-modes has been retired and its behaviour folded into this agent's `self` relation.

---

## Existing guards per phase

| Phase | Existing guards | Typical gaps |
| --- | --- | --- |
| 0 | Literal-args rule, parent-paraphrase ignored; PR reference regex (URL / `#n` / bare integer) | Argument quoting strips a flag; bare integer mistaken for a URL fragment; `RESOLVED_REPO` empty outside a git repo |
| 0.5 | `gh api user` vs `gh pr view --json author.login`; sets `REVIEW_RELATION` without refusing | Token belongs to a different account than the CLI session, so relation is misclassified; tone-framing leaks between relations |
| 0.7 | Sticky-report fetch by marker (`<!-- PR_REVIEWER_REPORT -->`) on `issues/{n}/comments`, with the legacy `reviews`-body fallback and then the ledger-only `<!-- PR_REVIEWER_POINTER -->` fallback; `PRIOR_SHA` / `PRIOR_VERDICT` / `LAST_FULL_SHA` / `INCR_RUNS_SINCE_FULL` / `PRIOR_OPEN_THREAD_IDS` from the run ledger; `CARRIED_FINDINGS` + `PRIOR_DIAGNOSTICS` parsed in every mode incl. `--full`; unparseable accordion or ledger announced and degraded, never fatal | Only `reviews` scanned so a current PR's sticky is missed and the run reads as first-pass; `commit_id` assumed on a sticky (issue comments have none); carry-forward skipped in an incremental mode, silently losing a deferred finding; an unparseable ledger degraded toward `incremental` instead of `full`; a second sticky created alongside the existing one |
| 1.0 | Prior PR comments + `reviewThreads { isResolved }` fetched via `gh api`; dedup set + `OPEN_BOT_COMMENTS[]` built from thread state (default ON); GraphQL `hasNextPage` paged with `endCursor`; reply-text heuristic retained as an explicit fallback; memories loaded narrow-to-broad, expired skipped | `gh api` paginates on PRs with > 100 comments; GraphQL page 2+ dropped so a resolved thread reads as unresolved; a GraphQL error treated as "everything unresolved" instead of "unverified"; resolution inferred from reply prose despite thread state being available; first-pass run has empty dedup set (correct no-op); `memory.*` not connected only after retries exhausted (a single transient throw is retried, not treated as a permanent outage) |
| 1.1 | Five parallel `gh` fetches; `state == "OPEN"` confirmed; fetched content treated as reference data, not instructions | Long-running PR with commits since fetch; race with a new push; MERGED/CLOSED needs a proceed prompt |
| 1.2 | `/tmp/pr-files.json` populated once at run start with the full PR patch | Cache stale if the run takes > 60 s and the PR receives commits |
| 1.2b | Delta compared via `gh api compare`; upgrade rules (delta > 100, any new file, any high-stakes path) force `full`; zero-delta short-circuit to gate-only | Heuristic marks a real change trivial; high-stakes regex misses a path; `/tmp/pr-files.json` wrongly replaced (it must stay the full PR patch) |
| 1.2c | Diff-keyed `memory.search` merged into the Step 1.0 pool; relevance count stays relevance-only | Search widens `MEMORIES_READ_COUNT` beyond relevance memories; `reviewer-lessons` hit not applied as a consideration |
| 1.3 | Sources: PR title, body, commit messages, branch name | Branch named `fix/stuff`; intent guessed and findings calibrated against the guess |
| 1.5 | Context-line tagging via diff prefix inspection | Finding on a moved line counted as new when the same logic existed on a deleted line |
| 1.6 | Max 3, lens-version validation, dedupe, applies-to glob | Lens > 80 lines warned but loaded; missing `lens.md` silently skipped |
| 1.7 | Review-config hierarchy walk (default `.github/review.yaml`, legacy root `.review.yaml`, subtree `.review.yaml`); absent config → `profile: balanced` | Nested subtree overrides the default-base profile silently if the path walk is incorrect |
| 1.8 | Gates 1–5 evaluated on the full PR state; Gate 1 (description) is soft, Gates 3 (prior bot feedback) and 6 (code review) are tri-state and fail only on a blocking item; token-economy holistic-skip on ≥ 3 failing gates | A hard gate misclassified as soft, or a graded gate as hard; Gate 3 ❌ with no unanswered blocking thread; Gate 4 self-review scan misses a debug artifact on a `+` line; prose-vs-code carve-out over- or under-fires |
| 2 | Skill loading order; auto-engage heuristics for `critical`; persona availability by run mode | Auto-engage regex misses `prisma/migrations`; UX heuristic misses Svelte 5 `.svelte.ts`; Persona 4 activated when no integration changed |
| 2.2 | Relevance memories drop (`not-relevant` ≥ 3) / downgrade (1–2) / promote (`relevant` ≥ 2); `APPLIED_MEMORIES[]` linked in the report | A legitimate finding suppressed by an over-broad memory; applied memory not linked so the influence is invisible |
| 2.3 | Filter list matched against each finding's category; no-op when `filters:` empty | Over-broad category tag suppresses a legitimate finding; step skipped so `Filter drops` stays 0 despite configured filters |
| 2.4 | Default-on holistic call; trivial-skip heuristic; size-scaled `max_findings` (3 / 6 / 10); cross relation maps `system-fit` to `question` | Holistic skipped on a non-trivial diff the heuristic marked trivial; holistic finding overrides a correct line-level finding on the same `(file, line)`; framing leak (`system-fit` posted as `issue`) |
| 2.4b | Parallel focused traces on context-dependent findings, cap 10; skipped when 2.4 was skipped or `--no-escalate` | Escalation fans out on a non-context-dependent finding, wasting a trace; cap exceeded |
| 2.4c | Report-mode call; proposals bypass 2.7–2.9b and render as body cards; log block emitted even at 0 proposals; **cross-review never applies** | Proposal squeezed into an inline comment and trimmed / dropped by `comment-shape`; log block omitted so a skipped run is indistinguishable from a silent one; proposal allowed to influence the verdict; an apply is attempted |
| 2.5 | Dedupe, group, priority-sort; no cap applied here; holistic claim wins on collision; parity findings collapsed across sibling surfaces | LLM caps findings inline despite the rule; holistic-vs-line-level collision resolved wrongly; a parity finding reports one surface only, so its fix re-flags the neighbour next push |
| 2.5b | Prior-comment dedup: `(path, line ± 2)` + same prefix → DROP; anti-flip-flop: resolved suggestion contradicted → DROP unconditionally | Dedup step skipped on an incremental pass; anti-flip-flop threshold miscalibrated on moved lines |
| 2.5c | Disposition table (REPLACE / RESOLVE / CARRY / DROP); owning-step map; `RESOLVE` gated on the owning step having run; `(carried from …)` suffix mandatory; `Anchorless carried: <C> · resolved: <R>` logged | A skipped step's entry treated as RESOLVE, so a still-failing gate silently vanishes; a carried entry re-rendered without the suffix and read as freshly verified; a carried gate row used to set the gate status instead of Step 1.8 |
| 2.6 | Backticked-token grep, allowlist for keywords / built-ins | Hallucinated multi-word phrase passes (not backticked); allowlist over-eager |
| 2.6b | Proof tool run (grep / ast-grep / file-read); null/empty → DROP; contradicting → DROP; ambiguous → downgrade to `question:` | Proof tool not run on behavioral claims; null result mistakenly treated as confirmation |
| 2.7 | `Skill("confidence", "code")` weighted Final ≥ profile threshold (default 80); receipt evidence in the Evidence field | Confidence skill not wired for the per-comment input shape; threshold not read from the resolved profile |
| 2.8 | Mechanical pre-emit: length, sentences, structure | Trim heuristic breaks the comment's point; drop reported but easy to miss |
| 2.9 | Prefix table + decoration; mechanical pre-emit | Decoration appended twice on retry |
| 2.9b | Inline placement caps (5/file, 20 total); overflow deferred to the review body, never dropped; ordering by prefix, then material-before-cosmetic, then confidence | A cleared finding is dropped instead of deferred; `Additional findings` section omitted while `DEF > 0`; deferred list not carried into the next incremental run; a cosmetic parity nit posted inline spawns another on the next push |
| 2.9c | `resolveReviewThread` only on this agent's own `fixed` / `declined` / `acknowledged` threads; never on `persisting` / `unaddressed`; only successful mutations leave `OPEN_BOT_COMMENTS[]`; Gate 3 re-evaluated from the updated set; write outcomes to `reviewer-comment-relevance`; skipped on first pass; failures are logged and the run continues with pre-reconciliation state | A `persisting` thread resolved prematurely; a thread authored by someone else resolved; a failed mutation still removed from `OPEN_BOT_COMMENTS[]` so the checklist claims a thread closed that GitHub still shows open; a GraphQL / LoreKit failure blocks or delays the review instead of continuing with pre-reconciliation state; Gate 3 re-evaluated under `--skip-gates`, resurrecting a gate the invocation turned off; the step re-nested under Step 2, which the zero-delta path skips |
| 3 | Gate-status table + card template; PASS / WARN / FAIL chosen by gate states; advisory verdict is terminal-only | Card emitted without anchor; a soft ⚠️ gate counted into `FAILING_GATE_COUNT`; advisory verdict leaked into the posted body |
| 3.5 | Hunk walk; valid-range computation; retarget ≤ 3 lines | Off-by-one when a hunk has interleaved deletions; one bad line nukes the whole payload |
| 4a | Exactly one sticky per PR; `PATCH` an existing one rather than creating a second; never delete a comment, including a duplicate sticky; never skip the patch, even on a run that posts no review; `STICKY_URL` bound from the response | A second sticky created because `STICKY_COMMENT_ID` was not read at Step 0.7; the patch skipped on a no-review run, so the report describes an older commit than the PR head; a duplicate sticky deleted instead of left alone; `STICKY_URL` consumed at 4b without being bound at 4a |
| 4b | `payload_is_safe` pre-flight; `event == "COMMENT"`; non-empty **pointer** body; Conventional prefix + ≤ 240 chars per comment; `side` present; the four post-conditions evaluated before deciding to post; `state: "COMMENTED"` verified; no fallback on API failure | `event` mapped to `APPROVE` / `REQUEST_CHANGES`; empty body posted; `gh pr comment` used instead of the reviews endpoint; more than one review posted; fallback attempted on failure; a worsened verdict patched silently into the sticky with no review, so the author is never notified; the whole report duplicated into the pointer body |
| 5 | Lead with "Updated report on PR #<n> — created | updated sticky · posted review | no review posted (reason)"; confirm `COMMENTED` when a review was posted and `sticky-only` when not; report the sticky URL, gate verdicts, integrations, thread-resolution counts, line-validity casualties, and the Files-Changed link | "Drafted"/"pending" wording leaks into the report; casualties not listed for manual posting |

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID | Class | Symptom | Primary phase |
| --- | --- | --- | --- |
| `F-event-not-comment` | Posting event | Posted review used `APPROVE` / `REQUEST_CHANGES` or omitted `event` instead of the required `event: "COMMENT"` | 4 |
| `F-body-empty` | Payload shape | The review was posted with an empty body; Step 4b requires a non-empty **pointer** body (the gate table lives in the sticky, not in the review) | 4 |
| `F-comment-overlong` | Comment shape | Posted body > 240 chars OR > 2 sentences | 2.8 |
| `F-comment-unfounded` | Comment correctness | Body names a backticked symbol absent from the changed file | 2.6 |
| `F-confidence-self-graded` | Scoring loop | Per-comment confidence assigned by LLM directly rather than via `Skill("confidence", "code")` | 2.7 |
| `F-rubric-uncoordinated` | Multi-rubric collision | Two rubrics produce conflicting fixes on the same line; no consolidation step ran | 2.5 |
| `F-holistic-skipped-on-non-trivial` | Default-on bypass | Holistic review skipped on a non-trivial diff (false-positive trivial-skip heuristic, or unannounced `--no-holistic`) | 2.4 |
| `F-system-fit-framed-as-issue` | Cross-review framing | A `system-fit` finding posted as `issue:` instead of `question:` in the cross relation — violates the cross-review framing rule | 2.4 → 2.9 |
| `F-auto-fix-attempted` | Read-only violation | The agent edited code, applied an optimality rewrite, or otherwise wrote outside `gh api pulls/{n}/reviews`; auto-fix lives only in `implement-suggestion` / `code-quality simplify` | 2 / 2.4c |
| `F-multiple-reviews-posted` | Posting invariant | More than one GitHub review posted in a single run | 4 |
| `F-event-fallback` | Anti-pattern fallback | On API failure, the agent retried with a different event or endpoint instead of reporting verbatim and stopping | 4 |
| `F-line-out-of-hunk` | Diff geometry | Proposed `(file, line)` falls outside any RIGHT-side hunk; payload rejected entirely | 3.5 |
| `F-soft-gate-counted-as-failure` | Verdict miscount | A ⚠️ soft gate (Description vs. code or Code review) counted into `FAILING_GATE_COUNT` and flipped the verdict to FAIL | 3 → 4 |
| `F-advisory-verdict-leaked` | Communication invariant | The Step 3 advisory verdict (Approve / Request changes) leaked into the posted review body | 3 → 4 |
| `F-null-receipt-treated-as-confirmation` | Receipt failure | A null or empty verification-receipt proof result was interpreted as confirming the behavioral claim instead of dropping the finding | 2.6b |
| `F-flip-flop-not-suppressed` | Anti-flip-flop bypass | Agent proposed a finding that contradicts a resolved prior suggestion without triggering the anti-flip-flop drop | 2.5b |
| `F-carry-forward-lost` | Incremental data loss | A prior run's deferred finding was not re-admitted from `CARRIED_FINDINGS`, silently lost in an incremental (or `--full`) run | 0.7 |
| `F-prior-diagnostics-ignored` | Incremental data loss | A prior run's anchorless finding (gate row, optimality proposal, standards finding) was never parsed into `PRIOR_DIAGNOSTICS`, or was parsed and then neither replaced, resolved, nor carried — so it vanished from the re-review body | 0.7 → 2.5c |
| `F-skipped-step-read-as-resolved` | Carry-forward disposition | An entry whose owning step was skipped this run (2.4c/2.4d under `incremental-quick`, `--no-optimize`, `--no-standards`, `--skip-gates`) was dispositioned `RESOLVE` instead of `CARRY`, presenting an unverified finding as fixed | 2.5c |
| `F-thread-resolved-prematurely` | Re-review reconciliation | A `persisting` / `unaddressed` thread, or a thread authored by someone else, was resolved via `resolveReviewThread` | 2.9c |
| `F-resolved-thread-fails-gate-3` | Gate 3 false failure | A thread with `isResolved == true` was counted into `OPEN_BOT_COMMENTS[]` — resolution inferred from reply prose (author identity or a keyword list) instead of read from thread state, so an addressed finding fails Gate 3 on every subsequent pass | 1.0 → 1.8 |
| `F-unknown-thread-state-fails-gate-3` | Gate 3 false failure | Thread state was unavailable or the thread map was incomplete, and the unverified comments were admitted to `OPEN_BOT_COMMENTS[]` as failures instead of being reported as unverified | 1.0 → 1.8 |
| `F-nonblocking-thread-fails-gate-3` | Gate 3 false failure | Gate 3 rendered ❌ with no entry that is both `blocking == true` and `answered == false` — the open flag was graded as severity, so a `nitpick:`, a suggestion declined on-thread, or a finding already fixed in a later commit failed the PR | 1.0 → 1.8 |
| `F-gate-3-severity-reinvented` | Gate 3 overreach | `blocking` was decided by re-reading the code the other bot's comment points at, or by paraphrasing its ask, instead of from that bot's own `(blocking)` / `issue:` / severity decoration — the reviewer manufactured a severity it cannot evidence | 1.0 |
| `F-warn-hides-open-threads` | Gate 3 rendering | Gate 3 graded ⚠️ and `OPEN_THREADS_LIST` / `OPEN_THREADS_SUFFIX` were omitted (or entries were dropped for being non-blocking), so softening the verdict also erased the worklist the author still needs | 4 |
| `F-config-back-compat-broken` | Config regression | A review-config absence (no `.github/review.yaml`, no legacy root `.review.yaml`) caused a behavior change (threshold, cap, or filter change) instead of defaulting to `profile: balanced` | 1.7 |
| `F-standards-prose-flagged` | Standards-conformance overreach | `standards-conformance.md` emitted a finding on narrative, aspirational, or descriptive prose rather than a normative statement (must/always/never/prefer/do-not/forbidden) | 2.4d |
| `F-standards-cap-silent-truncation` | Standards-conformance budget failure | Standards text was truncated without logging the dropped document paths — the 30,000-char cap was applied silently instead of logging drops | 1.7b |
| `F-advisory-finding-dropped` | Confidence gate | A near-miss `issue`/`suggestion` (score in `[max(threshold−15,65), threshold)`) was dropped instead of deferred to `Low-confidence findings`, OR an advisory finding was posted inline / auto-applied / counted in the `cleared − deferred = posted` identity | 2.7 |
| `F-blocking-finding-deferred` | Placement | A `(blocking)` finding was deferred over the per-file or 20-total inline cap instead of always being posted inline | 2.9b |
| `F-deep-lens-starved` | Run-mode selection | An unbounded series of incremental reviews kept skipping the holistic passes because a deep-lens-refresh trigger (`CUM_DELTA_LINES > FULL_REFRESH_DELTA`, `INCR_RUNS_SINCE_FULL >= FULL_REFRESH_RUNS`, or empty `LAST_FULL_SHA`) failed to promote the run to `full` | 1.2b |
| `F-optimality-pointer-overreach` | Optimality surfacing | An optimality inline pointer was emitted for a proposal below `analysis_confidence` 95 or without a resolvable anchor, more than one pointer per proposal was posted, or the pointer carried the full argument instead of a signpost to the card | 2.4c |
| `F-report-in-review-body` | Posting host | A body carrying `<!-- PR_REVIEWER_REPORT -->` was posted as the review body (or any object other than the sticky), so each run left another permanent full report instead of one edited comment | 4a → 4b |
| `F-duplicate-report-posted` | Posting host | A second report object was created on a PR that already had one — sticky detection keyed on `.user.login` with an unresolved `ME`, a failed comments read treated as "no sticky", or an un-patchable access path answered by creating a new comment | 0.7 → 4a |
| `F-report-accordion-flattened` | Report rendering | **Retired — now structurally impossible.** The `Review details` wrapper was omitted and diagnostics rendered at the top level. Layout moved to `templates/report-body.md`; the renderer asserts the wrapper as a post-condition, so this is a render-time error rather than a review-time finding. Superseded by `F-report-hand-rendered`. | 4a |
| `F-report-accordion-expanded` | Report rendering | **Retired — now structurally impossible.** The accordion carried `open`. Same reason as above. Superseded by `F-report-hand-rendered`. | 4a |
| `F-open-threads-slot-orphaned` | Gate 3 rendering | **Retired — now structurally impossible.** One Gate 3 slot rendered without the other. `render-report.mjs` validates `OPEN_THREADS` / `OPEN_THREADS_COUNT` / `OPEN_THREADS_SUFFIX` as an all-or-nothing group and exits non-zero on a partial set. Superseded by `F-report-hand-rendered`. | 4a |
| `F-report-body-composed-from-memory` | Report rendering | **Retired — folded into `F-report-hand-rendered`,** which names the same failure without implying the three-template shape it was written against. | 4a |
| `F-report-hand-rendered` | Report rendering | `REPORT_BODY` was composed by hand instead of built as a payload and passed through `render-report.mjs` — the accordion, the marker, the body order and the section set are all properties of the template, so hand-rendering is the only way to lose them | 4a |
| `F-report-renderer-bypassed-on-error` | Report rendering | The renderer failed or could not be resolved and the run composed a body by hand rather than reporting the error and leaving the sticky untouched | 4a |
| `F-novel` | Novel mode | Does not match any existing row | — |

The taxonomy is **append-only**. New failure classes are added only after a confidence-gated diagnosis surfaces them, and a row is **never deleted** — when a failure becomes structurally impossible or is folded into another class, its row stays and is marked **Retired** with what superseded it. Deleting the row loses the record that the failure ever happened, which is the whole reason the taxonomy is append-only; L1 (G25) asserts the retired rows are still present.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **Exactly one visible `COMMENT` review is posted per run.** The `event` field MUST be `"COMMENT"` — never `"APPROVE"`, `"REQUEST_CHANGES"`, `"PENDING"`, or omitted. There is no pending/draft workflow and no `--publish` authorization gate.
- **`REPORT_BODY` is rendered by `agents/pr-reviewer/scripts/render-report.mjs`, never by hand.** The layout lives in `agents/pr-reviewer/templates/report-body.md`; the run supplies a JSON payload. The renderer fails closed on an unknown key, a missing required slot, an invalid gate glyph, a `**Verdict**` line, or a template that lost its marker or accordion — and prints nothing on stdout when it does. A renderer failure means no report that run, never a hand-written one.
- **The review `body` MUST be a non-empty one-line pointer** — never the report. The gate-status table and every other section live in the sticky comment; `payload_is_safe` (Step 4b) rejects an empty body, a body carrying `<!-- PR_REVIEWER_REPORT -->`, and a body over the pointer budget.
- **The Step 3 advisory verdict (Approve / Request changes) is terminal-only.** It is never written into the posted review body.
- **Never use `gh pr comment`.** Inline findings go only through `POST /repos/.../pulls/{n}/reviews`; `POST` / `PATCH` on `/issues/{n}/comments` is permitted for the single sticky report comment and nothing else.
- **The report body has exactly one host — the sticky.** A run posts at most one object carrying `<!-- PR_REVIEWER_REPORT -->`, and it is an issue comment. When the sticky cannot be created or patched on this access path, the report is not relocated: the run posts the compact degraded pointer (headline + a truncated newest-run ledger, marked `<!-- PR_REVIEWER_POINTER -->` so Step 0.7 recovers it) and says the report was not updated. Duplicating the report into a review body, or creating a second sticky, is a guard failure.
- **Prior-run detection is keyed on the marker, never on the bot login.** `ME` may be unresolvable (`/user` is not repo-scoped); an identity failure must degrade the relation to `cross`, never turn a `select` into "no prior report found".
- **Never fall back to a different event or endpoint on API failure.** Report verbatim with the request payload, list unposted comments, and stop.
- **Verify review state after posting.** The response MUST contain `state: "COMMENTED"`. Anything else is treated as an accidental submission and the user is alerted.
- **Every posted comment body MUST start with a Conventional-Comments prefix.** Mechanical check in `conventional-comments.md` is non-skippable.
- **Every posted comment body MUST be ≤ 240 chars and ≤ 2 sentences.** Mechanical check in `comment-shape.md` is non-skippable.
- **Every inline comment MUST carry a `side` field** (`RIGHT` or `LEFT`); omitting it returns HTTP 422.
- **A comment with `Skill("confidence", "code")` score below the profile threshold is never posted inline.** Default 80 for `balanced`; tunable via the `.github/review.yaml` profile. Lowering the inline bar without a config file is a guard failure. A near-miss `issue`/`suggestion` (score in `[max(threshold − 15, 65), threshold)`) is **deferred to the `Low-confidence findings` advisory body section, not dropped** (`per-comment-confidence.md § Drop vs. defer`); `question`/`nitpick` below threshold, and anything below the defer floor, are dropped. Advisory findings are never posted inline, never auto-applied, and never affect the verdict — routing one inline, or auto-applying one, is a guard failure.
- **A `(blocking)` finding is never subject to the inline placement caps.** Blocking findings always post inline and are never deferred; the per-file and 20-total caps govern non-blocking findings only (`rubric-composition.md § Placement`). Deferring a blocking finding over a cap is a guard failure.
- **The deep lenses cannot be starved indefinitely.** A re-review is promoted to `full` when cumulative churn since the last full pass exceeds `FULL_REFRESH_DELTA`, when `INCR_RUNS_SINCE_FULL` reaches `FULL_REFRESH_RUNS`, or when no prior full review is detectable (Step 1.2b). Letting an unbounded run of incremental reviews skip holistic forever is a guard failure.
- **A null verification proof result drops the finding; it is never read as confirmation.** `verification-receipt.md` (2.6b) is non-skippable for behavioral claims.
- **Anti-flip-flop drops are non-negotiable.** A finding that contradicts a resolved prior suggestion is dropped unconditionally, regardless of confidence score.
- **A prior run's deferred findings MUST be carried forward in every run mode**, including incremental modes and `--full`. They are not re-derivable from the delta.
- **A prior run's anchorless findings MUST be carried forward in every run mode.** Gate rows, optimality proposals, and standards findings live only in the prior review body and are not re-derivable from the delta. Each gets exactly one disposition (REPLACE / RESOLVE / CARRY / DROP), and only a step that actually ran this pass may `RESOLVE` its own entries — a skipped step's entry is always `CARRY`, re-rendered with the `(carried from …)` suffix.
- **A carried gate row never sets a gate's status.** Step 1.8 evaluates every gate against the current PR state in every run mode; `PRIOR_GATE_STATE` is context only and can neither fail a passing gate nor pass a failing one.
- **An absent review config MUST equal today's defaults.** With no `.github/review.yaml` and no legacy root `.review.yaml`, any behavior change is a guard failure (`F-config-back-compat-broken`).
- **Auto-fix and optimality-apply are forbidden in this agent.** The agent is read-only in both relations; optimality proposals are report-only and never applied. An auto-fix or apply attempt is a guard failure.
- **The agent reviews both its own and others' PRs; it never refuses on relation.** `REVIEW_RELATION` only adjusts framing tone — the pipeline, gates, and verdict are identical.
- **On a re-review, only this agent's own `fixed` / `declined` / `acknowledged` threads may be resolved.** A `persisting` / `unaddressed` thread, or another author's thread, is never resolved.
- **Resolution is read from `isResolved`, never inferred from reply prose.** A resolved thread never fails Gate 3, whoever resolved it and however the reply was worded. The reply-text heuristic is a fallback for when thread state is unavailable, and its use is always disclosed.
- **An unverifiable thread is reported, not failed.** When thread state is missing or incomplete, the affected comments are excluded from `OPEN_BOT_COMMENTS[]` and counted as unverified in the gate's Details. A tooling gap never fails a PR.
- **Gate 3 fails only on an unanswered blocking thread.** It is tri-state (`pr-reviewer.md § Gate states`): open threads that are non-blocking or already answered grade ⚠️ and never flip the verdict. Severity is read from the other bot's own decoration, never re-adjudicated here; an undecorated ask is non-blocking.
- **Softening the verdict never shrinks the worklist.** `OPEN_THREADS_LIST` renders every open thread on ⚠️ exactly as on ❌; only the `OPEN_THREADS_SUFFIX` framing on the summary changes. A thread may leave the list only by being resolved. The bullets live inside the `Review details` accordion and the count stays visible on the summary above it — collapsing is never allowed to become omitting, and the visible count is what guarantees that.
- **The report body is collapsed by default, and the wrapper is not optional.** Every diagnostic renders inside `<details><summary>Review details…` with no `open` attribute — but this is now a property of `templates/report-body.md` enforced by `render-report.mjs`, not a rule a run must remember. A body that violates it was hand-written (`F-report-hand-rendered`), and the Step 4a pre-write assertion catches it even when the renderer was bypassed.
- **Narrative and aspirational prose is never a finding.** `standards-conformance.md` must only flag clearly violated normative statements (must / always / never / prefer / do not / forbidden). A finding on descriptive or aspirational prose is a guard failure (`F-standards-prose-flagged`).
- **Over-cap drops in standards discovery are always logged, never silent.** When the 30,000-char cap is reached, every dropped document is logged by path. Silent truncation is a guard failure (`F-standards-cap-silent-truncation`).
- **A lens cannot upgrade a finding to a blocking verdict.** Strict blocking rules (broken behaviour, security, data loss, misimplemented intent) apply regardless of lens severity hints.
- **Maximum 3 lenses per `--with` invocation.**
- **Pre-existing issues do not count toward the verdict.**
- **Every backticked symbol in a comment body MUST grep-resolve against the changed file.** `finding-grounding.md` is the load-bearing false-positive control.
- **Holistic review is default ON in `full` mode.** Skipping requires `--no-holistic` (announced in the run line), a trivial-skip condition, the token-economy skip, or an incremental run. Silent skip on a non-trivial `full`-mode diff is a guard failure.
- **`system-fit` findings in the cross relation MUST be framed as `question:`, not `issue:`.** The cross-review agent has less context than the PR author; the framing asymmetry is non-negotiable. `intent-mismatch` remains `issue:` because by definition the diff does not do what the PR claims.

---

## Artifacts

| File pattern | Produced by | When |
| --- | --- | --- |
| Terminal local proposal (gate-status table + cards) | pr-reviewer Step 3 | Every run |
| Sticky report comment (one per PR, marker + run ledger) | pr-reviewer Step 4a | Every run — created once, patched thereafter |
| Visible `COMMENT` review on GitHub (`state: "COMMENTED"`) | pr-reviewer Step 4b | Only when there are new inline findings, it is the first run, the verdict worsened, or a new blocking finding appeared |
| Resolved GitHub review threads (`resolveReviewThread`) | pr-reviewer Step 2.9c | Re-review only, for this agent's own fixed / declined / acknowledged threads |
| `/tmp/pr-files.json` (ephemeral) | `gh api repos/.../pulls/{n}/files` | Step 1.2 |
| `/tmp/pr-delta.json` (ephemeral) | `gh api repos/.../compare/...` | Step 1.2b (incremental modes) |
| `reviewer-comment-relevance` memories | pr-reviewer Step 2.9c | Re-review reconciliation (`trigger: re-review-reconcile`) |
| Terminal Quality Gate summary | shared/rules pipeline | Every run |
| `.agent/recordings/*.{webm,mp4,gif}` | `Skill("screen-recorder")` | Motion-relevant diff + stable selector + preview deploy URL |

The agent rewrites one sticky report per PR and posts at most one review per run. Its only durable state is the sticky body — the report plus the run ledger — which a re-run reads back; everything else recomputes from PR state.
Diagnoses lean on the transcript plus the GitHub-side sticky and reviews (inspectable via `gh api`).

---

## Validators

- `claude plugin validate agents/pr-reviewer.md` — frontmatter + structure check (when supported for agents).
- `gh api repos/$REPO/pulls/$PR_NUMBER/reviews --jq '.[] | select(.user.login == "'"$(gh api user --jq .login)"'") | {id, state}'` — confirms any review posted by the current user is `COMMENTED`; any other state after a Step 4b run is the load-bearing safety failure.
- `ME=$(gh api user --jq .login) gh api repos/$REPO/issues/$PR_NUMBER/comments --paginate --jq '[.[] | select(.user.login == env.ME and (.body | contains("<!-- PR_REVIEWER_REPORT -->")))] | length'` — MUST be exactly `1` after any run on a PR. Mirror the Step 0.7 fetch exactly: `--paginate` (a PR with > 30 issue comments otherwise returns `0`, reading as "the sticky was never written") and the author filter (any other actor quoting the marker otherwise inflates it to `2+`, reading as a duplicate). A validator looser than the fetch it checks raises false alarms on a stated MUST. `0` means Step 4a never wrote the sticky; `2+` means a run created a duplicate instead of patching, which splits the ledger and the carry-forward history.
- Manual end-to-end: run twice with no code change between passes and nothing new found; confirm the second run patches the sticky, posts **no** second review, and says so in the Step 5 report.
- Manual end-to-end: run on a PR whose report predates the sticky (report in a `reviews` body); confirm the legacy fallback finds it, carry-forward still runs, and the sticky is created this run.
- Manual end-to-end: on a re-review where the agent resolves its own last open thread, confirm the sticky's unblock checklist no longer lists it **in the same run** (Step 2.9c before Step 4), rendered as plain bullets with no `- [ ]` checkbox.
- Manual end-to-end: invoke against a known PR with a deliberately out-of-hunk proposed comment line; confirm `line-validity.md` retargets or drops it.
- Manual end-to-end: invoke against your own PR; confirm `REVIEW_RELATION` is set to `self`, the agent does not refuse, and the review posts as a visible `COMMENT`.
- Manual end-to-end: invoke against someone else's PR; confirm `REVIEW_RELATION` is `cross`, `system-fit` findings are framed as `question:`, and no optimality proposal is applied.
- Manual end-to-end: invoke with `--with code-quality,ux,critical,extra` (4 lenses); confirm the agent aborts with `--with: max 3 lenses (got 4)`.
- Manual end-to-end: invoke with one comment naming a backticked symbol absent from the diff; confirm `finding-grounding.md` drops it and logs the drop.
- Manual end-to-end: invoke with one deliberately overlong comment; confirm `comment-shape.md` drops it before posting.
- Manual end-to-end: re-invoke on a PR with a prior `<!-- PR_REVIEWER_REPORT -->` review; confirm `CARRIED_FINDINGS` are re-admitted and Step 2.9c resolves only this agent's own fixed / declined threads.
- Manual end-to-end: on a PR where a bot replied with a free-form decline (no "won't fix" / "by design" wording, reply authored by the bot rather than the PR author) and then resolved the thread, confirm Gate 3 passes. Under the old prose test this PR fails Gate 3 permanently.
- Manual end-to-end: on a PR whose only open bot threads are a `nitpick:`/`suggestion:` with no blocking decoration and a thread declined on-thread with a rationale, confirm Gate 3 renders ⚠️ (not ❌), the verdict stays PASS/WARN, and the accordion summary still counts both threads while `OPEN_THREADS_LIST` still lists them under the `Open bot threads` heading. Under the old binary gate this PR fails until someone clicks Resolve.
- `gh api graphql` the PR's `reviewThreads` and compare the `isResolved == false` count against `OPEN_BOT_COMMENTS[]`; any resolved thread present in the array is `F-resolved-thread-fails-gate-3`.
- Manual end-to-end: re-invoke on a PR whose prior review body carries a `❌` gate row and an optimality proposal, pushing a delta small enough to select `incremental-quick` (which skips 2.4c/2.4d); confirm the gate row is re-evaluated by Step 1.8 and the optimality card is re-rendered with `(carried from <sha>)` rather than disappearing.
- Manual end-to-end: re-invoke against a prior review body written by an older template (no `Review details` accordion); confirm the run announces `Prior diagnostics unparseable — anchorless carry-forward skipped.` and completes normally.
