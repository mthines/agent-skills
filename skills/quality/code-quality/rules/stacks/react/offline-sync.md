---
title: 'Offline & Sync — Mutation Queue, Reconciliation, Multi-Tab Coordination'
impact: HIGH
tags:
  - offline
  - offline-first
  - sync
  - mutation-queue
  - outbox
  - indexeddb
  - tanstack-query
  - broadcastchannel
  - web-locks
  - service-worker
  - background-sync
---

# Offline & Sync

`rules/stacks/react/autosave.md` answers "how do I save this *form* well?" — debounce, indicator, ETag. This rule answers "how does the *whole app* keep working when the network blinks, the user opens three tabs, or they close the laptop mid-edit?"

The two rules share idempotency, local persistence, and conflict detection, but the scope is different: autosave is a per-form trigger; offline-sync is an architectural posture for an entire client. Use this rule when the user expects the app to be usable without a connection, when mutations need to survive reloads, or when multiple tabs must stay in step. Mutation cache mechanics live in `rules/stacks/react/data-fetching.md` §4–§6; this rule layers durability and coordination on top.

## Contents

- 1. Pick a posture
- 2. The mutation queue (outbox pattern)
- 3. Foreground queue vs Background Sync
- 4. TanStack Query offline support
- 5. Idempotency is non-negotiable
- 6. Reconnection flow
- 7. Conflict resolution strategies
- 8. Multi-tab coordination
- 9. Surfacing offline state in the UI
- 10. Common mistakes

## 1. Pick a posture

Three postures, in order of cost. Pick the lowest one that meets the user's expectations.

| Posture | What it means | When |
| --- | --- | --- |
| **Online-only** | Mutations require connectivity; failures surface as errors | Internal admin tools, low-stakes forms, rarely-disconnected users |
| **Offline-tolerant** | Reads cached; mutations queued in memory and retried on reconnect; lost on reload | Most public web apps; mobile-leaning consumer apps |
| **Offline-first** | Mutations queued in durable storage (IndexedDB) and replayed on reconnect; reads served from local cache; multi-tab coordination | Linear, Notion, native-feeling productivity apps; field tools used in poor connectivity |

Climbing one rung up the ladder roughly doubles client complexity. Don't move beyond what the user expects.

## 2. The mutation queue (outbox pattern)

Every mutation becomes a queue entry before it touches the network. Server confirmation deletes the entry; failure leaves it in place to retry. This is the **outbox pattern**, the same one used in distributed systems, scaled down to the browser.

### Queue entry shape

```typescript
type QueueEntry = {
  id: string;                            // client-generated UUID — used as Idempotency-Key
  type: 'create_todo' | 'update_todo' | 'delete_todo';
  payload: unknown;                      // schema-validated input (R7)
  entityId?: string;                     // for ordering and conflict detection
  ifMatch?: string;                      // ETag captured at enqueue time
  enqueuedAt: number;                    // for ordering
  attempts: number;
  lastAttemptAt?: number;
  lastError?: { code: string; message: string };
  status: 'pending' | 'in_flight' | 'failed';
};
```

### Storage

- **IndexedDB** is the right store. Use a thin wrapper (`idb-keyval`, `Dexie`) or a sync engine (`Replicache`, `RxDB`, `PowerSync`) — never raw IndexedDB callbacks.
- A typical schema: one object store for entities (the local cache), one for the queue. Index the queue by `(entityId, enqueuedAt)` so reconciliation can replay per-entity in order.
- `localStorage` is the wrong store for a queue: too small, synchronous, and loses structure. Reserve it for tiny config (theme, last-seen tab).

### Order

Queue entries replay in **enqueue order per entity**. Two updates to the same todo must apply in the order the user made them; updates to different todos can replay in parallel.

### Lifecycle

```
schedule → pending → (network call) → in_flight → success → delete
                                                ↘ failure (transient) → pending (retry, backoff)
                                                ↘ failure (permanent) → failed (surface to user)
```

## 3. Foreground queue vs Background Sync

| Mechanism | Where it runs | Survives tab close? | When to use |
| --- | --- | --- | --- |
| **Foreground queue** | App code, while the tab is open | No (queue persists; replay needs the tab) | Default. Simple, debuggable, browser-portable |
| **Background Sync API** | Service worker, even with no tab open | Yes | Low-risk, high-frequency mutations (analytics, telemetry, low-stakes edits) |

