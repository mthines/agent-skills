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

`pr-reviewer` is the **cross-review** half of the former `reviewer` agent. Its single job is to author and (with authorization) post a PENDING GitHub review on someone else's PR. It never auto-fixes, never operates on a PR authored by the current user (it refuses and points to `reviewer`), and never writes anywhere outside of `gh api pulls/{n}/reviews`.

The companion agent `reviewer` handles own-work (Fix Mode, Report Mode, Self-Review on own PR) and has its own diagnostic surface at `agents/reviewer/rules/diagnostic-surface.md`.

---

## Source root

`agents/`

`git apply` runs from this root. The agent body lives at `agents/pr-reviewer.md`; supporting rules live under `agents/pr-reviewer/`. Shared rules imported by both agents live under `agents/shared/`.

---

## Phase model

| Phase | Name | Rule / section | Gate |
| --- | --- | --- | --- |
| 0 | Raw-arguments read | [pr-reviewer.md § Step 0](../../pr-reviewer.md) | Raw arguments preserved verbatim; parent paraphrases ignored |
| 0.5 | Authorship pre-check | [pr-reviewer.md § Step 0.5](../../pr-reviewer.md) | `author != current user`; refuse with redirect to `reviewer` if equal |
| 1.0 | Prior-comment awareness (default ON) | [shared/rules/prior-comment-awareness.md](../../shared/rules/prior-comment-awareness.md) | Existing PR review comments fetched via `gh api`; dedup set and resolved-suggestion set built |
| 1.1 | PR resolution | [pr-reviewer.md § Step 1.1](../../pr-reviewer.md) | PR number, repo, base/head/state resolved via `gh pr view --json` |
| 1.2 | Patch cache | [line-validity.md](./line-validity.md) | `/tmp/pr-files.json` populated; sole source of line-validity truth |
| 1.3 | Intent synthesis | [pr-reviewer.md § Step 1.3](../../pr-reviewer.md) | 2–3 line intent summary; uncertainty flagged on missing PR body |
| 1.5 | Pre-existing-issue separation | [pr-reviewer.md § Step 1.5](../../pr-reviewer.md) | Context-line findings tagged `[pre-existing]`; excluded from verdict |
| 1.6 | Lens loading | [shared/rules/rubric-composition.md](../../shared/rules/rubric-composition.md), [review-lens-contract.md](../../../skills/authoring/create-skill/rules/review-lens-contract.md) | Max 3 lenses; `lens-version: 1`; dedupe against auto-loaded |
| 1.7 | Review config load | [shared/rules/review-config.md](../../shared/rules/review-config.md) | `.review.yaml` hierarchy resolved; absent config → `profile: balanced` (defaults to profile: balanced — threshold 80, per-file cap 5, no filters) |
| 2 | Review (multi-rubric) | [shared/rules/rubric-composition.md](../../shared/rules/rubric-composition.md) | `code-quality` always; `ux` on UI globs; `critical` on auto-engage / `--critical`; lenses |
| 2.4 | Holistic review (default ON) | [shared/rules/holistic-review.md](../../shared/rules/holistic-review.md), `Skill("holistic-analysis", "review")` | Runs unless `--no-holistic` OR trivial-skip; emits 0–3 findings mapped to `issue` (intent-mismatch) / `question` (system-fit, scope-creep) |
| 2.5 | Dedupe + consolidate | [shared/rules/rubric-composition.md § Consolidation](../../shared/rules/rubric-composition.md) | Per-file cap 5; total cap 20; priority-sorted; holistic claim wins on `(file, line)` collision |
| 2.5b | Prior-comment dedup | [shared/rules/prior-comment-awareness.md](../../shared/rules/prior-comment-awareness.md) | Drop findings already said in a prior review pass; anti-flip-flop on resolved suggestions |
| 2.6 | Finding grounding | [shared/rules/finding-grounding.md](../../shared/rules/finding-grounding.md) | Every backticked symbol grep-confirmed in changed file |
| 2.6b | Verification receipt | [shared/rules/verification-receipt.md](../../shared/rules/verification-receipt.md) | Behavioral claims need executed proof (grep / ast-grep / file-read); null result = DROP |
| 2.7 | Per-comment confidence | [shared/rules/per-comment-confidence.md](../../shared/rules/per-comment-confidence.md) | `Skill("confidence", "code")` weighted Final ≥ profile threshold (default 80); receipt evidence fed in |
| 2.8 | Comment shape | [shared/rules/comment-shape.md](../../shared/rules/comment-shape.md) | ≤ 240 chars, ≤ 2 sentences, no headings, no bullets |
| 2.9 | Conventional Comments | [shared/rules/conventional-comments.md](../../shared/rules/conventional-comments.md) | Prefix prepended; `(blocking)` / `(non-blocking)` decoration appended |
| 3 | Local proposal | [pr-reviewer.md § Step 3](../../pr-reviewer.md), [templates/pr-comment-card.template.md](../../templates/pr-comment-card.template.md) | Summary table + numbered cards; total / dropped counts |
| 3.5 | Line validity | [line-validity.md](./line-validity.md) | Every `(file, line)` falls inside a RIGHT-side diff hunk |
| 3.6 | Persist publish-ready payload | [pr-reviewer.md § Step 3.6](../../pr-reviewer.md) | Validated `comments[]` + `commit_id` + `body:""` written to `.agent/pr-review/<owner>__<repo>__<n>.payload.json` |
| 4 | Authorization gate | [authorization-gate.md](./authorization-gate.md) | `--publish` token in raw args OR explicit phrase in latest user message with negation guard clear |
| 5 | Post pending review | [posting-mechanics.md](./posting-mechanics.md) | `event` omitted; `body == ""`; verified `state: PENDING` post-call |
| 6 | Report | [posting-mechanics.md § Reporting](./posting-mechanics.md) | Lead with "Drafted N pending comments"; use "drafted" not "posted" |

