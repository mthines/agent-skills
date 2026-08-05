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
It is **read-only**: it never auto-fixes, never applies an optimality rewrite, and never writes anywhere outside of `gh api pulls/{n}/reviews` (plus the `resolveReviewThread` GraphQL mutation on a re-review).
It posts **exactly one visible `COMMENT` review** per run, directly and unconditionally — there is no pending/draft workflow, no `--publish` authorization gate, and no own-PR refusal.

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
| 0.7 | Prior run detection | [pr-reviewer.md § Step 0.7](../../pr-reviewer.md) | `RUN_MODE` (full / incremental / incremental-quick) chosen; `PRIOR_SHA` set from the prior review's `commit_id`; `CARRIED_FINDINGS` parsed in every mode |
| 1.0 | Prior-comment awareness + memory load (default ON) | [shared/rules/prior-comment-awareness.md](../../shared/rules/prior-comment-awareness.md), [shared/rules/comment-relevance-memory.md](../../shared/rules/comment-relevance-memory.md) | Existing PR review comments fetched via `gh api`; dedup set, resolved-suggestion set, and `OPEN_BOT_COMMENTS[]` built; `reviewer-lessons` + `reviewer-comment-relevance` memories loaded narrow-to-broad |
| 1.1 | Fetch PR data in parallel | [pr-reviewer.md § Step 1.1](../../pr-reviewer.md) | Metadata, diff, CI checks, prior reviews, and issue comments fetched concurrently; `state == "OPEN"` confirmed |
| 1.2 | Patch cache | [line-validity.md](./line-validity.md) | `/tmp/pr-files.json` populated with the full PR patch; sole source of line-validity truth; `HEAD_SHA` set |
| 1.2b | Delta triage (incremental modes only) | [pr-reviewer.md § Step 1.2b](../../pr-reviewer.md) | `DELTA_LINES` / `NEW_FILES` / `HIGH_STAKES` computed; upgrade to `full` on any trigger; `REVIEW_DIFF` set |
| 1.2c | Diff-keyed lesson search (all modes) | [pr-reviewer.md § Step 1.2c](../../pr-reviewer.md) | One targeted `memory.search` keyed on changed paths; merged into the Step 1.0 pool |
| 1.3 | Intent synthesis | [pr-reviewer.md § Step 1.3](../../pr-reviewer.md) | 2–3 line intent summary; uncertainty flagged on missing PR body |
| 1.5 | Pre-existing-issue separation | [pr-reviewer.md § Step 1.5](../../pr-reviewer.md) | Context-line findings tagged `[pre-existing]`; excluded from verdict |
| 1.6 | Lens loading | [shared/rules/rubric-composition.md](../../shared/rules/rubric-composition.md), [review-lens-contract.md](../../../skills/authoring/create-skill/rules/review-lens-contract.md) | Max 3 lenses; `lens-version: 1`; dedupe against auto-loaded |
| 1.7 | Review config load | [shared/rules/review-config.md](../../shared/rules/review-config.md) | `.review.yaml` hierarchy resolved; absent config → `profile: balanced` (threshold 80, inline placement cap 5, no filters) |
| 1.8 | Pre-merge gate checks | [pr-reviewer.md § Step 1.8](../../pr-reviewer.md) | Gates 1–5 evaluated against the full PR state; `--skip-gates` sets them `SKIPPED`; token-economy holistic-skip heuristic on ≥ 3 failing gates |
| 2 | Review (multi-rubric + personas) | [shared/rules/rubric-composition.md](../../shared/rules/rubric-composition.md) | `code-quality` always; `ux` on UI globs; `critical` on auto-engage / `--critical`; lenses; Personas 1–4 (Persona 4 skipped in `incremental-quick`) |
| 2.2 | Relevance-memory filtering | [shared/rules/comment-relevance-memory.md § Read](../../shared/rules/comment-relevance-memory.md) | Drop / downgrade not-relevant patterns; promote reliably-resolved ones; `APPLIED_MEMORIES[]` built for the review-body diagnostics |
| 2.3 | Filter suppression | [shared/rules/review-config.md § Filters](../../shared/rules/review-config.md) | Drop findings whose category is in the effective `filters:` list; runs before holistic; no-op when no `.review.yaml` |
| 2.4 | Holistic review (default ON in `full`) | [shared/rules/holistic-review.md](../../shared/rules/holistic-review.md), `Skill("holistic-analysis", "review")` | Runs unless `--no-holistic`, trivial-skip, token-economy skip, or an incremental run; findings mapped to `issue` (intent-mismatch) / `question` (system-fit, scope-creep) in cross relation |
| 2.4b | Targeted holistic escalation (default ON in `full`) | [shared/rules/holistic-review.md § Targeted escalation](../../shared/rules/holistic-review.md) | Parallel focused traces on context-dependent findings, cap 10; skipped by `--no-escalate` or when 2.4 was skipped |
| 2.4c | Optimality review (default ON in `full` / `incremental`) | [shared/rules/optimality-review.md](../../shared/rules/optimality-review.md), `Skill("optimize-approach", "report")` | **Report-only — cross-review never applies.** Runs unless `--no-optimize`, trivial-skip, or `incremental-quick`; 0–2 proposals rendered as review-body cards, never inline; `analysis_confidence` ≥ 85 is the only confidence gate; never blocks the verdict |
| 2.5 | Dedupe + consolidate | [shared/rules/rubric-composition.md § Consolidation](../../shared/rules/rubric-composition.md) | Dedupe, group, priority-sort; **no cap, nothing dropped**; holistic claim wins on `(file, line)` collision |
| 2.5b | Prior-comment dedup | [shared/rules/prior-comment-awareness.md](../../shared/rules/prior-comment-awareness.md) | Drop findings already said in a prior review pass; anti-flip-flop on resolved suggestions |
| 2.6 | Finding grounding | [shared/rules/finding-grounding.md](../../shared/rules/finding-grounding.md) | Every backticked symbol grep-confirmed in changed file |
| 2.6b | Verification receipt | [shared/rules/verification-receipt.md](../../shared/rules/verification-receipt.md) | Behavioral claims need executed proof (grep / ast-grep / file-read); null result = DROP |
| 2.7 | Per-comment confidence | [shared/rules/per-comment-confidence.md](../../shared/rules/per-comment-confidence.md) | `Skill("confidence", "code")` weighted Final ≥ profile threshold (default 80); receipt evidence fed in |
| 2.8 | Comment shape | [shared/rules/comment-shape.md](../../shared/rules/comment-shape.md) | ≤ 240 chars, ≤ 2 sentences, no headings, no bullets |
| 2.9 | Conventional Comments | [shared/rules/conventional-comments.md](../../shared/rules/conventional-comments.md) | Prefix prepended; `(blocking)` / `(non-blocking)` decoration appended |
| 2.9b | Placement | [shared/rules/rubric-composition.md § Placement (Step 2.9b)](../../shared/rules/rubric-composition.md) | Inline caps (profile per-file, 20 total) applied after every quality gate; overflow deferred to the review body's `Additional findings`, never dropped |
| 3 | Local proposal (terminal output) | [pr-reviewer.md § Step 3](../../pr-reviewer.md), [templates/pr-comment-card.template.md](../../templates/pr-comment-card.template.md) | Gate-status table + numbered cards; PASS / WARN / FAIL presentation chosen by gate states; advisory terminal verdict |
| 3.5 | Line validity pre-flight | [line-validity.md](./line-validity.md) | Every `(file, line)` falls inside a RIGHT-side diff hunk; retarget ≤ 3 lines or drop |
| 4 | Post the review | [pr-reviewer.md § Step 4](../../pr-reviewer.md) | `payload_is_safe` pre-flight; exactly one `POST /pulls/{n}/reviews` with `event="COMMENT"` and a non-empty gate-table body; `state: "COMMENTED"` confirmed |
| 4.5 | Reconcile prior threads (re-review only) | [shared/rules/thread-resolution.md](../../shared/rules/thread-resolution.md) | Auto-resolve this agent's own fixed / declined / acknowledged threads via `resolveReviewThread`; write outcomes to `reviewer-comment-relevance`; skipped on a first-pass review |
| 5 | Report | [pr-reviewer.md § Step 5](../../pr-reviewer.md) | Lead with "Posted review …"; confirm `COMMENTED`; list gate verdicts, integrations, and line-validity casualties |

