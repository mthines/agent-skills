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
Invoked with `Skill("code-quality", "simplify")` (default safe partition), `Skill("code-quality", "simplify aggressive")` (also auto-applies Medium-impact mechanical recipes), or `Skill("code-quality", "simplify deep")` (also auto-applies **Class J judgment** recipes — dedup-by-extraction, structural, type-driven — behind a stricter **test-backed** gate).

This mode is designed to run **once at the end of a feature** — after the implementation is correct, tests are green, and the diff is roughly the shape it will ship in.
Use it as the final pass before opening a PR.

The contract: every write is gated by `Skill("confidence", "code") ≥ 90 %` and a scoped fast-check (TS / lint on touched files), one recipe at a time, with automatic revert on failure.
This is the same gate `test-provenance-guard --fix` uses for autonomous mutation; see `autonomous-workflow/CLAUDE.md` § *Confidence-gated autonomous action — design intent*.

---

## When to use

| Situation | Mode |
|---|---|
| After a feature is implemented and tests are green, before opening the PR | `simplify` |
| Same, but you want the bigger structural / dedup / type-driven refactors applied too — and the code is well tested | `simplify deep` |
| During interactive review, want a list of findings to discuss | `code` / `review` |
| Before any code is written | `plan` |
| While writing new code | authoring (no argument) |

Invocation:

```
Skill("code-quality", "simplify")              # safe partition (default): only mechanical recipes
Skill("code-quality", "simplify aggressive")   # also auto-applies medium-impact mechanical recipes
Skill("code-quality", "simplify deep")         # also auto-applies Class J judgment recipes behind the test-backed gate (implies aggressive)
Skill("code-quality", "simplify deep --characterize")  # deep, but write+provenance-check a characterization test for an untested runtime refactor instead of demoting it
Skill("code-quality", "simplify dry-run")      # runs the partition, reports, but never writes
Skill("code-quality", "simplify <path>")       # scope to a specific path instead of the diff
```

