# Mechanical gate errors

Load when a mechanical gate in `SKILL.md` fails — Step 5a (reproduction), Step 6.pre (protected
branch), or Step 7.pre (draft PR).
Emit the matching block verbatim, filling the `<…>` slots, then follow its routing.
None of these gates has a force-proceed.

## Contents

- [Step 5a — Reproduction gate](#step-5a--reproduction-gate)
- [Step 6.pre — Branch pre-flight](#step-6pre--branch-pre-flight)
- [Step 7.pre — Draft PR assertion](#step-7pre--draft-pr-assertion)

## Step 5a — Reproduction gate

Route back to Phase 2.5 after emitting:

```text
Phase 5 gate failed: Phase 2.5 did not produce a gate-eligible reproduction.

Bug-notes ledger says:
  Path:   <verbatim from ledger or "missing">
  Status: <verbatim from ledger or "missing">
  Reason: <verbatim from ledger or "missing">

A reproduction must satisfy one of:
  1. Runnable test at repro/<id>.<test-ext> with Status "failing on HEAD as expected"
  2. Best-effort marker at repro/<id>.md with Status "best-effort" AND
     Reason in {race, production-only, heisenbug, visual, performance}

Returning to Phase 2.5. Re-invoke /tdd, /e2e-testing, or /e2e-testing-mobile,
or explicitly document a best-effort reason from the closed list above.
The forbidden self-justifications ("small diff", "pattern exercised elsewhere",
"scaffolding overhead", "would duplicate the fix") are not valid reasons —
see rules/reproduction.md § Forbidden reasons to skip Phase 2.5.

There is no force-proceed below this gate.
```

The closed list of best-effort reasons is taken verbatim from
[`reproduction.md`](./reproduction.md): `race`, `production-only`, and `heisenbug` from
[Best-effort fallback](./reproduction.md#best-effort-fallback); `visual` and `performance` from
rows 7–8 of the [layer routing table](./reproduction.md#layer-routing).
The gate widens only when the spec widens — never inline.

## Step 6.pre — Branch pre-flight

Refuse to proceed after emitting:

```text
Phase 6 gate failed: working on protected branch `<branch>`.

Phase 6 implementation work happens inside an isolated worktree on a fix/* branch,
dispatched via `aw-executor` (which opens a draft PR). Editing files inline on a
protected trunk branch bypasses:
  - worktree isolation
  - draft PR creation
  - Phase 7 verification against a draft PR

Run `gw checkout fix/<slug>` first, then re-enter Phase 6. There is no force-proceed
below this gate — committing implementation work directly to a protected branch is
forbidden by hard invariant in rules/diagnostic-surface.md.
```

The protected-branch list matches default trunk conventions and no private feature branch.
If a project uses a non-standard trunk name, extend the closed list in `SKILL.md` Phase 6 — never inline.

## Step 7.pre — Draft PR assertion

Fail closed after emitting:

```text
Phase 7 gate failed: no draft PR exists for branch `<branch>`.

`gh pr view` returned: <verbatim output or "MISSING">

Phase 6 dispatch must produce a draft PR via `Task(subagent_type="aw-executor", ...)`.
If you find that:
  - You are still on a protected branch (main / master / develop / trunk)
  - Implementation files were edited inline by the main agent
  - `git log` shows implementation commits already on a protected branch
…then Phase 6 was bypassed. Phase 7 verification cannot run in this state.

Recovery:
  1. Revert / cherry-pick the implementation off the protected branch (manual — destructive).
  2. Run `gw checkout fix/<slug>` to create the worktree.
  3. Re-enter Phase 6 via the documented dispatch path (Step 6.main).
  4. Phase 7 will re-run once aw-executor produces the draft PR.

Skipping Phase 7 verification on the grounds of "diff is small", "pattern matches existing code",
or "verification is for diff-sanity grading only" is forbidden — see
rules/diagnostic-surface.md hard invariants.
```
