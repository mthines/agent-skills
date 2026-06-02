---
title: reviewer — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - reviewer
  - meta
---

# reviewer — Diagnostic Surface

## Contents

- [Source root](#source-root)
- [Phase model](#phase-model)
- [Existing guards per phase](#existing-guards-per-phase)
- [Failure taxonomy](#failure-taxonomy)
- [Hard invariants](#hard-invariants)
- [Artifacts](#artifacts)
- [Validators](#validators)

---

This file declares the contract `/create-skill diagnose reviewer` reads to parameterize the generic Diagnose Mode procedure for this agent.
The contract spec lives at [`skills/authoring/create-skill/rules/diagnostic-surface.md`](../../../skills/authoring/create-skill/rules/diagnostic-surface.md).

The reviewer is an **agent**, not a skill — its source is a single file at `agents/reviewer.md`.
A proposed diff against the reviewer almost always targets that file (occasionally this surface, or a future rule under `agents/reviewer/rules/`).
The diagnoser treats agents the same as skills: walk the phase model, classify against the taxonomy, propose one earliest-phase fix.

---

## Source root

`agents/`

`git apply` runs from this root.
The reviewer's body lives at `agents/reviewer.md`; supporting rules (this file included) live under `agents/reviewer/`.

---

## Phase model

The reviewer's body is organised as numbered Steps in `agents/reviewer.md`.
Each Step is a phase row below.
The diagnoser walks every row, even when a mode skips a step (e.g. Fix Mode skips Step 5; PR Mode skips Step 4).

| Phase | Name                              | Rule / section                                                                             | Gate                                                                                                       |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 0     | Raw-arguments read                | [reviewer.md § Step 0](../reviewer.md)                                                     | Raw arguments preserved verbatim; parent paraphrases ignored; `--pr` / PR URL / `#n` not stripped          |
| 0.5   | Mode detection                    | [reviewer.md § Mode Detection](../reviewer.md)                                              | Exactly one mode chosen (Fix / Report-Only / PR); detected mode announced in one line                     |
| 1.1   | Diff acquisition                  | [reviewer.md § Step 1.1](../reviewer.md)                                                   | Diff fetched via `git diff` (branch) or `gh pr diff` (PR); file list, stat, body in scope                  |
| 1.2   | Triage for large PRs              | [reviewer.md § Step 1.2](../reviewer.md)                                                   | Above ~30 files: auto-generated, lock files, and vendored code skipped; skipped files noted in summary    |
| 1.3   | Intent synthesis                  | [reviewer.md § Step 1.3](../reviewer.md)                                                   | 2–3 line intent summary written from PR body / commit messages / branch name; ambiguity flagged           |
| 1.4   | Review-context detection          | [reviewer.md § Step 1.4](../reviewer.md)                                                   | Own-branch vs someone-else's-PR resolved; never auto-fix on someone else's PR                              |
| 1.5   | Pre-existing-issue separation     | [reviewer.md § Step 1.5](../reviewer.md)                                                   | Findings on context lines marked `[pre-existing]`; do not count toward verdict                             |
| 1.6   | Lens loading (`--with`)           | [reviewer.md § Step 1.6](../reviewer.md), [review-lens-contract.md](../../../skills/authoring/create-skill/rules/review-lens-contract.md) | Max 3 lenses; `lens-version: 1`; dedupe against auto-loaded; `applies-to` glob honoured                    |
| 2     | Review (multi-rubric)             | [reviewer.md § Step 2](../reviewer.md)                                                     | `code-quality` rubric loaded for substantive diffs; `ux` rubric on UI files; lens checklists walked         |
| 2.5   | Quality Gate                      | [reviewer.md § Step 2.5](../reviewer.md), `aw-review-quality-gate`                          | Every non-pre-existing finding answers 6 gate questions; drop on 2+ fails, downgrade on 1                  |
| 2.7   | Adversarial Pre-Mortem            | [reviewer.md § Step 2.7](../reviewer.md), `Skill("critical", "code")`                       | Runs on `--critical` OR auto-engage heuristic; emits Must / Should / Nice + mandatory steelman             |
| 3     | Output & Verdict                  | [reviewer.md § Step 3](../reviewer.md)                                                     | Summary table + verdict + 1–10 score; default permissive (`Approve with comments`); `Request changes` rare |
| 3.5   | Review-confidence                 | [reviewer.md § Step 3 / Review Confidence](../reviewer.md)                                  | `Skill("confidence", "code")` runs against the assembled verdict; ≥ 70 % required to deliver as-is         |
| 4     | Auto-Fix (Fix Mode only)          | [reviewer.md § Step 4](../reviewer.md)                                                     | Skipped in PR Mode / Report-Only / someone-else's PR; only simple issues applied, complex issues planned   |
| 5.1   | PR Mode — PR resolution           | [reviewer.md § Step 5.1](../reviewer.md)                                                   | PR `state` confirmed `OPEN` (or user warned); prior pending review reused, not duplicated                  |
| 5.2   | Line-validity pre-flight          | [reviewer.md § Step 5.2](../reviewer.md)                                                   | Every proposed `(file, line)` verified to fall inside a diff hunk on the RIGHT side                        |
| 5.3   | Comment proposal build            | [reviewer.md § Step 5.3](../reviewer.md)                                                   | Category ∈ {`suggestion`, `issue`, `question`, `nitpick`, `praise`}; anchor snippet recorded               |
| 5.4   | Per-comment confidence            | [reviewer.md § Step 5.4](../reviewer.md)                                                   | Each comment scored 0–100 %; **drop below 70 %**                                                            |
| 5.5   | Proposal presentation             | [reviewer.md § Step 5.5](../reviewer.md)                                                   | Summary table + numbered detail cards printed to terminal                                                  |
| 5.6   | Post as pending review            | [reviewer.md § Step 5.6](../reviewer.md)                                                   | **Authorization precondition**: `--publish` in raw args OR explicit authorization phrase in latest user message (with negation guard clear). THEN: `event` omitted; `body == ""`; Conventional-Comments prefix on each comment; state verified `PENDING` |
| 5.7   | Resuming a prior proposal         | [reviewer.md § Step 5.7](../reviewer.md)                                                   | Never silently re-derive; treat parent-passed proposal as authoritative or ask once                        |

Mode-driven phase elisions (so the diagnoser can tell skipped from failed):

- **Fix Mode** runs 0 → 4; skips 5.
- **Report-Only Mode** runs 0 → 3; skips 4 and 5.
- **PR Mode** runs 0 → 3 then 5; skips 4. Step 5 is **mandatory** in PR Mode — skipping it after Step 3 is itself a failure class.

---

## Existing guards per phase

| Phase | Existing guards                                                                                                                                | Typical gaps                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | "Read the user's literal arguments — do not paraphrase" rule; explicit instruction to ignore parent paraphrases that strip `--pr`              | Parent prompt paraphrase strong enough to bias mode detection; literal arg block missed when reviewer is invoked via `Agent` rather than `/` |
| 0.5   | Five-step auto-detection table; one-line mode announcement                                                                                     | PR URL with unusual fragment (`/files#discussion_r…`) not matched; bare integer mistaken for a hash/SHA prefix                         |
| 1.1   | `gh pr diff` + `gh pr view --json` for PR Mode; `git diff origin/main...HEAD` for branch                                                       | Remote `origin/main` stale ⇒ diff includes unrelated commits; PR diff truncated by GitHub on very large diffs                          |
| 1.2   | ~30-file threshold; skip auto-generated, lockfiles, vendored                                                                                   | Threshold not tripped on a 25-file diff that was 80 % generated; skipped files not surfaced in the summary                             |
| 1.3   | Sources: PR title + body, commit messages, branch name; uncertainty flagged                                                                    | Branch named `fix/stuff`, no PR body ⇒ intent guessed and findings calibrated against the guess                                       |
| 1.4   | `gh api user` vs PR author comparison; explicit "never auto-fix someone else's PR"                                                             | `gh api user` returns wrong user when token belongs to a different account; auto-fix slipped into a PR review the user did not author |
| 1.5   | Diff prefix inspection (` ` = context, `+` = added, `-` = deleted)                                                                             | Finding on a moved line counted as new when the same logic existed on a deleted line; `git blame` not run before classifying           |
| 1.6   | Max-3 cap; `lens-version: 1` validation; defensive 1 000-line file guard; dedupe against `code-quality`, `ux`, `critical`, `screen-recorder`; `applies-to` glob | Lens file under-trimmed (>80 LOC) warned but loaded; missing `lens.md` silently skipped without surfacing it in the summary           |
| 2     | `Skill("code-quality")` on substantive diffs; `Skill("ux")` on UI globs; `Skill("screen-recorder")` on motion regex in PR Mode; lens checklists | code-quality skipped on a "small" diff that was actually substantive; UI heuristic missed Svelte 5 `.svelte.ts` files; motion regex didn't match Lottie via dynamic import |
| 2.5   | `aw-review-quality-gate`'s 6 gate questions; drop on 2+ fails, downgrade on 1; pre-existing issues bypass                                      | Gate questions answered leniently (LLM grading own findings); pre-existing flag mis-applied to a changed line                          |
| 2.7   | `--critical` flag OR auto-engage heuristic (migrations, auth, billing, infra, `risk:high`, > 800 LOC); steelman mandatory                      | Auto-engage regex didn't match `prisma/migrations` (only `**/migrations/**`); steelman section omitted because "no must-fixes"         |
| 3     | Worst-blocking-finding drives verdict; strict definition of "blocks" (broken behavior / security / data loss / misimplemented intent)          | Style finding upgraded to `Request changes`; missing-test finding promoted to blocker when no critical path was uncovered              |
| 3.5   | `Skill("confidence", "code")` after verdict assembly; 70 % / 90 % thresholds with explicit acknowledge-low-confidence rule                     | `/confidence` skipped on small diffs; low score acknowledged in terminal but the review still posted                                   |
| 4     | Skip if `--report` OR `--pr` OR someone-else's PR; simple-vs-complex split with planned-only output for complex                                | Auto-fix touched a generated file; "simple" classification included a refactor that needed user input                                   |
| 5.1   | `gh pr view --json state`; prior reviews check via `gh api repos/.../pulls/{n}/reviews --jq '.[] | select(.user.login == $me)'`                | Existing PENDING review from this user not detected (different `$ME` token, e.g. `app/<bot>` vs human login) ⇒ duplicate pending attempted |
| 5.2   | `/tmp/pr-files.json` cache; walk every `@@ -a,b +c,d @@`; valid RIGHT range = `[c, c + d - 1]` minus deletions and header                       | Off-by-one on the RIGHT-side line count when a hunk contained interleaved deletions; one bad line nukes the whole 5-comment review     |
| 5.3   | 5-category enum; constructive-tone guidelines; "pseudo-code — verify and test" disclaimer; group-related-concerns rule                          | Duplicate comments on every occurrence instead of one comment + "same applies to lines X, Y, Z"; missing pseudo-code disclaimer         |
| 5.4   | 70 % drop threshold; minimum of {accurate, actionable, helpful}                                                                                | Confidence inflated by overconfidence on the "actionable" axis; nitpick-shaped comments above 70 % became noise                        |
| 5.5   | Summary table + detail cards; total/dropped count surfaced                                                                                     | Detail card omitted the code anchor (user couldn't validate without opening the PR)                                                    |
| 5.6   | **Authorization precondition**: assert `--publish` literal token in raw args OR explicit authorization phrase in latest user message + negation guard. THEN **mechanical** checks: `body == ""`; no `event` key; comment body starts with one of 5 Conventional-Comments prefixes; no `gh pr comment`; no `POST /issues/{n}/comments`; verify state is `PENDING` after posting | Authorization gate skipped because "the parent's prompt was clear" (parent prompt is not user authorization); phrase-path accepted on a negated reply ("don't publish") because negation guard regex missed a synonym; "Pending isn't possible" LLM confusion ⇒ fallback to `event: COMMENT` (silent publish bypass); body populated with verdict summary; Conventional prefix missing on a lens-generated comment; verb "posted" used in the report instead of "drafted" |
| 5.7   | Two-path rule: parent-passes-verbatim ⇒ use; only-references ⇒ ask once                                                                        | Silent re-derivation when continuation prompt restated comments inline but with slight wording changes                                  |

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID                      | Class                                   | Symptom                          | Primary phase | Primary gate / companion                                          |
| ----------------------- | --------------------------------------- | -------------------------------- | ------------- | ----------------------------------------------------------------- |
| F-publish-unauthorized  | External-system-write authorization gap | Cross-review sub-agent posts to `/pulls/{n}/reviews` under the user's identity without an explicit per-call authorization (literal `--publish` token in raw args OR explicit authorization phrase in latest user message with negation guard clear) visible in the sub-agent's transcript. The resulting review may correctly be PENDING, but the harness security policy treats the write as unauthorized regardless. | 5.6           | Authorization precondition at the top of Step 5.6                 |
| F-novel                 | Novel mode                              | Does not match any existing row  | —             | Diagnosis proposes a new row inline (added on user approval only) |

The taxonomy is **append-only** and intentionally seeded with `F-novel` only.
Speculative categories were not pre-populated — they push the diagnoser toward forcing a match where none exists.
Real-world failure classes (e.g. "event silently mapped to COMMENT", "review body non-empty", "auto-fix on someone-else's PR", "out-of-hunk line nuked the review", "PENDING confusion mid-run") will be added as confidence-gated, user-approved diagnoses produce them.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **Step 0's raw-arguments rule is non-negotiable for the proposal work.** The reviewer must never strip `--pr`, never paraphrase the user's literal arguments, never downgrade Steps 5.1–5.5 (the proposal) because a parent prompt asked for "findings only". Reason: pending reviews are invisible until the user submits from the GitHub UI — the visibility gate is in the human's hands, not the agent's. **However, Step 5.6 (the actual API call) is separately gated by the authorization precondition at the top of that step.** The GitHub UI gate is secondary safety; the primary gate is per-call authorization captured in this sub-agent's transcript.
- **Step 5.6's authorization precondition is non-skippable in cross-review.** Before any `POST /pulls/{n}/reviews` API call, the agent asserts `--publish` literal token in raw args OR an explicit authorization phrase in the latest user message (with the negation guard clear). Skipping this — even "to honor the parent agent's clear intent to publish" — is the canonical anti-pattern: the parent's prompt is not the user's per-call authorization for an external-system write under the user's identity. Reason: the harness security policy requires explicit per-call authorization for writes to shared external systems under the user's identity, regardless of secondary safety properties (e.g. PENDING state at GitHub).
- **The review `body` field MUST be empty (`""`).** The verdict, score, and rationale live in the agent's terminal output, never on the PR. Reason: a non-empty `body` produces a top-level review comment that the PR author sees once submitted, diluting line-level feedback.
- **The `event` field MUST be omitted entirely.** Never send `"event": "PENDING"` (rejected by the API), never map the verdict to `APPROVE` / `COMMENT` / `REQUEST_CHANGES`. Omission is the documented mechanism for creating a pending review. Reason: any `event` value submits the review and bypasses the human review gate — this is the most consequential safety property of the agent.
- **Never use `gh pr comment` or `POST /issues/{n}/comments`.** Only `POST /repos/.../pulls/{n}/reviews` with `comments[]`. Reason: issue-comment endpoints are public on POST and have no pending state.
- **Never fall back to issue comments or any submitting `event` on API failure.** On error, report the failure verbatim with the request payload, list the unposted comments, and stop. The exact pattern "the omit-event approach didn't work, I'll send `event: COMMENT` to get *something* posted" is the canonical anti-pattern and is forbidden.
- **Every posted comment body MUST start with a Conventional-Comments prefix** (`praise:` / `nitpick:` / `suggestion:` / `issue:` / `question:`). The mechanical check at the end of Step 5.6 is non-skippable.
- **Drop any comment scoring below 70 % in Step 5.4.** The threshold is fixed; lowering it produces noise that erodes trust in subsequent reviews.
- **Verify the review state after posting.** The newest review by the current user MUST be `state: "PENDING"`. Anything else (`CHANGES_REQUESTED` / `COMMENTED` / `APPROVED`) is treated as an accidental submission and the user is alerted with the review ID and a dismissal command.
- **Use the verb "drafted", never "posted", in the user-facing report.** "Posted" reads as "made public" — false-failure perceptions follow. This is a communication invariant; mechanical pre-check the report wording before delivering.
- **Auto-fix is forbidden in PR Mode and on someone-else's PR.** Step 4 is gated on three conditions; failing any one drops to "propose only".
- **A lens cannot upgrade a finding to `Request changes` on its own.** The strict blocking-finding rules in Step 3 (broken behavior / security / data loss / misimplemented intent) apply regardless of lens severity hints.
- **Maximum 3 lenses per `--with` invocation.** The fourth is rejected with the exact error string. Reason: token budget hard cap; loading 4 lenses costs > 2 400 tokens and degrades review quality.
- **Pre-existing issues do not count toward the verdict.** They are informational. A "Request changes" verdict driven solely by pre-existing findings is a guard failure.
- **The Quality Gate (Step 2.5) runs on every non-pre-existing finding.** Skipping the gate to "save tokens on small diffs" is a forbidden shortcut.
- **`Skill("confidence", "code")` (Step 3.5) is the load-bearing self-review.** Skipping it on substantive diffs is a guard failure; below-70 % output must be acknowledged in the verdict, not silently shipped.

---

## Artifacts

| File pattern                                  | Produced by                       | When                                                       |
| --------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| Terminal verdict + summary table + score      | reviewer agent (Step 3)           | Every run, all modes                                       |
| Comment proposal (summary table + cards)      | reviewer agent (Step 5.5)         | PR Mode only                                               |
| Pending review on GitHub (`state: PENDING`)   | reviewer agent (Step 5.6)         | PR Mode only — fetched back to verify via Step 5.6 final check |
| Auto-fix diffs applied to local files         | reviewer agent (Step 4)           | Fix Mode only                                              |
| Planned-fix descriptions (no code applied)    | reviewer agent (Step 4.2)         | Fix Mode, complex issues                                   |
| `.agent/recordings/*.{webm,mp4,gif}`          | `Skill("screen-recorder")`        | PR Mode, motion-relevant diff, stable selector available   |
| `/tmp/pr-files.json` (ephemeral)              | `gh api repos/.../pulls/{n}/files` | Step 5.2 line-validation pre-flight                        |
| `/tmp/review-payload.json` (ephemeral)        | reviewer agent (Step 5.6)         | Step 5.6 posting payload                                   |

The reviewer produces **no durable artifact** in the repo (no `plan.md`, no `walkthrough.md`).
Diagnoses against reviewer runs lean entirely on the transcript plus the GitHub-side pending review (still inspectable via `gh api`).
Call this out in the diagnosis report — the evidence trail is thinner than for `autonomous-workflow` or `fix-bug`.

---

## Validators

- `claude plugin validate agents/reviewer.md` — frontmatter + structure check (when supported for agents).
- `gh api repos/$REPO/pulls/$PR_NUMBER/reviews --jq '.[] | select(.user.login == "'"$(gh api user --jq .login)"'") | {id, state}'` — confirms the most-recent review by the current user is `PENDING`; any other state after a Step 5.6 run is the load-bearing safety failure.
- Manual end-to-end: invoke the reviewer against a known PR with a deliberately out-of-hunk proposed comment line, confirm the pre-flight in Step 5.2 retargets or drops it without submitting an invalid payload.
- Manual end-to-end: invoke with `--with code-quality,ux,critical,extra` (4 lenses) and confirm the agent aborts with `--with: max 3 lenses (got 4: code-quality,ux,critical,extra)`.
- Manual end-to-end: invoke the reviewer in PR Mode against a small UI diff and confirm `Skill("ux")` is auto-loaded and a `### UX & Accessibility` subsection appears in Step 3.
