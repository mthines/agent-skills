---
name: polish
description: >
  Re-runnable pre-PR quality gate for the current branch. Composes passes over
  the branch diff: a broad reviewer-agent pass (auto-fixes simple issues, plans
  complex ones) and a code-quality simplify pass. Runs the deep tier by default:
  after the review pass it auto-writes the bigger structural / deduplication /
  type-driven refactors (Class J recipes) behind a test-backed gate — confidence
  ≥ 90 % plus behaviour-preservation evidence (compiler-green for type-level
  recipes, a green-before-and-after covering test for runtime recipes; anything
  unprovable stays a proposal). Scale down explicitly with `simplify` (Class M
  mechanical only), `quick` (light comment/naming/dead-code pass), or `review`
  (reviewer only). Commits each pass separately for traceability (`--no-commit`
  to skip). Use standalone any time mid-development to clean a branch; `/create-pr`
  delegates its pre-push step here, so a default create-pr now runs the deep tier
  (scale down with its `--no-review` / `--quick` / `--no-quality` flags). Triggers
  on "polish my branch", "clean this up before the PR", "review and simplify",
  "deduplicate this branch", "make bigger cleanups", "tidy up", "prep my branch",
  "/polish".
disable-model-invocation: false
argument-hint: '[review|simplify|quick|deep] [--no-commit] [--critical] [--characterize]'
license: MIT
metadata:
  author: mthines
  version: '1.2.0'
  workflow_type: command
  tags:
    - code-quality
    - review
    - simplify
    - refactor
    - pre-pr
    - branch-cleanup
    - reviewer-agent
    - orchestrator
---

# Polish — Re-runnable Branch Quality Gate

Get a branch into clean, reviewable shape **before** it goes up for review — and run it again any time you've made a lot of changes and want to tidy up.

This skill is an **orchestrator**. It does not contain quality rules of its own; it composes existing pieces over the current branch diff:

1. The **`reviewer` agent** — broad own-work review (correctness, holistic intent/system-fit, code-quality, UX). Auto-fixes simple issues; plans complex ones.
2. The **`code-quality` skill in `simplify` mode** — applies refactors one at a time behind `Skill("confidence", "code") ≥ 90 %` and a scoped fast-check, reverting any that fail. By default polish uses the **`deep`** tier (Class M mechanical **and** Class J judgment refactors, the latter behind the extra test-backed gate below); the explicit `simplify` mode uses the mechanical-only tier where Class J stays a proposal.

**The default makes the bigger changes.** Bare `/polish` runs the **deep** tier: after the reviewer pass it delegates to `Skill("code-quality", "simplify deep")`, which auto-writes the highest-value cleanups the mechanical tiers only ever *propose* — deduplicate real logic, restructure control flow, brand raw primitives, lift illegal states into discriminated unions (all Class J recipes). Every such write clears a **test-backed** gate: `Skill("confidence", "code") ≥ 90 %` **plus** behaviour-preservation evidence — compiler-green (`tsc --noEmit`) for type-level recipes, a green-before-and-after covering test for runtime recipes. Anything it cannot prove safe stays a proposal, never a blind write. Tests are the safety net that keeps business logic consistent across the restructure.

If you want a lighter touch, ask for it explicitly: `simplify` (Class M mechanical refactors only, no Class J), `quick` (light comment/naming/dead-code pass), or `review` (reviewer only). Those are the escape hatches from the deep default.

`/create-pr` delegates its pre-push quality step to this skill, so the two never drift — which means a default `/create-pr` now runs the deep tier on the branch before pushing. Scale it down from `create-pr` with `--no-simplify` (review only), `--quick` (light pass), or `--no-quality` (skip). You can also run polish standalone at any point.

## Modes

Parse the **first token** of `$ARGUMENTS`. Everything else is a flag.

| Mode                 | Trigger                          | What runs                                                                                                  |
| -------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **deep** *(default)* | No mode token, or `deep`         | `review` pass, then **`simplify deep`** — Class M mechanical **and** Class J refactors (dedup, structural, type-driven) behind the test-backed gate. The "make the bigger changes" default. |
| `review`             | First token `review`             | Reviewer-agent pass only — auto-fix simple, plan complex.                                                  |
| `simplify`           | First token `simplify`           | `code-quality` simplify pass only, **mechanical Class M only** — no reviewer, no Class J. The lighter escape hatch. |
| `quick`              | First token `quick`              | Light mechanical pass only (comments, naming, dead code). No reviewer agent, no structural refactors.     |

