---
title: Testing — Pyramid, Mocks, VCR, Snapshots, CI Cost Discipline
impact: HIGH
tags:
  - testing
  - unit-tests
  - integration-tests
  - vcr
  - snapshot-tests
  - ci
---

# Testing AI Code

Evals (in `evals.md`) measure **product quality**.
Tests measure **engineering correctness** — that prompt templates render,
tool functions return what they promise, retrieval pipelines return
chunks in the right shape, and that none of it breaks on the next PR.

The two layers are complementary.
You need both.

## Contents

- The AI testing pyramid (unit / integration / eval)
- Unit-test the deterministic layer (snapshots, mocks)
- Integration tests with VCR record/replay
- Property-based tests for output validators
- Test the agent loop, not just the calls
- CI cost discipline (token budgets, gating)
- Flake handling (temperature, seeds, retries)
- Test prompt rendering, not model interpretation
- Common mistakes

## The AI testing pyramid

```text
                       ┌────────────────────┐
                       │   Eval suite (real │   Slow, expensive, judgment-based
                       │   models on golden │   See evals.md
                       │   set)             │
                       └────────────────────┘
                  ┌──────────────────────────────┐
                  │   Integration tests (record/ │   Medium, deterministic via VCR
                  │   replay; one real model run │
                  │   per PR)                    │
                  └──────────────────────────────┘
            ┌──────────────────────────────────────────┐
            │   Unit tests (mocked LLM, fast,           │   Most coverage lives here
            │   deterministic, pennies-on-cost)         │
            └──────────────────────────────────────────┘
```

Coverage targets:

| Layer        | Share of total tests | Run on               |
| ------------ | -------------------- | -------------------- |
| Unit         | 70–80%               | Every commit         |
| Integration  | 15–25%               | Every PR             |
| Eval         | 5%                   | Every prompt change  |

## 1. Unit-test the deterministic layer

What is unit-testable without calling a model:

| Component                       | Test                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| Prompt templates                | Renders correctly with known inputs; no missing slots; correct order. |
| Tool input/output schemas       | Validates correct inputs, rejects malformed.                         |
| Tool functions                  | Return the documented shape; error paths return `is_error: true`.    |
| Retrieval pre-processing        | Chunker boundaries, overlap, metadata propagation.                   |
| Retrieval post-processing       | Reranker takes top-N, returns top-K; ties broken deterministically.   |
| Output validators               | Reject schema-valid-but-semantically-wrong values.                   |
| Guardrail logic                 | Classifier wrapper fails closed on errors.                           |
| Cost tracker                    | Cumulative token counter; budget halt logic.                         |

These do not need a model.
**Do not** call a real model in a unit test — you'll burn money,
introduce flakes, and slow CI.

### Snapshot-test prompt templates

Prompt strings are an API.
A diff is a contract change.

```python
def test_triage_prompt_renders():
    rendered = render_triage_prompt(
        ticket="I want a refund...",
        customer_tier="gold",
    )
    assert rendered == snapshot("tests/snapshots/triage_prompt.txt")
```

Use `pytest-snapshot`, `vitest` snapshot, or `jest` snapshot.
Reviewers see the prompt diff in PR review — exactly what you want.

### Mock the LLM client at the boundary

Mock at the SDK boundary, not deeper:

```python
# Good — mock at SDK boundary
from unittest.mock import AsyncMock

async def test_agent_handles_tool_error():
    mock_client = AsyncMock()
    mock_client.messages.create.side_effect = [
        # first call: model asks for a tool
        Message(content=[ToolUseBlock(name="search_customers", input={"query": "..."})]),
        # second call: model returns final answer after tool error
        Message(content=[TextBlock(text="I couldn't find that customer.")]),
    ]
    result = await run_agent(mock_client, "find John")
    assert "couldn't find" in result
```

Mock the SDK, not your wrapper.
That way the test exercises your wrapper code.

## 2. Integration tests — record and replay (VCR)

Integration tests exercise the full path including the model — but
deterministically, via cassettes.

| Library                 | Languages           | Notes                                    |
| ----------------------- | ------------------- | ---------------------------------------- |
| `vcrpy`                 | Python              | Mature; HTTP-level recording.            |
| `pytest-recording`      | Python              | Wraps `vcrpy`; pytest-friendly.          |
| `polly.js`              | JS/TS               | Fetch-level recording.                   |
| `nock` + recorder       | Node                | Request-level mocking.                   |
| Provider-specific (e.g. `anthropic` `mock_response`) | varies | When available, prefer over HTTP-level. |

Pattern:

1. Run the test once with `RECORD=1` against the real model.
2. The cassette (a JSON/YAML file) is committed to the repo.
3. CI replays the cassette — no model call, no cost, deterministic.
4. Re-record only when the prompt or model intentionally changes.

```python
@pytest.mark.vcr()
async def test_full_triage_path():
    result = await triage_ticket(ticket="...", customer_id="c_123")
    assert result.intent == "refund"
```

The cassette pinning is the trade-off:

