---
id: 2026-06-11-no-full-verify-on-heavy-monorepos
created: 2026-06-11T10:15:00Z
updated: 2026-06-11T10:15:00Z
type: procedural
scope: reviewer-lessons
phase: 4
trigger-context: "Reviewer in `fix` or `self-review` sub-mode on a heavy JS/TS monorepo (dash0, `components/ui` with 354+ vitest tests; pnpm + nx workspaces). Especially when the working tree shows signs of a recent autonomous-workflow run (PR already open on the current branch, fresh worktree, recent `aw-executor` commit) — meaning `pnpm verify` has very likely already run in this session."
seen_count: 1
confidence: high
status: active
expires: 2026-09-09T10:15:00Z
source: system
redacted: false
---

# Don't run full `pnpm verify` after applying fixes on heavy monorepos — use targeted tests

**What failed:** A single Claude Code session ran `aw` → `reviewer` (read-only) → `aw-executor` → `reviewer --fix` (autofix) in sequence on dash0. The two verify-running rounds (`aw-executor` and `reviewer --fix`) each fired a full `pnpm verify` in `components/ui` (TS compile + ESLint + 354 vitest tests with ~10 parallel workers), and there was also an `aw` round's verify earlier in the chain. Three full verify pipelines stacked back-to-back. Combined with sticky `nx daemon` processes per worktree (12+ alive across the user's 15 worktrees) and resident vitest worker swarms, Claude Code consumed >55 GB RAM. The user's existing memory already forbids *parallel* lint/tsc/tests; this is the cascading-sequential counterpart, and `reviewer --fix` is the heaviest single offender because it tacks a full verify onto the end of every autofix round.

**Why:** Vitest worker pools don't fully release between back-to-back invocations; TS + ESLint peak memory stacks on top of an already-large worktree footprint (1.5–2 GB node_modules per worktree × N worktrees). Each subagent that ran during the chain also held its own 1M-context window in the harness. The full verify run is not the only way to gain confidence after a small fix.

**What to do next time:**
- **In `fix` / `self-review` sub-mode**, after applying autofixes, run **only** the test files for the changed paths (`pnpm test path/to/changed.test.ts` or `pnpm test -t "<test name>"`). Do not run `pnpm verify`, `pnpm tsc`, or `pnpm lint` over the whole workspace.
- **Defer full type/lint to CI** when iterating on a heavy monorepo. CI is the authoritative gate; the local verify is redundant once unit tests pass for the touched files.
- **If a prior autonomous-workflow run in the same session already executed `pnpm verify`** (signal: open PR on current branch + recent `aw-executor` commit), **skip even the targeted re-test** — push and let CI catch any drift. Re-verify only on explicit user request.
- **Detect "heavy monorepo" by signal**, not name: presence of a `pnpm-workspace.yaml`, an `nx.json` or `nx daemon` process, a vitest config with worker pooling, and a test suite over ~200 files. Dash0's `components/ui` qualifies on all four.
- When the lesson applies, **announce it once at intake**: e.g. "Heavy-monorepo lesson active — skipping post-fix `pnpm verify`, deferring to CI" — so the user knows why the usual full verify is absent.

**Promotion target:** Once `seen_count ≥ 3`, harden into `agents/reviewer/rules/auto-fix-policy.md` as a new "Post-fix verification" subsection: "On heavy monorepos (detected via the four signals above), the auto-fix completion check is a targeted test of the changed files — not `pnpm verify`. Full verify is CI's job."

## History (added on UPDATE only)
