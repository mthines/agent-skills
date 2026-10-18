# Stack-Specific Rules

The `code-quality` skill is **language-agnostic at its core**. The rules in `rules/*.md` (one level up) apply to any language: cognitive complexity, naming, control flow, abstraction, error handling, idempotency, testability.

This directory holds **stack-specific extensions** — rules that codify best practices for a particular language, framework, or runtime. Each subdirectory is one stack. An agent loads only the subdirectory relevant to the code in front of it.

## Layout

```
rules/stacks/
├── react/         — React component composition, client data fetching, autosave, offline + sync
└── nextjs/        — Next.js Route Handlers / Server Actions, shared schemas, telemetry
```

## Current stacks

### `react/`

| File | Covers |
| --- | --- |
| [`components.md`](./react/components.md) | Splitting components, compound / namespace components (`Component.List.Item`, `Component.useComponent`), slots, RSC boundaries |
| [`data-fetching.md`](./react/data-fetching.md) | Server-state libraries (TanStack Query / SWR), query keys, optimistic updates, cache surgery, killing waterfalls, Next.js App Router prefetch + `HydrationBoundary` |
| [`autosave.md`](./react/autosave.md) | Form autosave: debounce + max-wait, on-blur / visibility triggers, local draft buffer, status indicator, ETag conflict detection |
| [`offline-sync.md`](./react/offline-sync.md) | App-wide offline: durable mutation queue / outbox, TanStack Query persistence, multi-tab coordination via Web Locks + BroadcastChannel |

### `nextjs/`

| File | Covers |
| --- | --- |
| [`endpoints.md`](./nextjs/endpoints.md) | Route Handlers / Server Actions, Zod boundary validation, shared schemas (FE + BE), error envelope, OTel server-span wrap |

## Flagship patterns

The highest-leverage stack-specific smells; each stack file's Common Mistakes section has the rest.
`Where` paths are relative to `rules/`.

| Smell | Refactor To | Where |
|---|---|---|
| React component with 6+ props (especially booleans) controlling visual variations | Compound component with deep dot-notation (`Combobox.Content.List.Item`) + namespaced control hook (`Combobox.useCombobox`); shared state via Context | `stacks/react/components.md` |
| `useEffect(() => { fetch(...).then(setData) }, [id])` for server data | `useQuery({ queryKey, queryFn })` (TanStack Query / SWR) | `stacks/react/data-fetching.md` |
| Mutation waits for the server before updating the UI | Optimistic update in `onMutate`, rollback in `onError`, invalidate in `onSettled` | `stacks/react/data-fetching.md` |
| Form saves on every keystroke | Debounce ~1000 ms + max-wait ~5 s flush + on-blur + on-visibility-hidden; never block input | `stacks/react/autosave.md` |
| Two tabs autosave the same record and one silently overwrites the other | ETag + `If-Match`; on 412 surface "edited elsewhere — Reload / Keep mine" | `stacks/react/autosave.md` |
| Mutations lost on reload, ad-hoc retries scattered across components | Durable mutation queue in IndexedDB + idempotency key per entry; multi-tab single-writer via `navigator.locks` | `stacks/react/offline-sync.md` |
| Route handler trusts `req.json()` body without validation | `safeParse` with a shared Zod schema (FE + BE import the same module); one error envelope mapped from a discriminated `AppError` union | `stacks/nextjs/endpoints.md` |

## Adding a new stack

To add e.g. Go server-side rules:

1. Create `rules/stacks/go/` with one rule file per topic (`http-handlers.md`, `errors-as-values.md`, `concurrency.md`).
2. Add a row to "Current stacks" above with a one-line description.
3. Update `SKILL.md` — add a row to the stack-specific Rule Files lookup table, and update the tag list if relevant. Add the stack's flagship smell to [Flagship patterns](#flagship-patterns) above.
4. Cross-reference back to language-agnostic rules using `rules/<file>.md` paths so the references resolve regardless of where the agent reads from.

Stack-specific files should pull on the language-agnostic rules whenever possible — for example, Go HTTP handler rules should reference `rules/api-design.md` for total functions and `rules/correctness.md` for idempotency rather than restating them. The stack file's job is to translate the universal pattern into the stack's idiom, not to re-derive the principle.