Real-world apps mix both: a foreground queue for high-stakes mutations the user wants to watch land, and Background Sync for fire-and-forget writes. Service workers and Background Sync are a deep topic — consult MDN and the chosen sync-engine's docs before adopting.

Start foreground-only. Add Background Sync only when you have evidence that users close the tab before the queue drains.

## 4. TanStack Query offline support

If the project uses TanStack Query (see `rules/stacks/react/data-fetching.md`), use its offline primitives rather than rolling a queue from scratch.

### `networkMode`

```typescript
new QueryClient({
  defaultOptions: {
    queries:    { networkMode: 'offlineFirst' },  // run once, then pause retries on offline
    mutations:  { networkMode: 'offlineFirst' },  // mutations pause when offline; resume on reconnect
  },
});
```

| Mode | Queries | Mutations | Use |
| --- | --- | --- | --- |
| `online` (default) | Pause when offline; resume on reconnect | Same | Online-only and offline-tolerant apps |
| `offlineFirst` | Run once, then pause retries; cache wins | Pause when offline; queued | Offline-first apps; pairs with a service worker for cached responses |
| `always` | Run regardless of network state | Same | Background polling that should never pause |

### Persistence

For mutations to survive a reload, install `@tanstack/react-query-persist-client` (or equivalent) to dehydrate the query cache **and the mutation queue** to IndexedDB.

```typescript
persistQueryClient({
  queryClient,
  persister: createIDBPersister(),                 // not localStorage — quotas + sync limits
  buster: APP_VERSION,                             // bump to invalidate after schema changes
  dehydrateOptions: {
    shouldDehydrateMutation: (m) => m.state.isPaused,  // persist only paused (offline) mutations
  },
});
```

### Resume on reconnect

```typescript
window.addEventListener('online', () => {
  void queryClient.resumePausedMutations();        // replays in enqueue order
});
```

`resumePausedMutations` returns a promise that resolves when every paused mutation has settled. Surface failures from the result; do not assume reconnect ⇒ all-good.

### Define a default `mutationFn`

Persistence-then-replay only works if the resumed mutation knows how to run. Register `mutationFn` on the `MutationCache` defaults (or via a key registry) so a rehydrated mutation does not arrive without behaviour attached.

## 5. Idempotency is non-negotiable

Queue replay is, by definition, a retry. Every endpoint a queued mutation targets must be idempotent. See R18 (Make the Operation Idempotent) and `rules/correctness.md` §1.

### Concrete rules

- **Client generates a stable `id` per queue entry** (UUID v4). Pass it as `Idempotency-Key` on every retry. The server dedupes on this key.
- **PUT and DELETE are naturally idempotent.** Design POST handlers to be safe to retry — typically by upserting on the idempotency key.
- **The server returns the canonical entity on every retry**, not just the first. The client overwrites cache from the response on each settle.
- **Combine with ETag / `If-Match`** (`rules/stacks/react/autosave.md` §6) so a queued update that has been superseded by another tab returns 412 instead of clobbering.

A queue without idempotency is a corruption machine.

## 6. Reconnection flow

```
detect online (window.online + actual request success)
  → acquire single-writer lock                     (§8)
  → for each queue entry, enqueue order:
      → fetch current entity (for ETag / version)
      → POST/PUT/DELETE with Idempotency-Key + If-Match
      → on success → delete entry, broadcast result
      → on 4xx (non-conflict) → mark failed, surface to user
      → on 412 → run conflict resolution            (§7)
      → on 5xx / network → backoff (1s → 2s → 4s …, jittered, capped ~30s)
  → release lock
```

Drive `online` from request *outcomes*, not just `navigator.onLine`. The browser's network signal is a hint. The first successful request is the contract.

## 7. Conflict resolution strategies

| Strategy | What it does | When |
| --- | --- | --- |
| **Last-write-wins (LWW)** | Newest timestamp wins; older edits dropped | Single-user, single-device data only |
| **Server reconciliation** | Server merges patch onto current state; rejects on `If-Match` mismatch | Default for collaborative apps; simple and explicit |
| **Version vectors** | Each replica tracks its own counter; merges deterministic | When you need "happened before" semantics across many devices |
| **CRDTs (Yjs, Automerge)** | Operation-based merge that always converges | Real-time collaborative editing (Google Docs–style) — different problem from autosave |

Default to **server reconciliation with `If-Match`**. When the server returns 412:

