---
title: 'Server Endpoints — Validation, Shared Schemas, Errors, Telemetry'
impact: HIGH
tags:
  - server
  - endpoints
  - nextjs
  - route-handlers
  - zod
  - shared-schemas
  - error-handling
  - telemetry
  - otel
---

# Server Endpoints

Applies to any HTTP entrypoint: Next.js Route Handlers (`app/**/route.ts`), Server Actions, Pages API routes, Hono / Fastify / NestJS / Express handlers. Examples use Next.js App Router because that is where most of this skill's consumers ship code; the patterns translate one-to-one.

The endpoint is a **boundary**. Three things have to happen at the boundary, every time, in this order: validate the input, run the business logic, return a typed response — with telemetry recording what happened and structured errors that the client can render. This rule is the server-side peer of `rules/stacks/react/data-fetching.md`.

## Contents

- 1. Endpoint shape: pick a posture
- 2. Parse at the boundary with Zod
- 3. Shared schemas: one module, both stacks
- 4. Consistent error envelope and HTTP status mapping
- 5. Auth and rate limiting before the body runs
- 6. Idempotency for writes
- 7. Telemetry: span the handler, record errors
- 8. Common mistakes

## 1. Endpoint shape: pick a posture

| Concern | Use |
| --- | --- |
| Pure read (GET), public or cached | Route Handler with `export async function GET` |
| Mutation triggered from a form / button in a server component | **Server Action** (`'use server'` function) |
| Mutation called from client code (TanStack Query, fetch) | Route Handler with `POST` / `PUT` / `DELETE` |
| Webhook / third-party callback | Route Handler — the caller is not your client |
| Streaming response (LLM, SSE) | Route Handler returning `Response` with a stream body |

Pages API routes (`pages/api/*`) are still supported but are not the App Router default. Do not introduce them in a new App Router project.

## 2. Parse at the boundary with Zod

Every byte that crosses the wire is `unknown`. Validate it once, here, and trust the result internally. This applies R7 (Replace Validation with Schema) at the HTTP boundary.

```typescript
// app/api/todos/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { CreateTodoInput, TodoResponse } from '@/shared/schemas/todo';
import { createTodo } from '@/server/todos';

export async function POST(req: NextRequest) {
  const parsed = CreateTodoInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid_input', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const todo = await createTodo(parsed.data);     // parsed.data is fully typed
  return NextResponse.json(TodoResponse.parse(todo)); // also encode the response
}
```

### What to parse

- **Body** — `req.json()` for JSON, `req.formData()` for forms, `req.text()` for raw.
- **Search params** — `Object.fromEntries(req.nextUrl.searchParams)` then `schema.parse(...)`. Coerce numbers and booleans inside the schema (`z.coerce.number()`).
- **Route params** — Next.js passes `{ params: Promise<{ id: string }> }`; `await params` and parse with a route-param schema.
- **Headers** — only validate the headers you actually depend on; do not parse the entire header bag.

Prefer `safeParse` over `parse` at the HTTP boundary so you control the response shape. `parse` throws, which couples error handling to whatever global error filter the framework provides.

### Encode the response too

Parsing the response (or at least typing it via `z.infer`) prevents accidentally leaking internal fields (password hashes, soft-deletion flags, internal IDs). The schema becomes the contract.

## 3. Shared schemas: one module, both stacks

Schemas are framework-agnostic. Put them in a directory both the client and the server import from — `shared/schemas/`, a workspace package, or `lib/contracts/`.

```typescript
// shared/schemas/todo.ts
import { z } from 'zod';

export const Todo = z.object({
  id: z.string().uuid().brand<'TodoId'>(),
  title: z.string().min(1).max(140),
  completed: z.boolean(),
  createdAt: z.string().datetime(),
});

export const CreateTodoInput = Todo.pick({ title: true });
export const UpdateTodoInput = Todo.partial().omit({ id: true, createdAt: true });
export const TodoResponse = Todo;
export const TodoListResponse = z.array(Todo);

export type Todo = z.infer<typeof Todo>;
export type CreateTodoInput = z.infer<typeof CreateTodoInput>;
export type UpdateTodoInput = z.infer<typeof UpdateTodoInput>;
```

### Server uses the schema to *parse*

```typescript
const input = CreateTodoInput.parse(await req.json()); // validates + narrows
```

### Client uses the *type* (and optionally the schema)

