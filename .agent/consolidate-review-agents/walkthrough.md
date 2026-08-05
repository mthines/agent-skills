---
created: 2026-08-05T14:00:00Z
branch: consolidate-review-agents
task: Consolidate reviewer + pr-reviewer into unified pr-reviewer + review-loop skill
pr: 85
---

# Walkthrough: Consolidate reviewer + pr-reviewer into unified pr-reviewer + review-loop

## Quick Reference

- **Branch**: `consolidate-review-agents`
- **PR**: #85
- **Worktree**: `/Users/mthines/Workspace/mthines/agent-skills.git/consolidate-review-agents`

## Summary

Retires the `reviewer` agent entirely and consolidates all review capability into a single `pr-reviewer` agent that handles both self (own PR) and cross (someone else's PR) review via a `REVIEW_RELATION` flag set at Step 0.5.
A new thin orchestrator skill `review-loop` replaces the pre-push reviewer dispatch in `create-pr`, `polish`, `autonomous-workflow` Phase 6/7, and `/review-changes` — it sequences `pr-reviewer` → `implement-suggestion` → `polish simplify` in a bounded convergence loop (cap N=3, early exit on PASS with no blockers).
Net result: 884 lines deleted, one unified review primitive, and a cleaner anti-circularity guarantee enforced by the new skill.

## Changes

| File | Change | Purpose |
| ---- | ------ | ------- |
| `agents/reviewer.md` | Deleted (623 lines) | Retire the reviewer agent entirely |
| `agents/reviewer/rules/auto-fix-policy.md` | Deleted (100 lines) | Remove reviewer-only fix policy |
| `agents/reviewer/rules/diagnostic-surface.md` | Deleted (175 lines) | Remove reviewer-only diagnostic surface |
| `agents/reviewer/rules/self-review-report.md` | Deleted (121 lines) | Remove reviewer-only self-review report |
| `agents/pr-reviewer.md` | Modified | Add REVIEW_RELATION (self/cross) at Step 0.5; remove cross-review-only refusal; unify self + cross modes in one agent |
| `skills/quality/review-loop/SKILL.md` | Created (154 lines) | New orchestrator: pr-reviewer → implement-suggestion → polish simplify, cap N=3, anti-circularity guarantee |
| `skills/delivery/create-pr/SKILL.md` | Modified | PR-first flow: draft PR first, then post-draft review-loop; all 5 flags preserved |
| `skills/quality/polish/SKILL.md` | Modified | Phase 6 self-review → review-loop delegation |
| `skills/quality/review-changes/SKILL.md` | Modified | Routes to review-loop (and pr-reviewer) instead of retired reviewer |
| `skills/workflow/autonomous-workflow/rules/phase-6-pr-creation.md` | Modified | Pre-push reviewer → post-draft review-loop |
| `skills/workflow/autonomous-workflow/rules/phase-7-ci-gate.md` | Modified | Phase 7 reviewer dispatch → pr-reviewer via review-loop |
| `skills/workflow/autonomous-workflow/rules/companion-skills.md` | Modified | reviewer companion → pr-reviewer / review-loop |
| `skills/workflow/autonomous-workflow/templates/aw-executor.agent.md` | Modified | reviewer references → pr-reviewer |
| `scripts/eval/l1.mjs` | Modified | Remove read("agents/reviewer.md") call; drop reviewer-only G8d/G9c/G11 checks |
| `agents/shared/rules/holistic-review.md` | Modified | reviewer → pr-reviewer; add REVIEW_RELATION parameter |
| `agents/shared/rules/optimality-review.md` | Modified | reviewer → pr-reviewer; add review_relation |
| `agents/shared/rules/rubric-composition.md` | Modified | reviewer rows → pr-reviewer self rows |
| `agents/shared/rules/finding-grounding.md` | Modified | reviewer self-review → pr-reviewer self mode |
| `agents/shared/rules/prior-comment-awareness.md` | Modified | reviewer Self-Review row → pr-reviewer self row |
| `agents/shared/rules/thread-resolution.md` | Modified | reviewer-only guard → pr-reviewer self/cross clarification |
| `agents/shared/rules/review-config.md` | Modified | reviewer profile notes → self-mode profile notes |
| `agents/shared/rules/memory-buckets.md` | Modified | reviewer-lessons host: reviewer→pr-reviewer (consumer); LoreKit host stays "reviewer" |
| `agents/shared/rules/outcome-learning.md` | Modified | reviewer.md Step 0.7 → pr-reviewer.md Step 0.7; reviewer tag removed from frontmatter |
| `agents/shared/rules/review-outcomes.md` | Modified | reviewer reference → pr-reviewer |
| `agents/shared/rules/comment-relevance-memory.md` | Modified | source_agent: "reviewer" option removed |
| `agents/shared/rules/comment-shape.md` | Modified | reviewer tag removed from frontmatter |
| `agents/shared/rules/conventional-comments.md` | Modified | reviewer tag removed from frontmatter |
| `agents/shared/rules/verification-receipt.md` | Modified | reviewer tag removed from frontmatter |
| `agents/shared/rules/per-comment-confidence.md` | Modified | reviewer tag removed from frontmatter |
| `agents/templates/reviewer-inline-report.template.md` | Modified | for: reviewer → for: pr-reviewer |
| `skills/analysis/holistic-analysis/SKILL.md` | Modified | "reviewer agents" → "pr-reviewer agent" |
| `skills/analysis/holistic-analysis/lens.md` | Modified | for: reviewer → for: pr-reviewer |
| `skills/analysis/holistic-analysis/rules/review-mode.md` | Modified | Add REVIEW_RELATION parameter; update output framing table |
| `skills/quality/optimize-approach/SKILL.md` | Modified | reviewer caller field → pr-reviewer |
| `skills/quality/code-quality/rules/simplify-mode.md` | Modified | reviewer agent Fix Mode → pr-reviewer self-mode; removed dead link to auto-fix-policy.md |
| `skills/design/ux/lens.md` | Modified | for: reviewer → for: pr-reviewer |
| `skills/design/storybook/rules/playwright-cli.md` | Modified | "A reviewer agent" → "The pr-reviewer agent" |
| `skills/design/storybook/SKILL.md` | Modified | "reviewer" → "pr-reviewer" |
| `skills/design/storybook/rules/visual-verification.md` | Modified | holistic-review references updated |
| `skills/analysis/screen-recorder/rules/integrations.md` | Modified | Dead link agents/reviewer.md → agents/pr-reviewer.md fixed; Caller 3 heading, ASCII box, and common-mistakes prose repointed from `reviewer` to `pr-reviewer` (follow-up commit) |
| `skills/workflow/autonomous-workflow/CLAUDE.md` | Modified | review-loop added; reviewer agent entry removed |
| `skills/workflow/autonomous-workflow/SKILL.md` | Modified | companion table reviewer rows → pr-reviewer/review-loop |
| `skills/workflow/autonomous-workflow/rules/diagnostic-surface.md` | Modified | reviewer dispatch refs → pr-reviewer; F5 updated |
| `skills/workflow/autonomous-workflow/rules/overview.md` | Modified | Phase 6 Agent(reviewer) → Skill("review-loop") |
| `skills/workflow/autonomous-workflow/rules/phase-4-testing.md` | Modified | reviewer dispatch → pr-reviewer dispatch |
| `skills/workflow/autonomous-workflow/rules/safety-guardrails.md` | Modified | Phase 6 gate; "necessary not sufficient" note |
| `skills/workflow/autonomous-workflow/rules/self-improvement-loop.md` | Modified | agent list reviewer → pr-reviewer |
| `skills/workflow/autonomous-workflow/references/autonomous-workflow-complete.md` | Modified | companion table updated |
| `skills/workflow/aw-review-quality-gate/SKILL.md` | Modified | "reviewer agent" → "pr-reviewer agent" |
| `CLAUDE.md` | Modified | Agent inventory: remove reviewer; add review-loop; restate pr-reviewer; update coupled skill entries |
| `README.md` | Modified | Agent table: remove reviewer row; update polish/review-changes/optimize-approach entries; badge updated agents-4→agents-5; directory tree updated 6 agents→5 agents dropping reviewer (follow-up commit) |
| `skills/workflow/autonomous-workflow/README.md` | Modified | Phase 6/7 companion rows rewired from retired `reviewer *(agent)*` to `review-loop *(skill)*`; explanatory paragraph rewritten from reviewer-is-an-agent boilerplate to review-loop/pr-reviewer description (follow-up commit) |

## Key Decisions

1. **Unified via REVIEW_RELATION flag, not a new agent** — rather than creating a new agent, pr-reviewer detects at Step 0.5 whether `ME == AUTHOR` and sets `REVIEW_RELATION=self|cross`. Self mode uses assertive framing + terminal report + auto-fix; cross mode uses question framing + PENDING GitHub review. This avoids a three-agent topology and keeps a single quality contract.

2. **review-loop is a thin orchestrator, not a new quality primitive** — it sequences three existing components (pr-reviewer, implement-suggestion, polish simplify) in a convergence loop and owns zero quality rules of its own. Anti-circularity is enforced by allowing only `Skill("polish", "simplify")` — never bare polish or polish review mode (which would re-enter pr-reviewer).

3. **PR-first flow in create-pr** — the branch is pushed and the PR opened as a draft _before_ the review loop runs, so pr-reviewer can post inline GitHub comments referencing specific PR lines. Previously the reviewer ran pre-push on local files only.

4. **L1 eval guard removed, not patched** — the plan warned that `scripts/eval/l1.mjs` has a `read("agents/reviewer.md")` call that would throw on file-not-found. The read call and its three reviewer-only checks (G8d, G9c, G11) were removed entirely rather than special-cased.

5. **reviewer-lessons LoreKit bucket is NOT renamed** — pr-reviewer continues to read and benefit from all previously accumulated reviewer-lessons. The bucket is identified by its LoreKit `host: "reviewer"` label (a bucket slug, not the agent filename) — no migration needed.

6. **sync-symlinks wires review-loop automatically** — `scripts/sync-symlinks.sh` discovered the new `skills/quality/review-loop/` directory and created the two-tier symlink chain (`~/.claude/skills/review-loop` → `~/.agents/skills/review-loop` → repo).

## Testing Results

- [x] L1 evals: 148/148 deterministic contract checks pass (L1 baseline-ratcheted; no new broken links/anchors)
- [x] AC-1: pr-reviewer.md defines REVIEW_RELATION with self/cross; no cross-review-only claim
- [x] AC-2: always-use-COMMENT contract preserved in pr-reviewer.md
- [x] AC-3: agents/reviewer.md and agents/reviewer/rules/ do not exist
- [x] AC-4: no tracked file dispatches the retired reviewer agent (zero grep matches)
- [x] AC-5 (judge): all remaining "reviewer" occurrences are English nouns, LoreKit bucket labels, or historical citations — none is a live dispatch target. Three surfaces fixed in the lens-contract sweep; four more surfaces fixed in a third sweep: `skills/analysis/holistic-analysis/rules/review-mode.md` (frontmatter `- reviewer` tag removed; intro + inputs prose updated to `pr-reviewer`), `skills/quality/optimize-approach/rules/apply-mode.md` (caller set and commit-ownership prose updated, retired agent removed), `skills/quality/optimize-approach/rules/report-mode.md` (caller table row `reviewer` → `pr-reviewer self`), `skills/authoring/create-skill/rules/diagnose-mode.md` (example agent name `reviewer` → `pr-reviewer`). Bonus: `skills/authoring/persistent-memory/rules/scaling-tiers.md` (LoreKit loops list updated, retired agent removed from the enumeration).
- [x] AC-6: review-loop/SKILL.md documents loop body, cap N=3, early-exit, and polish-simplify-only rule
- [x] AC-7: review-changes routes to review-loop; no reviewer agent dispatch
- [x] AC-8: review-loop only invokes `Skill("polish", "simplify")` — `Skill("polish")` and `polish.*review` patterns absent
- [x] AC-9 (judge): create-pr has push→draft PR→review-loop flow; all 5 flags retained; post-push --watch scoped to external bots
- [x] AC-10: AW Phase 6/7 companion surfaces reference review-loop/pr-reviewer only; no reviewer agent dispatch. Fixed in a follow-up commit: `skills/workflow/autonomous-workflow/README.md` Phase 6 row (was `reviewer *(agent)*`; now `review-loop *(skill)*`) and Phase 7 row (was `reviewer *(agent)*`; now `review-loop *(skill)*`); explanatory paragraph rewritten from retired-agent boilerplate to review-loop/pr-reviewer description.
- [x] AC-11 (judge): CLAUDE.md and README.md drop reviewer, add review-loop, restate pr-reviewer; agent count = 5. Fixed in a follow-up commit: `README.md` badge updated from `agents-4` to `agents-5` (was stale on base); directory tree updated from `6 agents (reviewer, pr-reviewer, ...)` to `5 agents (pr-reviewer, ...)`.
- [x] AC-12: l1.mjs has no read("agents/reviewer.md"); exits 0
- [x] AC-13: sync-symlinks succeeds; review-loop symlink discoverable
- [x] AC-14 (judge): all code fences in review-loop/SKILL.md have language IDs; prose uses semantic line breaks
- [x] AC-15: guardrail dirs exist; pr-reviewer references reviewer-lessons

## How to Verify

1. Confirm retired agent is gone: `test ! -f agents/reviewer.md && test ! -d agents/reviewer/rules && echo "RETIRED OK"`
2. Confirm REVIEW_RELATION in pr-reviewer: `grep 'REVIEW_RELATION' agents/pr-reviewer.md`
3. Confirm review-loop skill exists: `ls skills/quality/review-loop/SKILL.md`
4. Confirm symlink: `readlink ~/.agents/skills/review-loop`
5. Run L1 evals: `node scripts/eval/l1.mjs` — expect 148/148
6. Confirm no reviewer dispatch: `grep -rn 'subagent_type.*"reviewer"\|Agent(reviewer\|Skill("reviewer")' --include='*.md' . | grep -v pr-reviewer` — expect no output
7. Spot-check create-pr PR-first path: `grep -A5 'Step 6' skills/delivery/create-pr/SKILL.md | grep -i draft`
8. Spot-check review-loop anti-circularity: `grep -E 'Skill\("polish"\)|polish.*review' skills/quality/review-loop/SKILL.md` — expect no output

## Post-Self-Review Doc-Drift Fixes (commit after 1e56330)

A dogfood self-review by `pr-reviewer` (PR #85) surfaced 5 findings; 3 inventory/sweep ones
were fixed in commit 1e56330.
The remaining 4 doc-vs-source-drift findings were applied in a follow-up commit:

1. **CLAUDE.md — pr-reviewer entry** (line 103): Removed "auto-fix Simple findings" and "PENDING
   review with `--publish`" claims. Rewrote self/cross sentences to match the shipped read-only,
   COMMENT-only, no-`--publish` model. Both relations now correctly described as posting a visible
   COMMENT review; self uses assertive framing, cross uses question framing.

2. **README.md — pr-reviewer table cell** (line 176): Same correction as CLAUDE.md. Removed
   "auto-fix Simple findings" (self) and "PENDING review with `--publish`" (cross). Kept
   the ≤ 240-char / confidence-threshold detail for cross inline comments.

3. **skills/quality/review-changes/SKILL.md**: Removed the `--publish` flag entirely —
   `argument-hint`, routing-table row, `Skill()` call, usage-table row, and authorization prose
   citing `authorization-gate.md`. Replaced with a tombstone note: `pr-reviewer` posts a
   visible COMMENT review unconditionally, no authorization token required. Verified
   `authorization-gate.md` exists on disk but is an orphaned legacy rule not wired into the
   shipped agent pipeline.

4. **skills/quality/polish/SKILL.md** (lines 261–262): Fixed inverted flag mapping.
   `--no-review` was incorrectly mapped to `Skill("review-loop", "--no-feedback")` (which runs
   the reviewer). Corrected to `Skill("polish", "simplify")` — simplify only, skip reviewer —
   consistent with the authoritative `create-pr/SKILL.md:190` table.

L1 evals: 148/148 after all edits. Zero stale `--publish` active claims in CLAUDE.md /
README.md / skills/quality/. Zero dangling reviewer-dispatch references.

## Final Sweep: Lens Contract + Lens Binding Repoint (AC-5, --with surface)

The `feature-pr-verifier` caught one remaining unaudited surface: the `--with` lens contract
and the individual lens-file bindings still declared `for: reviewer` (the retired agent) instead
of `for: pr-reviewer` (the agent that now consumes lenses, per `agents/pr-reviewer.md` frontmatter
Step 1.6). The following files were repointed to match the already-updated `skills/design/ux/lens.md`
and `skills/analysis/holistic-analysis/lens.md`:

### Lens-file frontmatter (`for: reviewer` → `for: pr-reviewer`)

| File | Change |
| ---- | ------ |
| `skills/design/charting/lens.md` | `for: reviewer` → `for: pr-reviewer` |
| `skills/design/animations/lens.md` | `for: reviewer` → `for: pr-reviewer` |
| `skills/quality/ai-engineering/lens.md` | `for: reviewer` → `for: pr-reviewer` |
| `skills/quality/dx/lens.md` | `for: reviewer` → `for: pr-reviewer` |
| `skills/authoring/create-skill/templates/lens.md` | `for: reviewer` → `for: pr-reviewer` (scaffold template; new lenses authored from it now default to `pr-reviewer`) |

### Lens contract (`review-lens-contract.md`)

All live-dispatch references to the retired `reviewer` agent were updated to `pr-reviewer`:
- Title + YAML tags: `reviewer` → `pr-reviewer`
- Opening prose: "user invokes the `reviewer` agent" → "`pr-reviewer` agent"
- Hard rules 1–6: each "the reviewer" naming the consuming agent → "`pr-reviewer`"
- File-shape code block frontmatter example: `for: reviewer` → `for: pr-reviewer`
- Frontmatter table `for` field note: "Always `reviewer` for v1" → "Always `pr-reviewer` for v1"
- `lens-version` table cell: "Reviewer rejects" → "`pr-reviewer` rejects"
- Section heading "What the reviewer does at runtime" → "What the pr-reviewer does at runtime"
- "Severity hints" note: "the reviewer knows what's blocking" → "the `pr-reviewer` knows what's blocking"
- "A reviewer that supports version N" → "A `pr-reviewer` that supports version N"
- Step 5 test invocation: `reviewer --pr <PR-URL> --with <your-skill>` → `/pr-review <PR-URL> --with <your-skill>`
- Step 6 note: "for the `reviewer` agent" → "for the `pr-reviewer` agent"
- Anti-patterns: "The reviewer applies lenses" → "The `pr-reviewer` applies lenses"

### Audit results

- `grep -rn 'for: reviewer\b' skills/ | grep -v pr-reviewer` → empty (zero live matches)
- `grep -n '\breviewer\b' skills/authoring/create-skill/rules/review-lens-contract.md | grep -v pr-reviewer` → empty (zero live matches)
- L1 evals: 148/148 (unchanged)

## Third AC-5 Sweep: rules/ Subfile Repoint (optimize-approach + holistic-analysis)

The `feature-pr-verifier` caught a third missed surface set: `rules/` subfiles whose parent
`SKILL.md` was already repointed to `pr-reviewer`, but the children still named the retired
`reviewer` AGENT as a live caller or invoker.

### Files fixed

| File | Change |
| ---- | ------ |
| `skills/analysis/holistic-analysis/rules/review-mode.md` | Frontmatter `- reviewer` tag removed; line 15 intro updated from "the `reviewer` and `pr-reviewer` agents…their per-PR pipeline" → "the `pr-reviewer` agent…its per-PR pipeline"; line 32 `intent_summary` input description updated from "the reviewer produced" → "the `pr-reviewer` produced" |
| `skills/quality/optimize-approach/rules/apply-mode.md` | Line 15 caller set updated from "`reviewer` Fix / Self-Review, `polish`" → "`polish` (optimize/simplify), standalone `/optimize-approach apply`"; line 56 commit-ownership updated from "`polish`, reviewer, or the user" → "`polish` or the user" |
| `skills/quality/optimize-approach/rules/report-mode.md` | Caller table row updated from `reviewer` (own work) → `pr-reviewer` (self — own PR); sibling cross row label stays `pr-reviewer` (cross — someone else's PR); framing note updated for clarity |
| `skills/authoring/create-skill/rules/diagnose-mode.md` | Example agent name `reviewer` → `pr-reviewer` (the retired agent no longer exists under `agents/`) |
| `skills/authoring/persistent-memory/rules/scaling-tiers.md` | LoreKit loops enumeration: "the `reviewer` / `pr-reviewer` agents" → "the `pr-reviewer` agent" (retired agent removed from active list) |

### Exhaustive AC-5 audit results (post-fix)

`grep -rn '\breviewer\b' skills/ agents/ CLAUDE.md README.md | grep -v pr-reviewer | grep -vi 'reviewer-lessons|reviewer-comment-relevance|reviewer-signal|host: "reviewer"|host: reviewer|…'`

All surviving hits confirmed legitimate: English role-nouns (UX/DX/human reviewer), `implement-suggestion` domain nouns (reviewer suggestions/source/feedback/AI reviewer), LoreKit bucket/host slug references (`comment-relevance-memory.md`, `review-outcomes.md` frontmatter tags, `thread-resolution.md` host label), history/architecture prose (`autonomous-workflow/CLAUDE.md` changelog, `anthropic-architecture-research.md` REJECTED-pipeline discussion, `pr-12340-postmortem.md`), template placeholder labels (`pr-comment-card.template.md` card-destination, `reviewer-inline-report.template.md` placeholder), and intentional tombstones (`review-loop/SKILL.md:167`).

Zero live dispatch/caller/binding references to the retired `reviewer` agent remain.

- L1 evals: 148/148 (unchanged)

## Next Steps

1. Mark as ready for review after CI green
2. After merge: `gw remove consolidate-review-agents` (or `git worktree remove` + `git branch -d`)
