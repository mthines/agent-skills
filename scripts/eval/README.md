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
- **the L2 wiring itself** (`G21`) — every suite extracts a non-empty rubric body
  (`G21g`), the workflow derives its suite selection instead of mirroring the rubric
  files (`G21d`), the selector's mapping self-test and the unknown-`--suite` exit
  (`G21h`), the opt-in gate and its documented label (`G21i`), and every suite's
  `choices` ↔ golden labels in both directions (`G21j`), and the telemetry module's
  own self-test plus its four rules — off by default, a miss is not a span error, the
  flush precedes the gate exit, and CI forwards the OTLP config (`G21k`), and the
  **scorer and the gate** — `parseChoice` is extracted from the live runner and
  *executed*, so a reply enumerating every choice must read as ambiguous rather than
  as the first one; a miss must print the raw reply; only a suite at or above the
  case floor can breach the gate; an absent key fails an opted-in run; the rubric
  travels as a cached system block (`G21l`), and the **`bug-detection` CI chain** —
  its inputs are declared in the suite table, the selector derives one boolean from
  that declaration rather than restating the paths, the job consumes the boolean and
  runs gated, and the aggregator both depends on the job *and* branches on its result
  (`G21m`). L1 gates the
  *plumbing* of L2, which is why an unrun L2 still cannot silently rot.
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
- **L2 cost controls** (`G50`) — asserts the selector *imports* the suite table
  (and the harness set) rather than re-parsing or restating either, pins the
  cached system block (and the absence of the bare-string form it replaced) plus
  the three-way cache notice that makes an uncacheable prefix distinguishable
  from a missed cache, pins the `--suite` comma list and its empty-selection
  exit, pins the harness-file set **and its two deliberate exclusions**
  (`telemetry.mjs`, `evals-l2.yml` — neither can move a label), and reads the
  `l2` aggregator to assert that a selection which did not *succeed* fails the
  run loudly while the only thing that may suppress the matrix is a genuinely
  empty count. Executing the selector's self-test is `G21h`'s job, not `G50`'s —
  two IDs asserting one contract make a red build ambiguous about which broke.

Add a check: append a `s.check(label, condition, detail)` in `l1.mjs`.

## L2 — `ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs`

Data-driven: one runner, many suites. Each suite feeds a skill's **live** rubric
section (read straight from the skill source, so the eval tests the *shipped*
instructions) + a labelled input to the model, and exact-matches the model's
choice against the human label. Classification → exact-match, **no LLM-as-judge**.

The suite table lives in **[`suites.mjs`](./suites.mjs)**, not in the runner.
It has two consumers that must never disagree — `l2.mjs` runs the suites, and
[`select-suites.mjs`](./select-suites.mjs) maps a PR's changed files back to the
suites those files can affect — so both import the same array rather than one of
them re-parsing the other. See [Cost](#cost) below.

| Suite | Question | Rubric read from | Choices |
| --- | --- | --- | --- |
| `tier-routing` | Which tier for this task? | autonomous-workflow `### Step 1: Detect Workflow Mode` — the table's one home; the `aw` dispatcher links it rather than restating it (`G2b`) | Micro / Lite / Full |
| `bug-class` | What `bugClass` for this evidence? | fix-bug `### Step 0c` | the 9 classes |
| `complexity-triage` | simple or complex bug? | fix-bug `## Phase 0.5` | simple / complex |
| `aw-should-trigger` | should the routing rule auto-trigger? | the whole routing rule | trigger / skip |
| `reviewer-agreement-bump` | is the surviving finding agreement-promoted? | reviewer `## Cross-rubric agreement` | promoted / not-promoted |
| `optimize-approach-optimality` | is this approach optimal or suboptimal? | optimize-approach `optimality-rubric.md` (whole file) | optimal / suboptimal |
| `shape-depth-routing` | given the computed delta, shapes, and impact graph, which depth tier does Phase C pick? | `agents/pr-reviewer/rules/depth-routing.md` (whole file) | deep / standard / quick |
| `code-review-retrieval-relevance` | would the documented Step 1.0 + 1.2c read surface this candidate memory for the given PR diff? | `agents/pr-reviewer.md` `### 1.0` + `### 1.2c` (the two-section `rubric.sections` form — deliberately **not** the `## Step 1` parent, see the methodology note) | surface / skip |

```bash
node scripts/eval/l2.mjs                          # all suites
node scripts/eval/l2.mjs --suite bug-class
node scripts/eval/l2.mjs --suite bug-class,tier-routing   # comma list
node scripts/eval/l2.mjs --suite typo    # exits 1 and lists the suites — never a silent zero-case pass
node scripts/eval/l2.mjs --suite ""      # exits 1 — an empty selection grades nothing, so it is never a pass
EVAL_MODEL=… EVAL_GATE=70 node scripts/eval/l2.mjs
```

- **Report-only** by default (each golden set is < 50 — `evals.md` calls that
  noisy). `EVAL_GATE=<pct>` soft-gates: fail if any suite is below the floor.
- **A suite under `EVAL_GATE_MIN_CASES` (default 10) cannot breach the gate.**
  It still runs, still prints its accuracy, and is labelled `[advisory]` — but
  below ten cases one case moves accuracy by ≥ 10 points, so a 70% floor on a
  5-case set allows exactly one miss and is decided by a coin flip rather than by
  the rubric's health. Raise the case count to make a suite gate again; do not
  lower the floor.
- A **miss** means one of *three* things — the printed line now includes the
  model's raw reply so you can tell them apart: the model got it wrong (improve
  the rubric), the golden label is debatable (fix the label), or the reply never
  named one choice at all and shows as `?(…)` (the model answered in a shape the
  harness did not expect — usually because the rubric asks the agent to emit a
  structured block). That feedback loop *is* the eval.
