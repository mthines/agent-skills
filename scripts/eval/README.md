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
| **Example here** | `l1.mjs` — incl. the #31 confidence-gate regression, the tier table's single home (`G2b`), and the `aw-` agent count (`G2c`). | `l2.mjs` — does `aw` route tasks to the right tier? does `/fix-bug` classify the bug right? |

**Why both?** L1 proves the *contract* (cheap, every PR). L2 proves the
*behavior* (expensive, periodic). L1 would never have caught "the dispatcher
routes a 4-file task to Micro"; L2 would never have caught "the confidence
`awk` idiom counts 0 acceptance criteria." Different failure classes.

## L1 — `node scripts/eval/l1.mjs`

Zero dependencies, no network. Exits non-zero on failure (CI gate). Checks:

- **Links/anchors** resolve across `skills/`, `memory/`, root docs (skips code
  fences + templates; ratchets on a baseline of pre-existing debt — see the
  `BASELINE` set, burn it down, never add to it).
- **Tier table** has exactly one home: present in `SKILL.md` Step 1, absent from the `aw` dispatcher skill, which links it (`G2b`).
- **plan.md Core contract** — runs the *actual* `confidence` rule #2 (8 Core
  sections), rule #3 (Acceptance Criteria non-empty, the #31 fix), rule #9
  (every `[user-stated]` requirement covered by a `(covers: R…)` annotation),
  rule #10 (a `create` row requires an Existing Code Survey verdict;
  modify-only passes vacuously), and rule #11 (checks.yaml `AC-{n}` IDs in
  sync with the plan, both directions) against fixtures in `fixtures/plans/`.
- **diagnose resolvability** — every skill with a `diagnostic-surface.md` is
  uniquely resolvable by `skills/*/<name>/` (locks the path-resolution fix).
- **lesson scopes** — no `memory/<scope>/` is committed in this repo (the loops'
  fast tier runs on LoreKit now, not committed markdown).
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
| `tier-routing` | Which tier for this task? | autonomous-workflow `### Step 1: Detect Workflow Mode` — the table's one home; the `aw` dispatcher links it rather than restating it (`G2b`) | Micro / Lite / Full |
| `bug-class` | What `bugClass` for this evidence? | fix-bug `### Step 0c` | the 9 classes |
| `complexity-triage` | simple or complex bug? | fix-bug `## Phase 0.5` | simple / complex |
| `aw-should-trigger` | should the routing rule auto-trigger? | the whole routing rule | trigger / skip |
| `reviewer-agreement-bump` | is the surviving finding agreement-promoted? | reviewer `## Cross-rubric agreement` | promoted / not-promoted |
| `optimize-approach-optimality` | is this approach optimal or suboptimal? | optimize-approach `optimality-rubric.md` (whole file) | optimal / suboptimal |
| `shape-depth-routing` | given the computed delta, shapes, and impact graph, which depth tier does Phase C pick? | `agents/pr-reviewer/rules/depth-routing.md` (whole file) | deep / standard / quick |
| `code-review-retrieval-relevance` | would the documented Step 1.0 + 1.2c read surface this candidate memory for the given PR diff? | `agents/pr-reviewer.md` `## Step 1: Fetch all inputs + load memories` | surface / skip |

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
2. Append a config object to `SUITES` in `suites.mjs` — point `rubric.section` at
   the skill heading to read live, and list the `choices`.

That is the whole change. There is **no** third step wiring the new suite into CI:
`evals-l2.yml` derives which suites a PR affects from this table, so declaring the
suite's `rubric.file` and `golden` is what makes CI run it on an opted-in PR.

### L2 in CI is opt-in

Every L2 case is a model call, so **CI runs no suite unless someone asks.**
Two mechanisms, both manual:

| To run L2… | Do this |
| --- | --- |
| on a PR | add the **`run-evals`** label — the affected suites then run on that PR's every push until the label is removed |
| ad hoc | Actions → *evals · L2 (behavioral)* → **Run workflow**; the `suites` input takes `all` (default) or a comma-separated list |

A PR without the label pays one ~3-second bookkeeping job: no checkout, no Node,
no API call. The `evals · L2 (behavioral) / l2` check reports `not opted in — no
suites run, no tokens spent` and passes.

**Why the workflow still triggers on `pull_request` at all.** The trigger governs
whether the *check* appears; the gate governs whether *suites run*. A workflow with
only `workflow_dispatch` never reports on a PR, so requiring its check leaves every
PR pending forever — the same trap the old `paths:` filter set. Keeping the trigger
and gating the spend gets both: an always-resolving required check and zero cost by
default. `G21i` asserts both halves, and that the label name in the workflow is the
one documented here.

### Which suites run once you opt in

Even opted in, CI runs only the **subset** the PR's changed files can affect, one
job per suite — so labelling a one-rubric PR costs one suite, not nine.
`select-suites.mjs` computes that subset from the suite table:

| An opted-in PR changes… | …and CI runs |
| --- | --- |
| a suite's `rubric.file` | that suite (a rubric two suites read selects both — e.g. `fix-bug/SKILL.md` → `bug-class` + `complexity-triage`) |
| a suite's `golden/*.jsonl` | that suite |
| `l2.mjs`, `lib.mjs`, `suites.mjs`, `select-suites.mjs` | **every** suite — a runner change can alter any of them |
| anything else | nothing; the aggregator job passes with "no suite is affected by this diff" |

```bash
git diff --name-only main...HEAD | node scripts/eval/select-suites.mjs
node scripts/eval/select-suites.mjs --json skills/quality/severity/SKILL.md
node scripts/eval/select-suites.mjs --self-test    # executed by L1 G21h
```

