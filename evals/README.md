# Plugin evals — does each skill beat no skill?

These cases run the repo root as a Claude Code plugin through [`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals).
Each run is a sandboxed `claude -p` with only this plugin loaded; under `--ablation with-without` every case also runs with no plugin, and `Δ` is the difference.
A skill whose `Δ` stays at or below zero is decoration: the model already does what it teaches.

## Run

From the repo root:

```bash
# Ablation suite: does the skill change the outcome? (both arms)
pnpm plugin-eval --tag ablation --runs 3 --max-cost-usd 40 -j 4 --json /tmp/plugin-eval.json

# Trigger suite: does natural phrasing reach the right skill? (one arm; a Skill grader can never pass without the plugin)
pnpm plugin-eval --tag trigger --ablation none --runs 3 --max-cost-usd 5 -j 4

# One case while iterating on it
pnpm plugin-eval --case critical-premortem --runs 1 --ablation none
```

`pnpm plugin-eval` expands to `claude plugin eval . --trust-plugin --scaffold --no-publish --allow-tools Write Edit Bash`.

| Flag | Why it is in the script |
| --- | --- |
| `--scaffold` | Cases copy their `fixtures/` into the empty workspace through `scaffold.sh`; without it they start empty |
| `--allow-tools Write Edit Bash` | The refactor, TDD, and plan-artifact cases edit files and run `node --test`; Bash runs inside the OS sandbox |
| `--trust-plugin` | Skips the first-run trust prompt, which `--json` cannot answer |
| `--no-publish` | Keeps `report.html` local |

## Cost knobs

- A smoke run (3 cases × 1 run × 2 arms) costs about $1.40; the full ablation suite at `--runs 3` is roughly 7 cases × 6 runs.
- `--max-cost-usd` stops new runs once the estimate is spent (exit 2, partial results).
- `--runs 1` while editing a case, `--runs 3` (the default) before trusting a `Δ`.
- `--ablation none` halves the cost when you only need to know the case loads and grades.
- `--model <id>` and `--judge-model <id>` pin both models; compare `Δ` only between runs with the same pins.
- `--tag smoke` selects the three cheapest representative cases.

## Read the result

Results land in `evals/results/<timestamp>/` (gitignored), or the `--json` path.

| Field | Meaning |
| --- | --- |
| `cases[].aggregates.score` | Mean with-plugin score, 0–1 |
| `cases[].aggregates.scoreWithout` | Mean no-plugin score |
| `cases[].aggregates.delta` | `score − scoreWithout`; what the skill contributed on this case |
| `aggregates.meanDelta` | Mean `delta` across the cases that ran both arms |

A `tool_used: Skill` grader is a plugin-fired indicator in a two-arm run (`scored: false`): it tells you whether the skill was invoked, not whether the outcome improved.

## Decision rule

1. Run the ablation suite at `--runs 3` with pinned `--model` and `--judge-model`.
2. A skill whose every case has `delta ≤ 0` is a deletion or slimming candidate.
3. Before acting, check the case's `skill-fired` indicator or trace: a skill that never fired has a description problem, not a content problem.
4. A negative `delta` with the skill firing means the skill makes the outcome worse; read the failing grader's explanation in `report.html`.

## Write a case

- One directory per case: `prompt.md` (frontmatter + prompt), `graders/*.md`, and, when it needs files, `case.yaml` + `scaffold.sh` + `fixtures/`.
- Tag it `ablation` (outcome graders, both arms) or `trigger` (one `tool_used: Skill` grader).
- Tag it neither when the plugin arm alone is the test, as for `review-lens` cases, whose scaffold installs the reviewer and so equips both arms: run them with `--tag review-lens --ablation none`.
- Give it at least one deterministic grader (`regex`, `tool_used`, `tool_order`, `file_exists`) and at most one `llm` grader; L1 `G110` enforces both and the frontmatter keys.
- Ask for the outcome in a neutral format both arms can produce (for example `Severity: <tier>`), so `Δ` measures the decision, not the skill's house style.
- Keep `max_turns ≤ 15` and prefer read-only tools.

## Cases

| Case | Skill | Graders |
| --- | --- | --- |
| `polish-simplify` | `polish` | restating and ticket comments pruned, docstring contract, license header, and lint pragma kept, dead helper removed, nesting flattened with behaviour kept, threshold single-sourced, tests green and untouched, pass committed |
| `tdd-discount-codes` | `tdd` | red run before the first `src/cart.mjs` write, ≥ 4 passing tests, suite ran ≥ 2× |
| `critical-premortem` | `critical` | steelman heading, line-cited finding, no self-score, llm: grounded findings |
| `confidence-plan-gaps` | `confidence` | `Final:` ≤ 89%, names missing Acceptance Criteria, names the dangling path |
| `aw-create-plan-artifact` | `aw-create-plan` | `.agent/*/plan.md`, `.agent/*/checks.yaml`, `AC-n (covers: Rn)`, llm: testable criteria |
| `ux-signup-form` | `ux` | error association, labelled toggle or target size, llm: ≥ 5 of 7 defects |
| `behavioral-design-local-tests` | `behavioral-design` | names a barrier, no shaming, llm: diagnosis → intervention → metric |
| `behavioral-design-hard-postmortems` | `behavioral-design` | comparison or re-measure design, llm: diagnosis, steers off the performance-review link, ease lever first, system-of-record metric |
| `behavioral-design-hard-review-sla` | `behavioral-design` | baseline measured, llm: ≥ 2 barriers, friction-removing default first, no individual ranking, GitHub-data metric |
| `review-lens-team-path` | `branch-reviewer` + `.agents/review/lenses/` | reviewer dispatched; findings name the lens-only rule (`audit.record`) for a change under the lens's `applies-to` |
| `review-lens-team-control` | `branch-reviewer` + `.agents/review/lenses/` | reviewer dispatched; findings never name it for a change outside `applies-to` |
| `review-lens-builtin-tdd` | `branch-reviewer` + built-in `tdd` lens | reviewer dispatched; flags a test that mocks its own module and asserts call counts |
| `review-lens-builtin-approach` | `branch-reviewer --effort high` + built-in `optimize-approach` lens | reviewer dispatched; flags a shared package importing from an app |
| `trigger-critical`, `trigger-confidence`, `trigger-behavioral-design-1on1s` | each named skill | `Skill` fired |
| `trigger-neg-aw-question`, `trigger-neg-aw-here` | `aw` | `aw` / `autonomous-workflow` not fired |
