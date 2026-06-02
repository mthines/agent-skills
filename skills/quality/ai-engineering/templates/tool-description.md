<!--
Literal scaffold for an agent tool definition.
Tool descriptions are part of the system prompt and carry durable
attention. Treat them as documentation written FOR an agent.
For methodology, see ../rules/agents-and-tools.md and
../rules/system-prompt-design.md.

Replace every <PLACEHOLDER>. Delete bracketed comments before shipping.
-->

```json
{
  "name": "<verb_object>",
  "description": "<One sentence: what the tool does. One sentence: when the agent should call it (the situation, not the API). Optional: one sentence on what the agent will see in the return shape.>",
  "input_schema": {
    "type": "object",
    "properties": {
      "<param>": {
        "type": "<string|number|boolean|object|array>",
        "description": "<What this param is. Include format constraints (e.g. 'ISO-8601 date', 'UUIDv4'). Avoid implementation details.>"
      }
    },
    "required": ["<param>"]
  }
}
```

## Worked example — good

```json
{
  "name": "search_customers",
  "description": "Search customers by free-text query and structured filters. Use when the user names a customer ambiguously, asks for 'all customers in <region>', or needs to disambiguate before another action. Returns up to 25 customers ranked by recency, each with id, name, email, and tier.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Free-text search across name, email, and company. Required. Min 2 chars."
      },
      "filters": {
        "type": "object",
        "description": "Optional structured filters.",
        "properties": {
          "tier": { "type": "string", "enum": ["bronze", "silver", "gold"] },
          "region": { "type": "string", "description": "ISO-3166 country code." }
        }
      }
    },
    "required": ["query"]
  }
}
```

## Worked example — bad (do not ship)

```json
{
  "name": "list_customers",
  "description": "Retrieves the customers from the customer database table according to the documented API specification.",
  "input_schema": {
    "type": "object",
    "properties": {}
  }
}
```

Why bad:
- Describes the implementation, not the situation.
- No signal for *when* to call.
- No documented return shape.
- No required inputs — agent will guess.

## Error contract (return this on failure)

```json
{
  "type": "tool_result",
  "tool_use_id": "<incoming_id>",
  "is_error": true,
  "content": [{
    "type": "text",
    "text": "{\"error\": \"<short_code>\", \"<context_field>\": \"<value>\", \"fix\": \"<one sentence telling the agent what to do next>\"}"
  }]
}
```

The `fix` field is the difference between an agent that recovers and
one that loops. Always include it.

## Checklist before shipping a tool

- [ ] Name is one verb (`search_*`, `issue_*`, `get_*` — not
      `list_customers_v2_helper`).
- [ ] Description names the situation, not the implementation.
- [ ] Description includes the return shape.
- [ ] Required inputs marked.
- [ ] Format constraints (ISO dates, UUIDs, enums) declared in
      schema descriptions.
- [ ] Idempotency key parameter for any destructive tool (see
      `../rules/resilience.md`).
- [ ] Error responses return `is_error: true` with a `fix` hint.
- [ ] Total tool count for this agent ≤ 15 (else split into sub-agents).