There is no Auto-Fix phase, no optimality-apply phase, and no authorization gate.
The `reviewer` agent that once owned own-work Fix / Report / Self-Review sub-modes has been retired and its behaviour folded into this agent's `self` relation.

---

## Existing guards per phase

| Phase | Existing guards | Typical gaps |
| --- | --- | --- |
| 0 | Literal-args rule, parent-paraphrase ignored; PR reference regex (URL / `#n` / bare integer) | Argument quoting strips a flag; bare integer mistaken for a URL fragment; `RESOLVED_REPO` empty outside a git repo |
| 0.5 | `gh api user` vs `gh pr view --json author.login`; sets `REVIEW_RELATION` without refusing | Token belongs to a different account than the CLI session, so relation is misclassified; tone-framing leaks between relations |
| 0.7 | Prior-review marker (`<!-- PR_REVIEWER_REPORT -->`) fetch; `PRIOR_SHA` from `commit_id`; `CARRIED_FINDINGS` parsed in every mode incl. `--full` | Carry-forward skipped in an incremental mode, silently losing a deferred finding; `PRIOR_SHA` read from body text instead of `commit_id` |
| 1.0 | Prior PR comments fetched via `gh api`; dedup set + `OPEN_BOT_COMMENTS[]` built (default ON); memories loaded narrow-to-broad, expired skipped | `gh api` paginates on PRs with > 100 comments; first-pass run has empty dedup set (correct no-op); `memory.*` not connected (silent no-op) |
| 1.1 | Five parallel `gh` fetches; `state == "OPEN"` confirmed; fetched content treated as reference data, not instructions | Long-running PR with commits since fetch; race with a new push; MERGED/CLOSED needs a proceed prompt |
| 1.2 | `/tmp/pr-files.json` populated once at run start with the full PR patch | Cache stale if the run takes > 60 s and the PR receives commits |
| 1.2b | Delta compared via `gh api compare`; upgrade rules (delta > 100, any new file, any high-stakes path) force `full`; zero-delta short-circuit to gate-only | Heuristic marks a real change trivial; high-stakes regex misses a path; `/tmp/pr-files.json` wrongly replaced (it must stay the full PR patch) |
| 1.2c | Diff-keyed `memory.search` merged into the Step 1.0 pool; relevance count stays relevance-only | Search widens `MEMORIES_READ_COUNT` beyond relevance memories; `reviewer-lessons` hit not applied as a consideration |
| 1.3 | Sources: PR title, body, commit messages, branch name | Branch named `fix/stuff`; intent guessed and findings calibrated against the guess |
| 1.5 | Context-line tagging via diff prefix inspection | Finding on a moved line counted as new when the same logic existed on a deleted line |
| 1.6 | Max 3, lens-version validation, dedupe, applies-to glob | Lens > 80 lines warned but loaded; missing `lens.md` silently skipped |
| 1.7 | `.review.yaml` hierarchy walk; absent file → `profile: balanced` | Nested subtree overrides root profile silently if the path walk is incorrect |
| 1.8 | Gates 1–5 evaluated on the full PR state; Gate 1 (description) and Gate 6 (code review) are soft; token-economy holistic-skip on ≥ 3 failing gates | A hard gate misclassified as soft; Gate 4 self-review scan misses a debug artifact on a `+` line; prose-vs-code carve-out over- or under-fires |
| 2 | Skill loading order; auto-engage heuristics for `critical`; persona availability by run mode | Auto-engage regex misses `prisma/migrations`; UX heuristic misses Svelte 5 `.svelte.ts`; Persona 4 activated when no integration changed |
| 2.2 | Relevance memories drop (`not-relevant` ≥ 3) / downgrade (1–2) / promote (`relevant` ≥ 2); `APPLIED_MEMORIES[]` linked in the report | A legitimate finding suppressed by an over-broad memory; applied memory not linked so the influence is invisible |
| 2.3 | Filter list matched against each finding's category; no-op when `filters:` empty | Over-broad category tag suppresses a legitimate finding; step skipped so `Filter drops` stays 0 despite configured filters |
| 2.4 | Default-on holistic call; trivial-skip heuristic; size-scaled `max_findings` (3 / 6 / 10); cross relation maps `system-fit` to `question` | Holistic skipped on a non-trivial diff the heuristic marked trivial; holistic finding overrides a correct line-level finding on the same `(file, line)`; framing leak (`system-fit` posted as `issue`) |
| 2.4b | Parallel focused traces on context-dependent findings, cap 10; skipped when 2.4 was skipped or `--no-escalate` | Escalation fans out on a non-context-dependent finding, wasting a trace; cap exceeded |
| 2.4c | Report-mode call; proposals bypass 2.7–2.9b and render as body cards; log block emitted even at 0 proposals; **cross-review never applies** | Proposal squeezed into an inline comment and trimmed / dropped by `comment-shape`; log block omitted so a skipped run is indistinguishable from a silent one; proposal allowed to influence the verdict; an apply is attempted |
| 2.5 | Dedupe, group, priority-sort; no cap applied here; holistic claim wins on collision | LLM caps findings inline despite the rule; holistic-vs-line-level collision resolved wrongly |
| 2.5b | Prior-comment dedup: `(path, line ± 2)` + same prefix → DROP; anti-flip-flop: resolved suggestion contradicted → DROP unconditionally | Dedup step skipped on an incremental pass; anti-flip-flop threshold miscalibrated on moved lines |
| 2.6 | Backticked-token grep, allowlist for keywords / built-ins | Hallucinated multi-word phrase passes (not backticked); allowlist over-eager |
| 2.6b | Proof tool run (grep / ast-grep / file-read); null/empty → DROP; contradicting → DROP; ambiguous → downgrade to `question:` | Proof tool not run on behavioral claims; null result mistakenly treated as confirmation |
| 2.7 | `Skill("confidence", "code")` weighted Final ≥ profile threshold (default 80); receipt evidence in the Evidence field | Confidence skill not wired for the per-comment input shape; threshold not read from the resolved profile |
| 2.8 | Mechanical pre-emit: length, sentences, structure | Trim heuristic breaks the comment's point; drop reported but easy to miss |
| 2.9 | Prefix table + decoration; mechanical pre-emit | Decoration appended twice on retry |
| 2.9b | Inline placement caps (5/file, 20 total); overflow deferred to the review body, never dropped; ordering by prefix then confidence | A cleared finding is dropped instead of deferred; `Additional findings` section omitted while `DEF > 0`; deferred list not carried into the next incremental run |
| 3 | Gate-status table + card template; PASS / WARN / FAIL chosen by gate states; advisory verdict is terminal-only | Card emitted without anchor; a soft ⚠️ gate counted into `FAILING_GATE_COUNT`; advisory verdict leaked into the posted body |
| 3.5 | Hunk walk; valid-range computation; retarget ≤ 3 lines | Off-by-one when a hunk has interleaved deletions; one bad line nukes the whole payload |
| 4 | `payload_is_safe` pre-flight; `event == "COMMENT"`; non-empty gate-table body; Conventional prefix + ≤ 240 chars per comment; `side` present; `state: "COMMENTED"` verified; no fallback on API failure | `event` mapped to `APPROVE` / `REQUEST_CHANGES`; empty body posted; `gh pr comment` used instead of the reviews endpoint; more than one review posted; fallback attempted on failure |
| 4.5 | `resolveReviewThread` only on this agent's own `fixed` / `declined` / `acknowledged` threads; never on `persisting` / `unaddressed`; write outcomes to `reviewer-comment-relevance`; skipped on first pass | A `persisting` thread resolved prematurely; a thread authored by someone else resolved; runs before Step 4 and blocks the review |
| 5 | Lead with "Posted review …"; confirm `COMMENTED`; report gate verdicts, integrations, line-validity casualties, and Files-Changed link | "Drafted"/"pending" wording leaks into the report; casualties not listed for manual posting |

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID | Class | Symptom | Primary phase |
| --- | --- | --- | --- |
| `F-event-not-comment` | Posting event | Posted review used `APPROVE` / `REQUEST_CHANGES` or omitted `event` instead of the required `event: "COMMENT"` | 4 |
| `F-body-empty` | Payload shape | Review `body` was empty; `payload_is_safe` requires a non-empty gate-table body | 4 |
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
| `F-thread-resolved-prematurely` | Re-review reconciliation | A `persisting` / `unaddressed` thread, or a thread authored by someone else, was resolved via `resolveReviewThread` | 4.5 |
| `F-config-back-compat-broken` | Config regression | A `.review.yaml` absence caused a behavior change (threshold, cap, or filter change) instead of defaulting to `profile: balanced` | 1.7 |
| `F-novel` | Novel mode | Does not match any existing row | — |