There is no Auto-Fix phase. There is no Self-Review phase. Both belong to `reviewer`.

---

## Existing guards per phase

| Phase | Existing guards | Typical gaps |
| --- | --- | --- |
| 0 | Literal-args rule, parent-paraphrase ignored | Argument quoting strips `--publish`; bare integer mistaken for hash |
| 0.5 | `gh api user` vs `gh pr view --json author.login`; explicit refusal on match | Token belongs to a different account than the user's CLI session; agent runs as wrong identity |
| 1.0 | Prior PR comments fetched via `gh api`; dedup set built (default ON) | `gh api` paginates on PRs with > 100 comments; first-pass run has empty dedup set (correct no-op) |
| 1.1 | `gh pr view --json state`; warn on `MERGED` / `CLOSED` | Long-running PR with multiple commits since cache; race with new pushes |
| 1.2 | `/tmp/pr-files.json` populated once at run start | Cache stale if run takes > 60 s and PR receives commits |
| 1.3 | Sources: PR title, body, commit messages, branch name | Branch named `fix/stuff`; intent guessed and findings calibrated against the guess |
| 1.5 | Context-line tagging via diff prefix inspection | Finding on a moved line counted as new when same logic existed on deleted line |
| 1.6 | Max 3, lens-version validation, dedupe, applies-to glob | Lens > 80 lines warned but loaded; missing `lens.md` silently skipped |
| 1.7 | `.review.yaml` hierarchy walk; absent file → `profile: balanced` (defaults to profile: balanced) | Nested subtree overrides root profile silently if path walk is incorrect |
| 2 | Skill loading order; auto-engage heuristics for `critical` | Auto-engage regex misses `prisma/migrations`; UX heuristic misses Svelte 5 `.svelte.ts` |
| 2.4 | Default-on holistic call; trivial-skip heuristic (whitespace / dep-bumps / test-only / < 10 lines + no high-stakes); 3-finding cap; pr-reviewer maps `system-fit` to `question` | Holistic skipped on a non-trivial diff that the heuristic incorrectly marked trivial; holistic finding overrides a line-level finding on the same `(file, line)` when the line-level was actually correct; framing leaks: `system-fit` posted as `issue` instead of `question` |
| 2.5 | Per-file cap 5, total cap 20, priority-sorted; holistic claim wins on collision | LLM dedupes inline despite the rule; cap drops not surfaced; holistic-vs-line-level collision resolved wrongly |
| 2.5b | Prior-comment dedup: `(path, line ± 2)` + same prefix → DROP; anti-flip-flop: resolved suggestion contradicted → DROP unconditionally | Dedup step skipped on incremental review pass; anti-flip-flop threshold miscalibrated on moved lines |
| 2.6 | Backticked-token grep, allowlist for keywords / built-ins | Hallucinated multi-word phrase passes (not backticked); allowlist over-eager |
| 2.6b | Proof tool run (grep / ast-grep / file-read); null/empty result → DROP; contradicting result → DROP; ambiguous → downgrade to `question:` | Proof tool not run on behavioral claims; null result mistakenly treated as confirmation |
| 2.7 | `Skill("confidence", "code")` weighted Final ≥ profile threshold (default 80); receipt evidence in Evidence field | Confidence skill not yet wired for per-comment input shape; threshold not read from resolved profile |
| 2.8 | Mechanical pre-emit: length, sentences, structure | Trim heuristic breaks the comment's point; drop reported but easy to miss |
| 2.9 | Prefix table + decoration; mechanical pre-emit | Decoration appended twice on retry |
| 3 | Card template, summary table | Card emitted without anchor; user can't validate without opening PR |
| 3.5 | Hunk walk; valid-range computation; retarget ≤ 3 lines | Off-by-one when hunk has interleaved deletions; one bad line nukes the whole payload |
| 4 | Token path OR phrase path with negation guard | Authorization gate skipped on parent paraphrase; phrase accepted on negated reply |
| 5 | `event` omitted; `body == ""`; Conventional prefix per comment; state verified `PENDING` | Body populated with verdict; "Pending isn't possible" → `event: COMMENT` fallback |
| 6 | Lead with "Drafted N"; use "drafted" not "posted"; link to Files Changed | "Posted" leaks into report wording |

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID | Class | Symptom | Primary phase |
| --- | --- | --- | --- |
| `F-publish-unauthorized` | External-system-write authorization gap | Cross-review posts to `/pulls/{n}/reviews` under user identity without `--publish` token in raw args OR explicit authorization phrase in latest user message (with negation guard clear) | 4 |
| `F-comment-overlong` | Comment shape | Posted body > 240 chars OR > 2 sentences | 2.8 |
| `F-comment-unfounded` | Comment correctness | Body names a backticked symbol absent from the changed file | 2.6 |
| `F-confidence-self-graded` | Scoring loop | Per-comment confidence assigned by LLM directly rather than via `Skill("confidence", "code")` | 2.7 |
| `F-rubric-uncoordinated` | Multi-rubric collision | Two rubrics produce conflicting fixes on the same line; no consolidation step ran | 2.5 |
| `F-holistic-skipped-on-non-trivial` | Default-on bypass | Holistic review skipped on a non-trivial diff (false-positive trivial-skip heuristic, or unannounced `--no-holistic`) | 2.4 |
| `F-system-fit-framed-as-issue` | Cross-review framing | `pr-reviewer` posted a `system-fit` finding as `issue:` instead of `question:` — violates the cross-review framing rule | 2.4 → 2.9 |
| `F-self-pr-routed-to-cross-reviewer` | Wrong-agent | `pr-reviewer` invoked on user's own PR; should have refused | 0.5 |
| `F-event-fallback` | Anti-pattern fallback | On API failure, agent sends `event: COMMENT` or any submitting event | 5 |
| `F-line-out-of-hunk` | Diff geometry | Proposed `(file, line)` falls outside any RIGHT-side hunk; payload rejected entirely | 3.5 |
| `F-publish-rederives-payload` | Publish-path token waste | A post-authorization publish run (often a fresh invocation) rebuilds the `comments[]` payload by re-running the full review pipeline instead of reading the persisted artifact — costs ~full-review tokens and may produce a different finding set than the user approved | 3.6 → 4–5 |
| `F-body-non-empty` | Payload shape | Review `body` populated with verdict / score; PR author sees noise on submit | 5 |
| `F-posted-leaks-into-report` | Communication invariant | Final report uses "posted" instead of "drafted"; produces false-failure perception | 6 |
| `F-null-receipt-treated-as-confirmation` | Receipt failure | A null or empty verification-receipt proof result was interpreted as confirming the behavioral claim instead of dropping the finding | 2.6b |
| `F-flip-flop-not-suppressed` | Anti-flip-flop bypass | Agent proposed a finding that contradicts a resolved prior suggestion without triggering the anti-flip-flop drop | 2.5b |
| `F-config-back-compat-broken` | Config regression | A `.review.yaml` absence caused a behavior change (threshold, cap, or filter change) instead of defaulting to `profile: balanced` | 1.7 |
| `F-novel` | Novel mode | Does not match any existing row | — |

