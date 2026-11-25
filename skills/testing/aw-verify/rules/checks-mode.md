---
title: Checks mode — prove a non-UI diff's criteria with recorded test runs
impact: HIGH
tags:
  - checks-only
  - acceptance-criteria
  - proof
  - autonomous-workflow
---

# Checks mode

Read when the diff has no UI file (`ui-verify`'s `is-ui-diff.mjs` prints `UI_DIFF: no`) or the caller passed `run checks`.
A non-UI diff still needs proof: the criteria it claims, and a run showing each one holds.
Checks mode supplies that run without a browser, a stack, or `.agents/aw/environments.yml`, and writes it in the same format as every other run: the PR's `intent` region and an `aggregate` region in [`report.md.template`](../templates/report.md.template)'s shape.
The same `--check` gate then judges it.

## Contents

- [Steps](#steps)
- [`runs.json`](#runsjson)
- [Rules](#rules)

## Steps

Everything goes under `.agent/{branch}/verify/`.

1. **Criteria.** Use `.agent/{branch}/plan.md`'s `## Acceptance Criteria` (the `/aw` brief).
   No brief → derive the criteria per [`intent.md` § Step 3](./intent.md#step-3--write-acceptance-criteria-sources-2-and-3-only) and write a minimal `plan.md` holding just `## Guardrails` and `## Acceptance Criteria` with `- [ ] AC-n — <criterion>` lines.
   An untagged AC's proof kind is `check`.
2. **One command per AC.** Pick the narrowest command that exercises the behaviour, such as a test filtered by name (`pnpm vitest run render-lib -t 'TEMP'`, `pytest -k utf8`).
   An AC with no test that reaches it gets one written first, as its own commit: on your own PR or before one exists, never on someone else's PR.
3. **Run them.** Write `.agent/{branch}/verify/commands.json`, one command per AC (`{"AC-1": "pnpm vitest run render-lib -t 'TEMP'"}`), and let the script run them:

   ```bash
   VC="${CLAUDE_SKILL_DIR}/scripts/verify-comment.mjs"; D=.agent/<branch>
   node "$VC" --checks $D/verify/commands.json --run --base origin/<base> --from-plan $D/plan.md --local $D/verify
   ```

   It runs each command at the head (`after`), then again in a temporary worktree at the merge base with the branch's changed test files laid over it (`before`), with the checkout's `node_modules` linked in. Exit 0 is `pass`, anything else `fail`; `evidence` is the last output line that names no local path. It writes `$D/verify/runs.json` (every run `by: "run"`), `intent.md`, and `report.md`, and removes the worktree.
   A `before` that fails because the base cannot build the test (it imports a new export) still reads `fail`: read its evidence, and when it is a build error rather than the assertion, note it in the PR.
   Pass `--test-files a,b` when the branch's tests are not named like tests (`*.test.*`, `*_test.*`, `test_*.py`, or under `test/`, `tests/`, `__tests__/`, `spec/`).
4. **Only when a command cannot run here** (a Windows-only path with no mock), record that AC by hand in `runs.json` as `unsatisfiable`, with `evidence` saying what ran instead, and render without `--run` (`--checks $D/verify/runs.json`). The report labels it `hand` and lists it for a human.
5. **Gate.**

   | When | Render | Gate, until it prints |
   | --- | --- | --- |
   | no PR yet (`/aw` before `create-pr`) | step 3 (`--local $D/verify`) | `node "$VC" --check --local $D/verify` → `local report complete` |
   | a PR | `node "$VC" --checks $D/verify/runs.json --from-plan $D/plan.md --pr <pr-url> --head <sha>` (the recorded runs, posted) | `node "$VC" --pr <pr-url> --check` → `report complete` |

   The render writes both regions: the criteria table ticked from `after` (✅ pass, ❌ fail, ⏭️ unsatisfiable, ⬜ no run) and the aggregate, whose table says who recorded each run (`run`, `run-checks`, or `hand`).
   Verdict: any `fail` → `❌ Not verified`; an AC with no run → `⛔ Blocked`; an `unsatisfiable` run, or a `pass` that also passed on the base → `⚠️ Verified with open items`; otherwise `✅ Verified`.
6. **Head moved?** Run step 3 again: the merge gate refuses a report recorded on another commit than the PR head.
7. **Fix loop.** On your own PR, a `fail` re-enters the fix loop ([`fix-loop.md`](./fix-loop.md)): fix, commit, run step 3 again.

## `runs.json`

```json
{
  "AC-1": { "command": "pnpm vitest run render-lib -t 'TEMP'", "before": "fail", "after": "pass", "evidence": "1 failed → 1 passed" },
  "AC-2": { "command": "pytest -k utf8", "before": "n/a", "after": "pass", "evidence": "1 passed; base has no configure_stdio to import" },
  "AC-3": "pass"
}
```

That is the file `--run` writes (with `"by": "run"` on each entry). `after` is required: `pass`, `fail`, or `unsatisfiable`.
`before` is `fail`, `pass`, or `n/a`.
With `--run` the input maps each AC to its command; without it, a bare string is `after` alone, which is the shape `run-checks.mjs --statuses` prints, so a Full run's sealed checks can be rendered as they are; its `pending` is no run (⬜).
A run for an ID the brief lacks, or an unknown `after`, is refused.

## Rules

- **Let the script run it.** `--run` reads the exit code itself, so a `pass` cannot be typed. Record by hand only what cannot run here, and only as `unsatisfiable`. A suite exit code is never spread across criteria it did not test.
- **One format.** Only `verify-comment.mjs` writes the regions. Never hand-write an evidence section in the PR body: nothing reads it, and the gate refuses a PR that has only that.
- **A pass that also passes on the base proves nothing about the change.** Keep it, but expect `⚠️`. Tighten the test when you can.
- **Quote the result, not where it ran.** A local path in `command` or `evidence` (`/tmp/…`, `C:\…`) is refused before anything is posted: a reviewer cannot open it.
- **Mocked platforms are named.** A Windows-only fix proven by a test that mocks `win32` is `pass` with `evidence` saying `mocked win32`, and the report's open items say what a real machine still has to confirm.