There is no separate `full` mode anymore: the default **is** deep. `deep` remains accepted as an explicit token (same as no token) so existing muscle memory and `/polish deep` keep working.

Flags (compose with any mode):

| Flag             | Effect                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `--no-commit`    | Leave all changes in the working tree instead of committing each pass. Use mid-development to keep iterating. |
| `--critical`     | Pass `--critical` through to the reviewer agent (adversarial pre-mortem). Ignored by `simplify` / `quick`.    |
| `--characterize` | Default/`deep` only. **Pure forwarder** — polish passes it straight to `Skill("code-quality", "simplify deep --characterize")` and owns none of the behaviour. The engine, for a runtime Class J refactor with **no** covering test, writes a characterization test pinning the symbol's current output, **validates it via `test-provenance-guard`** (mutation check — a test-by-construction is discarded), commits it, then refactors behind it — instead of demoting. Ignored by `simplify` / `quick`. |

**Order is fixed in the default/deep mode: `review` first, then `simplify deep`.** The reviewer fixes correctness and obvious cleanups; simplify deep then applies the mechanical and structural refactors to the already-cleaner code, so confidence gates evaluate the final shape.

## Step 0: Resolve mode and preconditions

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "polish: not a git repo"; exit 1; }
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin main --quiet 2>/dev/null || git fetch origin --quiet 2>/dev/null
```

Refuse to run on the default branch — there is no branch diff to polish:

```bash
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "polish: on $BRANCH — check out a feature branch first."
  exit 1
