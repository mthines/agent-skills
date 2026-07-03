---
title: reviewer — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - reviewer
  - meta
  - own-work
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

`reviewer` is the **own-work** half of the former monolithic reviewer. It runs in three sub-modes: Fix Mode (own branch, no PR yet — auto-fix simple, plan complex), Report Mode (`--report`, own branch — propose only), and Self-Review (own PR — auto-fix + inline terminal report). It **never** writes to GitHub — that is `pr-reviewer`'s job.

The companion agent `pr-reviewer` handles cross-review on someone else's PR; its diagnostic surface is at `agents/pr-reviewer/rules/diagnostic-surface.md`.

---

## Source root

`agents/`

`git apply` runs from this root. The agent body lives at `agents/reviewer.md`; supporting rules live under `agents/reviewer/`. Shared rules imported by both agents live under `agents/shared/`.

---

## Phase model

| Phase | Name | Rule / section | Gate |
| --- | --- | --- | --- |
| 0 | Raw-arguments read | [reviewer.md § Step 0](../../reviewer.md) | Raw arguments preserved verbatim |
| 0.5 | Mode detection | [reviewer.md § Mode Detection](../../reviewer.md) | Exactly one sub-mode chosen: Fix / Report / Self-Review |
| 0.6 | Cross-PR redirect | [reviewer.md § Step 0.6](../../reviewer.md) | If a PR ref is passed but `author != current user`, agent redirects to `pr-reviewer` |
| 1.0 | Prior-comment awareness (Self-Review only) | [shared/rules/prior-comment-awareness.md](../../shared/rules/prior-comment-awareness.md) | Existing PR review comments fetched; dedup set and resolved-suggestion set built |
| 1.1 | Diff acquisition | [reviewer.md § Step 1.1](../../reviewer.md) | `git diff origin/main...HEAD` for branch; `gh pr diff` + cached patch list for Self-Review |
| 1.2 | Triage for large diffs | [reviewer.md § Step 1.2](../../reviewer.md) | Above ~30 files: skip auto-generated, lockfiles, vendored |
| 1.3 | Intent synthesis | [reviewer.md § Step 1.3](../../reviewer.md) | 2–3 line intent summary; uncertainty flagged on missing PR body |
| 1.5 | Pre-existing-issue separation | [reviewer.md § Step 1.5](../../reviewer.md) | Context-line findings tagged `[pre-existing]`; excluded from verdict |
| 1.6 | Lens loading | [shared/rules/rubric-composition.md](../../shared/rules/rubric-composition.md) | Max 3 lenses; `lens-version: 1`; dedupe |
| 1.7 | Review config load | [shared/rules/review-config.md](../../shared/rules/review-config.md) | `.review.yaml` hierarchy resolved; absent config → `profile: balanced` (defaults to profile: balanced — threshold 80, per-file cap 10, no filters) |
| 2 | Review (multi-rubric) | [shared/rules/rubric-composition.md](../../shared/rules/rubric-composition.md) | `code-quality` always; `ux` on UI globs; `critical` on auto-engage / `--critical`; lenses |
| 2.4 | Holistic review (default ON) | [shared/rules/holistic-review.md](../../shared/rules/holistic-review.md), `Skill("holistic-analysis", "review")` | Runs unless `--no-holistic` OR trivial-skip; emits 0–3 findings mapped to `issue` / `suggestion` / `nitpick` (reviewer asserts; cross-review questions) |
| 2.5 | Dedupe + consolidate | [shared/rules/rubric-composition.md § Consolidation](../../shared/rules/rubric-composition.md) | Per-file cap 10; no total cap; holistic claim wins on `(file, line)` collision |
| 2.5b | Prior-comment dedup (Self-Review only) | [shared/rules/prior-comment-awareness.md](../../shared/rules/prior-comment-awareness.md) | Drop findings already said in a prior review pass; anti-flip-flop on resolved suggestions |
| 2.6 | Finding grounding | [shared/rules/finding-grounding.md](../../shared/rules/finding-grounding.md) | Backticked symbols grep-confirmed in changed file |
| 2.6b | Verification receipt | [shared/rules/verification-receipt.md](../../shared/rules/verification-receipt.md) | Behavioral claims need executed proof (grep / ast-grep / file-read); null result = DROP |
| 2.7 | Per-comment confidence | [shared/rules/per-comment-confidence.md](../../shared/rules/per-comment-confidence.md) | `Skill("confidence", "code")` ≥ profile threshold (default 80); receipt evidence fed in |
| 2.8 | Comment shape | [shared/rules/comment-shape.md](../../shared/rules/comment-shape.md) | ≤ 240 chars, ≤ 2 sentences, no structure |
| 2.9 | Conventional Comments | [shared/rules/conventional-comments.md](../../shared/rules/conventional-comments.md) | Prefix prepended; decoration appended |
| 3 | Output & verdict | [reviewer.md § Step 3](../../reviewer.md) | Summary table + verdict + 1–10 score; default permissive |
| 4 | Auto-fix | [reviewer/rules/auto-fix-policy.md](./auto-fix-policy.md) | Skipped on `--report`; simple-vs-complex split; forbidden targets respected |
| 5 | Self-Review report | [reviewer/rules/self-review-report.md](./self-review-report.md) | Inline terminal output using pr-comment-card cards; no GitHub API calls |

