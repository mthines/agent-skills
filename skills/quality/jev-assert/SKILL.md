---
name: jev-assert
description: >
  Verifies a UI expectation semantically by asking TypeSafe's Jev model
  whether a user-observable outcome holds in a page's captured TEXT state
  (accessibility tree / page text — never a screenshot), then maps Jev's
  typed answer and probability onto this repo's verify-behavior receipt
  vocabulary (confirms, contradicts, ambiguous, null, unobtainable).
  Driver-agnostic: consumes text state from either the Playwright
  (aw-tester) or the claude-in-chrome (aw-tester-chrome) runner, so the
  Chrome-vs-Playwright choice is orthogonal to it. Use it for a semantic UI
  assertion where an exact locator or string match is brittle — "did the
  user see a success state", "is this the right screen". Delegates the API
  contract to the typesafe@typesafe-ai skill (TYPESAFE_API_KEY). Triggers on
  "assert semantically", "does the page show", "verify this outcome with
  jev", "semantic UI assertion", "jev-assert", "/jev-assert".
argument-hint: '<expectation> [--state-file <path>] [--threshold-high N] [--threshold-low N]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags:
    - jev
    - typesafe
    - semantic-assertion
    - ui-verification
    - verify-behavior
    - receipt
    - browser-testing
    - system-one
---

# jev-assert

Turns a natural-language, user-observable UI expectation into an executed
semantic verdict.
It reads a page's captured **text** state, asks TypeSafe's **Jev** model one
narrow judgment, and emits a `verify-behavior` receipt the rest of this repo
already consumes.
It never drives a browser, never applies a fix, and never writes code — it is a
read-only verification primitive, the semantic sibling of
[`verify-behavior`](../verify-behavior/SKILL.md).

> **This `SKILL.md` is a thin index.** Detailed rules live in `rules/*.md` and
> load on demand.

---

## What it returns

The terminal deliverable is one receipt line, byte-compatible with the
canonical vocabulary in
[`verification-receipt.md`](../../../agents/shared/rules/verification-receipt.md):

```text
[receipt] tier: 3 | tool: jev | target: <page/spec>
[receipt] question: Does the page state show that <expectation>?
[receipt] jev: noul=0.94
[receipt] verdict: confirms
```

The five verdicts and when each is emitted are owned by
[`rules/receipt-mapping.md`](./rules/receipt-mapping.md).
`null` (ran, no support) and `unobtainable` (could not run) are distinct and
never collapsed — the same rule `verification-receipt.md` enforces.

## Why Jev, and why text-only

Jev is a TypeSafe **System One** model: it takes structured natural-language
state and returns a **typed answer with a probability** (Noul / Choice /
Score), not generated prose.
That is exactly the shape a test assertion needs — a decision code can gate on,
with calibrated confidence.
Jev evaluates **text**, not images, so the browser side must feed it an
accessibility snapshot or page text; a screenshot is never a valid input.
See [`rules/state-extraction.md`](./rules/state-extraction.md).

## Workflow

Run these three steps in order; each has a gate.

| Step | Name              | Rule file                                                | Gate                                                        |
| ---- | ----------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| 0    | Provenance guard  | [`rules/provenance.md`](./rules/provenance.md)           | Expectation is a user-observable OUTCOME, not a restatement of the state text |
| 1    | State extraction  | [`rules/state-extraction.md`](./rules/state-extraction.md) | Page TEXT state captured (a11y tree / page text); no screenshot |
| 2    | Jev call + mapping | [`rules/receipt-mapping.md`](./rules/receipt-mapping.md) | Jev primitive resolved and mapped to exactly one receipt verdict |

## Invocation contract

Callers supply two things — the **page text state** and the **expectation** —
and receive one receipt.

- **`<expectation>`** — a user-observable outcome in plain language, phrased as
  something a person looking at the screen could confirm.
  Provenance (Step 0) rejects an expectation that merely restates the captured
  text (assertion-by-construction).
- **`--state-file <path>`** — a file holding the captured text state.
  When omitted, the caller passes the state inline (the spec runners do this).
- **`--threshold-high N` / `--threshold-low N`** — override the default
  decision bands (see `rules/receipt-mapping.md`); both are calibration knobs,
  not magic numbers.

