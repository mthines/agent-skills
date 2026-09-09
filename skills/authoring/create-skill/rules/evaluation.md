---
title: Evaluation — Proving the Skill Works Before Calling It Done
impact: HIGH
tags:
  - evaluation
  - testing
  - evals
---

# Evaluation

A skill that has never been run against a realistic prompt is a draft, not
a finished skill. Evaluation is Phase 6 of the scaffold workflow and the
`## Testing` section of the review checklist.

## Eval-first workflow

1. **Identify the gap.** Run the target task *without* the skill and note
   where the agent goes wrong (wrong file, wrong convention, skipped
   step, wrong tone).
2. **Write at least 3 realistic test prompts** — phrased the way an actual
   user or agent would phrase them, not as a restatement of the skill's
   own description.
3. **Baseline.** Run each prompt with the skill unavailable. Capture the
   result.
4. **Minimal skill.** Write the smallest `SKILL.md` that closes the
   observed gap. Do not front-load content the baseline run never needed.
5. **Iterate.** Re-run the same prompts with the skill installed; compare
   against the baseline. Add content only for gaps the comparison still
   shows.

## Observe navigation, not just output

Watch **how** the agent uses the skill, not only what it produces:

- Did it read files in the order the phase table implies, or jump around?
- Did it miss a linked rule file entirely?
- Did it re-read the same file more than once in a session? That file's
  content belongs in `SKILL.md` itself, not behind a link.
- Did it ignore a file you expected it to load? The link, or the phase
  table row pointing at it, is unclear — rewrite the pointer, not just the
  target file.

## Test across models

A skill is not "done" until it has been exercised on every model it is
expected to run under:

| Model  | Question to answer                                          |
| ------ | ------------------------------------------------------------- |
| Haiku  | Is there enough explicit guidance, or does it need judgment the smaller model does not reliably have? |
| Sonnet | Is the instruction clear and unambiguous at the default reasoning level? |
| Opus   | Is anything over-explained — spelling out a step a stronger model already infers, at the cost of tokens? |

A skill tuned only against one model either under-specifies for smaller
models or wastes tokens re-explaining to larger ones.

## Generalize, don't overfit

A skill iterated only against its own test prompts risks encoding the
exact phrasing of those prompts rather than the underlying task. After
each iteration, check the skill still reads correctly against a prompt
you did **not** use during iteration — phrased differently, from a
different angle. If it fails there, the fix is broader guidance, not a
special case for the new prompt.

### Bad — overfit to the test prompt

```markdown
If the user says "can you tidy up this Excel export", open the file with
pandas and drop the first two header rows.
```

Why bad: the rule only fires on that exact request. A rephrasing ("clean
this spreadsheet before I share it") falls outside the pattern-matched
condition.

### Good — generalized to the underlying task

```markdown
Normalize a spreadsheet export before sharing it: drop blank leading
rows, coerce header casing, and strip trailing whitespace from every
cell.
```

Why good: states the task and the transformation, independent of how any
one user phrased the request.

## Where to store eval artefacts

| File                                             | Contents                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `evals/evals.json`                               | `{skill_name, evals: [{id, prompt, expected_output, files, assertions[]}]}` — one entry per test prompt from step 2 above. |
| `evals/triggers.jsonl`                           | The should-trigger / should-not-trigger set from `description-writing.md`. |

Both are read on demand, never preloaded — see `progressive-disclosure.md`.

## The repo's own eval obligation

This repo additionally requires (root `CLAUDE.md` § "Keeping the evals
honest"): a new enumerable decision (a routing table, a tier ladder, a
class taxonomy) needs `scripts/eval/golden/<name>.jsonl` plus a `SUITES`
entry in `scripts/eval/suites.mjs`; a purely mechanical contract (a
section list, a required field, a line-count cap) belongs in
`scripts/eval/l1.mjs` instead, proven to bite by breaking the thing it
guards and watching it go red. Check both obligations before declaring a
new skill or a new decision inside an existing skill done.

## Definition of done for this phase

- [ ] At least 3 realistic test prompts written, none copied verbatim from
      the `description`.
- [ ] A baseline (no-skill) run captured for comparison.
- [ ] At least one with-skill run observed, including navigation (not just
      final output).
- [ ] Tested on every model the skill targets, or the user has explicitly
      waived a tier.
- [ ] `evals/triggers.jsonl` written for any `auto` skill.
- [ ] The repo eval obligation table checked and its outcome stated (which
      row applied, or that none did).
