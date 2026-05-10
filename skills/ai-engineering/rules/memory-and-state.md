---
title: Memory & State — Long-Running Conversations and Agents
impact: HIGH
tags:
  - memory
  - state
  - compaction
  - long-running
  - agents
---

# Memory & State

Distinct concern from RAG.
RAG retrieves facts from a corpus.
Memory retains facts about **this user, this session, this agent's
prior actions** across turns and sessions.

Long-running agents and chat apps need both.

## Contents

- Memory vs RAG — pick the right tool
- Conversation summarisation
- Structured memory (entity stores)
- Vector memory
- Anthropic memory tool / OpenAI conversation state
- Compaction survival rules
- Security: memory poisoning
- Common mistakes

## Memory vs RAG — pick the right tool

| Need                                              | Use                          |
| ------------------------------------------------- | ---------------------------- |
| "What did the user tell me 3 turns ago?"          | Conversation history.        |
| "What are this user's preferences across sessions?" | Structured memory.           |
| "Find documents in our knowledge base."           | RAG.                         |
| "What did this agent do yesterday on this task?"  | Agent journal (structured).  |
| "Recall similar past conversations."              | Vector memory.               |
| "Token-efficient long context."                   | Conversation summarisation.  |

If the data lives in **your** system (user profile, agent history),
it's memory.
If it lives in a **corpus** (docs, KB, support articles), it's RAG.
Same retrieval primitives, different sources of truth.

## Conversation summarisation

When a conversation exceeds the comfortable context window (typically
50k–100k tokens), summarise older turns rather than truncating.

Pattern:

```text
[ recent turns: kept verbatim, last N turns or last K tokens ]
[ <summary>...summarised history of older turns...</summary> ]
[ system prompt ]
```

Rules:

1. **Summarise eagerly, not at the cap.**
   Wait until you 200k-token-error and you're already broken.
   Summarise when conversation exceeds 60% of the window.
2. **Keep the recent N turns verbatim.**
   Summarisation drops detail; recency carries it.
   Default: last 6 turns or 20k tokens, whichever is larger.
3. **Summarise to a structured format**, not free prose.
   Headers like `<topics_discussed>`, `<user_preferences>`,
   `<open_threads>` survive re-summarisation cycles.
4. **Use a cheaper model** for summarisation (Haiku-class).
   Don't burn Opus tokens on compression.

The summary itself becomes part of the cached prefix on subsequent
turns — see `token-optimization.md`.

## Structured memory (entity stores)

For "remember this fact about this user", use a structured store:

```json
{
  "user_id": "u_123",
  "preferences": {
    "language": "en-GB",
    "tone": "concise",
    "no_emoji": true
  },
  "facts": [
    { "key": "company_name", "value": "Acme", "asserted_at": "2026-04-12" },
    { "key": "team_size", "value": 14, "asserted_at": "2026-05-01" }
  ],
  "open_threads": [
    { "id": "t_payment_dispute", "summary": "...", "next_step": "..." }
  ]
}
```

Inject the relevant slice into the system prompt at session start:

```xml
<user_memory>
  <preferences>language=en-GB; tone=concise; no_emoji=true</preferences>
  <recent_facts>company=Acme; team_size=14</recent_facts>
</user_memory>
```

Rules:

1. **Schema-validate writes.**
   The model writes to memory via tool calls; without validation, you
   accumulate junk.
2. **Timestamp every fact.**
   Stale facts ("user lives in NYC") need an expiry policy.
3. **Cap memory size.**
   At ~5kB of injected memory, instruction-following starts to drop.
   Surface the most-relevant slice, not everything.
4. **One source of truth.**
   Don't duplicate facts in conversation summaries AND structured
   memory; pick one home per fact category.

## Vector memory

For "recall similar past conversations" or "find what we discussed about
X three months ago":

- Embed each completed conversation (or summary).
- Index in a vector DB.
- On a new turn, retrieve top-K similar past conversations and inject.

This is just RAG with conversations as the corpus.
All `rag.md` rules apply: hybrid search, reranking, separate eval.

When **not** to use vector memory:

- For short-term context (< 10 turns) — conversation history is enough.
- For preferences and facts — use structured memory; it's cheaper and
  more reliable.

Vector memory is the right tool when the user explicitly references
prior history ("last time we talked about X...") and the volume is too
large to summarise.

## Anthropic memory tool / OpenAI conversation state

Provider-managed memory (Q1 2026):

- **Anthropic memory tool** — built-in tool the model uses to read/write
  long-term memory.
  Storage is your responsibility (filesystem, database); the model
  drives it via tool calls.
- **OpenAI Responses API conversation state** — server-side conversation
  state with `previous_response_id` chaining.

Pattern (Anthropic memory tool):

1. Define `memory` as a tool with `read` / `write` / `delete` operations.
2. Persist tool outputs to your store (Redis, Postgres, S3).
3. The model decides when to read/write based on context.
4. Treat memory contents as untrusted (see security note below).

Source: [Anthropic — Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool).

Use the provider tool when:

- You want the model to make memory decisions itself.
- You don't already have a memory layer.

Roll your own when:

- You have an existing user-data store to integrate.
- You need fine-grained access control or audit logs.

## Compaction survival rules

When the harness/SDK compacts the conversation (token budget exceeded):

| What survives                            | What does not                     |
| ---------------------------------------- | --------------------------------- |
| The system prompt.                       | Old user/assistant message turns. |
| The last N messages.                     | Tool results from older turns.    |
| Tool definitions.                        | Older `<thinking>` blocks.        |
| Memory injected into the system prompt.  | Memory injected only into past user messages. |

**Implication:** if a fact must survive compaction, put it in the
system prompt or in structured memory injected into the system prompt
on every turn.
**Don't** rely on the model "remembering" something it said 50 turns ago
— compaction will drop it.

## Security: memory poisoning

Memory is an indirect prompt injection vector.
A malicious user (or compromised retrieved content) can write
instructions into memory that fire on the next session.

Mitigations:

1. **Scope memory per user.**
   User A's memory is never injected into User B's prompt.
2. **Validate writes.**
   Schema-validate; reject content with embedded instructions
   (`"Ignore all previous instructions"`).
3. **Treat memory as data.**
   Wrap in `<user_memory>` delimiters; tell the model to treat as
   reference data, not instructions.
   See `safety-and-guardrails.md`.
4. **Audit memory periodically.**
   Run a classifier over memory contents; flag suspicious entries.

## Common mistakes

- **Truncating instead of summarising.**
  **Fix:** summarise older turns; keep last N verbatim.
- **Summarising at the context cap (already broken).**
  **Fix:** summarise at 60% of the window.
- **Free-prose summaries that lose detail across re-summarisations.**
  **Fix:** structured summary headers (`<user_preferences>`, etc.).
- **Memory and conversation summary holding the same fact differently.**
  **Fix:** one source of truth per fact category.
- **No timestamp on memory facts.**
  **Fix:** timestamp every entry; expire stale ones.
- **Memory injected into a user message, not the system prompt.**
  **Fix:** if it must survive compaction, inject into system prompt.
- **Cross-user memory leakage.**
  **Fix:** scope keys server-side; never let the model fill in
  `user_id`.
- **Memory writes accepted without validation.**
  **Fix:** schema + content classifier on writes; treat as injection
  vector.