- **A missing API key skips (exit 0) — unless `EVAL_REQUIRE_KEY=1`**, which fails
  (exit 3). CI sets it on the opt-in path: a run someone explicitly asked for must
  not report green having measured nothing. 232 consecutive CI runs were green for
  exactly that reason.
- **The rubric is sent as a cached system block.** It is byte-identical across
  every case in a suite, so `cache_control: ephemeral` bills case 1 at 1.25× and
  the rest at 0.1× — roughly **80% off** a suite's input cost, and no change to any
  answer. The run's last line reports cache reads/writes, and distinguishes the two
  reasons there might be none: `cache not applicable` when the prompt is under the
  ~1024-token minimum cacheable prefix (the three smallest suites — nothing to
  discount, nothing to fix), and `cache MISSED` when a prompt long enough to cache
  produced no cache activity anyway (cases spread past the 5-minute TTL, or a rubric
  that stopped being byte-identical). Only the second is worth investigating.

### Telemetry — watching accuracy and cost over time

`stdout` answers *what was today's accuracy*.
It cannot answer *has the tier-routing rubric been drifting down for three weeks* or *which suite is eating the token budget* — both are trend questions, and a trend needs a backend.
So an L2 run also emits OTLP traces and metrics, via the zero-dependency [`telemetry.mjs`](./telemetry.mjs).