The taxonomy is **append-only**. New failure classes are added only after a confidence-gated diagnosis surfaces them.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **Authorization gate is non-skippable.** `--publish` token OR explicit authorization phrase with negation guard clear. Parent agent's invocation prompt is not authorization.
- **The review `body` MUST be empty (`""`).** Verdict, score, and rationale go in the agent's terminal output, never on the PR.
- **The `event` field MUST be omitted entirely.** Never `"PENDING"` (rejected by API); never `APPROVE` / `COMMENT` / `REQUEST_CHANGES` (submits review and bypasses user gate).
- **Never use `gh pr comment` or `POST /issues/{n}/comments`.** Issue-comment endpoints are public on POST and have no pending state.
- **Never fall back to a submitting event on API failure.** Report verbatim with the request payload, list unposted comments, stop.
- **Every posted comment body MUST start with a Conventional-Comments prefix.** Mechanical check at the end of `posting-mechanics.md` is non-skippable.
- **Every posted comment body MUST be ≤ 240 chars and ≤ 2 sentences.** Mechanical check in `comment-shape.md` is non-skippable.
- **Drop any comment with `Skill("confidence", "code")` score below the profile threshold.** Default 80 for `balanced`; tunable via `.review.yaml` profile. Lowering without a config file is a guard failure.
- **A null verification proof result drops the finding; it is never read as confirmation.** `verification-receipt.md` (2.6b) is non-skippable for behavioral claims.
- **Anti-flip-flop drops are non-negotiable.** A finding that contradicts a resolved prior suggestion is dropped unconditionally, regardless of confidence score.
- **Absent `.review.yaml` MUST equal today's defaults.** Any behavior change without a config file present is a guard failure (`F-config-back-compat-broken`).
- **Verify review state after posting.** Newest review by current user MUST be `state: "PENDING"`. Anything else is treated as accidental submission and the user is alerted with the review ID and a dismissal command.
- **Use "drafted", never "posted", in the user-facing report.**
- **Auto-fix is forbidden in this agent.** Auto-fix lives only in `reviewer`. An auto-fix attempt by `pr-reviewer` is a guard failure regardless of mode.
- **Authorship pre-check is non-skippable.** `pr-reviewer` refuses on user's own PR.
- **A lens cannot upgrade a finding to `Request changes`.** Strict blocking rules (broken behaviour, security, data loss, misimplemented intent) apply regardless of lens severity hints.
- **Maximum 3 lenses per `--with` invocation.**
- **Pre-existing issues do not count toward the verdict.**
- **Every backticked symbol in a comment body MUST grep-resolve against the changed file.** `finding-grounding.md` is the load-bearing false-positive control.
- **Holistic review is default ON.** Skipping requires either `--no-holistic` (announced in the run line) or a trivial-skip condition (whitespace / dep-bumps / test-only / < 10 lines + no high-stakes path). Silent skip on a non-trivial diff is a guard failure.
- **`system-fit` findings in `pr-reviewer` MUST be framed as `question:`, not `issue:`.** The cross-review agent has less context than the PR author; the framing asymmetry is non-negotiable. `intent-mismatch` remains `issue:` because by definition the diff does not do what the PR claims.

