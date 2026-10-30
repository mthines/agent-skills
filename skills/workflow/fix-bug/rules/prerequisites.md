# Prerequisites

Load when a dependency is missing or you need to know whether one is optional.

| Dependency | Purpose | Required? |
|-----------|---------|-----------|
| `confidence` skill | Phase 3 / 4 gate (`analysis` mode) | **Yes** |
| `/tdd` skill | Phase 2.5 reproduction at unit / component layer | **Yes** for non-best-effort repros |
| `/e2e-testing` skill | Phase 2.5 reproduction at user-flow layer (web) | If web E2E repro |
| `/e2e-testing-mobile` skill | Phase 2.5 reproduction at user-flow layer (Expo / React Native) | If mobile E2E repro |
| `aw` skill (from [`autonomous-workflow`](../../autonomous-workflow/SKILL.md)) — its `rules/full-tier.md` and `rules/lessons.md` | Phase 6 Step 6b work loop, local review, PR, and lessons on both lanes | **Yes** for auto-fix path |
| `branch-reviewer` and `feature-pr-verifier` agents | Phase 6 Step 6b local review and PR-open verification; without a dispatch tool both report `not run` | **Yes** for an independent review |
| [`aw-create-plan`](../../aw-create-plan/SKILL.md) skill | Phase 6 plan.md authoring on both lanes (the fast-lane plan, or the standard-lane six-Core brief) | **Yes** for auto-fix path |
| `gh` CLI | Draft PR creation in Phase 6 Step 6b; `gh pr view` / `gh pr diff` / `gh pr edit` in Phase 7 | **Yes** for auto-fix path |
| `gw` CLI | Worktree management (Phase 6) | Recommended |
| `lorekit-memory` skill (LoreKit `memory.*` tools) | `fix-bug-lessons` self-improvement loop (read Phase 0.5, write Phase 5/7/8) | Optional — loop is a silent no-op if `memory.*` is not connected |
| `video-analyser` skill | Resolve video / screen-recording inputs — a direct video input (Phase 0 row 3) or a video attachment flagged on a Linear ticket (Phase 1 Linear route) | If video input or a Linear ticket carries a video |
| `telemetry-verify` skill + `.agents/aw/` config | Phase 2.5 repro-fidelity check — grades the local repro's window against the originating span's shape from the Evidence Record, for a telemetry-sourced input only | Optional — advisory; skipped with one line if unavailable or input is not telemetry-sourced |
| `ui-verify` skill | Phase 6 PR-body UI verification spec for UI / visual bugs — inherited via Step 6b → `create-pr` Step 6.4; seeds from the Phase 2.5 repro artifact when present | Optional — inherited transitively; silent no-op if not installed |
| Dash0 MCP server (`mcp__dash0__*` or equivalent) | Resolve span / log / web event URLs; Phase 8 polling | If Dash0 input |
| Linear MCP (`mcp__claude_ai_Linear__*`) | Linear-ticket input route (`get_issue`, `list_comments`) | If Linear input |