1. Stop replaying for this entity.
2. Refetch the canonical state.
3. Surface "edited elsewhere — Reload / Keep mine" rather than silently merging. Silent merges destroy data.
4. On "Keep mine", rebuild the queue entry with the new ETag and replay.

CRDTs are a different architecture. If the product needs them, the autosave + queue model is the wrong starting point — adopt the CRDT first and let the sync engine handle queue and conflicts.

## 8. Multi-tab coordination

Two tabs replaying the same queue is a duplicate-write bug. Coordinate.

### Single-writer with the Web Locks API

```typescript
async function withSyncLeadership(work: () => Promise<void>) {
  await navigator.locks.request('sync-leader', { mode: 'exclusive' }, async () => {
    await work();   // only one tab in this block at a time
  });
}
```

The lock is released automatically when the tab closes or the callback resolves. Other tabs queued on the same name proceed in order.

### Cross-tab state propagation with `BroadcastChannel`

```typescript
const channel = new BroadcastChannel('sync');
channel.postMessage({ type: 'mutation_settled', entityId, server });
channel.onmessage = (e) => queryClient.setQueryData(queryKeys.todos.detail(e.data.entityId), e.data.server);
```

After the leader tab settles a mutation, broadcast the result so other tabs update their TanStack Query cache without a refetch. This drops API calls dramatically when users have many tabs open.

### Fallback

`navigator.locks` is broadly supported; for the few environments without it (older WebViews), `BroadcastChannel`-based leader election libraries (`broadcast-channel`, `tab-election`) provide the same primitive. Most teams will not need to ship a fallback.

## 9. Surfacing offline state in the UI

Offline UX is a `/ux` skill concern in detail; the rules from there apply (`rules/forms-and-input.md` for status, `rules/ux-writing.md` for copy, `rules/accessibility.md` for live regions). Two specifics for offline-sync:

- **Global offline banner** — single source of truth, ARIA `role="status"`, copy: `"You're offline — changes will sync when you're back."` Hide as soon as the first request succeeds, not when `navigator.onLine` flips.
- **Per-item state** — items the user mutated while offline carry a "Pending sync" badge until the queue entry settles. Failed entries get a "Couldn't sync — Retry / Discard" affordance.
- **Never lock the UI** behind connectivity. Reads continue from cache; new mutations enqueue. Modal "You're offline" overlays drive users to close the tab — and lose the foreground queue.
- **Don't repeat the autosave indicator.** Per-form "Saved 14:02" is a different signal from app-wide "Offline — 3 changes queued". Keep them visually distinct.

## 10. Common mistakes

- **Online-only thinking, deployed to a mobile audience.** **Fix:** climb at least to offline-tolerant (queue mutations in memory, retry on reconnect) before shipping; offline-first if the use case warrants.
- **Mutation queue in `localStorage`.** **Fix:** IndexedDB. localStorage is sync, ~5 MB, and structurally a string map.
- **No idempotency key.** **Fix:** client-generated UUID per queue entry, sent as `Idempotency-Key`; server dedupes. R18.
- **Replaying the queue out of order.** **Fix:** index by `(entityId, enqueuedAt)`; replay per-entity in order; allow parallelism only across entities.
- **Two tabs replaying the same queue.** **Fix:** single-writer lock via `navigator.locks.request('sync-leader', ...)`; broadcast settled mutations on a `BroadcastChannel`.
- **Trusting `navigator.onLine` exclusively.** **Fix:** treat it as a hint; drive offline state from real request outcomes.
- **Persisting paused mutations without a default `mutationFn`.** **Fix:** register `mutationFn` on `MutationCache` defaults so rehydrated mutations have behaviour attached.
- **Silent merge on conflict.** **Fix:** on 412 (or version mismatch), surface "edited elsewhere — Reload / Keep mine". Silent merges destroy data.
- **No backoff on retries.** **Fix:** exponential backoff with jitter, capped ~30 s; do not retry 4xx (other than 408 / 425 / 429).
- **Locking the UI behind connectivity.** **Fix:** reads from cache, mutations enqueue, banner is informational. Modal blockers drive users to close the tab and lose the queue.
- **Reaching for CRDTs because "we want offline".** **Fix:** server reconciliation with `If-Match` covers most products. Adopt CRDTs only when the product is real-time collaborative editing.
- **Building this from scratch when a sync engine fits.** **Fix:** evaluate Replicache, RxDB, PowerSync, or ElectricSQL before implementing the queue, lock, and reconciliation by hand. The build cost is enormous and the failure modes are subtle.