**Off unless you configure an endpoint.** No `OTEL_EXPORTER_OTLP_ENDPOINT`, no export attempt — a fresh clone and a fork PR both run exactly as before.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingress.eu-west-1.aws.dash0.com \
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer auth_…,Dash0-Dataset=default" \
ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs --suite bug-class
```

Behind an egress proxy, add `NODE_USE_ENV_PROXY=1` — node's built-in `fetch` ignores `HTTPS_PROXY` without it, and the export then fails with a misleading allowlist error from the wrong gateway.

The shape, flushed once at exit (a batch job has no reason to stream):

| Signal | Name | Carries |
| --- | --- | --- |
| span | `eval.run` | model, gate floor, suite/case/pass counts, run accuracy, total tokens |
| span | `eval.suite <name>` | suite name, rubric file + section, `eval.rubric.chars`, accuracy, `eval.suite.below_gate`, `eval.suite.gating` |
| span | `eval.case <id>` (CLIENT) | expected, actual, `eval.case.match`, `gen_ai.usage.*_tokens` (input, output, and the two cache counters) |
| metric | `eval.case.result` | Sum, delta, split by `eval.case.match` — accuracy as a ratio in the backend |
| metric | `eval.suite.accuracy` / `eval.run.accuracy` | Gauge, `%` |
| metric | `eval.case.duration` | Histogram, `s` |
| metric | `gen_ai.client.token.usage` | Histogram, `{token}`, split by `gen_ai.token.type` — `input` / `output` / `cache_read` / `cache_write`, never summed together (a read bills at 0.1× and a write at 1.25×, so one total misreports the cost in both directions) |

Four rules the module holds, each guarded by L1 `G21k`:

1. **A miss is not an error.** A wrong answer *is* the measurement, so the case span stays `UNSET`; only a transport or API failure sets `ERROR`. Conflating them makes every rubric regression look like an outage in the trace list.
2. **An absent attribute is omitted, never a placeholder.** `unknown` is not queryable as absent.
3. **The flush precedes the gate exit.** A failing run is the one you most want to look at, so it ships its trace before `EVAL_GATE` exits non-zero.
4. **Export failure never changes the verdict.** The accuracy is the product; the span is the receipt. An unreachable backend prints a warning and nothing else.

Attributes use upstream OpenTelemetry semantic conventions wherever one exists — `gen_ai.*` for the model call, `cicd.*` / `vcs.*` on the resource so a regression is attributable to a commit rather than to "some run last Tuesday". The `eval.*` namespace covers only what upstream has no convention for.

In CI, the endpoint is a repository **variable** (`OTEL_EXPORTER_OTLP_ENDPOINT` — a hostname is not a secret) and only the token is a **secret** (`DASH0_AUTH_TOKEN`); `DASH0_DATASET` is an optional variable defaulting to `default`.
Each matrix job is its own process, so an opted-in PR produces **one trace per suite**, not one per run — group them by the `cicd.pipeline.run.id` resource attribute every span carries.

### Maintaining a suite as the skills change

A suite reads its rubric **live**, which is the point — and the cost: a rubric edit
silently becomes an unverified behavioural change unless someone runs the suite.
`CLAUDE.md` § *Keeping the evals honest* is the mandatory trigger table (what you
changed → what you must do). The mechanics behind its rows:

- **Edited a rubric body** → `node scripts/eval/l2.mjs --suite <name>`. A miss is
  information, not a failure: either the model got it wrong (fix the rubric) or the
  golden label is debatable (fix the label). Most rubric edits move no label, and
  reporting that is the deliverable.
- **Renamed or re-levelled a heading** → update `rubric.section`. `extractSection`
  throws on a missing anchor, so L1 `G21g` fails rather than feeding the model an
  empty rubric.
- **Moved or deleted the file** → repoint `rubric.file`, or remove the suite entry
  and its `golden/*.jsonl` in the same commit.
- **Changed a `choices` list** → every choice needs at least one golden case, and
  every golden label must be a current choice. L1 `G21j` enforces both directions,
  because each has its own failure: a new choice with no case is untested by
  construction, and a *renamed* choice leaves every existing label unmatchable, so
  the suite scores 0% and reads as a catastrophic rubric regression rather than the
  label mismatch it is.
- **Which suites does my change touch?** `git diff --name-only main...HEAD | node
  scripts/eval/select-suites.mjs` — the same computation CI runs. Read it instead of
  guessing; since CI is opt-in, an unverified rubric stays unverified.

### Cost

A full nine-suite run is ~150 one-word answers, and it used to cost **~273k input
tokens** because nearly all of that is rubric text sent over and over. Three
controls, in order of effect — measure, don't assume: every run prints its own
`tokens: … input + … output · cache …` line.

1. **Nothing runs unless someone asks.** The opt-in gate is the cheapest control
   there is, because it takes the whole bill to zero on every PR that did not ask
   for an eval — see [L2 in CI is opt-in](#l2-in-ci-is-opt-in).
2. **The rubric is a cached system block.** It is byte-identical across every
   case in a suite, so a suite pays for it roughly once instead of once per case
   (~−63% on a full run). Honest limit: `tier-routing`, `bug-class`, and
   `reviewer-agreement-bump` have rubrics under the model's minimum cacheable
   prefix, so caching is a **no-op** for them — the four large suites are 76% of
   the bill and all clear it.

   The notice is three-way, and the distinction is the point. `cache <N> read /
   <M> written` means it worked. **`cache not applicable`** means the largest
   system block the run built is under the ~1024-token minimum: there is nothing
   to discount and nothing to fix, which is the correct reading for those three
   suites — an undifferentiated "inactive" sent readers hunting a defect that did
   not exist. **`cache MISSED`** is the one worth investigating: the prefix was
   long enough to cache and produced no read and no write anyway, so a
   `cache_control` key the API silently declined is now distinguishable from a
   working one before the invoice arrives. The branch is decided by the measured
   prefix (`maxSystemChars`), never by dividing total input by case count — that
   also counts each case's user message and can cry MISSED at a suite that was
   never cacheable.
3. **An opted-in PR runs only the suites its changed files can affect.** A
   suite's result depends on exactly two inputs — the rubric file it reads live
   and the golden set that labels it — so a PR touching one golden file cannot
   move the other eight. `select-suites.mjs` does the mapping:

   ```bash
   git diff --name-only main...HEAD | node scripts/eval/select-suites.mjs
   node scripts/eval/select-suites.mjs skills/workflow/fix-bug/SKILL.md  # → bug-class,complexity-triage
   node scripts/eval/select-suites.mjs --self-test                        # offline; L1 G21h runs this
   ```

   Selection **widens** rather than narrows when in doubt: a change to a harness
   file (`l2.mjs`, `lib.mjs`, `suites.mjs`, `select-suites.mjs`) selects **all**
   suites plus `bug-detection`, since any of them can move a suite's score. A
   selection that *fails* is a different thing from an empty one, and the two
   must never collapse: selection runs as its own `select` job, so a failure
   arrives at the aggregator as a value to read and the run goes **red** with
   "the affected subset is unknown". Only a genuine empty count skips, and that
   is the single condition guarding the matrix (`G50f`). Running all nine on a
   selector crash — the fail-open answer an inline step is forced into, having no
   check to report on — would spend the full bill to hide a bug instead.

### Add a suite

1. Drop a `golden/<name>.jsonl` of `{"id","input","expected","notes"}` lines —
   at least one per entry in `choices` (`G21j`).
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
| `l2.mjs`, `lib.mjs`, `suites.mjs`, `select-suites.mjs` | **every** suite **and** `bug-detection` — a runner change can alter any of them |
| `l2-detection.mjs`, `finders.md`, `finding-verifier.md`, `golden/bug-detection.jsonl` | **only** `bug-detection` — a separate job, never a matrix entry |
| anything else | nothing; the aggregator job passes with "this diff affects no eval" |

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

**`bug-detection` rides the same derivation, in its own job.** It is a separate
runner, not a single-choice suite, so it cannot ride the `--suite` flag — but it had
the same CI problem every suite has, and for a long time the wrong answer: it ran in
**no workflow at all**. Only its `--self-test` executed (L1 `G39`), so the scoring
plumbing was guarded while the measurement it exists for — `recall ≥ 0.7` and
`fp ≤ 0.2` against 30 golden records — had never once run in CI. Its inputs are now
declared in `suites.mjs` as `SUITES.DETECTION` next to the suites, `select-suites.mjs`
reports one extra boolean off that declaration, and the workflow's `detection` job
consumes the boolean. No `paths:` mirror here either, and unlike the suites it runs
**gated** (`EVAL_DETECTION_GATE=1`): the two rates *are* the contract, and a detection
core that stops finding bugs while reporting green is the failure it was written for.
`G21m` asserts the whole chain — declaration → selector → job → aggregator — with the
last link the load-bearing one: the aggregator is `if: always()`, so a failed
dependency arrives as a value to read, and reading only `needs.suite.result` is how a
red detection run would report green.

**Required check:** require **`evals · L2 (behavioral) / l2`** — the aggregator job,
which runs on every PR whether or not it opted in and whether or not it affects a
suite. Never require a per-suite job (`suite (tier-routing)`) or the `bug-detection`
job: those exist only on an opted-in PR that selected them, and a required check that
does not run leaves the PR pending forever. The aggregator rolls both up — a failure
in either fails it, and `skipped` is a pass on either, since a PR can legitimately
affect one eval and not the other.

### The link to self-improvement

A promotion-eligible lesson (`seen_count ≥ 3`) is a recurring failure — exactly
what a golden case should encode.
When a lesson is promoted via `diagnose`, add the case here so the fix is locked.
The `diagnostic-surface.md` failure taxonomies are a proto-spec for this golden set.

### `code-review-retrieval-relevance` — methodology note

This suite measures whether `pr-reviewer`'s documented Step 1.0 (`mcp__lorekit__memory_list`)
+ Step 1.2c (`mcp__lorekit__memory_search`, enriched query) read surfaces the lessons
that should fire for a given PR diff + candidate memory pool.

**The rubric is those two subsections and nothing else.**
It reads `### 1.0` and `### 1.2c` through `rubric.sections`, not their `## Step 1` parent.
`extractSection` is heading-level-aware, so the parent captured all ten `### 1.x` subsections —
67,630 chars of impact graph, depth routing, and divergence pre-check against the 27,568 the two
own — and the suite ran at 3/5 (60%) against the 70% floor on both `main` and a PR head.
The material that decides it is `### 1.2d`, which shortlists Step 1.0's index by changed
directory, basename, symbol, integration, or `INTENT_PHRASE` before fetching bodies.
That is a real diff filter, correctly placed, but it answers a **different** question — *what
reaches the finders* — from the one these labels state, *what the documented read returns*.
With `1.2d` in the rubric a list-reachable lesson unrelated to the diff is legitimately `skip`,
and the suite contradicts its own `instruction` string.
Re-widening the rubric to the parent is a regression, and `G21a` reds on it.

**The question is procedure application, not relevance, and the `instruction` says so.**
The earlier wording asked whether the record "would be surfaced by the documented read *for the
given PR diff*", which put the diff in the framing and reads as an invitation to judge whether the
record is relevant to the change.
Two cases turn on exactly that distinction, and both were answered `skip` on a run where the
rubric already said in as many words that narrowing this read by apparent relevance is a defect —
so the framing, not the rubric's size or content, was the last untried lever.
The verb is **surfaces**, matching the labels: Step 1.0's source-attribution filter runs on what
its four calls returned, so a record another tool wrote *is* returned and then dropped, and under
"returns" the two source-attribution cases were answerable both ways.

Ground truth is **defined by the outcome signal** — `loop::reviewer-lessons` /
`loop::reviewer-comment-relevance` tags + `origin_pr` + `seen_count >= 3` marks a
promotion-grade should-fire lesson.
Labels are derived from this signal, not from re-running the read being measured.

**The read filters on four dimensions, and every label is decided by one of them alone** — tag,
scope (both paths read exactly `repo::{owner}/{repo}` and `global`, matched *exactly*: no
`branch::` or other-repo record is reachable), expiry, and source attribution
(`source.agent == "pr-reviewer" ∨ source.explicit == true`, applied to what the calls returned).
A record in range on all four is `surface` whether or not its gist relates to the diff; any one
out of range is `skip`.
Diff-relevance is not a fifth dimension and neither is `seen_count`, which is not even available
at Step 1.0 (`view="summary"` loads the index, not bodies).
An earlier version of this note defined `skip` by the tag dimension only, so the other three had
no ground truth here and the set tested none of them.

**Label balance is a correctness property.**
At 4 `surface` / 1 `skip` the majority-class baseline was 80% and cleared the 70% floor, so a
green meant only "the model stopped answering `skip`" — not that anything reasoned about
retrieval; and at N=5 one miss was 80% (pass) while two was 60% (fail), so the floor's own
justification ("only trips on a badly-broken rubric, not 1–2 cases of model noise") did not hold.
The set is now **14 cases, 8 `surface` / 6 `skip`** — a 57.1% baseline, so neither degenerate
strategy passes, and the floor tolerates 4 misses rather than 1.
L1 `G21n` asserts it, deriving the baseline from the JSONL and the floor from
`.github/workflows/evals-l2.yml`, so re-degenerating the split reds L1 rather than only a paid L2
run.
Grow the set by adding decoys, never by moving the floor.

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
| `.github/workflows/evals-l2.yml` | **evals · L2 (behavioral) / l2** | reports on every PR; **runs suites only on opt-in** — the `run-evals` label or a `workflow_dispatch` — and then only the affected ones ([details](#l2-in-ci-is-opt-in)) | `ANTHROPIC_API_KEY` | soft for the suites — `EVAL_GATE` floor (70%), per suite; **hard** for `bug-detection` (`recall ≥ 0.7`, `fp ≤ 0.2`) |

**To enable L2:** add an `ANTHROPIC_API_KEY` repository secret (Settings →
Secrets and variables → Actions). Accuracy + any misses are written to the PR's
check summary.

Without the key the *script* still exits 0 — that keyless skip is what makes a
fork PR (which cannot read secrets) and a fresh clone safe. **In CI it is not a
pass**, because an opted-in run must not report green having measured nothing:
the workflow sets `EVAL_REQUIRE_KEY=1`, so the runner exits 3 instead, and a
`::warning` names the missing secret for the human reading the log. That
distinction is not theoretical — 232 consecutive green runs were the keyless skip
path, the same self-concealing shape as a review that skips and reports a
legitimate outcome.

`workflow_dispatch` takes a `suites` input: `all` (default) or a comma-separated
list of suite names, for re-running one suite without touching a file.

**Why L2 only gates softly:** each golden set is < 50 cases, which `evals.md`
calls statistically noisy. The 70% floor only catches a badly-broken rubric, not
1–2 cases of model noise. Grow a suite's golden set to ≥ 50, then tighten the
floor (or switch to 0%-regression-vs-baseline) and gate it hard.

To require them: Settings → Branches → branch protection → "Require status
checks" → pick **evals · L1** (and **evals · L2** once the secret is set).

### The L2 baseline — first real run

The suites existed for 232 CI runs without the `ANTHROPIC_API_KEY` secret, so every
one of those greens measured nothing. This is the first run that actually executed,
recorded here so the next change has something to compare against rather than a
remembered number.

`claude-sonnet-4-6` · `EVAL_GATE=70` · nine suites, 140 cases · **130/140 = 92.9%**:

> **The denominator has since moved: nine suites are now 149 cases, not 140.** The
> retrieval suite's decoy set grew it 5 → 14. Every total on this page — `130/140`,
> `131/140` — is correct for the run that produced it and is **not** comparable to a
> current run; compare per suite, never on the aggregate. The row-level figures below are
> likewise a record of what those runs measured, not a target to reproduce.

| suite | cases | accuracy | misses |
| --- | --- | --- | --- |
| `bug-class` | 18 | 100.0% | — |
| `aw-should-trigger` | 15 | 100.0% | — |
| `optimize-approach-optimality` | 15 | 100.0% | — |
| `severity-tiering` | 15 | 100.0% | — |
| `reviewer-agreement-bump` | 6 | 100.0% | — |
| `complexity-triage` | 14 | 92.9% | `simple-5` (simple→complex) |
| `shape-depth-routing` | 22 | 90.9% | `plain-logic`, `refresh-runs` (both →`quick`) |
| `tier-routing` | 30 | 83.3% | 5, **all** →`Micro` |
| `code-review-retrieval-relevance` | 5 | 60.0% | `…unrelated-diff`, `…seen2-below-threshold` (both surface→skip) |

A **confirmation run** on the same rubrics after the scorer fix (`tier-routing`,
`shape-depth-routing`, `code-review-retrieval-relevance`) scored 25/30, 18/22 and 3/5.
Read the two together — the difference between them is most of what there is to learn.

**The first full run in CI** — all nine suites, on the opt-in path, after every fix in
this section — scored **131/140 = 93.6%**, against the 130/140 above. The aggregate
barely moved and the composition moved a lot, which is the point: `tier-routing`
+5 (83.3% → 100%), `severity-tiering` −2 (100% → 86.7%), `complexity-triage` −1,
`optimize-approach-optimality` −1, `shape-depth-routing` −1, everything else unchanged.
Only `tier-routing`'s gain is attributable to a rubric edit; the four −1/−2 moves are
suites nothing in this section touched, drifting inside the variance band. **Never read
the aggregate as a quality signal** — four uncorrelated single-case losses cancelled a
five-case rubric win, and a reader watching only the total would have seen a flat line
across the most substantive rubric fix in the repo's history.

**1. The `tier-routing` misses are real, and one hypothesis died.** All five landing on
`Micro` looked like a scoring artifact: `Micro` is both the first element of `choices`
and the first token of the `[Micro | Lite | Full]` placeholder in the rubric's own
`MODE SELECTION:` block, and the old earliest-substring parse scored that template line
as a confident `Micro`. The raw replies now printed on every miss refute it — the model
emits the block *filled in*: `MODE SELECTION: - Tier: Micro - Reasoning:`, and
`full-unfamiliar` replied with the bare word `Micro`. So these are genuine under-tierings
of the rubric, not a parse. The scorer fix stays (it closes a live failure mode and cost
nothing), but it fixed no miss, and the raw-reply line is what turned a plausible story
into a settled one in a single run.

The substance: `full-unfamiliar` — *"investigate and fix a memory leak somewhere in the
streaming pipeline — I'm not sure which layer"* — routes `Micro`, against Question 2
(*unfamiliar code or domains* ⇒ Full) and against **When in doubt, choose Full**. The
three `Lite`→`Micro` misses have a structural cause: the decision walk's Q4 fires `Lite`
on *"2–3 files **OR** any non-trivial logic change"*, while the tier table below it
describes Lite as *"2–3 files, simple logic"* and Micro as *"1 file, purely mechanical"*.
A one-file non-trivial logic change is `Lite` by the walk and `Micro` by the table, and
the model resolves that contradiction toward the table every time. **Two tables in one
section disagreeing on one cell is the finding** — not model noise.

**2. `shape-depth-routing`: every miss is `→ quick`, and the second run found two more.**
18/22, with `plain-logic` (40 lines, `band: none`), `blast-radius-none-medium-delta`
(70 lines, `band: none`), `refresh-runs` (`FULL_REFRESH_RUNS` fired) and
`refresh-cumulative` (`FULL_REFRESH_DELTA` fired) all routing `quick`. One cause covers
all four: **`blast_radius.band == none` is being read as sufficient for `quick`**,
overriding both the `standard` row's `11 ≤ DELTA_LINES ≤ 100` band and the `deep` row's
*"a refresh counter fired"*. Three properties of the rule file feed it — the `quick` row's
"Chosen when" is the single word `otherwise` with nothing saying `band: none` alone is not
"otherwise"; the refresh triggers are four words in the `deep` row whose counters are
defined in a section *below* the table and below `--effort`; and the worked-example block
shows a `deep` and a `quick` and **no `standard`** — the tier the golden set calls "the
middle tier's default population".

**3. The variance is the third finding.** Same rubric, two runs: `shape-depth-routing`
20/22 → 18/22, and `tier-routing` held at 5 misses while the *set* changed
(`lite-error-toast` in, `full-api-refactor` out). At n=22, ±2 cases is ±9 points. The 70%
catastrophic floor survives that; a "no regression vs baseline" gate would be pure noise
at these sizes. Do not tighten a floor until a golden set reaches ≥ 50.

**4. `code-review-retrieval-relevance` should not have been gating.** 5 cases at a 70%
floor allows exactly one miss, and its own golden notes say `BOOTSTRAP SEED — NOT A REAL
BASELINE`. At 5 cases it was `[advisory]` and could not breach the floor.

> **Superseded — it gates again.** The decoy set took it to 14 cases, back over
> `EVAL_GATE_MIN_CASES` (10), so it grades for real. It measured **9/14 (64.3%)** three times
> running with an identical miss set, which is a defect signature rather than noise: the cause
> was the suite's own `instruction` asking whether the read surfaces a record *"to the finders"*
> — a question §1.0 answers the *other* way, since Step 1.2d shortlists by changed path before
> the finders see anything — while the labels encode list-reachability. The question is now
> scoped to what the read **returns**, and the three runs since measured **10/14**, **11/14**
> and **11/14** (71.4 / 78.6 / 78.6%) — green every time, with the three misses predicted to
> remain recurring identically in all three and forming the *entire* miss set in the last two.
> One case is 7.1 points here, so quote that composition rather than any of the numbers; the
> per-case history, the full run table and what the fix did *not* close are in
> [`golden/code-review-retrieval-relevance.NOTES.md`](./golden/code-review-retrieval-relevance.NOTES.md).
> Every figure for this suite below predates the decoys and describes 5 different cases; none of
> them is comparable to a post-decoy run.

Separately, its rubric is the 67,630-char `## Step 1`
section — 6.4× the next largest — most of which is prior-comment awareness and gate
grading, while both misses turn on two facts the section only implies by *absence* (the
Step 1.0 `memory_list` is neither diff-filtered nor `seen_count`-gated) in the presence of
an explicit `seen_count ≥ 3` promotion rule that reads like a filter. That is a defect in
the shipped instructions, not only in the eval: an agent reading that section can draw the
same inference. Stating both non-filters explicitly, and repointing the suite at
`agents/pr-reviewer/rules/memory.md` — the file that *owns* the read contract, the same
reasoning that moved `shape-depth-routing` to `depth-routing.md` — would remove the
distractors.

**Cost, measured on both runs.** Uncached: **254,219 input tokens ≈ $0.77** at
sonnet-4-6, and two suites are 56% of it, because cost is `rubric_chars × cases` rather
than case count. With the cached system block, per suite:

| suite | before | after (billed-equivalent) | |
| --- | --- | --- | --- |
| `code-review-retrieval-relevance` | 84,540 | 466 input + 19,767 write + 79,068 read ≈ **33,100** | −61% |
| `shape-depth-routing` | 58,110 | 3,394 input + 3,014 write + 63,294 read ≈ **13,500** | −77% |
| `tier-routing` | 18,390 | 21,618 — `cache MISSED` | 0% |

The third row is the honest limit: a cache needs a ~1024-token prefix and `tier-routing`'s
rubric is ~613, so it cannot benefit — nor can `bug-class` (~342) or
`reviewer-agreement-bump` (~252), which are also the three cheapest suites. Projected full
run: **~$0.30, not the ~$0.15 a flat 80% would imply.** When the cache hits,
`input_tokens` collapses (466 for a suite that read 79k), so read the cache counters as
the cost, not the input figure.

**The first full CI run confirmed that prediction exactly** — those three suites and no
others reported no cache activity, and the other six all wrote and read a block between
1,179 and 8,185 tokens. It also showed the *warning* was the problem rather than the
cache: `cache MISSED (… the rubric is being re-billed per case)` reads as a defect
report, and on a small suite there is nothing to fix. The runner now separates the two —
`cache not applicable (~N tokens/case is below the 1024-token minimum cacheable prefix)`
when the prompt was never cacheable, and keeps `cache MISSED` for the case that is
actually worth investigating: a long prompt with no cache activity.

**The projections above are estimates from character counts; the runner now measures
the real thing.** The first wording decided between the two messages on total input ÷
case count, which is the wrong quantity — only the system block carries
`cache_control`, so a small rubric with large cases could be dragged over the bound by
user-message tokens and cry `MISSED`. It now tracks the largest system block the run
actually built. The next CI run printed `cache not applicable (largest cached prefix
~935 tokens, …)` for `tier-routing`, matching the local measurement to the token — so
the estimates in the paragraph above (~613/~342/~252) are the right *ordering* and are
low by roughly a third in magnitude. The measured figures are ~935, ~405 and ~317, and
`tier-routing` therefore misses the bound by under 90 tokens while carrying the largest
uncached bill in the run (30,168 input tokens — more than any cached suite pays after
its discount). Padding a rubric to reach the bound would be writing for the biller
instead of the reader, so that loss is accepted and named rather than engineered away.

### The post-fix run, and the three rubric fixes it measured

The three rubric defects the baseline diagnosed were fixed and the affected suites
re-run on the same model. Read this next to the confirmation-run figures above:

| suite | baseline | confirmation | post-fix | CI run 1 | CI run 2 |
| --- | --- | --- | --- | --- | --- |
| `tier-routing` | 25/30 | 25/30 | **30/30** (100%) | **30/30** (100%) | **30/30** (100%) |
| `shape-depth-routing` | 20/22 | 18/22 | 21/22 (95.5%) | **20/22** (90.9%) | **20/22** (90.9%) |
| `code-review-retrieval-relevance` | 3/5 | 3/5 | 4/5 (80%) `[advisory]` | **3/5** (60%) `[advisory]` | **3/5** (60%) `[advisory]` |

**The CI columns are the authoritative ones**, and two of the three suites came back a
case *worse* in them than the local post-fix run — `shape-depth-routing` re-missed
`mutex-small-delta` (standard→deep) alongside `no-deep-pass-on-record`, and
`code-review-retrieval-relevance` re-missed `…seen2-below-threshold` (surface→skip)
alongside `…unrelated-diff`. Nothing changed between the local run and CI but the
sample. This is the ±1–2 case variance the paragraphs below already warn about, arriving
immediately and on two suites at once, so treat a single post-fix run as *directional* —
it says the edit did not make things worse — and never as a settled figure.

**All three then reproduced their CI figures exactly on the next push**, including
`shape-depth-routing` re-missing the *same two* cases rather than two of comparable
count. That changes how those two misses read: a figure that repeats with an identical
miss set is a rubric defect, where one that moves around at the same total is sampling
noise. So `mutex-small-delta` and `no-deep-pass-on-record` are real gaps to fix when
someone next works that rubric — `no-deep-pass-on-record` still routing `deep`→`quick`
means `D6` is being missed even now that it is its own numbered row. `tier-routing`'s
30/30 has now reproduced three times and is the one result here strong enough to quote
on its own; it is also the largest suite.

`shape-depth-routing` took two edits, and **the intermediate run is the instructive
one** — it is why the column above is a single figure per suite and this paragraph
exists next to it. The first edit fixed the grammar of the refresh clause and
`refresh-runs` duly passed, but the suite came back **20/22** with two *different*
misses: `new-file` (deep→standard) and `no-deep-pass-on-record` (deep→quick). One miss
had become two, and reading the pair together said why. Both were triggers buried
deepest in a single overloaded table cell — `NEW_FILES > 0` was last of thirteen
`·`-separated conditions, and the absence of a prior `deep` pass was nested one level
down inside the refresh clause the edit had just made longer. A cell like that gets
scanned until something matches and then abandoned, so the fix was structural rather
than semantic: the conditions became an enumerated `D1`–`D13` checklist placed *before*
the tier table, with the cell reduced to `ANY of D1–D13 above`. Same thirteen triggers,
same order, same thresholds, and the surrounding prose now refers to them by ID instead
of restating them.

The lesson is about the *shape* of a rubric, not this rubric: a long `·`-separated cell
reads as a sentence that can be finished early, and clarifying one clause inside it
makes every later clause harder to reach. It is also a caution about single-suite
iteration — the first edit looked like a fix (`refresh-runs` passed) and was in fact a
net regression on the count.

`tier-routing`'s five under-tierings all came from the same three ambiguities and all
five closed: the walk-vs-table precedence, Micro's one-condition bar, and Q2's silence
on an unknown location. Nothing was re-labelled and no golden case was added — the
labels were right and the rubric was wrong, which is the outcome this suite exists to
distinguish from model noise.

The remaining misses — two in the post-fix run, four in the CI run — are **not** being
chased, deliberately. The reasoning is the same for the pair each suite re-missed as for
the one it kept:

- `no-deep-pass-on-record` is one case at n=22, where the measured run-to-run variance
  is ±2 cases. Its trigger is now `D6` — its own row, its own `**no**`, and a paragraph
  under the checklist stating that `D4`–`D6` are three independent triggers and that a
  recorded prior `deep` pass satisfies neither of the other two. Three edits in, with
  the condition stated three separate ways, a fourth aimed at this one golden line
  would be tuning the shipped rule to the eval rather than to a reader.
- `…unrelated-diff` sits in a **5-case advisory** suite whose golden file says
  BOOTSTRAP SEED — NOT A REAL BASELINE in as many words. The remedy for a small suite
  is more real-corpus cases, never more rubric tinkering: another precision edit
  aimed at one golden line would be over-fitting the shipped instructions to the eval.

### The L2-detection baseline — the first three runs

`bug-detection` had never executed in CI (it ran in no workflow; only its
`--self-test` was exercised). These are its first real measurements, on the detection
core as it already stood — the numbers describe the core, not the change that permitted
them:

`claude-sonnet-4-6` · 30 records (20 seeded + 10 decoy controls) · 4-way concurrency · ~3 min:

| stage | run 1 | run 2 | run 3 |
| --- | --- | --- | --- |
| finder only | 75% (15/20) · fp 50% (5/10) | 80% (16/20) · fp 50% (5/10) | 70% (14/20) · fp 40% (4/10) |
| + verifier | 75% · fp **30%** (3/10) | 60% (12/20) · fp **40%** (4/10) | 70% · fp **30%** (3/10) |
| verifier lift | **+20** (fp −20, recall −0) | **−10** (fp −10, recall −20) | **+10** (fp −10, recall −0) |

**Verdict: red in all three** — on `fp_rate` alone in runs 1 and 3 (30% > 20%), and on
both rates plus a negative verifier lift in run 2. The gate is red on the current core,
and that is the eval working: it found something the moment it was first permitted to
run.

**Read the runs together, never one alone.** That is the first finding, and it retracts
the strongest claim run 1 appeared to license:

- **The verifier's value is NOT established** — and the third run does not establish it
  either, it only narrows what the disagreement is about. Run 1 showed the verifier
  halving the finder's false positives (50% → 30%) at *zero* recall cost, which read as
  `finders.md`'s "finders flag, the verifier filters" polarity measured rather than
  argued. Run 2 shows it spending 20 points of recall to buy 10 of precision — a
  **negative** lift the runner names outright. Run 3 lands between them and looks like
  run 1: −10 fp at −0 recall. So two of three runs show the polarity working and one
  shows it inverted, across a lift spread of −10 to +20 points. At 20 seeded records and
  10 controls, one case moves recall by 5 points and one control moves `fp_rate` by 10,
  which is the whole spread — so the honest reading is still *unestablished*, with run
  2's recall cost looking more like the outlier than the rule. Never quote a single
  detection run as evidence for or against the verifier, and never tune the two rubrics
  against one.
- **`fp_rate` after the verifier looked like the stable number — 30% in runs 1 and 3, 40% in
  run 2 — until runs 4 and 5 came back at or under 20% and back at 40%. It is not stable
  either.** Five runs: `fp_rate` 30 · 40 · 30 · ≤20 · 40, recall 75 · 60 · 70 · 75 · 90%.
  Runs 4 and 5 were both on #184, whose diff touches neither detection rubric, so that
  pair is a clean same-content measurement and the spread between them is pure run-to-run
  variance.

  This **retracts** the earlier reading that the precision gap is the *reproducible*
  failure. One meet in five is a flaky gate, not a standing red — and run 5 pairs the
  worst `fp_rate` with the best recall yet (90%, only two records missed), which is the
  finder-aggression trade the two rubrics encode showing up as noise at these sample
  sizes rather than as a fixed operating point. Both rates are still worth aiming at, and
  the controls first, since four of five runs failed there. But do not treat a red or a
  green detection run as telling you the core changed: that is the same one-run rule as
  the bullet above, now demonstrated on the gate itself and not merely on the verifier's
  lift. Run 5 also lost one record to an unparseable finder reply
  (`intent-revert-not-fix`, prose instead of JSON) — counted as a miss, never as clean,
  and still never a reason to loosen the parse.
- **`intent-mismatch` is the weak class in all three** — 1/4, 2/4, 2/4, against 3/4–4/4
  elsewhere; `standards` is 4/4 every time. Most of its misses were never flagged at all,
  so the gap is predominantly finder recall rather than verifier over-filtering. `logic`
  moved 3/4 → 1/4 → 3/4, both run-2 losses being verifier drops — the same instability,
  seen per class, and the same partial recovery.
- **One record failed on output shape, not detection — and it is the same record
  twice.** In run 1 `intent-revert-not-fix`'s finder replied prose (`Looking at…`)
  instead of JSON; in run 3 the same record failed the same way (`The descri…`). It is
  counted as a **miss**, never as clean — the right bias. Do **not** loosen the parse to
  recover it; a finder that cannot emit its own contract has not found anything. That it
  recurs on one specific record points at that record's prompt rather than at model
  flakiness, which is a cheap thing to check before touching the parser.

**Neither rate is fixed here, and the gate is not lowered to accommodate them.**
Raising the detection core's precision means editing `finders.md` /
`finding-verifier.md` — the rubrics this eval measures — which per
[the maintenance table](../../CLAUDE.md#keeping-the-evals-honest-mandatory-on-every-change)
needs its own golden records (decoys included) and its own re-run. Lowering the gate to
meet the current core is the fix-to-pass this repo forbids everywhere else, and it is
what left the eval unrun in the first place. The variance above also says *how* to do
that work when someone does: **repeat runs before and after**, and three is a floor
rather than a target — it took the third run to tell run 2's recall cliff from a trend.
A single post-change run, inside a ±20-point recall swing, cannot tell a rubric
improvement from noise.

That prescription — repeat runs, three as a floor — is what makes the detection
runner's cost the binding constraint on this work, and it is why the runner is now
instrumented the way `l2.mjs` already was.

### The detection runner's token line

`l2-detection.mjs` prints a `tokens:` line before either exit, and its two system
blocks carry `cache_control: ephemeral`. Both are copies of what `l2.mjs` does, for
the same reasons, and neither can move a measured number: the model receives identical
tokens either way, so no result in this file needs re-baselining because of them.

Three things are specific to this runner:

- **Both prefixes are cacheable, so a `MISSED` here is a real defect.** `l2.mjs` has
  three suites genuinely under the 1024-token minimum, where "cache not applicable" is
  the honest report. Here the two prefixes are whole rule files (~2.5k tokens each), so
  the self-test asserts they clear the bound — shrinking one below it reds L1 rather
  than silently converting a discount into "nothing to discount".
- **The verifier prefix is the larger bill.** The finder prefix is re-sent once per
  record; the verifier prefix once per *candidate*, and a 30-record run raises well over
  30 candidates. That asymmetry is also why the runner's cost scales with how noisy the
  finders are, not just with the record count.
- **The tokens are counted inside `ask()`, not returned to the caller.** `l2.mjs`
  threads `usage` back so each case span carries its own numbers; this runner emits no
  telemetry and makes 1 + N calls per record, so a record that throws on its third
  verifier call would drop the two calls already billed. Counting where the request is
  paid for cannot undercount.

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