The taxonomy is **append-only**. New failure classes are added only after a confidence-gated diagnosis surfaces them.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **Exactly one visible `COMMENT` review is posted per run.** The `event` field MUST be `"COMMENT"` — never `"APPROVE"`, `"REQUEST_CHANGES"`, `"PENDING"`, or omitted. There is no pending/draft workflow and no `--publish` authorization gate.
- **The review `body` MUST be a non-empty string** carrying the gate-status table. `payload_is_safe` (Step 4) rejects an empty body.
- **The Step 3 advisory verdict (Approve / Request changes) is terminal-only.** It is never written into the posted review body.
- **Never use `gh pr comment` or `POST /issues/{n}/comments`.** Only `POST /repos/.../pulls/{n}/reviews`.
- **Never fall back to a different event or endpoint on API failure.** Report verbatim with the request payload, list unposted comments, and stop.
- **Verify review state after posting.** The response MUST contain `state: "COMMENTED"`. Anything else is treated as an accidental submission and the user is alerted.
- **Every posted comment body MUST start with a Conventional-Comments prefix.** Mechanical check in `conventional-comments.md` is non-skippable.
- **Every posted comment body MUST be ≤ 240 chars and ≤ 2 sentences.** Mechanical check in `comment-shape.md` is non-skippable.
- **Every inline comment MUST carry a `side` field** (`RIGHT` or `LEFT`); omitting it returns HTTP 422.
- **Drop any comment with `Skill("confidence", "code")` score below the profile threshold.** Default 80 for `balanced`; tunable via `.review.yaml` profile. Lowering without a config file is a guard failure.
- **A null verification proof result drops the finding; it is never read as confirmation.** `verification-receipt.md` (2.6b) is non-skippable for behavioral claims.
- **Anti-flip-flop drops are non-negotiable.** A finding that contradicts a resolved prior suggestion is dropped unconditionally, regardless of confidence score.
- **A prior run's deferred findings MUST be carried forward in every run mode**, including incremental modes and `--full`. They are not re-derivable from the delta.
- **Absent `.review.yaml` MUST equal today's defaults.** Any behavior change without a config file present is a guard failure (`F-config-back-compat-broken`).
- **Auto-fix and optimality-apply are forbidden in this agent.** The agent is read-only in both relations; optimality proposals are report-only and never applied. An auto-fix or apply attempt is a guard failure.
- **The agent reviews both its own and others' PRs; it never refuses on relation.** `REVIEW_RELATION` only adjusts framing tone — the pipeline, gates, and verdict are identical.
- **On a re-review, only this agent's own `fixed` / `declined` / `acknowledged` threads may be resolved.** A `persisting` / `unaddressed` thread, or another author's thread, is never resolved.
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
| Visible `COMMENT` review on GitHub (`state: "COMMENTED"`) | pr-reviewer Step 4 | Every run |
| Resolved GitHub review threads (`resolveReviewThread`) | pr-reviewer Step 4.5 | Re-review only, for this agent's own fixed / declined / acknowledged threads |
| `/tmp/pr-files.json` (ephemeral) | `gh api repos/.../pulls/{n}/files` | Step 1.2 |
| `/tmp/pr-delta.json` (ephemeral) | `gh api repos/.../compare/...` | Step 1.2b (incremental modes) |
| `reviewer-comment-relevance` memories | pr-reviewer Step 4.5 | Re-review reconciliation (`trigger: re-review-reconcile`) |
| Terminal Quality Gate summary | shared/rules pipeline | Every run |
| `.agent/recordings/*.{webm,mp4,gif}` | `Skill("screen-recorder")` | Motion-relevant diff + stable selector + preview deploy URL |

