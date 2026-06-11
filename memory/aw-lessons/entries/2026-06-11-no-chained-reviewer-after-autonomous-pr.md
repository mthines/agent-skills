---
id: 2026-06-11-no-chained-reviewer-after-autonomous-pr
created: 2026-06-11T10:00:00Z
updated: 2026-06-11T10:20:00Z
type: procedural
scope: aw-lessons
phase: 7
trigger-context: "End-of-run on a heavy JS/TS monorepo (dash0, `components/ui` with 354+ vitest tests). Specifically when aw has just produced a PR via the autonomous workflow."
seen_count: 1
confidence: high
status: active
expires: 2026-09-09T10:00:00Z
source: system
redacted: false
---

# At end-of-run on heavy monorepos, nudge the orchestrator away from chaining `reviewer --fix` and `aw-executor` in the same session

**What failed:** A single session ran `aw` → `reviewer` → `aw-executor` → `reviewer --fix` in sequence on dash0. `aw` itself only ran `pnpm verify` once (correct, expected). The cascade came from the orchestrating main agent dispatching `aw-executor` AND `reviewer --fix` after `aw` was already done — each of those additionally fired a full `pnpm verify`. Combined with sticky `nx daemon` processes per worktree and resident vitest worker swarms, the user reported >55 GB RAM. **Primary owner of this lesson is `reviewer-lessons` (see [`reviewer-lessons/entries/2026-06-11-no-full-verify-on-heavy-monorepos.md`](../../reviewer-lessons/entries/2026-06-11-no-full-verify-on-heavy-monorepos.md)) — that's where the actionable rule lives.** `aw`'s contribution is only the closing nudge below.

**Why:** `aw` is the entry point and therefore the only place where the chain can be stopped before it starts. By the time the main agent reaches `reviewer --fix`, the orchestrator pattern is already in motion.

**What to do next time (aw-specific):**
- **In the Phase 7 (CI Gate) / end-of-run summary**, on heavy monorepos (detect via `pnpm-workspace.yaml` + `nx.json` + large vitest suite), append a one-line nudge to the closing report:
  > "PR is open. For follow-up fixes prefer inline edits in the main agent; avoid dispatching `reviewer --fix` + `aw-executor` in the same session — each runs a full `pnpm verify` on top of this one."
- Do **not** change `aw`'s own verify behavior — running verify once before opening the PR is correct.
- This is a *foreshadowing* lesson, not an operational one — `aw` does not directly cause the problem; it warns the orchestrator about what comes next.

**Promotion target:** Once `seen_count ≥ 3`, harden the closing-nudge text into `skills/workflow/autonomous-workflow/SKILL.md` Phase 7's end-of-run report template, gated on the heavy-monorepo signal.