The concrete call path is the committed, zero-dependency script — it builds the
Noul question, POSTs it, and maps the probability to a verdict per
`receipt-mapping.md`:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/jev-call.mjs \
  --expectation "the user sees an order-confirmation number" \
  --state-file <captured-state.txt> --target <page-or-spec-id>
```

State also reads from stdin when `--state-file` is omitted (the runners pipe
captured page text in). The script follows the TypeSafe HTTP API contract
documented by the official `typesafe@typesafe-ai` skill — install that skill for
the API guidance, prompting patterns, and SDK; this skill owns only the
*semantic contract* (question template, thresholds, receipt mapping) and does not
fork the wire format. The API is keyed by the `TYPESAFE_API_KEY` environment
variable. When `TYPESAFE_API_KEY` is unset or the API is unreachable, the check
**could not run** — the script emits `unobtainable`, never a `confirms` /
`contradicts` guess. Run `node ${CLAUDE_SKILL_DIR}/scripts/jev-call.mjs
--self-test` to verify the mapping offline.

## Consumer: the semantic `THEN` assertion

The primary consumer is the shared UI spec grammar
([`spec-run-contract.md`](../../workflow/autonomous-workflow/rules/spec-run-contract.md)).
A spec author writes a semantic assertion with the `semantic:` prefix, mirroring
the existing `network:` form:

```text
- WHEN {role: "button", name: "Place order"} is clicked
  THEN semantic: the user sees an order-confirmation number
```

Both runners ([`aw-tester`](../../workflow/autonomous-workflow/templates/aw-tester.agent.md)
and [`aw-tester-chrome`](../../workflow/autonomous-workflow/aw-tester-chrome/SKILL.md))
capture the page text state, call this skill, and fold its receipt into the
spec verdict: `confirms` → the assertion passes; `contradicts` / `null` → it
fails; `ambiguous` / `unobtainable` → the spec is `inconclusive`, never a
silent pass.
`ui-verify` reuses that grammar verbatim, so a semantic `THEN` flows through to
PR/preview verification with no extra wiring.

## Core Principles

1. **A receipt, not a score.** This skill emits a `verify-behavior` verdict and
   the raw Jev probability; it never invents its own grading number —
   `confidence(code)` owns any score.
2. **User-observable outcomes only.** An expectation the agent could confirm by
   re-reading the state text it was handed is assertion-by-construction and is
   refused, mirroring [`observe-run`'s assertion-provenance rule](../observe-run/rules/assertion-provenance.md).
3. **Text in, typed out.** Jev never sees a screenshot; the input is always
   captured accessibility/page text.
4. **Fail honest, not confident.** No key, no state, or an unreachable API is
   `unobtainable` — a verdict about the tooling, never a guessed pass or fail.
5. **Driver-agnostic.** The same call works over Playwright or claude-in-chrome
   state; there is one implementation, not one per driver.

## Evaluation

- [ ] Golden set separates user-observable-outcome expectations (accept) from
      by-construction / DOM-restatement expectations (reject), balanced and
      resistant to a single-keyword shortcut — see `evals/evals.json`.
- [ ] `evals/triggers.jsonl` covers should-trigger and adjacent near-miss
      queries.
- [ ] The repo eval obligation is met: the receipt-token set is a mechanical
      contract guarded in `scripts/eval/l1.mjs`; the accept/reject provenance
      decision is an enumerable judgment guarded by a golden set.

## Anti-patterns

- Feeding Jev a screenshot or an image path — it is text-only.
- Phrasing the expectation as "the page contains the string I just read".
- Treating `unobtainable` as a failure, or `null` as a pass.
- Duplicating the TypeSafe API guidance instead of installing
  `typesafe@typesafe-ai` — `jev-call.mjs` follows its documented contract, it
  does not replace the guidance.
- Emitting a bespoke verdict word outside the five canonical receipt tokens.

## Definition of Done

- [ ] Every planned file written and within its line cap.
- [ ] `name` / `description` validate; `node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs`
      (run from `create-skill`) reports PASS.
- [ ] The receipt tokens match `verification-receipt.md` exactly.
- [ ] The `semantic:` assertion form is wired into `spec-run-contract.md`,
      `specs.md.template`, and both runners.
- [ ] Inventory rows added to `CLAUDE.md` and `README.md`.
