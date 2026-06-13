---
title: Simplify Mode — Review-Then-Apply for End-of-Feature Cleanup
impact: HIGH
tags:
  - simplify
  - refactor
  - auto-apply
  - end-of-feature
  - confidence-gated
---

# Simplify Mode

A fourth mode of `code-quality` that **applies** mechanical refactors after a feature is delivered, instead of only reporting them like `review` mode does.
Invoked with `Skill("code-quality", "simplify")` (default safe partition) or `Skill("code-quality", "simplify aggressive")` (also auto-applies Medium-impact mechanical recipes).

This mode is designed to run **once at the end of a feature** — after the implementation is correct, tests are green, and the diff is roughly the shape it will ship in.
Use it as the final pass before opening a PR.

The contract: every write is gated by `Skill("confidence", "code") ≥ 90 %` and a scoped fast-check (TS / lint on touched files), one recipe at a time, with automatic revert on failure.
This is the same gate `test-provenance-guard --fix` uses for autonomous mutation; see `autonomous-workflow/CLAUDE.md` § *Confidence-gated autonomous action — design intent*.

---

## When to use

| Situation | Mode |
|---|---|
| After a feature is implemented and tests are green, before opening the PR | `simplify` |
| During interactive review, want a list of findings to discuss | `code` / `review` |
| Before any code is written | `plan` |
| While writing new code | authoring (no argument) |

Invocation:

```
Skill("code-quality", "simplify")              # safe partition (default): only mechanical recipes
Skill("code-quality", "simplify aggressive")   # also auto-applies medium-impact mechanical recipes
Skill("code-quality", "simplify dry-run")      # runs the partition, reports, but never writes
Skill("code-quality", "simplify <path>")       # scope to a specific path instead of the diff
```

Default scope: files in `git diff --name-only main...HEAD` (or `git diff --name-only HEAD~1..HEAD` if not on a feature branch).
Path scope is whatever the user passes.

---

## Procedure

### Step 1 — Run the review pass

Run the standard `review` procedure from [`procedure.md`](./procedure.md) § *Review Mode* against the scoped files.
Produce the full Output Contract structure: High / Medium / Low / Maintainability / Correctness / Testability sections.
**Do not write anything yet.** This step exists so the partition in Step 2 has named findings to work from.

### Step 2 — Partition findings by recipe class

Walk every finding produced in Step 1 and tag it `mechanical` or `judgment` using the table in [`refactor-recipes.md`](./refactor-recipes.md) § *Recipe Class — Mechanical vs Judgment*.

A finding is `mechanical` only if **all four** hold:

1. It cites a recipe ID classified as Mechanical (Class M).
2. The transformation is **structural** — no naming change, no architectural move, no API redesign across modules.
3. The change footprint is **inside the scoped files** (no cascading edits to callers in other files), unless the recipe explicitly covers cross-file replacement (R2 Hoist Shared Constant, where the move is into a single new home and call sites swap import).
4. The recipe's *Trigger* is unambiguously present (e.g., R6 requires both a `type Foo = ...` and a `fooSchema = ...` for the same shape — partial matches do not qualify).

Anything that doesn't satisfy all four is `judgment`, regardless of recipe ID.

"Impact" here refers to the **finding-impact** bucket from Step 1's review pass (`### High Impact` / `### Medium Impact` / `### Low Impact` in the Output Contract — the impact of a *finding*, not the recipe). The same recipe (say R1 Consolidate Parallel Maps) can surface as High in one file and Low in another depending on visibility and blast radius.

- **Default mode** applies only `mechanical` findings in the **High** Impact bucket.
- **`aggressive`** also applies `mechanical` findings in the **Medium** Impact bucket.
- `mechanical` findings in the **Low** Impact bucket are never auto-applied; they stay as proposals (Low impact + auto-apply is a poor tradeoff — small wins, real risk of churn).

### Step 3 — Order recipes for safe application

Apply in this order, then by file path. Earlier recipes shrink later recipes' surface area; later recipes risk re-introducing patterns earlier ones removed.

1. **R35** Trim Verbose Comment — independent of any code change; reduces noise before everything else.
2. **R13** Inline the Premature Sub-Schema — collapses single-use sub-schemas first so the parent schema is fully expanded before R6 takes its inferred type. Running R6 first would freeze the sub-schema as a referenced identifier in the inferred type and leave a half-migrated shape.
3. **R6** Replace Type Declaration with Inferred Type — now safe to run because R13 has consolidated the schema shape.
4. **R7** Replace Validation with Schema — replaces hand-rolled checks with the now-canonical schema.
5. **R17** Justify or Remove the `any` — only the **remove** branch is mechanical (deletes the `as Foo` / `any` cast once a schema parse exists at the boundary). The **justify** branch (writing a `// because:` comment) is Class J and stays as a proposal.
6. **R2** Hoist Shared Constant — single-source-of-truth move, late so it picks up constants introduced by earlier recipes.
7. **R1** Consolidate Parallel Maps — structural merge of N maps into one record.

