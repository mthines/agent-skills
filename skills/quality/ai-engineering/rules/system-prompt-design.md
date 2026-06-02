---
title: System Prompt Design — Stability, Order, Tools, Refusals
impact: HIGH
tags:
  - system-prompt
  - prompt-engineering
  - tools
  - refusals
  - caching
---

# System Prompt Design

The system prompt is the durable contract between application and model.
It must hold only stable content, ordered for caching and attention.

## Contents

- Stable-only content rule
- Ordering: tools → system → messages
- Persona — when it shifts the answer surface
- XML vs markdown by model
- Tool descriptions (good vs bad examples)
- Refusals and scope (top-of-prompt rule)
- Stop conditions for agents
- Adaptive thinking (Q3 2025+) and the cache caveat
- Common mistakes

## Content rule: stable only

The system prompt holds:

- Persona (only when it changes the answer surface).
- Hard rules and refusal scope.
- Tool availability and tool descriptions.
- Output contract (schema, format, length).
- Domain glossary, fixed instructions.

Anything that changes per request goes in the user message.

| Belongs in system prompt        | Belongs in user message                  |
| ------------------------------- | ---------------------------------------- |
| "You are a triage agent."       | The current ticket text.                 |
| Refusal list.                   | The current user's role/permissions.     |
| Tool schemas.                   | Tool results from this turn.             |
| Output JSON schema.             | The retrieved chunks for this query.     |
| Glossary of internal codes.     | Today's date / timestamp.                |

Putting volatile content in the system prompt kills caching and bloats
the durable attention budget.

## Ordering: tools → system → messages

Anthropic's strict cache hierarchy is `tools → system → messages`.
OpenAI hashes the first ~256 tokens for prefix routing.
The order inside the system prompt itself should be:

1. Tool definitions (most stable).
2. Global rules and refusals.
3. Persona and tone.
4. Output contract.
5. Domain glossary.
6. (User message: dynamic context, retrieved chunks, then user query.)

Sources:
[Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## Persona

Use a role only when it shifts the answer surface:

| Persona                                       | Verdict        |
| --------------------------------------------- | -------------- |
| "You are a helpful assistant."                | Ceremonial. Drop. |
| "You are an expert at writing code."          | Ceremonial. Drop. |
| "You are a SOC-2 auditor reviewing access logs." | Material. Keep.   |
| "You are a triage agent for a support inbox."   | Material. Keep.   |

Concrete operational roles measurably improve relevance.
Vague flattery ("you are an expert") does not.

## XML vs markdown

| Model       | Preferred structural delimiter                            |
| ----------- | --------------------------------------------------------- |
| Claude      | XML tags (`<instructions>`, `<context>`, `<output_format>`). |
| GPT         | Markdown headings or XML — both work.                     |
| Gemini      | Markdown headings.                                        |
| Open models | Markdown unless you have evidence the model handles XML.  |

XML is not magic.
For Claude, it works because Claude was trained on XML-heavy data and
the boundaries are unambiguous.
For other models, markdown headings achieve equivalent separation.

Source: [Anthropic — Use XML tags](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags).

## Tool descriptions

Tool descriptions are part of the system prompt and carry durable
attention.
Treat them as documentation written **for an agent**, not for humans.

Rules:

1. **Few high-leverage tools beat many CRUD wrappers.**
   `search_contacts(query, filters)` beats
   `list_contacts()` + `get_contact(id)` + `filter_contacts(...)`.
2. **One verb per tool.**
   The tool name is the verb the agent should think.
3. **Include a 1–2 line example of when to call** — not how the API
   works, but the situation.
4. **Document the return shape briefly.**
   The agent uses the return shape to plan the next step.
5. **Never list more than 10–15 tools to a single agent.**
   Larger tool sets degrade selection accuracy.
   Split into specialised sub-agents.

Source: [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents).

### Good

```json
{
  "name": "search_customers",
  "description": "Search customers by free-text query and structured filters. Use when the user names a customer ambiguously, asks for 'all customers in X', or needs to disambiguate before another action. Returns up to 25 customers ranked by recency.",
  "input_schema": { "type": "object", "properties": { "query": { "type": "string" }, "filters": { "type": "object" } }, "required": ["query"] }
}
```

### Bad

```json
{
  "name": "list_customers",
  "description": "Retrieves the customers from the customer database table according to the documented API specification.",
  "input_schema": { "type": "object", "properties": {} }
}
```

The bad version describes the implementation, not the situation.
The agent has no signal for **when** to call it.

## Refusals and scope

Place refusal rules as a short, enumerated list **near the top** of the
system prompt — not buried.
Position bias is real: rules placed late are followed less consistently.

Limits:

- 5–10 refusal rules.
  More than that, the model starts dropping rules under load.
- Each rule is a single imperative sentence.
- No conflicting wording.
  ("Refuse legal advice" + "answer all questions" silently degrades both.)

## Stop conditions for agents

When the system prompt drives an agent loop, state stop conditions
explicitly:

```xml
<stop_conditions>
- Stop and return the final answer when the user's question is fully
  addressed.
- Stop and ask the user before any destructive action (delete, refund,
  send-email).
- Stop after at most 8 tool calls in a single turn.
</stop_conditions>
```

The Anthropic and OpenAI SDKs do **not** enforce loop termination.
It must come from the prompt or the caller's loop wrapper.
See `agents-and-tools.md` for the caller-side cap.

## Adaptive thinking (Anthropic, Q3 2025+)

Adaptive thinking on Opus 4.6+ / Sonnet 4.6+ is the recommended default;
it beats fixed extended-thinking budgets in Anthropic's internal evals.

Important: **toggling `thinking` parameters mid-conversation invalidates
the entire cached prefix.**
Decide at session start; do not flip per turn.

Source: [Anthropic — Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking).

## Common mistakes

- **Volatile content in the system prompt.**
  **Fix:** move timestamps, user IDs, and retrieved chunks to user message.
- **30+ tools in a single system prompt.**
  **Fix:** prune to 10–15; split into sub-agents.
- **Persona without a job.**
  **Fix:** drop "helpful assistant"; add a concrete operational role only
  when it shifts the answer.
- **Refusals at the bottom of a long prompt.**
  **Fix:** move to the top; cap at 10 rules.
- **Saying the same rule three different ways.**
  **Fix:** one canonical phrasing — conflicting versions degrade
  instruction-following.
- **Flipping `thinking` mid-conversation.**
  **Fix:** decide at session start.
