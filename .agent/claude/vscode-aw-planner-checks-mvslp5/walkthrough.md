---
created: 2026-07-05T16:40:00Z
branch: claude/vscode-aw-planner-checks-mvslp5
task: Surface the aw-planner checks.yaml artifact in the vscode-agent-tasks extension
plan: plan.md (v1, confidence 94%)
pr: https://github.com/mthines/agent-skills/pull/53
---

# Walkthrough: checks.yaml support in vscode-agent-tasks

## What shipped

The extension now surfaces `.agent/{branch}/checks.yaml` — the executable acceptance-check ledger the aw-planner derives from the plan's Acceptance Criteria and the aw-executor status-flips live during Phase 4 — as a first-class, strictly read-only artifact in both panels.

## The user-visible behavior

1. **Agent Tasks panel** — branches with checks get a collapsible `Checks` node (between Plan and Walkthrough) with one leaf per `AC-{n}`: status icon (`pending` outline / `pass` green / `fail` red / `unsatisfiable` yellow warning), truncated EARS text as the row description, full contract (EARS + expect + kind + covers) in the tooltip. Clicking any row opens `checks.yaml` as a text document — never Markdown preview.
2. **Progress rollups** — branch rows (and 1-branch flattened worktree rows) append a compact `✓ pass/total`; Sessions rows show the same rollup while the session is `running`.
3. **Live refresh** — `checks.yaml` is watched on both the native (macOS/Windows) recursive watcher and the Linux VS Code-pattern fallback, so statuses tick live as the executor works.
4. **Unsatisfiable escalation** — when a check transitions into `unsatisfiable` (the executor's abort affordance: it is blocked and needs a human), a warning notification fires once per transition with an "Open checks.yaml" action. Gated by the new `agentTasks.notifyUnsatisfiableCheck` setting (default `true`). `fail` never notifies — it is a normal mid-loop state. A wholesale reset to `pending` (plan re-iteration) produces no notification.
5. **Sessions correlation** — `LinkedArtifacts` gains `checksPath`; correlated sessions show a `Checks` child row and list `checks.yaml` in the tooltip.
6. **Read-only by contract** — no mutation affordances anywhere; `agentChecksFile` participates in Reveal in OS / Copy Path but is deliberately excluded from `deleteArtifacts` (deleting the ledger silently downgrades the executor to judgment-gating — same reasoning as `plan.md`).
7. **Backward compatible by absence** — no `checks.yaml` (Micro/Lite/fix-bug fast-lane/legacy) → no node, no rollup, zero behavior change.

## Key implementation decisions (full rationale in plan.md Decisions)

- **Hand-rolled tolerant parser** (`src/parsers/checks-parser.ts`), no YAML dependency: the file is machine-emitted with a fixed flat schema; quoted values keep embedded `:`/`#`, unquoted values are cut at inline comments, unknown statuses normalize to `pending`, malformed input → `{ checks: [] }`.
- **The watcher owns transition detection**: per-file `id → status` baselines + pure `diffNewUnsatisfiable`; scan-time seeding is silent (pre-existing state ≠ transition); providers stay display-only, so the two panels can't double-fire notifications.
- **Rollup on running sessions only**: the description slot is tight and clips; while running is when "how far along" matters.

## Files changed (2 created, 9 modified)

| File | Change |
| ---- | ------ |
| `src/parsers/checks-parser.ts` (new) | Types + `parseChecksYaml` + `summarizeChecks` + `formatChecksRollup` + `diffNewUnsatisfiable` + `statusMapOf` |
| `src/parsers/checks-parser.test.ts` (new) | 15 tests: schema, quoted colons, inline comments, status normalization, malformed input, rollup, transition diff (incl. reset + first-sighting cases) |
| `src/lib/session-artifact-correlator.ts` | `checksPath` in `LinkedArtifacts` (detect + gate + `hasLinkedArtifacts`) |
| `src/lib/session-artifact-correlator.test.ts` | +4 cases: present / absent / checks-only dir / hasLinkedArtifacts |
| `src/watchers/artifact-watcher.ts` | `checks.yaml` in `ARTIFACT_FILES` + Linux patterns; status baselines; `onUnsatisfiableCheck` event; delete eviction |
| `src/providers/agent-tasks-provider.ts` | `ChecksSummaryItem` + `CheckItem`; union entries; parse in `collectBranchesForWorktree`; node in `getBranchChildren`; rollup threaded through `getBranchDescription` (both call sites) |
| `src/providers/sessions-provider.ts` | `Checks` child; tooltip entry; running-row rollup via `readChecksRollup` |
| `src/extension.ts` | `resolveTarget` branch; `.md`-only preview routing in `openMarkdown`; notification subscription |
| `package.json` | `agentTasks.notifyUnsatisfiableCheck`; `agentChecksFile` in reveal/copy menu regexes (NOT delete); description strings |
| `CLAUDE.md` (package + root) | Documented the checks surface, setting, and read-only contract |

## Verification

- Executable Checks Loop: **10/10 checks pass** (`checks.yaml` statuses flipped by the loop; definitions untouched).
- `nx build vscode-agent-tasks` ✓ · `nx test vscode-agent-tasks` ✓ (268 tests / 14 files, incl. 19 new) · `nx lint vscode-agent-tasks` ✓.
- Pre-existing `tsc --noEmit` error in `hook-event-watcher.ts:44` confirmed on the unmodified baseline (git stash bisect) — out of scope; no project gate is wired to `tsc`.

## Known limitations / follow-ups

- Provider-level rendering (tree item shapes) is covered by grep-kind checks + manual smoke, not unit tests — the providers import `vscode` and are not vitest-testable (documented repo constraint).
- Manual smoke checklist for a real workspace: create a fixture `.agent/test/checks.yaml`, watch the node appear, edit statuses, verify live icon flips and the one-shot unsatisfiable notification.
- Out of scope by plan: webview editor, gutter decorations, `autoOpenChecks`, any write path.
