---
title: Decision log — one LoreKit bus event per stage decision, plus revert and hotfix outcomes
impact: MEDIUM
tags: [atelier, lorekit, bus, outcomes]
---

# Decision log

Every stage decision and every detected outcome becomes one LoreKit `bus` memory.
The log is evidence for later steps; nothing in atelier reads it to decide a stage.
**Why:** [`../references/design.md` § Ground truth](../references/design.md#ground-truth).

## Contents

- [Decision event](#decision-event)
- [Outcomes](#outcomes)
- [When LoreKit is absent](#when-lorekit-is-absent)

## Decision event

Write it right after the state comment is updated:

```text
memory.write {
  scope: "branch::{owner}/{repo}::{head-branch}",
  key: "atelier-decisions::pr-{n}-{stage}-{decision}-{sha7}",
  kind: "bus", host: "atelier", tags: ["loop::atelier-decisions"], ttl_days: 90,
  value: "<one line: stage, decision, reason>",
  attributes: { event: "decision", repo: "{owner}/{repo}", pr: {n}, stage: "build|ready|merge",
                decision: "proceed|refuse|hold|failed", reason: "<r>", user_visible: <bool>,
                has_flag_contract: <bool>, model: "<your model id>", head_sha: "<sha>" }
}
```

1. `user_visible` and `has_flag_contract` come from the last `merge-gate.mjs` JSON on this head (Build's early gate fills them); when the gate has not run on this head (a run started from an existing PR, or a head that moved), run it once with `--pr <pr-url> --contract-only` to fill them (it decides nothing at that point, and skips the CI read).
   When that JSON carries a `warning` (no flag provider), `has_flag_contract` is `true` and the `reason` ends with the warning.
2. A merge `proceed` also carries `merge_sha`, the squash commit; the outcome sweep reads it.
3. A Build `proceed` or `hold` also carries `preflight` (the `PREFLIGHT:` line), and `accepted_skip` / `accepted_gaps` (comma lists) only when the user passed `--accept-skip` / `--accept-gaps`, so a waiver is always attributable to the user.
4. A Build that failed before a PR exists uses the worktree's branch for the scope, `pr: 0`, and `failed-{ISO timestamp}` in place of `{decision}-{sha7}`.
5. A `skipped` Build is not a decision and writes no event.
6. `kind` and `host` are set explicitly: LoreKit infers them only from `loop::<x>-lessons` tags.

```text
✗ key: "atelier-decisions::pr-41-merge"                  # a proceed after a refusal on the same head overwrites the refusal
✓ key: "atelier-decisions::pr-41-merge-refuse-9f3c2a1"   # each decision keeps its own record
```

```text
✗ scope: "repo::acme/web"                                # per-PR rows crowd out the lessons a repo:: read injects
✓ scope: "branch::acme/web::feat/new-header"
```

## Outcomes

At the start of every run, before any stage:

1. List merged atelier PRs: `memory.list { kind: "bus", host: "atelier", tags: ["loop::atelier-decisions"], limit: 100 }`, passing each `nextCursor` back as `cursor` until it is null, and keep `event: decision`, `stage: merge`, `decision: proceed` rows of this repo that carry `merge_sha`.
2. Read each PR's stored outcome: `memory.read { refs: ["{scope}::atelier-decisions::pr-{n}-outcome"] }`, keeping its `outcome` and `version`.
   Drop only PRs whose stored outcome is `reverted`; a stored `clean` or `hotfixed` can still turn into `reverted`.
3. Classify the rest in one call, on a fetched base:

   ```bash
   git fetch -q origin
   node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/outcomes.mjs" --merged '[{"pr":41,"sha":"<merge_sha>"}]' --base origin/<default-branch>
   ```

4. For each result with `final: true` whose `outcome` differs from the stored one, write the event with `expected_version` set to the stored `version` (`0` when none), so two concurrent runs cannot both write it:

   ```text
   memory.write { scope: <the PR's scope>, key: "atelier-decisions::pr-{n}-outcome", expected_version: <stored version | 0>,
                  kind: "bus", host: "atelier", tags: ["loop::atelier-decisions"], ttl_days: 90,
                  value: "<outcome + evidence commits as JSON>",
                  attributes: { event: "outcome", repo: "{owner}/{repo}", pr: {n}, outcome: "clean|reverted|hotfixed",
                                merge_sha: "<sha>", evidence_shas: "<comma list>" } }
   ```

5. A result with `final: false` (clean, window still open, or `unknown` because its sha could not be read), or with the stored outcome, writes nothing; a later run classifies it again.
   Name each `unknown` once under `Degraded:` with its `error`; `outcomes.mjs` exiting 2 (a base it cannot read) is one `Degraded: outcome sweep failed — <stderr>` line, and the stages still run.
6. Classify only PRs whose merge event is still listed: the 90-day TTL bounds the sweep.

```text
✗ write "clean" the day after the merge                  # a hotfix on day 5 can no longer be recorded
✓ write only final results; clean becomes final after --days (default 14)
```

```text
✗ read one page of 100 rows                              # a busy repo's older merges drop out unclassified
✓ follow nextCursor until it is null
```

```text
✗ skip a PR because a "clean" outcome is stored         # its revert on day 30 is never recorded
✓ re-classify it; "clean" → "reverted" updates the record at its stored version
```

## When LoreKit is absent

No `memory.*` tool, or a call that errors or times out: print `Degraded: lorekit unreachable — decision log and outcomes skipped` once, skip every step in this file, and run the stages unchanged.

```text
✗ hold the merge until LoreKit answers
✓ Degraded: lorekit unreachable — decision log and outcomes skipped   → merge gate runs as normal
```