Mode-driven phase elisions:

- **Fix Mode** runs 0 → 4; skips 5.
- **Report Mode** runs 0 → 3; skips 4 and 5.
- **Self-Review** runs 0 → 5.

A PR reference + cross-author triggers redirect to `pr-reviewer` at Step 0.6; this agent does not handle that path.

---

## Existing guards per phase

| Phase | Existing guards | Typical gaps |
| --- | --- | --- |
| 0 | Literal-args rule; parent paraphrase ignored | Argument quoting strips flags |
| 0.5 | Sub-mode auto-detection: own-branch-no-PR / own-branch-with-PR / `--report` | Stale `origin/main` causes branch to appear as no-PR when one exists |
| 0.6 | `gh api user` vs `gh pr view --json author.login` | Token belongs to different account than CLI session |
| 1.0 | Prior PR comments fetched via `gh api`; dedup set built (Self-Review only) | `gh api` paginates on PRs with > 100 comments; agent may miss old comments |
| 1.1 | `git diff origin/main...HEAD`; `gh pr diff` for Self-Review | Diff includes unrelated commits if `origin/main` is stale |
| 1.2 | ~30-file threshold; auto-generated / lockfile / vendored skipped | Threshold not tripped on 25-file diff that's 80 % generated |
| 1.3 | Sources: PR title + body, commit messages, branch name | `fix/stuff` branch with no PR body ⇒ intent guessed |
| 1.5 | Diff prefix inspection (` ` = context, `+` = added, `-` = deleted) | Finding on moved line counted as new |
| 1.6 | Max 3, lens-version, dedupe, applies-to glob | Lens > 80 lines warned but loaded |
| 1.7 | `.review.yaml` hierarchy walk; absent file → `profile: balanced` (defaults to profile: balanced) | Nested subtree overrides root profile silently if the path walk is implemented incorrectly |
| 2 | Skill load order; auto-engage heuristics for `critical` | Auto-engage regex doesn't match `prisma/migrations` |
| 2.4 | Default-on holistic call; trivial-skip heuristic (whitespace / dep-bumps / test-only / < 10 lines + no high-stakes); 3-finding cap; reviewer maps `system-fit` (major) → `issue`, `system-fit` (minor) → `suggestion` | Holistic skipped on a non-trivial diff that the heuristic incorrectly marked trivial; holistic finding overrides a line-level finding on the same `(file, line)` when the line-level was actually correct |
| 2.5 | Per-file cap 10; priority-sorted; holistic claim wins on collision | LLM dedupes inline despite the rule; cap drops not surfaced; holistic-vs-line-level collision resolved wrongly |
| 2.5b | Prior-comment dedup: `(path, line ± 2)` + same prefix → DROP (Self-Review); anti-flip-flop: resolved suggestion contradicted → DROP unconditionally | Dedup skipped on first-pass runs (correct); anti-flip-flop threshold miscalibrated on moved lines |
| 2.6 | Backticked-token grep + allowlist | Hallucinated multi-word phrase passes (not backticked) |
| 2.6b | Proof tool run (grep / ast-grep / file-read); null/empty result → DROP; contradicting result → DROP; ambiguous → downgrade to `question:` | Proof tool not run on behavioral claims; null result mistakenly treated as confirmation |
| 2.7 | `Skill("confidence", "code")` ≥ profile threshold (default 80); receipt evidence in Evidence field | Confidence skill input shape not yet finalized; threshold not read from resolved profile |
| 2.8 | Mechanical pre-emit: length, sentences, structure | Trim heuristic breaks the comment's point |
| 2.9 | Prefix table + decoration; mechanical pre-emit | Decoration appended twice on retry |
| 3 | Worst-blocking-finding drives verdict; strict definition of blocks | Style finding upgraded to `Request changes` |
| 4 | `--report` skip; forbidden targets list; simple-vs-complex split | Auto-fix touched a generated file; "simple" classification included a refactor |
| 5 | Card template; severity → bucket mapping; orchestrator block | Bucket with no findings omitted instead of emitting `None.` |

---

## Failure taxonomy