- **Pro:** zero model cost, zero flake, full path coverage.
- **Con:** when the prompt changes, cassette must be re-recorded.

Treat cassette regeneration as a code change — review the diff.

### Don't trust LLM output exactly in integration tests

Even with a cassette, asserting on free-text output is brittle if you
ever re-record.
Assert on **structural properties**:

```python
# Good — structural assertion
assert "refund" in result.intent           # one of a known set
assert result.confidence > 0.5             # bound, not exact
assert len(result.reasons) >= 1            # shape

# Bad — exact-match assertion
assert result.summary == "Customer wants refund for X-200..."
```

## 3. Property-based tests for output validators

Output validators are pure functions — perfect for property-based
testing (`hypothesis`, `fast-check`):

```python
from hypothesis import given, strategies as st

@given(st.floats(min_value=-1e9, max_value=-0.01))
def test_refund_amount_validator_rejects_negative(amount):
    with pytest.raises(ValidationError):
        validate_refund({"amount": amount})

@given(st.floats(min_value=0.01, max_value=1e6))
def test_refund_amount_validator_accepts_positive(amount):
    assert validate_refund({"amount": amount}).ok
```

This catches the schema-valid-but-semantically-wrong cases that
unit tests with hand-picked inputs miss.

## 4. Test the agent loop, not just the calls

For agents, the loop *itself* has test surface:

| Property                                | Test                                                     |
| --------------------------------------- | -------------------------------------------------------- |
| Iteration cap honoured                  | Mock infinite tool-use loop; assert halt at MAX_ITER.    |
| Token cap honoured                      | Mock high-token responses; assert halt at MAX_TOKENS.    |
| Parallel tool calls executed concurrently | Inspect call timing or order with mocked latency.        |
| Tool errors surface as `tool_result`    | Inject tool error; assert next message is a tool_result with `is_error: true`. |
| Stop condition triggers correctly       | Mock the model to emit no `tool_use`; assert loop exits.  |

These are unit tests with a mocked client — fast and deterministic.

## 5. CI cost discipline

CI is the single largest unmonitored AI spend in most teams.
Keep it bounded:

| Practice                                                             | Effect                          |
| -------------------------------------------------------------------- | ------------------------------- |
| Unit tests use mocks; **zero** real-model calls.                      | CI cost = 0 for the unit layer. |
| Integration tests use VCR cassettes; cassettes committed.            | Replay-only on every PR.        |
| Eval suite gated to `[run-evals]` PR label or main-branch only.      | Don't run on every WIP commit.  |
| Eval suite uses Batch API (50% off).                                 | Halves remaining cost.          |
| Eval suite uses prompt caching where the prefix is stable.           | Further 5-10× input savings.    |
| Per-PR token-budget alarm in CI.                                     | Catch a runaway test early.     |

Suggested guardrail:

```text
if PR_TOKENS > 100_000: fail CI with "exceeded test token budget — investigate"
```

## 6. Flake handling — temperature and seeds

Even with cassettes, you may run a real model in CI on rare paths.
For those:

- Use `temperature=0` everywhere except where stochasticity is the
  feature being tested.
- Set the provider's seed/`top_p` knobs if available (OpenAI:
  `seed`).
  Note: providers do not guarantee determinism even at `temperature=0`.
- Re-run flaky tests at most **once** before failing.
  Auto-retrying more masks real regressions.

For genuinely stochastic features (sampling, creative generation):

- Test the **distribution**, not the single output.
  E.g., "across 10 runs, at least 7 contain X."
- Use a much larger eval set there.

## 7. Test the prompt-template rendering, not the model's interpretation

A common anti-pattern: a "test" that checks "does the model produce
JSON" by calling a real model.

That's an eval, not a test.
Tests should check what your code does:

| Test (your code)                                          | Eval (model behaviour)                                |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `render_prompt(...)` returns the expected string.          | "Does the model output valid JSON given this prompt?"  |
| `parse_response(...)` rejects malformed output.            | "Is the JSON content semantically correct?"           |
| The agent loop halts at 15 iterations.                    | "Does the agent finish the task in under 15 iters?"   |

The left column is unit-testable.
The right column belongs in `evals.md`.

## Common mistakes

- **Calling real models in unit tests.**
  **Fix:** mock at the SDK boundary.
- **No snapshot for prompt templates.**
  **Fix:** snapshot — diffs become reviewable in PR.
- **Asserting on exact free-text output.**
  **Fix:** assert structural properties; use VCR cassettes.
- **Eval suite running on every commit.**
  **Fix:** gate to PR label or main; cache the stable prefix.
- **No agent loop tests.**
  **Fix:** mock-driven tests for cap, parallelism, error recovery.
- **Asserting "model returns valid JSON" in a unit test.**
  **Fix:** that's an eval; keep it out of unit tests.
- **Auto-retrying flaky tests until they pass.**
  **Fix:** at most one retry; investigate the rest as real failures.
- **No CI token budget.**
  **Fix:** cumulative cap with a fail-fast guardrail.
