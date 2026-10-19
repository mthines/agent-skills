# Prerequisites

Load when a dependency is missing or you need to know whether one is optional.

| Dependency | Purpose | Required? |
|-----------|---------|-----------|
| `confidence` skill | Phase 3 / 4 gate (`analysis` mode) | **Yes** |
| `/tdd` skill | Phase 2.5 reproduction at unit / component layer | **Yes** for non-best-effort repros |
| `/e2e-testing` skill | Phase 2.5 reproduction at user-flow layer (web) | If web E2E repro |
| `/e2e-testing-mobile` skill | Phase 2.5 reproduction at user-flow layer (Expo / React Native) | If mobile E2E repro |
| `aw-planner` + `aw-executor` agents (from [`autonomous-workflow`](../../autonomous-workflow/SKILL.md)) | Phase 6 standard-lane implementation; aw-planner also handles fast-lane round-3 fallback | **Yes** for auto-fix path |
| [`aw-create-plan`](../../aw-create-plan/SKILL.md) skill | Phase 6 fast-lane plan.md authoring (substitutes for aw-planner when triage = `simple` AND confidence ≥ 92 %) | **Yes** for fast-lane |
| `gh` CLI | Draft PR creation by `aw-executor`; `gh pr view` / `gh pr diff` / `gh pr edit` in Phase 7 | **Yes** for auto-fix path |
| `gw` CLI | Worktree management (planner) | Recommended |
| `lorekit-memory` skill (LoreKit `memory.*` tools) | `fix-bug-lessons` self-improvement loop (read Phase 0.5, write Phase 5/7/8) | Optional — loop is a silent no-op if `memory.*` is not connected |
| `video-analyser` skill | Resolve video / screen-recording inputs — a direct video input (Phase 0 row 3) or a video attachment flagged on a Linear ticket (Phase 1 Linear route) | If video input or a Linear ticket carries a video |
| `observe-run` skill | Phase 2.5 repro-fidelity check — grades the local repro's trace shape against expectations this skill materialises from the Evidence Record's originating span, for a telemetry-sourced input only | Optional — advisory, silent no-op if unavailable or input is not telemetry-sourced |
| `ui-verify` skill | Phase 6 PR-body UI verification spec for UI / visual bugs — inherited via `aw-executor` → `create-pr` Step 6.4; seeds from the Phase 2.5 repro artifact when present | Optional — inherited transitively; silent no-op if not installed |
| Dash0 MCP server (`mcp__dash0__*` or equivalent) | Resolve span / log / web event URLs; Phase 8 polling | If Dash0 input |
| Linear MCP (`mcp__claude_ai_Linear__*`) | Linear-ticket input route (`get_issue`, `list_comments`) | If Linear input |