| ID | Class | Symptom | Primary phase |
| --- | --- | --- | --- |
| `F-auto-fix-cross-contamination` | Wrong-target write | Auto-fix touched a generated or vendored file | 4 |
| `F-auto-fix-on-report-mode` | Mode escape | Auto-fix ran despite `--report` | 4 |
| `F-self-review-report-malformed` | Output shape | Inline terminal report missing required buckets or `None.` placeholders | 5 |
| `F-cross-pr-not-redirected` | Wrong-agent | PR ref with cross-author handled by `reviewer` instead of redirect to `pr-reviewer` | 0.6 |
| `F-comment-overlong` | Comment shape | Emitted card body > 240 chars | 2.8 |
| `F-comment-unfounded` | Comment correctness | Card body names a backticked symbol absent from changed file | 2.6 |
| `F-confidence-self-graded` | Scoring loop | Per-comment confidence assigned by LLM directly | 2.7 |
| `F-rubric-uncoordinated` | Multi-rubric collision | Conflicting fixes on same line; consolidation step did not run | 2.5 |
| `F-holistic-skipped-on-non-trivial` | Default-on bypass | Holistic review skipped on a non-trivial diff (false-positive trivial-skip heuristic, or unannounced `--no-holistic`) | 2.4 |
| `F-null-receipt-treated-as-confirmation` | Receipt failure | A null or empty verification-receipt proof result was interpreted as confirming the behavioral claim instead of dropping the finding | 2.6b |
| `F-flip-flop-not-suppressed` | Anti-flip-flop bypass | Self-Review proposed a finding that contradicts a resolved prior suggestion without triggering the anti-flip-flop drop | 2.5b |
| `F-config-back-compat-broken` | Config regression | A `.review.yaml` absence caused a behavior change (threshold, cap, or filter change) instead of defaulting to `profile: balanced` | 1.7 |
| `F-novel` | Novel mode | Does not match any existing row | — |

The taxonomy is **append-only**. New classes are added after confidence-gated diagnoses surface them.

---

## Hard invariants

- **Never write to GitHub.** Posting belongs to `pr-reviewer`. An `reviewer` run that calls `gh api pulls/{n}/reviews` is a guard failure.
- **Auto-fix is forbidden on cross-author PRs.** Step 0.6 must redirect to `pr-reviewer` before any auto-fix can run.
- **Auto-fix is forbidden on forbidden targets** (migrations, lockfiles, generated files, env files, snapshots). Even for simple-looking issues.
- **`--report` skips auto-fix unconditionally.**
- **A bucket with no findings emits `None.`**, not omitted, in the Self-Review report.
- **Every card body MUST be ≤ 240 chars and ≤ 2 sentences.** `comment-shape.md` is non-skippable.
- **Every backticked symbol MUST grep-resolve.** `finding-grounding.md` is the load-bearing false-positive control.
- **Per-comment confidence is via `Skill("confidence", "code")`**, not LLM self-grade. Threshold is profile-driven (default 80 for `balanced`); lowering requires an explicit `.review.yaml`.
- **A null verification proof result drops the finding; it is never read as confirmation.** `verification-receipt.md` (2.6b) is non-skippable for behavioral claims.
- **Anti-flip-flop drops are non-negotiable in Self-Review.** A finding that contradicts a resolved prior suggestion is dropped unconditionally, regardless of confidence score.
- **Absent `.review.yaml` MUST equal today's defaults.** Any behavior change without a config file present is a guard failure (`F-config-back-compat-broken`).
- **A lens cannot upgrade a finding to `Request changes`.**
- **Maximum 3 lenses per `--with` invocation.**
- **Pre-existing issues do not count toward the verdict.**
- **Auto-fix regressions revert the auto-fix.** Never leave the working tree in a broken state.
- **Holistic review is default ON.** Skipping requires either `--no-holistic` (announced in the run line) or a trivial-skip condition (whitespace / dep-bumps / test-only / < 10 lines + no high-stakes path). Silent skip on a non-trivial diff is a guard failure.

---

## Artifacts

| File pattern | Produced by | When |
| --- | --- | --- |
| Terminal verdict + summary table + score | reviewer Step 3 | Every run |
| Auto-fix diffs applied to local files | reviewer Step 4 | Fix Mode + Self-Review (no `--report`) |
| Planned-fix descriptions (no code applied) | reviewer Step 4 complex path | Fix Mode + Self-Review |
| Self-Review report (terminal) | reviewer Step 5 | Self-Review only |

The agent produces no durable artefact in the repo and no remote-side artefact. Diagnoses lean entirely on the transcript plus the local git working tree (for auto-fix verification).

---

## Validators

- `claude plugin validate agents/reviewer.md` — frontmatter + structure check.
- Manual end-to-end: invoke on a branch with no PR; confirm Fix Mode runs auto-fix and emits verdict.
- Manual end-to-end: invoke on a branch with no PR and `--report`; confirm no auto-fix.
- Manual end-to-end: invoke on user's own PR; confirm Self-Review report uses pr-comment-card cards.
- Manual end-to-end: invoke with a cross-author PR ref; confirm redirect to `pr-reviewer`.
- Manual end-to-end: produce a finding with a hallucinated backticked symbol; confirm `finding-grounding.md` drops it.
- Manual end-to-end: produce a finding > 240 chars; confirm `comment-shape.md` drops or trims.
