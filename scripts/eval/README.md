# Skill evals

Regression evals for the skills in this repo. Skills are prompts that bias an
LLM, so "testing" them splits into layers by **cost** and **determinism**.
Methodology follows the repo's own [`ai-engineering/rules/evals.md`](../../skills/quality/ai-engineering/rules/evals.md).

## The two layers (what / why / how)

| | **L1 — deterministic contract checks** | **L2 — behavioral evals** |
| --- | --- | --- |
| **What it asks** | "Does the artifact obey its mechanical contract?" | "Does the model, given this skill, *behave* correctly?" |
| **Runs an LLM?** | **No.** Pure file parsing + the skills' own `grep`/`awk` idioms. | **Yes.** Calls a model with the skill's rubric + an input. |
| **Determinism** | Fully deterministic — same result every run. | Stochastic — score with a threshold, expect some noise. |
| **Cost / speed** | Free, milliseconds. Runs in CI on every PR. | Costs API tokens, seconds–minutes. Run locally / nightly. |
| **Scoring** | Exact assertions (pass/fail). | Accuracy vs human-labelled golden set (here: exact-match on a label; no LLM-judge needed for classification). |
| **Catches** | Broken links/anchors, missing plan sections, gate-logic regressions, doc drift, version-collision. | "The skill biases the model the wrong way" — wrong tier routing, mis-classification, mis-calibrated confidence. Things reading the markdown can't prove. |
| **Example here** | `l1.mjs` — incl. the #31 confidence-gate regression and the dispatcher↔SKILL tier-table drift. | `l2.mjs` — does `aw` route tasks to the right tier? does `/fix-bug` classify the bug right? |

**Why both?** L1 proves the *contract* (cheap, every PR). L2 proves the
*behavior* (expensive, periodic). L1 would never have caught "the dispatcher
routes a 4-file task to Micro"; L2 would never have caught "the confidence
`awk` idiom counts 0 acceptance criteria." Different failure classes.

## L1 — `node scripts/eval/l1.mjs`

Zero dependencies, no network. Exits non-zero on failure (CI gate). Checks:

- **Links/anchors** resolve across `skills/`, `memory/`, root docs (skips code
  fences + templates; ratchets on a baseline of pre-existing debt — see the
  `BASELINE` set, burn it down, never add to it).
- **Tier table** in `aw.template.md` is byte-identical to `SKILL.md` Step 1.
- **plan.md Core contract** — runs the *actual* `confidence` rule #2 (8 Core
  sections) and rule #3 (Acceptance Criteria non-empty, the #31 fix) against
  fixtures in `fixtures/plans/`.
- **diagnose resolvability** — every skill with a `diagnostic-surface.md` is
  uniquely resolvable by `skills/*/<name>/` (locks the path-resolution fix).
- **lesson scopes** — committed `memory/<scope>/` have the storage contract.
- **frontmatter** — SKILL versions are semver; `name` matches the directory.
- **cross-file contracts** — locks contracts that span producer and consumer
  files (the drift class link checks cannot see): the `seen_count` UPDATE
  sentence shared verbatim by persistent-memory and the autonomous-workflow
  loop, the fast-lane plan ⊇ Core-8 sections, implement-suggestion keyed on
  `/critical`'s real Must-fix bucket, the per-comment gate consuming
  `confidence(code)`'s real output, a forbidden-phrase list for audited
  contradictions and phantom references, and the
  `code-quality` Recipe Class table being exhaustive over every R-recipe in
  the Contents list (G7 — `simplify` mode keys auto-apply on this
  classification, so an unclassified or doubly-classified recipe is a hard
  failure).

Add a check: append a `s.check(label, condition, detail)` in `l1.mjs`.

## L2 — `ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs`

Data-driven: one runner, many suites. Each suite feeds a skill's **live** rubric
section (read straight from the skill source, so the eval tests the *shipped*
instructions) + a labelled input to the model, and exact-matches the model's
choice against the human label. Classification → exact-match, **no LLM-as-judge**.

| Suite | Question | Rubric read from | Choices |
| --- | --- | --- | --- |
| `tier-routing` | Which tier for this task? | dispatcher `## Tier detection` | Micro / Lite / Full |
| `bug-class` | What `bugClass` for this evidence? | fix-bug `### Step 0c` | the 9 classes |
| `complexity-triage` | simple or complex bug? | fix-bug `## Phase 0.5` | simple / complex |
| `aw-should-trigger` | should the routing rule auto-trigger? | the whole routing rule | trigger / skip |

```bash
node scripts/eval/l2.mjs                 # all suites
node scripts/eval/l2.mjs --suite bug-class
EVAL_MODEL=… EVAL_GATE=70 node scripts/eval/l2.mjs
```

- **Report-only** by default (each golden set is < 50 — `evals.md` calls that
  noisy). `EVAL_GATE=<pct>` soft-gates: fail if any suite is below the floor.
- A **miss** means one of two things — inspect it: the model got it wrong
  (improve the rubric), or the golden label is itself debatable (fix the label).
  That feedback loop *is* the eval. Skips cleanly (exit 0) with no API key.

### Add a suite

1. Drop a `golden/<name>.jsonl` of `{"id","input","expected","notes"}` lines.
2. Append a config object to `SUITES` in `l2.mjs` — point `rubric.section` at the
   skill heading to read live, and list the `choices`.
3. Add the golden path / rubric file to `evals-l2.yml`'s `paths:` so CI runs it
   when relevant files change.

### The link to self-improvement

A promotion-eligible lesson (`seen_count ≥ 3`) is a recurring failure — exactly
what a golden case should encode. When a lesson is promoted via `diagnose`,
add the case here so the fix is locked. The `diagnostic-surface.md` failure
taxonomies are a proto-spec for this golden set.

## CI — two requireable checks

Both layers run in GitHub Actions, so each shows up as a status check you can
require via branch protection:

| Workflow | Check name | Trigger | Needs a secret? | Gates? |
| --- | --- | --- | --- | --- |
| `.github/workflows/evals-l1.yml` | **evals · L1 (contract checks)** | every PR + push to `main` | no | **yes** — fails on any broken contract |
| `.github/workflows/evals-l2.yml` | **evals · L2 (behavioral)** | PRs touching a rubric/golden file, + manual `workflow_dispatch` | `ANTHROPIC_API_KEY` | soft — `EVAL_GATE` floor (70%), per suite |

**To enable L2:** add an `ANTHROPIC_API_KEY` repository secret (Settings →
Secrets and variables → Actions). Until then the L2 job still runs and **passes**
(the script skips cleanly with no key), so it's safe to require immediately and
safe for fork PRs (which can't read secrets). Accuracy + any misses are written
to the PR's check summary.

**Why L2 only gates softly:** each golden set is < 50 cases, which `evals.md`
calls statistically noisy. The 70% floor only catches a badly-broken rubric, not
1–2 cases of model noise. Grow a suite's golden set to ≥ 50, then tighten the
floor (or switch to 0%-regression-vs-baseline) and gate it hard.

To require them: Settings → Branches → branch protection → "Require status
checks" → pick **evals · L1** (and **evals · L2** once the secret is set).

### The L1 baseline

`l1.mjs` keeps a `BASELINE` set of known pre-existing broken links so the gate
catches *new* breakage without failing on history. It is currently **empty** —
all internal links resolve. Keep it that way: fix new breaks, don't baseline
them. (The three original entries were resolved: `from-to-morphs.md` →
`state-choreography.md`; the fix-bug verifier anchor → `#verifier-checks`; and
`playwright-test-healer` → the external [Playwright Test Agents](https://playwright.dev/docs/test-agents) docs.)
