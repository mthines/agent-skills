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
| **Example here** | `l1.mjs` — incl. the #31 confidence-gate regression and the dispatcher↔SKILL tier-table drift. | `l2-tier-routing.mjs` — does `aw` route tasks to Micro/Lite/Full correctly? |

**Why both?** L1 proves the *contract* (cheap, every PR). L2 proves the
*behavior* (expensive, periodic). L1 would never have caught "the dispatcher
routes a 4-file task to Micro"; L2 would never have caught "the confidence
`awk` idiom counts 0 acceptance criteria." Different failure classes.

## L1 — `node scripts/eval/l1.mjs`

Zero dependencies, no network. Exits non-zero on failure (CI gate). Checks:

- **Links/anchors** resolve across `skills/`, `memory/`, root docs (skips code
  fences + templates; ratchets on a baseline of pre-existing debt — see the
  `BASELINE` set, burn it down, never add to it).
- **Tier table** in `dispatcher.template.md` is byte-identical to `SKILL.md` Step 1.
- **plan.md Core contract** — runs the *actual* `confidence` rule #2 (8 Core
  sections) and rule #3 (Acceptance Criteria non-empty, the #31 fix) against
  fixtures in `fixtures/plans/`.
- **diagnose resolvability** — every skill with a `diagnostic-surface.md` is
  uniquely resolvable by `skills/*/<name>/` (locks the path-resolution fix).
- **lesson scopes** — committed `memory/<scope>/` have the storage contract.
- **frontmatter** — SKILL versions are semver; `name` matches the directory.

Add a check: append a `s.check(label, condition, detail)` in `l1.mjs`.

## L2 — `ANTHROPIC_API_KEY=… node scripts/eval/l2-tier-routing.mjs`

Feeds the dispatcher's **live** `## Tier detection` rubric + each golden task
to the model and exact-matches the emitted tier against the label in
`golden/tier-routing.jsonl`. Skips cleanly (exit 0) without an API key.

- **Report-only** today: 30 cases. The repo's `evals.md` says < 50 is "noisy —
  do not gate CI." Grow `tier-routing.jsonl` to ≥ 50, then add a gate threshold.
- A **miss** means one of two things — inspect it: the model got it wrong
  (improve the rubric), or the golden label is itself debatable (fix the label).
  That feedback loop *is* the eval.
- Override the actor model with `EVAL_MODEL=…`.

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
| `.github/workflows/evals-l2.yml` | **evals · L2 (tier routing)** | PRs touching routing files, + manual `workflow_dispatch` | `ANTHROPIC_API_KEY` | soft — `EVAL_GATE` catastrophic floor (70%) |

**To enable L2:** add an `ANTHROPIC_API_KEY` repository secret (Settings →
Secrets and variables → Actions). Until then the L2 job still runs and **passes**
(the script skips cleanly with no key), so it's safe to require immediately and
safe for fork PRs (which can't read secrets). Accuracy + any misses are written
to the PR's check summary.

**Why L2 only gates softly:** the golden set is 30 cases (< 50), which `evals.md`
calls statistically noisy. The 70% floor only catches a badly-broken rubric, not
1–2 cases of model noise. Grow `tier-routing.jsonl` to ≥ 50, then tighten the
floor (or switch to 0%-regression-vs-baseline) and gate hard.

To require them: Settings → Branches → branch protection → "Require status
checks" → pick **evals · L1** (and **evals · L2** once the secret is set).

### The L1 baseline

`l1.mjs` keeps a `BASELINE` set of known pre-existing broken links so the gate
catches *new* breakage without failing on history. It is currently **empty** —
all internal links resolve. Keep it that way: fix new breaks, don't baseline
them. (The three original entries were resolved: `from-to-morphs.md` →
`state-choreography.md`; the fix-bug verifier anchor → `#verifier-checks`; and
`playwright-test-healer` → the external [Playwright Test Agents](https://playwright.dev/docs/test-agents) docs.)