```typescript
// lib/api/todos.ts (client)
import { CreateTodoInput, TodoResponse, type Todo } from '@/shared/schemas/todo';

export async function createTodo(input: CreateTodoInput): Promise<Todo> {
  // Optionally re-parse on receive if the server is untrusted (third-party);
  // skip when both ends ship from this repo and you trust the contract.
  const res = await fetch('/api/todos', { method: 'POST', body: JSON.stringify(input) });
  if (!res.ok) throw await ApiError.from(res);
  return TodoResponse.parse(await res.json());
}
```

### Why this pays off

- Adding a field to `Todo` is **one edit**; both stacks pick up the new shape on the next type-check.
- The form on the client validates with the same schema (`react-hook-form` + `zodResolver`) that the server enforces — no drift between "what the form accepts" and "what the API accepts".
- Branded primitives (`TodoId`) prevent passing a `UserId` where a `TodoId` is expected, on either side.
- Discriminated unions for state machines (R15) are defined once.

### Where to put the file

| Repo shape | Location |
| --- | --- |
| Single Next.js app | `src/shared/schemas/` or `src/lib/contracts/` |
| Monorepo (Turborepo, Nx, pnpm workspaces) | `packages/contracts/` (its own package, no framework deps) |
| Server in a different repo | Publish a typed package, or generate from an OpenAPI spec |

The directory must have **no framework imports** — no `next/server`, no React, no Node-only modules. Zod and TypeScript only.

## 4. Consistent error envelope and HTTP status mapping

Every error response from every endpoint has the same shape. Clients render it with one component; logs index it with one query.

```typescript
// shared/schemas/error.ts
import { z } from 'zod';

export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),                                   // machine-readable, stable
    message: z.string(),                                // human-readable
    issues: z.unknown().optional(),                     // Zod flatten() output for 400
    requestId: z.string().optional(),                   // correlation handle
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
```

### Domain errors → HTTP status

Map domain error types (R12 Discriminated Error Union) to status codes in **one** translator, not at every call site.

```typescript
// server/lib/to-response.ts
export function toErrorResponse(err: AppError, requestId: string): NextResponse {
  const body: ApiErrorBody = { error: { code: err.code, message: err.message, requestId } };
  switch (err.code) {
    case 'invalid_input':       return NextResponse.json(body, { status: 400 });
    case 'unauthenticated':     return NextResponse.json(body, { status: 401 });
    case 'forbidden':           return NextResponse.json(body, { status: 403 });
    case 'not_found':           return NextResponse.json(body, { status: 404 });
    case 'conflict':            return NextResponse.json(body, { status: 409 });
    case 'rate_limited':        return NextResponse.json(body, { status: 429 });
    case 'internal':             // fallthrough
    default:                    return NextResponse.json(body, { status: 500 });
  }
}
```

### Wrap every handler with the same envelope

```typescript
export const POST = withApi(async (req, ctx) => {
  const input = CreateTodoInput.parse(await req.json());
  const todo = await createTodo(input);
  return NextResponse.json(TodoResponse.parse(todo));
});
```

`withApi` is a thin wrapper that catches, maps to `toErrorResponse`, attaches the `requestId`, and runs the telemetry span (§7). One implementation, every route uses it. R20 Factory over Side-Effecting Import — no per-route boilerplate.

### Never leak internals

Stack traces, raw SQL errors, and internal field names belong in logs, not responses. Map unknown errors to `{ code: 'internal', message: 'Something went wrong' }` and **log** the original.

## 5. Auth and rate limiting before the body runs

Run identity, authorisation, and rate-limit checks **before** parsing the body. A 401/429 should not require a database lookup or a 50-KB JSON parse.

```typescript
export const POST = withApi(async (req, ctx) => {
  const session = await requireSession(req);             // throws unauthenticated
  await requireRateLimit(`todos:${session.userId}`, 60);  // throws rate_limited
  const input = CreateTodoInput.parse(await req.json());
  await requirePermission(session, 'todo.create');        // throws forbidden
  ...
});
```

Permission checks that depend on the parsed input (e.g., "can this user edit *this* todo") run after parsing but before the mutation.

## 6. Idempotency for writes

Any mutation that may be retried — by the client, by a queue, by a flaky network — must be safe to invoke twice. See R18 (Make the Operation Idempotent) and `rules/correctness.md` §1.

- Accept an `Idempotency-Key` header on `POST` and dedupe on it.
- Use the right HTTP method: `PUT` and `DELETE` are idempotent by definition; design `POST` handlers to be safe to retry.
- For database writes, prefer upserts keyed on the idempotency key over "check then insert".