R3, R4, and R14 are intentionally absent — they are Class J (see [`refactor-recipes.md`](./refactor-recipes.md#recipe-class--mechanical-vs-judgment)) and are proposed but never auto-applied.

If a recipe's Trigger is no longer satisfied after an earlier recipe ran (e.g., R6 already collapsed the type declaration so R7 has nothing to do), skip it silently and continue.

### Step 4 — Apply one recipe at a time, behind the gate

For each `mechanical` finding in order:

1. **Construct the diff** — produce the unified diff for this single finding. Do not batch findings into one diff; one recipe = one commit-able unit.
2. **Run `confidence(code)`** against the diff with the question *"Does this diff correctly apply ${R-ID} (${recipe name}) to the cited finding, with no behaviour change and no unintended side effects?"*
3. **Decision:**
   - `confidence ≥ 90 %` → apply the diff and proceed.
   - `confidence < 90 %` → demote the finding to a proposal in the output; do not write; continue to the next finding.
4. **Fast-check the touched files** — run the project's TS compiler in `--noEmit` mode and the linter, scoped to the touched files only. Whole-project commands are forbidden (Sub-Agent Resource Discipline; see `autonomous-workflow/rules/parallel-coordination.md#sub-agent-resource-discipline`).
   - Fast-check passes → continue.
   - Fast-check fails → `git checkout -- <touched-files>` (revert just this recipe's writes), demote the finding to a proposal with a `revert-reason:` note, continue to the next finding.
5. **Run the scoped test command** if the recipe's Trigger row in `refactor-recipes.md` requires it (default: skip — Step 6 runs the suite once at the end).

### Step 5 — Halt conditions

Stop applying recipes and finalize the report if any of these fire:

- **Five consecutive reverts** (default mode) or **three consecutive reverts** (`aggressive` mode) — the partition is wrong; the remaining diff is risk-only. Demote everything still pending to proposals. The cap is tighter in `aggressive` because the Medium-impact bucket already carries more risk per finding; mirrors the `autonomous-workflow` Lite (3) / Full (5) mode-aware cap.
- **Confidence gate misses five times in a row** (default) or **three** (`aggressive`) — the diff structure is noisy; the gate's signal is that the rest needs human judgment.
- **The user invoked with `dry-run`** — never write past Step 4 (`confidence` is still computed so the report has scores).
- **The fast-check command is unavailable** (no `tsc`, no `lint` script) — `simplify` requires the fast-check to be runnable; without it, switch to dry-run and report.

### Step 6 — Final whole-diff verification

After all `mechanical` findings are processed (applied, demoted, or skipped), run the project's full test command **once** against the cumulative diff (this is the orchestrator-only whole-project boundary explicitly permitted by Sub-Agent Resource Discipline at end-of-phase).

- Tests pass → keep all applied recipes; emit the final report.
- Tests fail → identify the last applied recipe before the failure, revert it (`git checkout -- <its files>` or `git restore --staged`), re-run; repeat until green or until all applied recipes are reverted. Demote each reverted recipe to a proposal with `revert-reason: post-apply-test-failure`.

### Step 7 — Emit the report

Use the Output Contract in the next section.

---

## Mechanical recipe whitelist

`simplify` only auto-applies recipes flagged **Class M (Mechanical)** in the [Recipe Class table](./refactor-recipes.md#recipe-class--mechanical-vs-judgment) — that table is the single source of truth. Do not duplicate the list here; the L1 eval guards the table against drift (`G7 every recipe in Contents has a class`).

Class J recipes need architectural taste, naming decisions, semantic judgment, or cross-module redesign that confidence scoring on a structural diff cannot validate — propose, never apply.

When a new recipe is added to `refactor-recipes.md`, classify it explicitly in the table. Default for an un-classified recipe is **Judgment** — `simplify` does not auto-apply recipes it has not been told are safe. L1 will flag an un-classified recipe in CI.

---

## Output Contract

```
## Code Quality Simplify: [target]
Mode: simplify | simplify aggressive | simplify dry-run
Scope: <N files in diff main...HEAD>  (or <path>)

### Applied (auto-written, gate-passed)
- [file:line] R<ID> <recipe-name> — confidence: <score>%
  - Touched: <files>
  - Fast-check: pass
  ```diff
  <unified diff for this recipe>
  ```

### Demoted to proposal (gate failed or revert)
- [file:line] R<ID> <recipe-name> — confidence: <score>%
  - Reason: <below-threshold | fast-check-failed | post-apply-test-failure>
  - Proposed diff:
  ```diff
  <unified diff>
  ```

### Judgment proposals (not auto-applyable — needs human decision)
- [file:line] R<ID> <recipe-name>
  - <one-line description of the change>
  - <reason this is Judgment-class: naming, architectural, cross-module, etc.>

### Maintainability findings (proposals)
- [file:line] [duplicated concept / parallel maps / shotgun-surgery risk] → R<ID>
- [estimated change footprint for the next obvious variant: N files, type-checked? yes/no]

### Correctness findings (proposals, when relevant)
- [file:line] [idempotency / money / dates / determinism / async / resources] → R<ID>

### Testability findings (proposals, when relevant)
- [file:line] [hard-to-test surface, missing injection, coupled to global state] → R<ID>

### Verification
- Final test run: <pass | fail (N reverts applied)>
- Final scoped TS / lint: pass

### Summary
- Applied: <N> recipes across <M> files
- Demoted: <N> recipes
- Proposals: <N> judgment-class items for review
- Halted: <reason if halted before completing the partition>
```

The `Applied` section is the **only** section where this mode has written to disk.
Everything else (`Demoted`, `Judgment proposals`, `Maintainability`, `Correctness`, `Testability`) is identical in shape to the `review` mode output — a user can apply them by hand or by re-invoking on a narrower scope after addressing the judgment-class items.

---

## Safety rules (load-bearing — do not relax)

1. **One recipe at a time.** Never bundle two recipes into one diff. Confidence cannot reason about the joint correctness of two independent transformations.
2. **Scoped fast-check between recipes, full test suite at end.** Whole-project commands inside the loop are forbidden (Sub-Agent Resource Discipline). The single full test run at Step 6 is the only orchestrator-level boundary.
3. **Revert on any check failure.** A reverted recipe is demoted, never retried with a different prompt. The signal is "this transformation is not as mechanical as the recipe class suggested in this context".
4. **Never write under `dry-run`.** Confidence scoring still runs so the report carries scores; writes do not.
5. **Never apply Class J recipes.** Even if confidence is 99 %, judgment recipes stay as proposals. The class is the contract; confidence does not override it.
6. **Never delete tests.** A test deletion that "fixes" a fast-check failure is a P0 anti-pattern (mirrored from `bug-fix-verifier`'s diff-sanity rule). If a fast-check failure is rooted in a test file, the revert is mandatory.
7. **Never modify a docstring's contract block.** R35 trims prose; the JSDoc / TSDoc / Python docstring summary line and structured tags (`@param`, `@returns`, etc.) are part of the API surface and must be preserved. See `comments.md` § *Docstrings → Hard rule for auto-fix runs*.

---

## Boundary with the `reviewer` agent Fix Mode

`reviewer`'s **Fix Mode** (own branch, no PR) also auto-applies fixes to owned files — its scope is lint / typo / dead-code class fixes ([`agents/reviewer/rules/auto-fix-policy.md`](../../../../agents/reviewer/rules/auto-fix-policy.md)). Both tools can land on the same lines (R35 ↔ "verbose comment", R17 remove ↔ "dead code", R2 ↔ "duplicated constant").

Sequencing rule when both are invoked on the same diff:

1. **`reviewer` Fix Mode runs first.** Reviewer's auto-fix set is a strict subset of what `simplify` covers, and Reviewer's checks include lint-class fixes that may shift line numbers `simplify` keys on.
2. **`simplify` runs second.** After Reviewer finishes (or if Reviewer is not invoked at all), `simplify` operates on the post-Reviewer working tree.
3. **Never invoke them in parallel.** Both write to owned files. There is no shared lock; concurrent writes produce a corrupted working tree.

If a `simplify` finding's file:line was already touched by Reviewer in this session, `simplify` must re-run the review pass (Step 1) on that file before applying — the cached finding may be stale.

---

## Integration with autonomous-workflow

`simplify` is **not** invoked from `autonomous-workflow` Phase 3 by default.
Phase 3 keeps the existing `Skill("code-quality", "code")` call (audit-only) so the planner / executor cycle does not silently rewrite the diff before the user has seen it.

Two opt-in paths exist:

1. **`plan.md` flag.** A plan that includes `auto_simplify: true` in its frontmatter triggers `Skill("code-quality", "simplify")` at the end of Phase 3, after the existing `code` invocation, before Phase 4 testing. The Phase 4 test pass then validates the post-simplify diff.
2. **Manual end-of-feature step.** A user calls `Skill("code-quality", "simplify")` themselves after the workflow finishes, before opening the PR.

Both paths produce the same Output Contract; the `plan.md` flag is the way to make `simplify` part of the standard workflow without making it mandatory.

When invoked under `autonomous-workflow`, `simplify` writes its report to `.agent/{branch}/simplify-{ts}.md` in addition to returning it.

---

## Cross-references

- [`refactor-recipes.md`](./refactor-recipes.md) — recipe definitions and the Class table.
- [`procedure.md`](./procedure.md) § *Review Mode* — the review pass `simplify` runs in Step 1.
- [`output-contract.md`](./output-contract.md) — the `review` output shape that `simplify`'s proposal sections mirror.
- `Skill("confidence", "code")` — the gate at Step 4.
- `autonomous-workflow/rules/parallel-coordination.md#sub-agent-resource-discipline` — why fast-checks are scoped, not whole-project.
- `autonomous-workflow/CLAUDE.md` § *Confidence-gated autonomous action — design intent* — the broader pattern this mode follows.