fi
```

Establish the scope and whether there's anything to do:

```bash
git diff --name-only origin/main...HEAD     # files changed on this branch
git diff --stat origin/main...HEAD
```

If the branch diff is empty, print `polish: no changes vs origin/main — nothing to do.` and exit.

If the branch diff is **non-code only** (docs, lockfiles, generated artefacts, asset binaries — decide from the file list, not the line count), print one line and exit: `polish: branch diff is non-code only — skipping.`

## Step 1: Working-tree check

```bash
git status --porcelain
```

- **Clean tree (empty output):** ideal. Each pass's commit contains only that pass's changes.
- **Dirty tree, committing (default):** print a one-line warning — `polish: working tree is dirty; pass commits will include your uncommitted changes. Commit or stash first to keep them separate.` — then continue.
- **Dirty tree, `--no-commit`:** no warning needed; nothing is committed.

Never stash, discard, or reset the user's uncommitted work to "clean up" the tree.

## Step 2: Run the passes

Run only the passes the resolved mode selects (see the Modes table). Each pass below is self-contained.

### Pass A — `review` (modes: default/deep, review)

Dispatch the **`reviewer` agent** as a subagent. It auto-detects its sub-mode from the working tree (own branch with no PR → Fix Mode, auto-fix simple + plan complex; own PR exists → Self-Review, same auto-fix policy). It never writes to GitHub.

```
Agent(
  subagent_type: "reviewer",
  description: "Polish: review + auto-fix current branch",
  prompt: |
    Review the current branch diff against origin/main as own work.
    Auto-fix simple issues directly in the working tree; plan (do not apply)
    complex ones. Do not touch GitHub. Do not weaken or delete tests.
    Return: the verdict, the list of auto-fixed items (one line each), and
    the list of planned-but-not-applied complex items (title + why + files).
    <pass "--critical" here only if the user passed --critical to polish>
)
```

Capture from the agent's reply: the verdict, the auto-fixed list, and the planned-complex list. The planned-complex items are **surfaced to the user**, not applied — they need judgment.

The reviewer runs its own post-fix verification (targeted tests for changed files) and reverts any auto-fix that regresses. Do not re-run a full verify here; trust its gate.

### Pass D — `simplify deep` (modes: default/deep)

The default "make the bigger changes" pass. Runs **after** Pass A (review) on the already-cleaner tree. Invoke the code-quality simplify engine in its `deep` tier:

```
Skill("code-quality", "simplify deep")           # or "simplify deep --characterize" when --characterize was passed to polish
```

`simplify deep` does everything `aggressive` does (High + Medium Class M) **and** auto-writes **Class J** refactors — the dedup-by-extraction, structural, and type-driven changes that the other tiers only propose — behind its **test-backed gate**. Per the engine's contract ([`code-quality/rules/simplify-mode.md` § Deep tier](../code-quality/rules/simplify-mode.md#deep-tier--auto-applying-class-j-behind-a-test-backed-gate)), each Class J write requires:

- `Skill("confidence", "code") ≥ 90 %` on the single-finding diff, **and**
- behaviour-preservation evidence: for the **type-level** Class J recipes (R11, R15) a green scoped `tsc --noEmit`; for the **runtime** Class J recipes (R3, R4, R5, R10, R12, R16) a covering test that is **green before and after** the refactor. (The engine's [Deep tier § evidence table](../code-quality/rules/simplify-mode.md#evidence-required-by-recipe-kind) is authoritative; the Class M recipes R1/R2/R6/R7 are applied in `simplify deep`'s mechanical wave, not gated here.)

Anything without that evidence — no covering test, callers outside the scoped files, confidence miss — stays a **proposal**, never a blind write. If polish was invoked with `--characterize`, forward it verbatim (`simplify deep --characterize`): the engine then writes a `test-provenance-guard`-validated characterization test for an untested runtime finding and refactors behind it instead of demoting. Polish owns none of that logic — it only passes the flag through.

Capture from its output: applied Class M recipes, applied Class J recipes (each tagged with its evidence), and the Class J findings demoted to proposals with their reason.

**The default pass never auto-applies the reviewer's planned-complex correctness items** — those are surfaced from Pass A. `deep` widens what the *simplify* engine writes (recipe-based refactors), not what free-form correctness fixes get auto-applied.

### Pass B — `simplify` (mode: simplify — the mechanical-only escape hatch)

Invoke the code-quality skill in its default (mechanical) simplify tier against the branch diff:

```
Skill("code-quality", "simplify")
```

This runs the code-quality review pass, then **applies** Class M (mechanical) refactors one at a time — each behind `Skill("confidence", "code") ≥ 90 %` and a scoped fast-check, reverting any that fail its check. **Class J (judgment) recipes are returned as proposals only** — this is exactly the lighter, pre-flip behaviour, for when you deliberately do not want the bigger structural changes.

Capture from its output: which recipes were applied (by ID, e.g. R6, R12) and which were surfaced as judgment-required proposals.

Do **not** pass `aggressive` here unless the user explicitly asked — if they want the bigger changes, that is the default (Pass D), not `aggressive`.

### Pass C — `quick` (mode: quick only)

The light mechanical pass. Invoke code-quality in **review** mode against the branch diff, then auto-apply only the mechanical subset:

```
Skill("code-quality", "review")
```

**Auto-apply** a finding only when it meets **all three**:

- Footprint stays inside files already in the branch diff (no new files, no edits outside the diff).
- The fix is mechanical, not a judgment call: removing/rewriting a plain inline comment that explains WHAT or references the current task; renaming a local variable to a domain noun; dropping `else` after `return`/`throw`; extracting a magic number to a named constant; deleting unreachable/dead code introduced on this branch; flipping a single guard clause to an early return.
- The fix does not change behaviour observable from a test or a caller.

**Docstring / JSDoc / TSDoc / Python-docstring blocks attached to a function, method, class, type, or exported constant are a special case.** Never delete the block as noise removal — IDE hover, type strippers, and doc generators read it. Instead apply code-quality recipe **R35 step 4**: trim verbose prose to a one-sentence summary plus the structured tags (`@param`, `@returns`, `@throws`, `@deprecated`, `@since`, `@example`, `@see`, `@internal`, `@experimental`). Keep the summary line and every contract-bearing tag; drop only the restated-WHAT prose. If the block would be empty after trimming, surface it as a judgment-required finding instead of removing it. License / SPDX headers and linter pragmas (`eslint-disable-next-line`, `@ts-expect-error`, `# noqa`) are never removed.

