---
title: Observability & Versioning — Tracing, Prompts-as-Code, A/B Releases
impact: HIGH
tags:
  - observability
  - tracing
  - opentelemetry
  - dash0
  - prompt-versioning
---

# Observability & Versioning

Without traces in production, you cannot do error analysis.
Without error analysis, you cannot do evals.
Without evals, prompt changes are guesses.

Observability is the foundation of every other rule in this skill.

## Contents

- Trace every LLM call (OTEL is the strong default)
- Span hierarchy for agents
- Redact PII before logging
- Sampling policy — keep all errors and slow paths
- Prompts as code (in-repo, semver, tested)
- A/B release new prompt versions
- Alert on the right things
- Common mistakes

## 1. Trace every LLM call — OpenTelemetry is the strong default

For every model call, record:

| Field                | Why                                                            |
| -------------------- | -------------------------------------------------------------- |
| Full prompt (input)  | The eval input. Without it, you cannot reproduce a failure.    |
| Full response        | The eval expected/actual.                                      |
| Model + version      | Comparing "claude-sonnet-4-6" vs "4-7" requires the version.   |
| Token counts         | Cost attribution and cache-hit rate.                           |
| Latency              | TTFT and total. Distinct metrics.                              |
| Cache read/write     | Anthropic returns `cache_read_input_tokens` etc.               |
| Tool calls + results | Full nested span tree for agents.                              |
| User / session ID    | Correlation across traces.                                     |

**Default to OpenTelemetry (OTEL) with the GenAI semantic conventions.**
Vendor SDKs are fine on top, but build on OTEL underneath — it's the
converging standard, every backend ingests it, and switching backends
becomes a config change instead of a rewrite.

The GenAI semantic conventions (`gen_ai.*` attributes) are non-negotiable.
They're how every backend recognises an LLM span as an LLM span:

| Attribute                          | What it carries                                  |
| ---------------------------------- | ------------------------------------------------ |
| `gen_ai.system`                    | `anthropic`, `openai`, `google`.                  |
| `gen_ai.request.model`             | Requested model id.                              |
| `gen_ai.response.model`            | Resolved model id (different on aliases).        |
| `gen_ai.usage.input_tokens`        | Prompt tokens billed.                             |
| `gen_ai.usage.output_tokens`       | Completion tokens billed.                         |
| `gen_ai.usage.cache_read_tokens`   | Anthropic cache read tokens.                      |
| `gen_ai.operation.name`            | `chat`, `embeddings`, `tool_use`.                 |

If you skip these, your traces look like generic HTTP spans and the
backend cannot compute LLM-specific metrics (cost, cache hit rate,
TTFT).

Most modern frameworks already emit OTEL natively:
Pydantic AI, smolagents, Strands, OpenAI Agents SDK, LangChain (via
`langchain-otel`), LiteLLM.
For the rest, instrument at the SDK boundary using the OTEL SDK.

### Compose with the dash0 OTEL skills

When this rule loads, **immediately delegate** to the dash0 OTEL skills
for authoritative context — they are domain-specific and stay current
with the OTEL spec, while this rule only frames the AI-side concerns.

**Required calls** when the user's task involves OTEL wiring or attribute
naming:

| Skill                            | Invoke via                            | When                                                                            |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `/otel-instrumentation` (dash0)  | `Skill("otel-instrumentation", ...)`  | Adding OTEL to a service, picking exporters, designing span shape, resource attrs. |
| `/otel-semantic-conventions` (dash0) | `Skill("otel-semantic-conventions", ...)` | Picking attribute names, validating emitted spans, reviewing `gen_ai.*` compliance. |

Order:

1. Detect that observability is in scope (the user mentions tracing,
   spans, instrumentation, OTEL, attributes, exporters, dashboards).
2. **Before answering**, scan the available-skills list for
   `otel-instrumentation` and `otel-semantic-conventions`.
3. If present, invoke them with the relevant slice of the user's task —
   load their context first, then answer.
4. If neither is present, fall back to the guidance in this rule and
   the OTEL spec link below.

Pattern:

```text
User: "Add tracing to our agent loop."

ai-engineering observability rule loads
  → Skill("otel-instrumentation", "wire OTEL into a Node service that
     calls Anthropic; emit GenAI semconv spans for each LLM call and
     each tool call")
  → answer using dash0's wiring guidance + this rule's GenAI-specific
     attributes (cache_read_tokens, agent loop hierarchy, PII redaction)
```

Both skills are the source of truth in their lane.
This rule's job is to mark the AI-specific span fields (`gen_ai.*`,
agent-loop hierarchy, PII redaction policy) and hand the rest off.

### Backend

Use **Dash0**.
It ingests OTEL natively, surfaces `gen_ai.*` attributes as first-class
LLM metrics (cost, cache hit rate, TTFT, agent loop hierarchy), and is
the backend the dash0 skills above are designed against.

