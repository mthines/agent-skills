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
3. **Before, on the base.** Run each command against the base code with the branch's test files laid over it, so the new test meets the old code:

   ```bash
   H=$(git rev-parse HEAD); B=$(mktemp -d)
   git worktree add --detach "$B" "$(git merge-base HEAD origin/<base>)"
   git -C "$B" checkout "$H" -- <the test files the branch changed>    # git diff --name-only origin/<base>... lists them
   (cd "$B" && <command>); echo "before=$?"
   git worktree remove --force "$B"
   ```

   Record `fail` (the test catches the change), `pass` (it does not), or `n/a` when it cannot run there, with the reason in `evidence`.
4. **After, on the branch.** Run the same command at the head and record `pass` or `fail`, with the result line it printed (`46 passed`, `1 failed: expected 'C:\Temp'`) as `evidence`.
   A command that cannot run on this machine at all (a Windows-only path with no mock) is `unsatisfiable`; `evidence` says what ran instead.
5. **Write** `.agent/{branch}/verify/runs.json` ([below](#runsjson)).
6. **Render and gate.** `VC="${CLAUDE_SKILL_DIR}/scripts/verify-comment.mjs"`, `D=.agent/<branch>`:

   | When | Render | Gate, until it prints |
   | --- | --- | --- |
   | no PR yet (`/aw` before `create-pr`) | `node "$VC" --checks $D/verify/runs.json --from-plan $D/plan.md --local $D/verify` | `node "$VC" --check --local $D/verify` → `local report complete` |
   | a PR | `node "$VC" --checks $D/verify/runs.json --from-plan $D/plan.md --pr <pr-url> --head <sha>` | `node "$VC" --pr <pr-url> --check` → `report complete` |

   The render writes both regions: the criteria table ticked from `after` (✅ pass, ❌ fail, ⏭️ unsatisfiable, ⬜ no run) and the aggregate.
   Verdict: any `fail` → `❌ Not verified`; an AC with no run → `⛔ Blocked`; an `unsatisfiable` run, or a `pass` that also passed on the base → `⚠️ Verified with open items`; otherwise `✅ Verified`.
7. **Fix loop.** On your own PR, a `fail` re-enters the fix loop ([`fix-loop.md`](./fix-loop.md)): fix, commit, re-run step 4 for that AC, render again.

## `runs.json`

```json
{
  "AC-1": { "command": "pnpm vitest run render-lib -t 'TEMP'", "before": "fail", "after": "pass", "evidence": "1 failed → 1 passed" },
  "AC-2": { "command": "pytest -k utf8", "before": "n/a", "after": "pass", "evidence": "1 passed; base has no configure_stdio to import" },
  "AC-3": "pass"
}
```

`after` is required: `pass`, `fail`, or `unsatisfiable`.
`before` is `fail`, `pass`, or `n/a`.
A bare string is `after` alone, which is the shape `run-checks.mjs --statuses` prints, so a Full run's sealed checks can be rendered as they are.
A run for an ID the brief lacks, or an unknown `after`, is refused.

## Rules

- **Run it, then record it.** Every `pass` comes from a command you ran on this head, and `evidence` is copied from its output. A suite exit code is never spread across criteria it did not test.
- **One format.** Only `verify-comment.mjs` writes the regions. Never hand-write an evidence section in the PR body: nothing reads it, and the gate refuses a PR that has only that.
- **A pass that also passes on the base proves nothing about the change.** Keep it, but expect `⚠️`. Tighten the test when you can.
- **Mocked platforms are named.** A Windows-only fix proven by a test that mocks `win32` is `pass` with `evidence` saying `mocked win32`, and the report's open items say what a real machine still has to confirm.