---

## Artifacts

| File pattern | Produced by | When |
| --- | --- | --- |
| Terminal local proposal (summary table + cards) | pr-reviewer Step 3 | Every run |
| Pending review on GitHub (`state: PENDING`) | pr-reviewer Step 5 | Authorization granted |
| `/tmp/pr-files.json` (ephemeral) | `gh api repos/.../pulls/{n}/files` | Step 1.2 |
| `/tmp/review-payload.json` (ephemeral) | pr-reviewer Step 5 | Posting payload |
| `.agent/pr-review/<owner>__<repo>__<n>.payload.json` (durable) | pr-reviewer Step 3.6 | Every run with ≥ 1 surviving comment |
| Terminal Quality Gate summary | shared/rules pipeline | Every run |
| `.agent/recordings/*.{webm,mp4,gif}` | `Skill("screen-recorder")` | Motion-relevant diff + stable selector + preview deploy URL |

The agent's only durable artefact is the PR-keyed payload under `.agent/pr-review/` (gitignored scratch), which lets a later publish invocation post without re-reviewing. Diagnoses otherwise lean on the transcript plus the GitHub-side pending review (inspectable via `gh api`).

---

## Validators

- `claude plugin validate agents/pr-reviewer.md` — frontmatter + structure check (when supported for agents).
- `gh api repos/$REPO/pulls/$PR_NUMBER/reviews --jq '.[] | select(.user.login == "'"$(gh api user --jq .login)"'") | {id, state}'` — confirms most-recent review by current user is `PENDING`; any other state after a Step 5 run is the load-bearing safety failure.
- Manual end-to-end: invoke against a known PR with a deliberately out-of-hunk proposed comment line; confirm `line-validity.md` retargets or drops it.
- Manual end-to-end: invoke against own PR; confirm authorship pre-check refuses with redirect to `reviewer`.
- Manual end-to-end: invoke with `--with code-quality,ux,critical,extra` (4 lenses); confirm the agent aborts with `--with: max 3 lenses (got 4)`.
- Manual end-to-end: invoke with one comment naming a backticked symbol absent from the diff; confirm `finding-grounding.md` drops it and logs the drop.
- Manual end-to-end: invoke without `--publish` and without authorization phrase; confirm `authorization-gate.md` aborts with the closing report verbatim.
- Manual end-to-end: invoke with `--publish` and one deliberately overlong comment; confirm `comment-shape.md` drops it before posting.