## 7. Telemetry: span the handler, record errors

Wrap every handler in a server span and attach the right attributes. **Do not invent attribute names** — use the OpenTelemetry semantic conventions registry. For deeper guidance see the companion skills:

- **`/otel-instrumentation`** — span lifecycle, status codes, recording errors, the `nextjs` SDK rule for Next.js full-stack instrumentation. Load `rules/sdks/nextjs.md` from that skill when wiring up the SDK.
- **`/otel-semantic-conventions`** — which attribute to use for each piece of context (HTTP, user, route, error). Always check the registry before inventing a name.

### Minimum viable handler span

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';
const tracer = trace.getTracer('app');

export async function withApi(handler: ApiHandler): RouteHandler {
  return async (req, ctx) => {
    return tracer.startActiveSpan(
      `${req.method} ${routeTemplateOf(req)}`,        // low-cardinality span name
      { kind: SpanKind.SERVER },
      async (span) => {
        const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
        span.setAttributes({
          'http.request.method': req.method,           // semconv: http.request.method
          'url.path': new URL(req.url).pathname,       // semconv: url.path
          'http.route': routeTemplateOf(req),          // semconv: http.route (low-cardinality)
        });
        try {
          const res = await handler(req, ctx, { requestId, span });
          span.setAttribute('http.response.status_code', res.status);
          if (res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
          return res;
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          return toErrorResponse(toAppError(err), requestId);
        } finally {
          span.end();
        }
      },
    );
  };
}
```

### Rules

- **Span name = method + route template**, not the concrete URL. `GET /api/todos/{id}`, not `GET /api/todos/abc-123`. High cardinality breaks dashboards.
- **Use semconv attribute names** (`http.request.method`, `http.response.status_code`, `http.route`, `url.path`, `user.id`). Custom names fragment querying — see the otel-semantic-conventions skill.
- **Set status `ERROR` only on 5xx and unhandled exceptions**, not on 4xx. A 400 is a successful-from-the-server-perspective rejection of a bad request.
- **`recordException` for unexpected errors only.** Do not record validation rejections — those are expected, not exceptional.
- **Never put PII in span attributes.** Email, raw tokens, full request bodies — all belong in dedicated, sanitised log channels. See the `sensitive-data` rule in otel-instrumentation.
- **`requestId` flows through.** Stamp it on the response, the error envelope, and span attributes; it is the bridge between client logs, server logs, and traces.

### When to add custom spans inside the handler

- Outbound HTTP / DB / queue calls — usually auto-instrumented; only add a manual span when the auto-instrumentation does not see the call.
- Expensive pure computations inside the request — only if they will move (so the span name is stable).

## 8. Common mistakes

- **Parsing the body before auth/rate-limit checks.** **Fix:** auth → rate-limit → parse → permission-on-input → mutation.
- **`schema.parse(...)` at the route boundary without try/catch.** **Fix:** use `safeParse`, or wrap with `withApi` so the central error mapper handles it.
- **Returning raw `Error.message` to the client.** **Fix:** map to a stable `code` + sanitised `message`; log the original.
- **Different error shapes per route.** **Fix:** one envelope (`ApiErrorBody`), one mapper (`toErrorResponse`), every route.
- **Defining the request type and the schema separately.** **Fix:** R6 — declare the schema once and `type X = z.infer<typeof X>`.
- **Schemas in `app/api/.../route.ts`.** **Fix:** move to `shared/schemas/` so the client can import them too. Route handlers consume schemas; they do not own them.
- **Server returning fields the schema does not list.** **Fix:** parse the response shape on the way out, or use a database query that selects only the schema's fields.
- **High-cardinality span names.** **Fix:** `http.route` template, not the concrete path. `/api/todos/{id}`, not `/api/todos/abc-123`.
- **Setting span status `ERROR` on 4xx.** **Fix:** only 5xx and unhandled exceptions are span errors; 4xx is a successful rejection.
- **Putting `request.body` or auth tokens in span attributes.** **Fix:** never. PII and secrets belong in sanitised logs at most. See otel-instrumentation `sensitive-data`.
- **No `requestId`.** **Fix:** generate one in `withApi`, stamp it on response headers, error envelope, and span — clients can quote it in bug reports.
- **Reaching for Pages API routes in a new App Router app.** **Fix:** Route Handlers or Server Actions; Pages API is legacy.