If a backend swap is ever needed, the trace data is portable because
OTEL is the wire format — switching is config, not a rewrite.

Source: [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).

## 2. Span hierarchy for agents

Agent calls produce nested spans:

```text
session
└── turn-3
    └── agent-loop
        ├── llm-call (iter 1)
        ├── tool-call: search_customers
        │   └── (database query span if instrumented)
        ├── tool-call: get_account_summary
        │   └── (database query span)
        └── llm-call (iter 2)
```

Without the hierarchy, debugging "why did the agent loop 8 times?" is
impossible.

Pattern:

- One root span per turn.
- Child span per LLM call.
- Sibling spans per tool call.
- Errors propagate up; mark the failing span first.

Source: [OpenTelemetry — Tracing concepts](https://opentelemetry.io/docs/concepts/signals/traces/).

## 3. Redact PII before logging

The trace store is a long-lived data store.
Treat it like any other PII surface:

- Run PII redaction on prompts and responses **before** they hit the
  trace tool.
- Maintain a redaction allowlist (some traces are anonymised analytic
  data, not PII).
- Fail closed: if redaction errors, drop the trace.

See `safety-and-guardrails.md` for the redactor choice.

## 4. Sample, then keep everything that errors

100% trace retention is expensive at scale.
Default policy:

- **All errors:** kept.
- **Slow traces** (> p95 latency): kept.
- **Low confidence / validator failure:** kept.
- **Random sample of successes:** 1–5% kept.

The error/slow/low-confidence subset is what feeds error analysis.
Successes are sampled for trend monitoring.

## 5. Prompts as code

Treat prompts as code:

- **In repo.**
  Not in a database, not in a vendor dashboard.
  The version that shipped is the version in git.
- **Reviewed in PR.**
  Diffs are reviewable; conflicts are mergeable.
- **Tagged with semver.**
  Major bump on contract change, minor on rule change, patch on fix.
- **Tested.**
  Every prompt change runs the golden set (see `evals.md`).

Tooling:

- **In-repo + custom router.**
  Cheapest, most flexible.
  Pattern: `prompts/triage.v3.md` files loaded by a router that picks
  the active version from config.
- **Promptfoo, PromptLayer.**
  Specialist tools with diff/eval/AB built in.
  Useful when many non-engineers edit prompts.

Source: [PromptLayer — Prompt Versioning](https://www.promptlayer.com/glossary/prompt-versioning/).

For full migration rules (pin snapshots vs aliases, deprecation
handling, cross-provider migration, rollback playbook), load
[`model-migration.md`](./model-migration.md).
This rule covers the prompt-versioning side; that rule covers the
model-versioning side.

## 6. A/B release new prompt versions

Never flip a prompt globally.
Pattern:

```text
v3 → v4
  → 5% traffic on v4 for 24h
  → compare metrics: task accuracy, latency, cost, satisfaction
  → 50% traffic for 48h
  → 100% if metrics hold
  → rollback path stays open for 7 days
```

The metric set must include:

- Eval-driven (golden set pass rate).
- Production-driven (validator failure rate, user thumb-down rate).
- Cost (input + output tokens per request).
- Latency (p50, p95).

Rollback is a config flip, not a redeploy.

Source: [PromptLayer — A/B releases](https://docs.promptlayer.com/why-promptlayer/ab-releases).

## 7. Alert on the right things

Useful alerts:

- **Validator failure rate > N%** — schema drift or model regression.
- **Cache hit rate dropped** — someone changed the stable prefix.
- **p95 latency > N ms** — model degradation or load.
- **Cost per request up > 2σ** — token bloat or routing regression.
- **User thumb-down rate up** — leading indicator of quality regression.

Useless alerts (that teams set anyway):

- "Model returned an empty response" — usually a downstream timeout,
  not a model issue.
- "Token count > N" — only matters relative to budget.
- "Tool call failed" — expected; agent should recover.

## Common mistakes

- **No tracing in prod.**
  **Fix:** OTEL with GenAI semantic conventions. Anything is better than
  nothing, but vendor-locked tracing is one rewrite away.
- **Tracing without `gen_ai.*` attributes.**
  **Fix:** apply the OTEL GenAI semantic conventions; invoke
  `/otel-semantic-conventions` to validate.
- **Logging raw PII to the trace store.**
  **Fix:** redact before logging.
- **Prompts edited in a vendor dashboard, not in git.**
  **Fix:** in-repo prompts; dashboard is for reading, not authoring.
- **Globally flipping a new prompt version.**
  **Fix:** A/B at 5% → 50% → 100%.
- **Alerting on every tool failure.**
  **Fix:** alert on validator failure rate and user thumb-down — leading
  indicators that matter.
- **No span hierarchy on agent traces.**
  **Fix:** one root per turn; nest LLM and tool calls.