**Surface but do NOT auto-apply** (out of scope for `quick` — that's what `simplify` is for): structural refactors, type-driven design changes, anything that expands blast radius into files outside the diff, anything where a sibling test would need updating.

## Step 3: Commit each pass that changed files

Unless `--no-commit` was passed, commit after each pass that produced changes, as its own commit, so the diff stays traceable. Skip the commit if a pass made no edits.

```bash
# After Pass A (review):
git add -u && git commit -m "chore: review pass (auto-fixes from reviewer)"

# After Pass B (simplify):
git add -u && git commit -m "chore: simplify pass (mechanical refactors)"

# After Pass D (simplify deep):
git add -u && git commit -m "refactor: deep simplify pass (dedup / structural / type-driven, test-backed)"

# After Pass C (quick):
git add -u && git commit -m "chore: code-quality pass (comments, naming, dead code)"
```

In the default/deep mode this can produce up to two commits (review, then simplify deep). That is intended — each pass is independently revertible. If `--characterize` produced characterization tests, `simplify deep` commits each test as its own unit before its refactor, so those land as additional commits ahead of the refactor commit.

With `--no-commit`, stage nothing; leave every change in the working tree for the user to review and commit themselves.

## Step 4: Report

Print a compact summary. Match the depth to what ran.

```
Polish (<mode>) on <branch>

Review pass:
  Verdict: <Approve | Approve with comments | Request changes | n/a (not run)>
  Auto-fixed: <one line per fix, or "none">
  Planned (needs your judgment): <one line per complex item, or "none">

Deep simplify pass:        # default/deep mode
  Applied (Class M): <recipe IDs + one-line each, or "none">
  Applied (Class J, test-backed): <recipe ID + evidence (tsc-green | test <name> green before+after), one line each, or "none">
  Demoted to proposal: <recipe ID + reason (no-covering-test | callers-out-of-scope | confidence-miss | revert), one line each, or "none">
  Characterization tests written: <path per test, or "none" / "n/a (no --characterize)">

Simplify pass:        # only if mode == simplify (mechanical-only escape hatch)
  Applied: <recipe IDs + one-line each, or "none">
  Proposed (Class J, not applied): <one line each, or "none">

Quick pass:        # only if mode == quick
  Applied: <one line per mechanical fix, or "none">

Commits: <SHA + message per pass, or "none (--no-commit)">
```

Surface the **planned-complex** (review) and **demoted Class J** (deep / simplify) items prominently — these are the items the user still needs to decide on. Do not silently drop them. In the default/deep mode, the applied Class J refactors each carry their behaviour-preservation evidence in the report — that is the receipt that business logic was held constant.

## Hard rules

- **Never weaken the codebase to look clean.** No deleting/skipping/weakening tests, no disabling lint rules or type checks, no `--no-verify`.
- **Never change public API or exported types** as a mechanical fix. That is always judgment-required — surface it. (In `deep`, a type-driven Class J recipe that touches exported types may be applied, but only when scoped `tsc --noEmit` is green — the compiler is the proof that no caller broke — and never when callers live outside the scoped files.)
- **Class J (judgment) refactors are auto-applied only through the test-backed gate** (the default/deep pass). In the explicit `simplify` and `quick` modes, Class J stays a proposal. Even in the default pass, confidence alone is never enough — the [behaviour-preservation evidence](../code-quality/rules/simplify-mode.md#deep-tier--auto-applying-class-j-behind-a-test-backed-gate) (compiler-green or green-before-and-after test) is the contract, and a finding without it is demoted, never written blind. When unsure whether a fix is mechanical or judgment, treat it as judgment.
- **Never write to GitHub.** Polish is local-only. PR creation and any GitHub-side review belong to `/create-pr`.
- **Never stash, reset, or discard the user's uncommitted work.**
- **One pass each per invocation. Do not loop.** If the branch still has issues after a polish run, that is a signal for the user to act on, not for the skill to grind.

## Relationship to `/create-pr`

`/create-pr` delegates its pre-push quality step to this skill:

| `/create-pr` invocation     | Delegates to            | Simplify tier |
| --------------------------- | ----------------------- | ------------- |
| `/create-pr` (default)      | `Skill("polish")` (default = deep) | Class M **and** test-backed Class J |
| `/create-pr --no-review`    | `Skill("polish", "simplify")` | Class M mechanical only |
| `/create-pr --no-simplify`  | `Skill("polish", "review")`   | *(none — reviewer only)* |
| `/create-pr --quick`        | `Skill("polish", "quick")`    | light mechanical only |
| `/create-pr --no-quality`   | *(polish skipped)*      | — |

Because polish's default is now the **deep** tier, a default `/create-pr` runs the bigger test-backed Class J refactors on the branch before pushing. This is safe by construction — the deep gate only writes a refactor when a covering test (or the compiler) proves behaviour is preserved, and demotes everything else to a proposal — but it is a real behaviour change from a routine push. To get the old mechanical-only pre-push pass, use `/create-pr --no-review` (mechanical `simplify`) or `/create-pr --quick` (light pass); `--no-quality` skips polish entirely.

Because the logic lives here, the standalone `/polish` command and `/create-pr`'s pre-push pass can never drift apart.
