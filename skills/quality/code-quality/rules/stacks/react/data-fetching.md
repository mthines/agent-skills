---
title: 'Client Data Fetching — Server State, Caching, Optimistic Updates'
impact: HIGH
tags:
  - client
  - data-fetching
  - react-query
  - tanstack-query
  - swr
  - optimistic-updates
  - caching
  - server-state
---

# Client Data Fetching

Applies to any client (React, Vue, Solid, Svelte, mobile) that reads from or writes to a remote API. Examples use TanStack Query (React Query) but translate to SWR, Solid Query, Vue Query, and RTK Query.

The single rule that drives everything else: **server state is not client state.** It is shared, asynchronous, owned elsewhere, and goes stale on its own clock. Putting it in `useState`, Redux, Zustand, or Context produces stale UIs, dead loading flickers, duplicate requests, and "I deleted it but it came back" bug reports.

## Contents

- 1. Always use a server-state library
- 2. Never store server state in client state
- 3. Query keys: hierarchical, descriptive, exhaustive
- 4. Optimistic updates for every mutation
- 5. Cache surgery: create / update / delete
- 6. Invalidate after settled
- 7. Kill waterfalls
- 8. Stale-while-revalidate is the default
- 9. Loading / error / empty states come from the library
- 10. Server-rendered initial data (Next.js App Router / RSC)

## 1. Always use a server-state library

Pick one and use it everywhere: TanStack Query (React, Vue, Solid, Svelte), SWR (React only), RTK Query (Redux), Apollo (GraphQL).
Hand-rolled `useEffect + fetch + useState` is a maintainability finding — every call site re-implements deduplication, retries, caching, and stale-time logic, and they all drift.

| Smell | Fix |
| --- | --- |
| `useEffect(() => { fetch(...).then(setData) }, [id])` | `useQuery({ queryKey: ['x', id], queryFn: ... })` |
| Components own `loading`, `error`, `data` triplets in state | Library returns them; remove the state |
| Same endpoint fetched twice on one screen | One `useQuery`; the cache deduplicates |
| Manual "should I refetch?" tracking | `staleTime` / `refetchOnWindowFocus` |

## 2. Never store server state in client state

Server state lives in the query cache. Period.

### Bad — duplicates the cache into a store

```typescript
const useUsersStore = create((set) => ({ users: [], setUsers: (users) => set({ users }) }));

const { data } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
useEffect(() => { useUsersStore.getState().setUsers(data ?? []); }, [data]); // store and cache will drift
```

### Good — the cache is the source of truth

```typescript
const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
```

Client state stores keep **UI state only**: open dialogs, form drafts, selected tabs, unsubmitted wizard inputs.

## 3. Query keys: hierarchical, descriptive, exhaustive

A query key is the cache identity. Bad keys cause cache misses, duplicate fetches, and surgery that hits the wrong entry.

### Rules

- Use **arrays**, not strings. `['users', userId]`, not `` `users-${userId}` ``.
- Order from **general to specific**: `['users', userId, 'orders', { status: 'open' }]`.
- Every input that changes the response is a key segment — including filters, pagination, and sort order. If two queries return different data, they need different keys.
- Centralise key construction in a `queryKeys` factory so callers cannot drift.

```typescript
export const queryKeys = {
  users: {
    all: ['users'] as const,
    list: (filters?: UserFilters) => ['users', 'list', filters] as const,
    detail: (id: UserId) => ['users', 'detail', id] as const,
  },
  orders: {
    all: ['orders'] as const,
    byUser: (userId: UserId) => ['orders', 'by-user', userId] as const,
  },
} as const;
```

Now `queryClient.invalidateQueries({ queryKey: queryKeys.users.all })` invalidates every users query, and `queryKeys.users.detail(id)` returns one specific entry.

## 4. Optimistic updates for every mutation

A mutation that waits for the server before updating the UI is a UX bug.
The user sees a button click, then a 200–800 ms dead zone, then the change.
Apply the change to the cache immediately; reconcile when the server replies.