The agent posts one visible review per run and holds no durable review payload — a re-run recomputes from the PR state and the prior-review marker.
Diagnoses lean on the transcript plus the GitHub-side posted review (inspectable via `gh api`).

---

## Validators

- `claude plugin validate agents/pr-reviewer.md` — frontmatter + structure check (when supported for agents).
- `gh api repos/$REPO/pulls/$PR_NUMBER/reviews --jq '.[] | select(.user.login == "'"$(gh api user --jq .login)"'") | {id, state}'` — confirms the most-recent review by the current user is `COMMENTED`; any other state after a Step 4 run is the load-bearing safety failure.
- Manual end-to-end: invoke against a known PR with a deliberately out-of-hunk proposed comment line; confirm `line-validity.md` retargets or drops it.
- Manual end-to-end: invoke against your own PR; confirm `REVIEW_RELATION` is set to `self`, the agent does not refuse, and the review posts as a visible `COMMENT`.
- Manual end-to-end: invoke against someone else's PR; confirm `REVIEW_RELATION` is `cross`, `system-fit` findings are framed as `question:`, and no optimality proposal is applied.
- Manual end-to-end: invoke with `--with code-quality,ux,critical,extra` (4 lenses); confirm the agent aborts with `--with: max 3 lenses (got 4)`.
- Manual end-to-end: invoke with one comment naming a backticked symbol absent from the diff; confirm `finding-grounding.md` drops it and logs the drop.
- Manual end-to-end: invoke with one deliberately overlong comment; confirm `comment-shape.md` drops it before posting.
- Manual end-to-end: re-invoke on a PR with a prior `<!-- PR_REVIEWER_REPORT -->` review; confirm `CARRIED_FINDINGS` are re-admitted and Step 4.5 resolves only this agent's own fixed / declined threads.
