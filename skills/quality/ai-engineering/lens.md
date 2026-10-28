---
for: pr-reviewer
lens-version: 1
applies-to: always
auto: true
diff-matches:
  - '@anthropic-ai/'
  - 'from ["'']openai["'']'
  - 'require\(["'']openai'
  - 'from ["'']ai["'']'
  - '@ai-sdk/'
  - 'langchain'
  - '\bclaude-(opus|sonnet|haiku|fable)'
  - '\bgpt-[0-9]'
  - 'system_?[pP]rompt|cache_control|tool_use'
---

# AI Engineering — Review Lens

## Trigger

Auto-loads when an added line imports an LLM SDK (`@anthropic-ai/*`, `openai`, `ai`, `@ai-sdk/*`, LangChain), names a model, or touches a system prompt, `cache_control`, or `tool_use` — the `diff-matches` list above.

## Checklist

- [ ] Prompt prefix is stable — `tools → system → stable context → volatile context → user input`; volatile values (timestamps, user IDs, random IDs) appear AFTER the stable prefix, not interleaved.
- [ ] Prompt caching is wired (`cache_control: { type: "ephemeral" }` on the stable prefix) when the prefix is ≥ 1 024 tokens or is reused across calls in the same flow.
- [ ] `tools`, `tool_choice`, and `thinking` are not flipped mid-conversation — any change to these silently invalidates the cached prefix.
- [ ] Model is pinned to a dated snapshot in production code paths (e.g. `claude-opus-4-7-20250101`), not a moving alias (`claude-opus-4-7`).
- [ ] Tool descriptions are written for an LLM consumer, not a human reader: ≤ 1 024 chars, action-first, list valid inputs and one negative example.
- [ ] Retry logic on 429 honours the `Retry-After` header AND adds full jitter; no fixed-interval or pure-exponential retries.
- [ ] Side-effectful tool calls carry an idempotency key (request-id, business key, or content hash) — retries must not double-charge or double-write.
- [ ] No "let's think step by step" / chain-of-thought scaffolding added to a reasoning model (Claude with adaptive thinking, OpenAI o-series).
- [ ] Eval / regression test exists for any prompt change, OR the PR explicitly notes evals are deferred and why.
- [ ] No raw user input concatenated into the system prompt — at minimum an input classifier and an output validator wrap LLM-controlled destructive actions (OWASP LLM01:2025 defence-in-depth).
- [ ] Long conversations are summarised, not truncated — truncation drops semantic context the model needs.
- [ ] Memory / user-state keys are server-derived (session, JWT claim), never read from a value the model can fill in — prevents cross-user memory leakage.

## Severity hints

- **Must-fix**: model alias in production code path; raw user input in system prompt; side-effectful tool without idempotency key; cross-user memory key from model-controlled field.
- **Should-fix**: missing prompt caching on a reusable ≥ 1 024-token prefix; volatile content before stable; tool descriptions written for humans; 429 retry without `Retry-After` or jitter.
- **Nice-to-have**: chain-of-thought on reasoning models; missing eval entry; conversation truncation vs summarisation.