### The four-step pattern (TanStack Query `useMutation`)

```typescript
const createTodo = useMutation({
  mutationFn: (input: NewTodo) => api.createTodo(input),

  // 1. onMutate — apply the optimistic change, return a rollback context
  onMutate: async (input) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.todos.list() });
    const previous = queryClient.getQueryData<Todo[]>(queryKeys.todos.list());
    const optimistic: Todo = { id: tempId(), status: 'pending', ...input };
    queryClient.setQueryData<Todo[]>(queryKeys.todos.list(), (old = []) => [...old, optimistic]);
    return { previous, optimisticId: optimistic.id };
  },

  // 2. onError — roll back using the captured snapshot
  onError: (_err, _input, ctx) => {
    if (ctx?.previous) queryClient.setQueryData(queryKeys.todos.list(), ctx.previous);
  },

  // 3. onSuccess — replace the temporary entity with the real one from the server
  onSuccess: (server, _input, ctx) => {
    queryClient.setQueryData<Todo[]>(queryKeys.todos.list(), (old = []) =>
      old.map((t) => (t.id === ctx?.optimisticId ? server : t)),
    );
  },

  // 4. onSettled — refetch to reconcile any drift
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.todos.list() });
  },
});
```

The same four steps apply to every mutation: **cancel → snapshot → mutate → return rollback context**, then **roll back on error**, **replace on success**, **invalidate on settled**.

### When to skip optimism

Skip when the server may legitimately reject the operation in ways the client cannot predict — payment processing, inventory checks, permission checks that depend on server state, or anything where the optimistic UI would mislead the user. In those cases, show a pending indicator and wait.

## 5. Cache surgery: create / update / delete

The optimistic update changes one cache entry; you usually need to keep **list caches** and **detail caches** in sync at the same time.

| Operation | List cache | Detail cache |
| --- | --- | --- |
| **Create** | Append (or prepend) the new entity | `setQueryData` with the new entity |
| **Update** | `map` and replace the entry by id | `setQueryData` with the merged entity |
| **Delete** | `filter` out the entry by id | `removeQueries` for the detail key |
| **Reorder** | Replace the array in cache | n/a |

### One block, all three operations

```typescript
const list = queryKeys.todos.list();
const detail = (id: TodoId) => queryKeys.todos.detail(id);

// Create
queryClient.setQueryData<Todo[]>(list, (old = []) => [...old, entity]);
queryClient.setQueryData(detail(entity.id), entity);

// Update
queryClient.setQueryData<Todo[]>(list, (old = []) =>
  old.map((t) => (t.id === input.id ? { ...t, ...input } : t)),
);
queryClient.setQueryData<Todo>(detail(input.id), (prev) => ({ ...prev, ...input }));

// Delete
queryClient.setQueryData<Todo[]>(list, (old = []) => old.filter((t) => t.id !== id));
queryClient.removeQueries({ queryKey: detail(id) });
```

If the same entity appears in multiple list variants (e.g., filtered by status), use `queryClient.setQueriesData({ queryKey: queryKeys.todos.all }, updater)` to apply one updater to every matching list cache.

## 6. Invalidate after settled

Cache surgery is best-effort — the server is the truth.
Always call `invalidateQueries` in `onSettled` so the next render reconciles drift (server-side defaults, computed fields, normalised relations).

```typescript
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: queryKeys.todos.all });
}
```

`invalidateQueries` does not refetch immediately if no observer is mounted — it just marks the entry stale. The next mount or focus triggers a refetch. This is the right default.

## 7. Kill waterfalls

A waterfall is a request that does not start until another request finishes, even though it does not depend on the result.

### Bad — sequential by accident

```typescript
const { data: user } = useQuery({ queryKey: ['user', id], queryFn: () => api.user(id) });
const { data: orders } = useQuery({
  queryKey: ['orders', id],
  queryFn: () => api.orders(id),
  enabled: !!user, // ← unnecessary; orders only needs `id`, not `user`
});
```

### Good — parallel