Matching is **exact** on repo-relative paths — the spelling `git diff --name-only`
prints and the table stores. Widening (the harness rule) is the deliberate
fail-open direction: extra suites cost tokens, a missed suite costs coverage, and a
suite that never ran reports as a green PR exactly like a suite that passed.

**Why it is derived rather than listed.** The workflow used to carry a hand-written
`paths:` mirror of the rubric files. It drifted: four of the nine rubric files were
missing from it (`severity/SKILL.md`, `optimality-rubric.md`, `depth-routing.md`,
`rubric-composition.md`), so editing those rubrics never ran their own eval, and two
listed paths backed no suite at all. `G21d` now asserts the derivation *and* the
absence of a rubric-path mirror, so that class of drift cannot come back.

**Required check:** require **`evals · L2 (behavioral) / l2`** — the aggregator job,
which runs on every PR whether or not it opted in and whether or not it affects a
suite. Never require a per-suite job (`suite (tier-routing)`): those exist only on
an opted-in PR, and a required check that does not run leaves the PR pending
forever.

### The link to self-improvement

A promotion-eligible lesson (`seen_count ≥ 3`) is a recurring failure — exactly
what a golden case should encode.
When a lesson is promoted via `diagnose`, add the case here so the fix is locked.
The `diagnostic-surface.md` failure taxonomies are a proto-spec for this golden set.

### `code-review-retrieval-relevance` — methodology note

This suite measures whether `pr-reviewer`'s documented Step 1.0 (`mcp__lorekit__memory_list`)
+ Step 1.2c (`mcp__lorekit__memory_search`, enriched query) read surfaces the lessons
that should fire for a given PR diff + candidate memory pool.

Ground truth is **defined by the outcome signal** — `loop::reviewer-lessons` /
`loop::reviewer-comment-relevance` tags + `origin_pr` + `seen_count >= 3` marks a
promotion-grade should-fire lesson.
Labels are derived from this signal, not from re-running the read being measured.

**When a lesson is promoted via `diagnose`, add a golden case so the fix is locked.**
Specifically: when a `loop::reviewer-lessons` or `loop::reviewer-comment-relevance` entry
reaches `seen_count >= 3` and is promoted through the slow tier (`/create-skill diagnose`),
record the lesson's trigger context as a new `{"id","input","expected","notes"}` line in
`golden/code-review-retrieval-relevance.jsonl` with `expected: "surface"`.

The current golden set is a **BOOTSTRAP SEED — NOT A REAL BASELINE**.
See `golden/code-review-retrieval-relevance.NOTES.md` for the full caveat and ground-truth definition.
Do not tighten the `EVAL_GATE` floor until the golden set reaches ≥ 50 real-corpus cases.

## CI — two requireable checks

Both layers run in GitHub Actions, so each shows up as a status check you can
require via branch protection:

| Workflow | Check name | Trigger | Needs a secret? | Gates? |
| --- | --- | --- | --- | --- |
| `.github/workflows/evals-l1.yml` | **evals · L1 (contract checks)** | every PR + push to `main` | no | **yes** — fails on any broken contract |
| `.github/workflows/evals-l2.yml` | **evals · L2 (behavioral) / l2** | reports on every PR; **runs suites only on opt-in** — the `run-evals` label or a `workflow_dispatch` — and then only the affected ones ([details](#l2-in-ci-is-opt-in)) | `ANTHROPIC_API_KEY` | soft — `EVAL_GATE` floor (70%), per suite |

**To enable L2:** add an `ANTHROPIC_API_KEY` repository secret (Settings →
Secrets and variables → Actions). Without it the L2 job still runs and **passes**
(the script skips cleanly with no key), which is what makes it safe to require
immediately and safe for fork PRs (which can't read secrets) — but a green check
in that state proves nothing, so the job emits a `::warning` naming the missing
secret rather than passing silently. Accuracy + any misses are written to the PR's
check summary.

`workflow_dispatch` takes a `suites` input: `all` (default) or a comma-separated
list of suite names, for re-running one suite without touching a file.

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

## Report-body snapshots

`fixtures/report-body/` holds the reference renderings of the `pr-reviewer` report:

| File | What it is |
| --- | --- |
| `<case>.json` | the payload a run would build (`pass`, `warn`, `fail`) |
| `<case>.expected.md` | the committed snapshot — **read these to see what a report looks like** |

The payloads are **structured data**, not markdown: counts come from array length, links are built
by the renderer from `{path, line, url}`, and the footer/`Run mode` lines are derived from a `RUN`
object. So a count cannot disagree with its list and a sha cannot appear at two lengths.

L1's **G25** executes `agents/pr-reviewer/scripts/render-report.mjs` against each payload and diffs
the result byte-for-byte against the snapshot, then asserts the structural invariants (marker
present, `Review details` accordion present, nothing pre-expanded, nothing the accordion owns
rendered above it) and that the renderer rejects **every payload in G25's `rejects` table** while
printing nothing on stdout. The count is deliberately not repeated here — it grows with the table,
and a mirrored number goes stale on the next case added. Read `rejects` in `l1.mjs` for the list.

It also runs a **producer → consumer round trip**: the extractors documented in
`agents/shared/rules/reviewer-report-ingest.md` are applied to the rendered output, and every
section must parse to its documented type. That is the test that was missing when a report
shipped with `Run mode — full … 750 additions / 486 deletions`, which the grammar parses for
`delta_lines`.

Regenerate after an intentional template or renderer change, and review the diff:

```bash
for n in pass warn fail; do
  node agents/pr-reviewer/scripts/render-report.mjs \
    scripts/eval/fixtures/report-body/$n.json > scripts/eval/fixtures/report-body/$n.expected.md
done
```
