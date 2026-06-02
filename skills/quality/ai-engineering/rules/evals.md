---
title: Evals — Golden Sets, LLM-as-Judge, Error Analysis
impact: HIGH
tags:
  - evals
  - testing
  - golden-set
  - llm-as-judge
  - error-analysis
---

# Evals

Evals are the regression suite for prompts.
Without them, you cannot tell whether a prompt change is an improvement.

For unit tests / mocking / VCR / CI cost discipline, load
[`testing.md`](./testing.md) — this rule covers eval methodology.

## Contents

- Start from error analysis on real traffic
- Golden set sizing (50–500)
- LLM-as-judge bias mitigations (judge≠actor, randomise, reference, sample-validate)
- Narrow rubrics (one dimension per pass)
- Eval-driven prompt development loop
- Separate eval stages for compound systems (RAG, agents)
- Common mistakes

## 1. Start from error analysis on real traffic

Hamel Husain's explicit rule:
**write evaluators for failures you've observed, not failures you fear.**

Process:

1. Pull 50–200 real production traces from your observability tool.
2. Read them.
   Tag each one with the failure mode (or "good").
3. Cluster failure modes.
   The 3–5 most common become your eval dimensions.
4. Build evaluators for those dimensions only.

Skipping this step traps teams optimising metrics that do not track
product quality.
"It feels off" is not an eval.

Source: [Hamel Husain — Evals FAQ](https://hamel.dev/blog/posts/evals-faq/).

## 2. Golden set — 50 to 500 input/output pairs

Maintain a versioned, in-repo golden set:

| Size       | Use                                                                |
| ---------- | ------------------------------------------------------------------ |
| < 50       | Statistically noisy. Do not gate CI on it.                         |
| 50–200     | **Default.** CI gate. Run on every prompt change.                  |
| 200–500    | Comprehensive coverage. Reach this when you have multiple features. |
| > 500      | Rarely needed for a single feature. Diminishing returns.            |

Each item has:

```yaml
- id: triage-001
  input: "I want a refund for my coffee maker, model X-200..."
  expected:
    intent: refund
    product: X-200
    blockers: ["no_receipt"]
  notes: "Was failing pre-2026-04-12 — model would mark intent=support."
```

CI gates on regression > N% (typically 0% — any regression blocks).
Source: [Hamel Husain — Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/).

## 3. LLM-as-judge — bias mitigations are non-negotiable

LLM-as-judge is useful but biased.
Apply all four mitigations:

1. **Different model family for judge vs actor.**
   Claude judges GPT.
   GPT judges Claude.
   Same-family judging shows ~10–25% self-preference inflation.
2. **Randomise candidate order.**
   Position bias is ~40% on GPT-4 (the first option wins more often).
   Randomise A/B order; aggregate over both orderings.
3. **Provide a reference answer when one exists.**
   Judge accuracy collapses without a reference for non-trivial tasks.
4. **Sample-validate against human labels.**
   Hand-label ~50 items.
   If judge agreement with humans is < 80%, do not trust the judge.

Sources:
[Justice or Prejudice? — LLM-as-Judge bias](https://llm-judge-bias.github.io/),
[Eugene Yan — LLM-as-Judge won't save the product](https://eugeneyan.com/writing/eval-process/).

## 4. Narrow rubrics — one dimension per pass

Multi-dimensional single-call scoring conflates verbosity with quality.
Run separate passes:

| Dimension          | Question                                                         |
| ------------------ | ---------------------------------------------------------------- |
| Faithfulness       | Are all factual claims supported by the provided context?        |
| Completeness       | Does the answer address every part of the question?              |
| Format             | Does the output conform to the schema/format spec?               |
| Safety             | Does the output avoid prohibited content / scope?                |
| Tone               | Does it match the brand tone guide?                              |

For each dimension: a 0/1 binary or a 1–3 ordinal (e.g.
`fail / partial / pass`).
Avoid 1–10 scales — judge models cluster around 7–8 with high variance.

A literal eval rubric template lives in
[`../templates/eval-rubric.md`](../templates/eval-rubric.md).

For a literal scaffold of a golden-set YAML file, see
[`../templates/golden-set.md`](../templates/golden-set.md).
For migrating to a new model version (which is when the golden set
earns its keep), see
[`model-migration.md`](./model-migration.md).

## 5. Eval-driven prompt development

Loop:

1. Make a prompt change in a branch.
2. Run the golden set (Batch API — see `token-optimization.md`).
3. Diff the results.
4. For every regression, hand-inspect the trace.
5. If the regression is real, revert.
   If it's a stale "expected" that the new prompt actually does better
   on, update the golden set with a note.

Treat the golden set as code: PR review, semver tags, no anonymous edits.
See `observability-and-versioning.md` for the prompt versioning side.

## 6. Separate eval stages for compound systems

For RAG and agent systems, evaluate each stage independently:

| Stage           | Metric                            | When it fails, fix…                |
| --------------- | --------------------------------- | ---------------------------------- |
| Retrieval       | recall@k, MRR                     | Chunking, hybrid weights, embeddings. |
| Reranker        | nDCG@5                            | Reranker model or top-k.            |
| Generation      | faithfulness, answer-relevance    | Prompt, output contract.            |
| End-to-end      | task accuracy                     | Whichever stage broke first.        |

A single end-to-end metric tells you something is wrong; not what.

## Common mistakes

- **No error analysis; eval criteria invented at the whiteboard.**
  **Fix:** read 50 production traces before building any evaluator.
- **Same model judging itself.**
  **Fix:** different family for judge.
- **No reference answer in the judge prompt.**
  **Fix:** add the reference; or use a deterministic check instead.
- **Multi-dimensional 1–10 scoring in a single call.**
  **Fix:** one binary/ordinal dimension per pass.
- **Eval set < 50 items, gating CI.**
  **Fix:** grow to 50–200 before gating.
- **Single end-to-end metric on a RAG/agent system.**
  **Fix:** measure each stage.
- **No version control on the golden set.**
  **Fix:** in-repo, PR-reviewed, tagged.