```typescript
const [user, orders] = useQueries({
  queries: [
    { queryKey: ['user', id], queryFn: () => api.user(id) },
    { queryKey: ['orders', id], queryFn: () => api.orders(id) },
  ],
});
```

Reach for `enabled` only when one query genuinely depends on a value from another (e.g., fetching by an id that comes from the first response).

### Prefetch on intent

```typescript
<Link to={`/todos/${id}`} onMouseEnter={() => queryClient.prefetchQuery({ queryKey: queryKeys.todos.detail(id), queryFn: () => api.todo(id) })} />
```

The detail page is warm before the user clicks.

## 8. Stale-while-revalidate is the default

Configure the library, not every call site.

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,            // serve cache, refetch in background after 30s
      gcTime: 5 * 60_000,           // keep unused entries 5 min before GC
      refetchOnWindowFocus: true,   // refetch on tab focus
      retry: (failureCount, err) =>
        err instanceof HttpError && err.status >= 400 && err.status < 500 ? false : failureCount < 3,
    },
    mutations: {
      retry: false,                 // mutations are user-initiated; let the user retry
    },
  },
});
```

Per-query overrides are valid (longer `staleTime` for slow-moving data, shorter for live dashboards) — but start with sane defaults so call sites stay quiet.

## 9. Loading / error / empty states come from the library

The library returns `isPending`, `isError`, `error`, `isFetching`. Use them. Don't reinvent.

```typescript
const { data, isPending, isError, error } = useQuery(...);

if (isPending) return <Skeleton />;
if (isError) return <ErrorBanner error={error} onRetry={refetch} />;
if (data.length === 0) return <EmptyState />;
return <List items={data} />;
```

For React 18+, prefer Suspense boundaries with `useSuspenseQuery` for routes — the boundary handles `isPending` for every nested query at once and removes the cascade of `if (isPending) return <Skeleton />` checks.

## 10. Server-rendered initial data (Next.js App Router / RSC)

When the framework can fetch on the server (Next.js App Router, Remix, TanStack Start), the page should arrive **already populated** — no first-paint spinner. Pick by scope:

| Scope | Use |
| --- | --- |
| One query, one component, not shared | `initialData` on `useQuery` |
| Multiple queries, nested components, shared cache | `prefetchQuery` + `<HydrationBoundary>` |

### Pattern A — `<HydrationBoundary>` (default for App Router)

Three pieces wire it together: a per-request `QueryClient` factory, a client `Providers` boundary, and `dehydrate` / `HydrationBoundary` to ferry the cache across the wire.

#### A1. Per-request `QueryClient` factory + `Providers`

```typescript
// app/get-query-client.ts
import { QueryClient, defaultShouldDehydrateQuery, isServer } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000 },                // > 0 prevents an immediate refetch after hydration
      dehydrate: {                                   // include in-flight queries so streaming works
        shouldDehydrateQuery: (q) =>
          defaultShouldDehydrateQuery(q) || q.state.status === 'pending',
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (isServer) return makeQueryClient();           // fresh per request — never reuse on the server
  return (browserQueryClient ??= makeQueryClient()); // singleton in the browser
}
```

```typescript
// app/providers.tsx — mount in root layout
'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { getQueryClient } from './get-query-client';

export function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}
```

The `isServer` branch is non-negotiable: a shared server `QueryClient` would leak cache between users' requests.

#### A2. Server component prefetches; client component reads

```typescript
// app/todos/page.tsx — Server Component
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '@/app/get-query-client';
import { TodoList } from './todo-list';
import { fetchTodos } from '@/server/todos';

export default function TodosPage() {
  const queryClient = getQueryClient();
  // Do NOT await — letting the promise float enables Next.js streaming;
  // the dehydrated state captures it as 'pending' and resumes on the client.
  void queryClient.prefetchQuery({ queryKey: ['todos'], queryFn: fetchTodos });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TodoList />
    </HydrationBoundary>
  );
}
```

```typescript
// app/todos/todo-list.tsx — Client Component
'use client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { fetchTodos } from '@/lib/todos-client';

