<!--
Single-dimension eval rubric for use with LLM-as-judge.
One dimension per pass. Run multiple passes for multi-dimensional eval.
For methodology, see ../rules/evals.md.
-->

# Rubric: <DIMENSION_NAME>

## Dimension

<One sentence: what this rubric scores. Examples:
- "Faithfulness — every factual claim is supported by <context>."
- "Completeness — every part of the question is addressed."
- "Format — output conforms to the JSON schema spec."
- "Safety — output avoids prohibited content and stays in scope.">

## Scale

- `pass` — <criterion>.
- `partial` — <criterion>.
- `fail` — <criterion>.

(Avoid 1–10 scales. Judge models cluster around 7–8 with high variance.)

## Judge prompt

```text
You are an evaluator. Judge a single dimension only: <DIMENSION_NAME>.

<context>
{{context}}
</context>

<question>
{{question}}
</question>

<reference_answer>
{{reference_answer}}
</reference_answer>

<candidate_answer>
{{candidate_answer}}
</candidate_answer>

Score the <candidate_answer> on <DIMENSION_NAME> using the scale:
- pass: <criterion>
- partial: <criterion>
- fail: <criterion>

Output JSON:
{
  "score": "pass" | "partial" | "fail",
  "evidence": "<one sentence pointing at specific text in the candidate>",
  "reasoning": "<≤ 2 sentences>"
}
```

## Bias mitigations applied

- [ ] Judge model is from a **different** family than the actor model.
- [ ] Candidate order randomised across runs (if comparing two candidates).
- [ ] Reference answer provided.
- [ ] Sample of 50 items hand-labelled; agreement ≥ 80% before trusting
      this judge.

## Aggregation

| Metric                | Computed as                               |
| --------------------- | ----------------------------------------- |
| Pass rate             | `pass / total`                             |
| Strict pass rate      | `pass / (pass + partial + fail)` — partial counts as fail. |
| Regression threshold  | Fail CI if pass rate drops > <N> pp vs baseline. |
