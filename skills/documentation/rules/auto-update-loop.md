# Auto-Update Loop (Called from Autonomous Workflows)

When this skill is invoked from a non-interactive workflow (`autonomous-workflow` Phase 5, etc.) the guardrails differ from a user-initiated `/documentation update`.
A user can review every proposed change; an autonomous run cannot.
The rules below prevent the four failure modes that ruin auto-updated docs: stale-rule re-assertion, hot-path bloat, one-off generalization, and documentation of behaviour Claude already exhibits.

This file is loaded when the caller passes `--auto` as a flag after the mode token (e.g. `Skill("documentation", "update --auto")`).
The skill parses `$ARGUMENTS` as `update` (mode) + `--auto` (flag); `--auto` triggers loading this file.

## 1. The Six Targets

In auto mode the skill writes to **six** doc surfaces, not just `CLAUDE.md`:

| Target                       | Update strategy                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `CLAUDE.md` (root)           | Hard rules + commands the agent could not guess. ≤ 200 lines hard cap.                           |
| `<dir>/CLAUDE.md` (nested)   | Subtree-scoped rules. Per Placement Resolver.                                                    |
| `.claude/rules/<topic>.md`   | Path / pattern-scoped rules with `paths:` frontmatter. Verify load post-write.                   |
| `AGENTS.md`                  | Cross-tool mirror. Symlink to `CLAUDE.md` if no Claude-specific divergence; otherwise `@import`. |
| `README.md`                  | User-facing changes (new feature flag, new command, new env var).                                |
| `docs/`                      | Diátaxis-routed narrative. New how-to for new task, new ADR for new decision.                    |
| `CHANGELOG.md`               | Append-only `## Unreleased` section. Stop at the version-cut line — release tooling owns below.  |

## 2. Hard Constraints (auto mode only)

These constraints are non-negotiable in autonomous runs. A user-initiated
run can break any of them on request; an auto run cannot.

### 2.1 Hot-path budget

Root `CLAUDE.md` line count **must stay under 200**.
If a proposed edit pushes it over:

1. Promote narrative to `docs/`.
2. Move path-scoped rules to `.claude/rules/` with `paths:` globs.
3. Move subtree rules to `<dir>/CLAUDE.md`.

If after three placement attempts the file still exceeds 200, fail the phase with a `HOT_PATH_OVERFLOW` reason.
Do not silently truncate.

### 2.2 Recurrence threshold

A proposed rule applies only after the pattern has been observed **N ≥ 2 times** across the current task plus history.
Single-occurrence patterns get logged to `.agent/docs/proposed-rules.jsonl` (append-only) instead of written.

Why: a one-off correction in PR #42 becomes a permanent rule everyone
pays tokens for forever. Recurrence guards against turning incidents into
canon.

Skip the threshold only when:

- The user explicitly says "remember this for next time".
- The pattern is a hard correctness invariant (e.g. "Never edit migrations after merge") — flag with `severity: critical` in the proposal payload.

### 2.3 Removed-rules ledger

Maintain `.agent/docs/removed-rules.jsonl` (append-only). Each entry:

```json
{
  "timestamp": "2026-05-14T10:38:00Z",
  "rule_hash": "sha256:abc123…",
  "rule_text": "Avoid the BackgroundContext helper",
  "removed_in_pr": 1234,
  "removed_reason": "user-deleted"
}
```

Before writing a new rule, hash the proposed text and check the ledger.
If a near-match exists (Jaccard similarity ≥ 0.8 on the rule text), do
NOT re-assert. Log to `proposed-rules.jsonl` and surface in the run
summary instead.

Why: agents that re-add deleted rules will exhaust user goodwill before
the second PR.

### 2.4 Ablation check (optional but high-value)

Before persisting a new rule, run an inexpensive ablation:

1. Take the smallest reproducing task from this run.
2. Spawn a fresh-context sub-agent **without** the proposed rule.
3. Compare behaviour to the run that prompted the rule.

If behaviour is identical without the rule, do not persist — Claude
already does the right thing. Log the proposed rule as `ablation:
no-divergence`.

Cost: one extra sub-agent dispatch per proposed rule. Worth it for any
rule that would land in root `CLAUDE.md`. Skip for `.claude/rules/`
path-scoped writes (lower cost; lower stakes).

### 2.5 Confidence gate

Every proposed write is gated by `Skill("confidence", "analysis") ≥ 90 %`.
Below 90 %, the write is logged but not persisted. The orchestrator's
own confidence gate (Phase 4 in `autonomous-workflow`) does not satisfy
this — confidence at *the doc write specifically* is a separate signal.

## 3. The Auto-Update Procedure

