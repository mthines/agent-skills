---
title: Apply Mode — gated approach rewrite
impact: HIGH
tags:
  - optimize-approach
  - apply
  - auto-fix
  - confidence-gate
  - revert-on-failure
---

# Apply Mode

Apply the top `suboptimal` proposal to the working tree — but only behind a confidence gate, scoped to the diff's files, with revert-on-failure.
Apply mode runs **only in own-work contexts** (`caller` ∈ {`reviewer` Fix / Self-Review, `polish`}, or standalone `/optimize-approach apply`).
It is **never** used by `pr-reviewer` — cross-review proposes, it does not rewrite someone else's PR.

This mirrors the confidence-gated self-modifying precedents already in this repo: `code-quality simplify`'s Class M apply and `test-provenance-guard --fix` both gate a code change on `confidence(code) ≥ 90 %` plus a mechanical post-check with revert.

## Contents

- [Preconditions](#preconditions)
- [The gate](#the-gate)
- [Apply procedure](#apply-procedure)
- [Forbidden targets](#forbidden-targets)
- [When the gate fails](#when-the-gate-fails)
- [Hard rules](#hard-rules)

## Preconditions

Apply at most **one** proposal per invocation — the highest-impact `suboptimal` unit from O4.
Do not apply a proposal unless **all** hold:

1. `apply_safe: true` on the proposal record — the rewrite is mechanical enough to state precisely, contained to files already in the diff, and changes no public/exported API or type.
2. `analysis_confidence ≥ 90 %` from O4 (the alternative is well understood).
3. The target files are not on the [forbidden-targets](#forbidden-targets) list.

If any precondition fails, do **not** apply — fall back to a report-mode proposal (see [When the gate fails](#when-the-gate-fails)).

## The gate

Before writing anything, run `Skill("confidence", "code")` against the concrete rewrite (the proposed edit + the surrounding hunk):

- **≥ 90 %** — proceed to the apply procedure.
- **< 90 %** — refuse the apply; emit the proposal as a report-mode finding instead.

The `confidence(code)` gate scores whether the *implemented rewrite* is correct; the `confidence(analysis)` gate from O4 scored whether the *alternative approach* is right. Both must pass — analysis first, code second.

## Apply procedure

1. Apply the rewrite with `Edit` / `Write`, scoped to the diff's files only.
2. Run a **scoped check** — targeted tests for the changed files plus a type-check on those files (e.g. `pnpm test <changed>.test.ts`, `tsc --noEmit` scoped, `pytest <changed>_test.py`). Never a whole-workspace verify.
3. **On green** — keep the change. Record it in the run output (axis, files, one-line summary).
4. **On red** — revert the rewrite immediately (`git checkout -- <files>` for committed baselines, or undo the edits), and downgrade to a report-mode proposal tagged `apply-reverted: <check that failed>`. Never leave the working tree broken.

Apply mode does not commit. The calling context (`polish`, reviewer, or the user) owns committing — this keeps the rewrite revertible as its own reviewable unit.

## Forbidden targets

Never auto-apply an approach rewrite that touches any of these, even at high confidence — surface a proposal instead:

- Database migrations.
- Lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, …).
- Generated / vendored files.
- Environment / secret files (`.env*`).
- Test snapshots.
- Any file outside the current diff's changed-file set.
- Any change to a public / exported API signature or type (that is a coordinated change, always `apply_safe: false`).

## When the gate fails

A refused apply is not a failure of the run — it is the safe path.
Emit the proposal exactly as report mode would (see [`report-mode.md`](./report-mode.md)), tagged with why the apply was withheld:

```yaml
apply_withheld: low-confidence | not-apply-safe | forbidden-target | apply-reverted
```

The user (or the calling skill) then decides whether to make the approach change by hand.

## Hard rules

- **Never apply below `confidence(code) ≥ 90 %`.** The gate is non-skippable inside the loop; the `--no-confidence-gate` override is reserved for explicit human slash invocations and is never set by a calling agent.
- **Never weaken or delete tests, disable lint/type rules, or use `--no-verify`** to make a rewrite pass. A rewrite that only passes by weakening a check is reverted.
- **Never widen blast radius.** Contained-to-diff-files is a hard boundary; a rewrite that would need edits outside the diff is `apply_safe: false`.
- **Never leave the tree broken.** Every failed scoped check reverts the rewrite before the run ends.
- **One apply per invocation.** Apply mode does not loop; remaining proposals are reported, not applied.
