---
title: Agents & Tools — Loops, Schemas, Parallelism, Stop Conditions
impact: HIGH
tags:
  - agents
  - tools
  - tool-use
  - workflow
  - loops
---

# Agents & Tools

The hierarchy:
**single LLM call < workflow (predefined control flow) < agent (model-driven loop)**.
Climb the ladder only when the previous rung fails.

## Contents

- Workflow vs agent — pick workflow first
- Hard-cap the loop (caller side, not SDK side)
- Tool design (good vs bad)
- Parallel tool calls
- Error recovery (return as tool_result, not exception)
- Multi-agent — last resort
- Common mistakes

## Workflow vs agent — pick workflow first

Anthropic's official guidance (and matches every well-run production
system in 2025): **workflows beat agents** on predictability, cost, and
latency.
Agents are model-driven — the LLM decides what to do next.
Workflows are code-driven — your code decides; the LLM fills slots.

Use a **workflow** when:

- The trajectory can be enumerated upfront.
- Each step has a clear input/output contract.
- You can run the steps in parallel safely.

Use an **agent** when:

- Trajectories are open-ended (debugging, research, exploration).
- The next step genuinely depends on the previous step's content in
  unpredictable ways.
- The user expects iteration.

Source: [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents).

## Hard-cap the loop — caller side, not SDK side

Neither the Anthropic SDK nor OpenAI SDK enforces loop termination.
You must.

Defaults:

| Agent shape                         | Iteration cap | Token cap           |
| ----------------------------------- | ------------- | ------------------- |
| Q&A / lookup agent                  | 3             | 50k cumulative      |
| Coding / research agent             | 15–20         | 200k cumulative     |
| Long-horizon (autonomous)           | 50            | 1M cumulative       |

Track `usage` cumulatively across the loop.
Halt when over budget.
Surface the halt to the user with a partial result rather than silently
truncating.

```text
loop:
  iter += 1
  if iter > MAX_ITER: break
  if cumulative_tokens > MAX_TOKENS: break
  call model
  if no tool_use blocks: break
  execute tool calls (parallel where safe)
  append results to messages
```

Source: [Anthropic — Implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use).

## Tool design

Tools should encapsulate the **verb the agent needs**, not wrap your
REST API.

### Good

```text
search_customers(query, filters)        — one verb, broad surface
issue_refund(order_id, amount, reason)  — one verb, atomic
get_account_summary(account_id)         — one verb, composed view
```

### Bad

```text
list_customers()                  — agent must paginate + filter
get_customer(id)                  — composes badly with search
filter_customers_by_zip(zip)      — too narrow; combinatorial
update_customer_field(id, k, v)   — error-prone; no contract
```

Rules:

1. **Describe situations, not implementations.**
   "Use when the user names a customer ambiguously."
   Not "Calls GET /api/v2/customers."
2. **Return shape matters as much as inputs.**
   Document what the agent will see and how to use it.
3. **Errors must tell the agent what to do.**
   `{"error": "missing_field", "field": "email", "fix": "ask the user for their email"}`.
   Generic "500: error" forces the agent to guess.
4. **Cap the tool count at 10–15 per agent.**
   Larger sets degrade selection accuracy.
   Split into specialised sub-agents.

Source: [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents).

## Parallel tool calls

Both Anthropic and OpenAI emit multiple `tool_use` blocks in a single
response when the calls are independent.
**Execute them concurrently**.

Sequential execution of parallel-safe calls multiplies turn latency 3–5×
for nothing.

```text
response.content_blocks
  → filter to tool_use blocks
  → Promise.all(blocks.map(execute))
  → return results in original order
```

Order-preservation matters: the model expects results in the same order
it requested them.

Disable parallelism only when calls have side effects that depend on
each other's results (rare — usually a workflow design smell).

Source: [Anthropic — Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use).

For retry, timeout, and idempotency rules around tool calls, load
[`resilience.md`](./resilience.md).
For long-running agents that need state across turns or sessions,
load [`memory-and-state.md`](./memory-and-state.md).

## Error recovery

When a tool raises:

1. Return the error **as a tool result**, not as an exception.
   The agent can then decide to retry, ask the user, or escalate.
2. Include a `fix` field telling the agent what to do.
3. After 2 consecutive failures of the same tool with the same args,
   stop calling it and escalate.

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01...",
  "is_error": true,
  "content": [{
    "type": "text",
    "text": "{\"error\": \"customer_not_found\", \"id\": \"c_123\", \"fix\": \"Verify the customer ID with the user; it may be a typo.\"}"
  }]
}
```

## Multi-agent — last resort

A multi-agent system (specialist sub-agents, orchestrator) is a real
last-resort design:

- 5–10× the cost of a single agent.
- 3–5× the latency.
- Hardest to debug — failures cross agent boundaries.

Apply only when:

- A single agent + workflow has been exhausted.
- The work decomposes cleanly into independent specialist domains.
- You have observability for cross-agent traces.

See `observability-and-versioning.md` for tracing.

## Common mistakes

- **Using an agent for a problem with an enumerable trajectory.**
  **Fix:** write a workflow.
- **No loop cap; SDK runs unbounded.**
  **Fix:** caller-side iteration + token cap.
- **Tools wrapping REST endpoints 1:1.**
  **Fix:** design tools as verbs the agent thinks in.
- **Sequential `await` of independent tool calls.**
  **Fix:** `Promise.all` (or equivalent).
- **30+ tools to one agent.**
  **Fix:** prune; split into sub-agents.
- **Tool errors thrown as exceptions instead of returned as `tool_result`.**
  **Fix:** wrap and return; the agent can recover only if it sees the error.
- **Multi-agent before single-agent + workflow is exhausted.**
  **Fix:** simpler shape first.