```
[from autonomous-workflow Phase 5]
        |
        v
0. Ensure .agent/ is gitignored (required before writing ledger files).
   Run: grep -q '\.agent' .gitignore 2>/dev/null || printf '\n# Agent workflow artifacts\n.agent/\n' >> .gitignore
   If .gitignore is absent, create .agent/.gitignore with content: *\n!.gitignore
        |
        v
1. Diff branch vs base; classify changes by area.
        |
        v
2. Read every doc surface (CLAUDE.md, .claude/rules/, AGENTS.md,
   README.md, docs/, CHANGELOG.md).
        |
        v
3. Run all §3 drift checks from drift-detection.md.
        |    Failures → P0 fix items.
        v
4. Walk the change classification table; for each new pattern:
   - Check recurrence (§2.2).
   - Check removed-rules ledger (§2.3).
   - Run ablation (§2.4, optional).
   - Route via content-routing.md.
   - Resolve placement via placement-resolver.md (innermost-wins).
   - Run confidence(analysis) gate (§2.5).
        |
        v
5. Apply P0 (drift fixes) — these are always-on, no confidence gate.
6. Apply P1 (new rules that passed §2 gates).
7. Skip P2 in auto mode (polish never auto-applied).
        |
        v
8. Run post-write verification:
   - /memory or InstructionsLoaded hook for new .claude/rules/.
   - lychee link check across all six targets.
        |
        v
9. Stage + commit ("docs(claude): sync agent guidance with feature changes").
10. Append run summary to .agent/docs/run-log.jsonl.
        |
        v
[control returns to caller]
```

## 4. Skip Conditions (auto mode)

Skip the entire run only when one of these matches:

| # | Condition                                                                    | Concrete example                                              |
| - | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1 | User said "skip docs" in Phase 0 or in the workflow's intake                  | Explicit override                                             |
| 2 | Touched 0 files outside `package.json` / lockfile (pure dependency bump)      | `zod` bump 3.22 → 3.23                                        |
| 3 | Touched only test files                                                       | Added missing unit tests for existing function                |
| 4 | Config-only change with no behaviour delta                                    | Stricter `tsconfig.json` flag with no source-file impact      |
| 5 | Run summary indicates no new patterns and zero drift findings                 | Pure refactor with identical exports and identical behaviour  |

For every skip, append to `.agent/docs/run-log.jsonl`:

```json
{
  "timestamp": "2026-05-14T10:42:00Z",
  "phase": "documentation-update",
  "action": "skipped",
  "reason": "test-only change"
}
```

Silent skips are not allowed.

## 5. Run Summary Output

Auto mode emits a compact JSON summary to stdout so the caller can log
it. Shape:

```json
{
  "phase": "documentation-update",
  "outcome": "applied",
  "p0_fixes": 2,
  "p1_rules_applied": 1,
  "p1_rules_logged": 3,
  "ablation_no_divergence": 1,
  "removed_rules_skipped": 0,
  "files_changed": [
    "CLAUDE.md",
    ".claude/rules/api.md",
    "docs/explanation/architecture.md"
  ],
  "post_write_verification": "ok"
}
```

If `outcome` is `error`, include a `reason` field with one of:
`HOT_PATH_OVERFLOW`, `VERIFICATION_FAILED`, `CONFIDENCE_LOW`,
`UNHANDLED_EXCEPTION`.

## 6. CHANGELOG-Specific Rules

Auto mode writes only to the `## Unreleased` section of `CHANGELOG.md`.
**Never** edit any versioned section — those are owned by release tooling
(`release-please`, `semantic-release`, `changesets`).

Detect the release tool:

| Marker found                                  | Tool              |
| --------------------------------------------- | ----------------- |
| `.release-please-manifest.json`               | release-please    |
| `.releaserc.*` / `release.config.*`           | semantic-release  |
| `.changeset/`                                 | changesets        |

If a tool is detected and the project's convention is to write changes
to that tool's input format (e.g. `.changeset/*.md` for changesets),
write there instead of `CHANGELOG.md` directly. See
[`maintenance.md`](./maintenance.md) §7.

## 7. Failure Modes — Watch For

| Failure                                                          | Detection                                                       | Response                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Rule passed gates but `paths:` frontmatter silently fails        | Post-write `/memory` check returns no match                     | Try `globs:` fallback; if still fails, escalate |
| Hot-path overflow (root `CLAUDE.md` > 200 lines)                 | Line count after proposed write                                 | Reroute via Placement Resolver; if still over, fail with `HOT_PATH_OVERFLOW` |
| Re-asserting a removed rule                                      | Removed-rules ledger hit                                        | Skip write, log to `proposed-rules.jsonl`      |
| Documenting behaviour Claude already exhibits                    | Ablation `no-divergence`                                        | Skip write, log                                |
| Diátaxis pollution (how-to lands in `reference/`)                | Routing table content-kind ≠ destination quadrant               | Re-route per content-routing.md §1             |
| CHANGELOG written outside `## Unreleased`                        | Diff includes lines under versioned heading                     | Reject; release tool owns those sections       |
| Imported file expands root context past budget                   | Sum of `@import` chains exceeds threshold (e.g. 8K tokens)      | Demote imports to `docs/` Read-on-demand       |