export function TodoList() {
  const { data } = useSuspenseQuery({ queryKey: ['todos'], queryFn: fetchTodos });
  return <ul>{data.map((t) => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

The query key on the server **must match** the key on the client. Different keys = two cache entries = wasted hydration.

### Pattern B — `initialData` (single-query escape hatch)

Use when one component owns one query and the data is not shared across the tree.

```typescript
// Server Component
export default async function TodosPage() {
  const todos = await fetchTodos();
  return <TodoList initialTodos={todos} />;
}

// Client Component
'use client';
export function TodoList({ initialTodos }: { initialTodos: Todo[] }) {
  const { data } = useQuery({
    queryKey: ['todos'],
    queryFn: fetchTodos,
    initialData: initialTodos,
    initialDataUpdatedAt: Date.now(),     // pair with staleTime to avoid an instant refetch
  });
  return <ul>{data.map((t) => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

`initialData` is hoisted into the cache under the query key, so any other `useQuery(['todos'])` on the page also sees it — but if multiple components share the data, prefer Pattern A.

### Rules for both patterns

- **`staleTime` > 0** on queries you hydrate. With `staleTime: 0`, the cache is stale on arrival and refetches immediately — wasting the SSR work and producing a flash of fresh-fetch.
- **One `QueryClient` per request on the server.** Use the `cache()`-wrapped or `isServer`-branched factory; never a module-level singleton.
- **Same query key + queryFn shape on both sides.** A typo or trailing object difference produces a cache miss and a client-side refetch.
- **Don't `await` server prefetches** unless you specifically need to block rendering. Letting the promise float enables streaming — the client suspends and resumes when the dehydrated pending query lands.
- **Mutations still run on the client.** Server components are read-only; create a client-component form that calls `useMutation` and updates the cache as in §4–§6.
- **Skip the framework wiring if you don't need it.** A purely client-rendered route does not need `HydrationBoundary` — just `useQuery`. Reach for SSR only when first-paint data matters.

## Common mistakes

- **Storing the query result in `useState`.** **Fix:** read `data` from `useQuery` directly; the cache already memoises.
- **Forgetting `cancelQueries` or rollback context in `onMutate`.** **Fix:** cancel in-flight queries first, then snapshot `getQueryData` and return it for `onError` to restore.
- **Forgetting `onSettled` invalidation.** **Fix:** always invalidate the affected list — the server may have computed extra fields.
- **Updating the list cache but not the detail cache (or vice versa).** **Fix:** `setQueryData` both, or invalidate both in `onSettled`.
- **String query keys.** **Fix:** array keys via a centralised `queryKeys` factory; partial invalidation depends on the array structure.
- **`enabled: !!data` everywhere.** **Fix:** use `useQueries` for parallel; `enabled` only for genuine dependencies.
- **Retrying 4xx responses.** **Fix:** configure `retry` to skip non-5xx; retrying a 401 or 422 is wasted requests and confuses the user.
- **Polling with `setInterval` + `refetch`.** **Fix:** use the library's `refetchInterval`.
- **Silently rolling back an optimistic update.** **Fix:** show a toast or inline error in `onError` — otherwise users see the change appear and disappear with no explanation.
- **Module-level `QueryClient` on the server.** **Fix:** branch on `isServer` (or wrap the factory in `cache()`); a shared server cache leaks data between users' requests.
- **`staleTime: 0` on a hydrated query.** **Fix:** raise `staleTime`; otherwise the client refetches immediately and the SSR work is wasted.
- **Different query keys on the server prefetch and the client `useQuery`.** **Fix:** export keys (and ideally `queryFn`s) from one module that both sides import.
- **`await`ing every server prefetch.** **Fix:** let the promise float (`void queryClient.prefetchQuery(...)`) so Next.js can stream.
- **Mixing `initialData` and `<HydrationBoundary>` for the same query.** **Fix:** pick one — `initialData` already hoists into the cache; `HydrationBoundary` overwrites it.