`deep` is the "make the bigger changes" tier: it auto-writes the structural, deduplicating, and type-driven refactors that `simplify` / `simplify aggressive` only ever *propose*.
It is gated harder than the mechanical tiers — see [§ Deep tier — auto-applying Class J behind a test-backed gate](#deep-tier--auto-applying-class-j-behind-a-test-backed-gate).
`deep` composes with `dry-run` (`simplify deep dry-run`), with a path (`simplify deep <path>`), and with `--characterize` (see [§ `--characterize`](#--characterize--write-the-missing-test-instead-of-demoting)).

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
- **`deep`** applies everything `aggressive` does (High + Medium `mechanical`) **and** also applies `judgment` (Class J) findings in the **High** and **Medium** Impact buckets — but only through the extra test-backed gate in [§ Deep tier](#deep-tier--auto-applying-class-j-behind-a-test-backed-gate). A `judgment` finding that cannot clear that gate stays a proposal exactly as in the other tiers.
- `mechanical` findings in the **Low** Impact bucket are never auto-applied; they stay as proposals (Low impact + auto-apply is a poor tradeoff — small wins, real risk of churn). `judgment` findings in the **Low** bucket are likewise never auto-applied, even in `deep`.

### Step 3 — Order recipes for safe application

Apply in this order, then by file path. Earlier recipes shrink later recipes' surface area; later recipes risk re-introducing patterns earlier ones removed.

1. **R35** Trim Verbose Comment — independent of any code change; reduces noise before everything else.
2. **R13** Inline the Premature Sub-Schema — collapses single-use sub-schemas first so the parent schema is fully expanded before R6 takes its inferred type. Running R6 first would freeze the sub-schema as a referenced identifier in the inferred type and leave a half-migrated shape.
3. **R6** Replace Type Declaration with Inferred Type — now safe to run because R13 has consolidated the schema shape.
4. **R7** Replace Validation with Schema — replaces hand-rolled checks with the now-canonical schema.
5. **R17** Justify or Remove the `any` — only the **remove** branch is mechanical (deletes the `as Foo` / `any` cast once a schema parse exists at the boundary). The **justify** branch (writing a `// because:` comment) is Class J and stays as a proposal.
6. **R2** Hoist Shared Constant — single-source-of-truth move, late so it picks up constants introduced by earlier recipes.
7. **R1** Consolidate Parallel Maps — structural merge of N maps into one record.

R3, R4, and R14 are intentionally absent from the list above — they are Class J (see [`refactor-recipes.md`](./refactor-recipes.md#recipe-class--mechanical-vs-judgment)) and are never auto-applied in the mechanical tiers (`simplify` / `simplify aggressive`). In **`deep`**, Class J recipes ARE applied, in a second ordered wave after the mechanical wave above completes — see [§ Deep tier](#deep-tier--auto-applying-class-j-behind-a-test-backed-gate) for the deep ordering.

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

- **Five consecutive reverts** (default mode), **three consecutive reverts** (`aggressive` mode), or **two consecutive reverts** (`deep` mode) — the partition is wrong; the remaining diff is risk-only. Demote everything still pending to proposals. The cap tightens as the tier gets more aggressive because each tier's marginal finding carries more risk; mirrors the `autonomous-workflow` Lite (3) / Full (5) mode-aware cap. `deep`'s cap of two is deliberately unforgiving — a second reverted judgment refactor is a strong signal the code is not shaped for autonomous restructuring.
- **Confidence gate misses five times in a row** (default), **three** (`aggressive`), or **two** (`deep`) — the diff structure is noisy; the gate's signal is that the rest needs human judgment.
- **The user invoked with `dry-run`** — never write past Step 4 (`confidence` is still computed so the report has scores).
- **The fast-check command is unavailable** (no `tsc`, no `lint` script) — `simplify` requires the fast-check to be runnable; without it, switch to dry-run and report.

### Step 6 — Final whole-diff verification

After all `mechanical` findings are processed (applied, demoted, or skipped), run the project's full test command **once** against the cumulative diff (this is the orchestrator-only whole-project boundary explicitly permitted by Sub-Agent Resource Discipline at end-of-phase).

- Tests pass → keep all applied recipes; emit the final report.
- Tests fail → identify the last applied recipe before the failure, revert it (`git checkout -- <its files>` or `git restore --staged`), re-run; repeat until green or until all applied recipes are reverted. Demote each reverted recipe to a proposal with `revert-reason: post-apply-test-failure`.

### Step 7 — Emit the report

Use the Output Contract in the next section.

---

## Deep tier — auto-applying Class J behind a test-backed gate

`deep` is the only tier that auto-writes **Class J (judgment)** recipes. It exists because the highest-value cleanups — deduplicating real logic into a shared function, extracting by abstraction level, restructuring conditionals, branding raw primitives, lifting illegal states into discriminated unions — are all Class J, so the mechanical tiers only ever *propose* them and the branch stays subtly un-cleaned. (The Class M type-driven recipes — R6 schema-inferred types, R7 boundary validation — are already auto-applied even by the default tier; `deep` adds the *judgment* type work on top.)

The whole tier rests on one substitution: **a mechanical recipe is proven safe by confidence on its structural diff; a judgment recipe is proven safe by evidence that observable behaviour did not change.** `deep` refuses to write a judgment refactor unless it can produce that evidence. No evidence ⇒ the finding stays a proposal, exactly as in the mechanical tiers.

### Deep runs in two waves

1. **Mechanical wave** — run Steps 3–6 exactly as the mechanical tiers do (Class M, High + Medium impact). This shrinks the surface first: dead code goes, comments trim, schemas collapse — so the judgment wave operates on the cleanest possible tree.
2. **Judgment wave** — only after the mechanical wave finalizes, apply **Class J** findings (High + Medium impact) in this order, then by file path. **Every recipe in this wave is Class J.** The Class M recipes — R1, R2 (dedup), R6, R7 (type-driven), R13, R17-remove, R35 (comments) — were already applied in the mechanical wave and never reappear here; that is the wave partition, and it exactly mirrors the [Recipe Class table](./refactor-recipes.md#recipe-class--mechanical-vs-judgment).
   1. **R17 justify** — comment-only (`// because:` on a genuinely-needed type escape). Zero behavioural surface. (R35, being Class M, is fully handled in the mechanical wave — it does not run here.)
   2. **Type-driven (Class J)** — **R11** (brand the primitive), **R15** (lift illegal state out of the type). Compiler-provable (see the evidence table below). **R12** (discriminate the error union) is type-driven in spirit but changes runtime error shape, so it verifies as runtime, in step 4.
   3. **Structural / dedup (Class J)** — **R5** (co-locate), **R16** (extract by abstraction level), **R4** (extract guarded function), **R3** (conditional → lookup). Runtime-behaviour changes — the test-backed gate is load-bearing here.
   4. **Total-ising / error shape (Class J)** — **R10** (total-ise the function), **R12** (discriminate the error union). Change call-site contracts; apply last so they reflect the fully-restructured tree.

   R14 (Replace Boolean Parameter with Two Functions) stays a proposal even in `deep` unless **every** call site is inside the scoped files (static caller-graph check) — a deleted signature that a caller outside scope depends on is exactly the confident-but-wrong trap documented in `refactor-recipes.md`. Any other Class J recipe not listed above (R8, R9, R18–R34) likewise stays a proposal in `deep` — the four waves above are deep's *complete* auto-apply set; everything else needs a human. Same for any recipe whose footprint the evidence gate below cannot bound.

### The per-finding gate (judgment wave)

For each Class J finding, in order, run these checks. **Any miss demotes the finding to a proposal — never a partial write.**

1. **Construct the single-finding diff.** One recipe = one unit. Never batch (Safety rule 1 still holds).
2. **Confidence.** Run `Skill("confidence", "code")` asking *"Does this diff correctly apply ${R-ID} to the cited finding with no change to observable behaviour?"* Require **≥ 90 %**. Below ⇒ demote.
3. **Establish the behaviour-preservation evidence** for this recipe's kind, using the table below. This is the check the mechanical tiers do not have. If the required evidence cannot be produced, **demote — do not write.**
4. **Apply the diff.**
5. **Verify against the evidence, revert on any failure.** Run the evidence command scoped to the touched files. Green ⇒ keep. Red ⇒ `git checkout -- <touched-files>`, demote with `revert-reason:`, continue.
6. Halt caps from Step 5 apply (two consecutive reverts / two consecutive gate misses ends the wave).

After the judgment wave, run the **Step 6 final whole-diff test suite once** over the cumulative diff (mechanical + judgment). A post-apply failure reverts the last applied recipe and re-runs until green, same as the mechanical tiers.

### Evidence required, by recipe kind

| Recipe kind | Recipes | Behaviour-preservation evidence (Step 3/5 above) | If evidence is absent |
|---|---|---|---|
| **Compiler-provable** (type-level only; no runtime branch, timing, or value change) | R11, R15 | Scoped `tsc --noEmit` (or the project's type-checker) is **green** on the touched files. The type system is the proof — no runtime test needed. | Type-checker unavailable ⇒ demote (cannot prove). |
| **Runtime-behaviour** (extraction, dedup, control-flow, total-ising, error shape) | R3, R4, R5, R10, R12, R16 | **A passing test that exercises the touched symbols.** Locate it: grep the scoped test files for the changed export / function name, or use the project's coverage map if configured. Run that test (scoped) before **and** after the diff — it must be green both times (green-before proves it actually reaches this code; green-after proves the refactor preserved behaviour). | **No covering test ⇒ demote with `reason: no-covering-test`. Never write a runtime refactor blind.** |

Every recipe in this table is Class J (the deep judgment wave's auto-apply set). The Class M type-driven recipes R6 / R7 and dedup recipes R1 / R2 are proven by confidence on the structural diff in the mechanical wave — they do not need, and do not appear in, this evidence table.

**Why green-before matters:** a test that was already red, or one that does not actually execute the refactored path, proves nothing about preservation. Requiring green-before-and-after is what makes "the tests protect the business logic" true rather than aspirational.

### `--characterize` — write the missing test instead of demoting

Invoked as `Skill("code-quality", "simplify deep --characterize")`. This is a **first-class argument of `simplify deep`** — the capability lives here, in the engine that hits the untested-refactor fork. Orchestrators (`polish`, `create-pr`) only forward the flag; they own none of this behaviour.

**Default (no `--characterize`): demote.** `deep` does **not** silently write tests — that expands the diff with unreviewed test code and can encode the *current* (possibly buggy) behaviour as gospel. A runtime-behaviour finding with no covering test is demoted with `reason: no-covering-test`.

**With `--characterize`:** for a **runtime-behaviour** finding (R3, R4, R5, R10, R12, R16) that has no covering test, `deep` may first pin the behaviour, then refactor behind it. The sequence, per finding:

1. **Write a characterization test** that captures the touched symbol's *current* observable output — call the real production symbol, assert on what it returns / emits today. Do not read the refactored version (it does not exist yet).
2. **Green-before check.** Run the new test against the unmodified production code — it must **pass**. A characterization test that does not pass against today's code is not characterizing anything; discard it and demote the finding (`reason: characterization-unstable`).
3. **Provenance gate — delegate to `test-provenance-guard`.** Run the mutation check from [`test-provenance-guard`](../../test-provenance-guard/SKILL.md): the test must **import the production symbol** (not shadow a private copy), and when the production function body is blanked the test must **fail**. A test that stays green under a blanked body is a **test-by-construction** — it proves nothing about the refactor. If the provenance gate does not go red, **discard the test and demote the finding** with `reason: characterization-by-construction`. Never keep a fake test to unlock a refactor. **Restore the production body the instant the mutation check reports** — the blank is a transient probe (the guard's own [`rules/mutation-check.md`](../../test-provenance-guard/rules/mutation-check.md) pairs every sabotage with a restore); step 4's commit and step 5's refactor must run against intact production code, never the blanked version.
4. **Commit the test as its own unit** (message `test: characterize <symbol> before deep refactor`), separate from the refactor commit that follows.
5. **Proceed to the refactor** using this now-trusted test as the runtime evidence in the [per-finding gate](#the-per-finding-gate-judgment-wave) — the same green-before-and-after contract as any covering test.

If step 2 or step 3 fails, the finding is demoted, not written — `--characterize` never lowers the safety bar, it only does the extra work to *meet* it. The provenance delegation is what keeps "the tests protect the business logic" honest: a generated test is only allowed to serve as evidence once `test-provenance-guard` has proven it actually exercises production code.

### Deep does not touch correctness findings from a broader review

`deep` auto-writes **recipe-based refactors** only — the structural / type / dedup catalog. It does **not** auto-apply free-form correctness fixes (a missing null check, a wrong comparison, an off-by-one). Those are not recipes, carry no bounded footprint, and belong to the reviewer agent's plan-don't-apply path. If a caller (e.g. `polish deep`) collected correctness items from a reviewer pass, they are surfaced, not fed to this engine.

## Mechanical recipe whitelist

`simplify` only auto-applies recipes flagged **Class M (Mechanical)** in the [Recipe Class table](./refactor-recipes.md#recipe-class--mechanical-vs-judgment) — that table is the single source of truth. Do not duplicate the list here; the L1 eval guards the table against drift (`G7 every recipe in Contents has a class`).

Class J recipes need architectural taste, naming decisions, semantic judgment, or cross-module redesign that confidence scoring on a structural diff cannot validate — propose, never apply.

When a new recipe is added to `refactor-recipes.md`, classify it explicitly in the table. Default for an un-classified recipe is **Judgment** — `simplify` does not auto-apply recipes it has not been told are safe. L1 will flag an un-classified recipe in CI.

---

## Output Contract

```
## Code Quality Simplify: [target]
Mode: simplify | simplify aggressive | simplify deep | simplify dry-run
Scope: <N files in diff main...HEAD>  (or <path>)

### Applied (auto-written, gate-passed)
- [file:line] R<ID> <recipe-name> — confidence: <score>% [— class: M | J (deep)]
  - Touched: <files>
  - Fast-check: pass
  - Evidence: <fast-check only (mechanical) | tsc-green (type-level J) | test <name> green before+after (runtime J)>
  ```diff
  <unified diff for this recipe>
  ```

### Demoted to proposal (gate failed or revert)
- [file:line] R<ID> <recipe-name> — confidence: <score>%
  - Reason: <below-threshold | fast-check-failed | post-apply-test-failure | no-covering-test | callers-out-of-scope | characterization-unstable | characterization-by-construction>
  - Proposed diff:
  ```diff
  <unified diff>
  ```

### Judgment proposals (not auto-applied — needs human decision)
# In deep mode this section holds only the Class J findings that could NOT clear
# the test-backed gate (no covering test, callers out of scope, confidence miss).
# Class J findings that cleared the gate appear under "Applied" tagged "J (deep)".
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
5. **Never apply Class J recipes in the mechanical tiers.** In `simplify` and `simplify aggressive`, judgment recipes stay proposals even at 99 % confidence — the class is the contract and confidence does not override it. Class J is auto-applied **only** in the `deep` tier, and only when the [test-backed gate](#deep-tier--auto-applying-class-j-behind-a-test-backed-gate) produces behaviour-preservation evidence: confidence ≥ 90 % **plus** a compiler-green (type-level) or green-before-and-after covering test (runtime). In `deep`, confidence alone is still never sufficient — the evidence is the contract.
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
