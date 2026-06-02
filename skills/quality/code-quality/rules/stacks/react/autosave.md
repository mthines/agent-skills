---
title: 'Autosave — Debounce, Local-First Drafts, Status, Conflict Detection'
impact: HIGH
tags:
  - autosave
  - forms
  - debounce
  - throttle
  - localstorage
  - indexeddb
  - offline
  - conflict-resolution
  - ux
  - accessibility
---

# Autosave

Autosave makes a form feel like a document — type, look away, come back, the work is still there. Done badly it feels like a haunted typewriter: characters disappear, focus jumps, the page warns you about "unsaved changes" that were saved three seconds ago.

This rule covers the implementation patterns. For the surrounding form fundamentals — labels, validation timing, error display, accessibility, and the words on the status indicator — load the `/ux` skill (`rules/forms-and-input.md`, `rules/accessibility.md`, `rules/ux-writing.md`). The mutation mechanics (cache surgery, optimistic updates, rollback) live in `rules/stacks/react/data-fetching.md` §4–§6; autosave is just one of them with a debounced trigger.

## Contents

- 1. Should you autosave at all?
- 2. Trigger model: debounce + on blur + max-wait flush
- 3. Timing values that work
- 4. Local-first draft buffer (localStorage / IndexedDB)
- 5. Status indicator: state, copy, accessibility
- 6. Conflict detection (ETag / `If-Match` / version)
- 7. Offline and retry
- 8. `beforeunload` guard
- 9. Field-level vs document-level saves
- 10. Common mistakes

## 1. Should you autosave at all?

Autosave is always more complex than an explicit Save button. Use it when these are true:

| Use autosave when | Use explicit Save when |
| --- | --- |
| Long-form editing (notes, drafts, settings panels) | Multi-step wizards where partial state is invalid |
| Loss of work would frustrate the user | Submitting triggers an irreversible side effect (charge, email, publish) |
| The "saved" state is the same shape as the "draft" state | The form is a transaction: payments, account deletions, bulk actions |
| Server can accept partial updates idempotently | The server validates only complete payloads |

If you reach for autosave, decide first whether the document model is **draft → publish** (two states; autosave saves the draft, an explicit button publishes) or **always live** (every save is the canonical state). Conflating the two is the most common source of "I didn't mean to save that" bugs.

## 2. Trigger model: debounce + on blur + max-wait flush

A single trigger is never enough. Layer four:

| Trigger | When | Why |
| --- | --- | --- |
| **Debounce** on change | User stops typing for *N* ms | Avoids a save per keystroke |
| **On blur** of any field | Input loses focus | Coarsest "user moved on" signal — saves before they leave |
| **Max-wait flush** | Debounce has been pending for *M* ms straight | Heavy typists never trigger pure debounce; flush so they don't lose 30 s of work |
| **On `visibilitychange` to hidden / `pagehide`** | User switches tab, closes window, navigates | Last-chance save; use `navigator.sendBeacon` or the keepalive `fetch` flag |

### Debounce vs throttle

Use **debounce** as the primary trigger (wait for the user to stop), and **add a max-wait** so it behaves like a throttle when typing is continuous. Pure throttle (save every N seconds regardless) wastes requests on idle pauses; pure debounce starves heavy typists.

Most utilities expose both: lodash's `debounce(fn, wait, { maxWait })`, or wire it manually:

```typescript
function makeAutosave(save: (v: T) => Promise<void>, { wait, maxWait }: { wait: number; maxWait: number }) {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingValue: T | undefined;

  const flush = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (maxWaitTimer) clearTimeout(maxWaitTimer);
    debounceTimer = maxWaitTimer = undefined;
    if (pendingValue !== undefined) { void save(pendingValue); pendingValue = undefined; }
  };

  return {
    schedule(value: T) {
      pendingValue = value;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flush, wait);
      if (!maxWaitTimer) maxWaitTimer = setTimeout(flush, maxWait);
    },
    flush,
  };
}
```

Wire `flush()` into `onBlur`, `visibilitychange` (when document becomes hidden), and `pagehide` so navigating away never strands a pending save.

## 3. Timing values that work

| Value | Default | When to deviate |
| --- | --- | --- |
| Debounce wait | **1000 ms** | 250–500 ms for short fields (single-line title, slider, toggle group); 1500–2000 ms for heavy text editors where users type in long bursts |
| Max-wait | **5 s** | Up to 10 s for low-stakes content; 2 s for collaborative editing where freshness matters |
| Min retry backoff | 1 s | Capped at ~30 s with jitter |
| Status indicator "Saved" linger | 2–3 s | Then fade to a quieter timestamp ("Saved 14:02") |

Never block input while a save is in flight. The next keystroke is more important than the previous save's response.

## 4. Local-first draft buffer (localStorage / IndexedDB)

Persist the draft locally **on every change** (cheap, synchronous-ish), and push to the server on the autosave trigger. The local buffer is the survival layer when the network blinks, the laptop closes, or the tab crashes.

| Storage | Use when |
| --- | --- |
| `localStorage` | Single small form, < ~1 MB total, plain JSON, single tab is fine |
| `IndexedDB` (via `idb-keyval`, Dexie) | Larger documents, image / file attachments, multi-tab safety, structured queries |
| In-memory only | Throwaway forms (search box drafts, inline edits) where local persistence has no value |

### Pattern

```typescript
const DRAFT_KEY = (id: string) => `draft:todo:${id}`;

function useAutosavedForm(id: string, initial: Todo, save: (v: Todo) => Promise<Todo>) {
  // Hydrate from local draft if newer than server
  const [value, setValue] = useState<Todo>(() => {
    const local = localStorage.getItem(DRAFT_KEY(id));
    return local ? { ...initial, ...JSON.parse(local) } : initial;
  });
  const autosave = useMemo(() => makeAutosave(save, { wait: 1000, maxWait: 5000 }), [save]);

  function onChange(next: Todo) {
    setValue(next);
    localStorage.setItem(DRAFT_KEY(id), JSON.stringify(next));   // local first, synchronous
    autosave.schedule(next);                                      // server, debounced
  }

  // Clear the local draft only after the server confirms it stored the same value
  function onSaved(server: Todo) {
    if (server.updatedAt >= value.updatedAt) localStorage.removeItem(DRAFT_KEY(id));
  }
  ...
}
```

### Rules

- **Write local first, then schedule the server save.** The local write is the safety net; if anything between here and the server fails, the draft survives.
- **Key by entity ID + user ID.** Two users on the same device must not see each other's drafts.
- **Hydrate from local on mount and compare timestamps.** If the local copy is newer than the server's `updatedAt`, present "Unsaved local changes — Discard / Restore" rather than silently overwriting either side.
- **Clear the local draft only after server confirmation** that it ingested the *same* value. Never clear on every server response — that creates a window where a stale server response wipes a fresher local edit.
- **Cap local size.** Truncate or rotate when localStorage approaches its quota (browsers throw `QuotaExceededError` around 5 MB); spill to IndexedDB for anything larger.

## 5. Status indicator: state, copy, accessibility

Five states, one indicator slot. Map the internal save state to one visible string at a time.

| State | Default copy | Notes |
| --- | --- | --- |
| **Idle** (no changes since load) | (empty) or `"Saved"` with a timestamp | Don't shout "Saved" if the user did nothing |
| **Dirty** (changes pending) | `"Unsaved changes"` | Subtle; the next state will replace it |
| **Saving** | `"Saving…"` | Spinner permitted; do not block input |
| **Saved** | `"Saved"` then fade to `"Saved 14:02"` | Linger 2–3 s; do not flash on every keystroke |
| **Error** | `"Couldn't save — Retry"` | Persistent until resolved; expose a manual Retry; on offline, switch to `"Offline — saved locally"` |

### Accessibility

- Wrap the indicator in an ARIA live region: `<div role="status" aria-live="polite">`. The transitions Saving → Saved → Error are announced by screen readers.
- Use `aria-live="assertive"` only for the **error** state when the user must act.
- Never rely on colour alone (red dot for error). Pair every state with text or a recognisable icon.
- Errors that block submission must be focusable so keyboard users can act. See `/ux` `rules/forms-and-input.md` and `rules/accessibility.md` for the broader rules on error display and live regions.

### Copy

Lift writing guidance from `/ux` `rules/ux-writing.md`. Two specifics for autosave:

- Prefer **"Saving…"** (with the ellipsis) over **"Auto-saving"** — users don't care that it's automatic, only that it's happening.
- Prefer **"Couldn't save"** over **"Failed to save"**. The first is contrite and human; the second sounds like a system error code.

## 6. Conflict detection (ETag / `If-Match` / version)

Two tabs, two devices, an autosave race — without a guard, the slow save overwrites the fast one. Add optimistic concurrency control on every write endpoint that an autosaving form targets.

### HTTP-native (preferred)

```http
GET /api/todos/123                  → 200 OK, ETag: "v7"
PATCH /api/todos/123                ← If-Match: "v7"
                                    → 200 OK, ETag: "v8"          (success)
                                    → 412 Precondition Failed     (someone else wrote v8 first)
```

Server pseudocode:

```typescript
const current = await db.todos.findOrThrow(id);
if (req.headers['if-match'] !== `"v${current.version}"`) {
  return new Response(null, { status: 412 });
}
const next = { ...current, ...patch, version: current.version + 1 };
await db.todos.update(id, next);
return NextResponse.json(next, { headers: { ETag: `"v${next.version}"` } });
```

Client behaviour on `412`:

1. Stop scheduling further saves for this version.
2. Refetch the server's current version.
3. Show **"This was edited elsewhere — Reload / Keep mine"** rather than silently merging.
4. On "Keep mine", retry with the new ETag in `If-Match`.

### Embedded version field (alternative)

If you cannot control HTTP headers (some serverless gateways, GraphQL), put `version: number` on the entity and reject writes whose `version` is not `current.version`. Same semantics, less ceremony.

### Last-write-wins (only when collisions are impossible)

Acceptable for purely single-user, single-device documents (personal notes that never leave a phone). For anything else, last-write-wins silently destroys data — `/ux` users will not forgive this.

## 7. Offline and retry

`navigator.onLine` is a hint, not a contract. Drive offline state from request *outcomes*, not from the API alone.

- **On network failure:** keep the local draft, switch the indicator to `"Offline — saved locally"`, schedule retry with exponential backoff + jitter (1 s → 2 s → 4 s → … capped ~30 s).
- **On reconnect (`window.online` event):** flush any pending value immediately.
- **Make the request idempotent.** Autosave will retry; the server must not duplicate. PATCH with `If-Match` is naturally idempotent on success and rejects safely on stale state. See R18 and `rules/correctness.md` §1.
- **Do not retry on 4xx** (other than 408 / 425 / 429). A 422 means the client sent invalid data; retrying without changes will fail again forever.

For app-wide offline (mutation queue across many forms, multi-tab coordination, replay on reconnect), use the patterns in `rules/stacks/react/offline-sync.md`. This section is the form-level slice; once you have more than one autosaving surface or need queued mutations to survive a reload, climb up to the durable outbox pattern.

## 8. `beforeunload` guard

If there are *truly* unsaved changes, prompt before navigation; if the autosave is just in flight, flush instead.

```typescript
useEffect(() => {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    autosave.flush(); // best-effort; modern browsers cap synchronous work here
    if (hasUnsavedChanges) {
      e.preventDefault();   // shows browser-controlled confirmation
      e.returnValue = '';   // legacy
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}, [hasUnsavedChanges]);
```

Pair with `visibilitychange → hidden` and `pagehide` for the cases where `beforeunload` is suppressed (mobile Safari, bfcache). Use `navigator.sendBeacon(url, body)` for the last-gasp save — it survives unload where `fetch` does not (unless `keepalive: true`).

## 9. Field-level vs document-level saves

| Pattern | When | Cost |
| --- | --- | --- |
| **Document-level** — send the whole entity | Small documents, no concurrent users | Simple; bigger payloads |
| **Field-level** — send `{ field, value, version }` patches | Large documents, collaborative editing, mobile bandwidth | Server must merge; ETag / version is per-field or per-document |

Field-level saves pair naturally with `PATCH` and JSON Patch (RFC 6902). They reduce conflicts (two users editing different fields don't collide) but require the server to apply patches in order and surface the merged result.

For collaborative editing in the same document, autosave is the wrong primitive — use a CRDT (Yjs, Automerge) or operational transform layer.

## 10. Common mistakes

- **Saving on every keystroke.** **Fix:** debounce 500–1000 ms, with a max-wait flush so heavy typists also save.
- **Pure throttle.** **Fix:** debounce + max-wait. Throttle wastes requests on idle pauses and starves heavy typists.
- **Disabling the input while saving.** **Fix:** never. The next keystroke matters more than the response. Show status, don't block input.
- **Refetching after save and clobbering the in-flight edit.** **Fix:** merge by `updatedAt` / version, or skip the refetch when the form is dirty.
- **Showing "Saved" on every keystroke.** **Fix:** show "Saving…" while pending, "Saved" only on transition from Saving → success, then linger 2–3 s.
- **No local draft buffer.** **Fix:** write to localStorage (or IndexedDB) on every change; clear only after server confirmation of the same value.
- **Clearing the local draft on every server response.** **Fix:** clear only when `server.updatedAt >= localValue.updatedAt`, otherwise a stale response will erase fresher local edits.
- **No conflict detection.** **Fix:** ETag + `If-Match` (or an embedded `version` field). On 412, stop saving and prompt the user to reload or keep theirs.
- **Retrying 422 forever.** **Fix:** don't retry 4xx (except 408 / 425 / 429). The body is wrong; retrying won't help.
- **Trusting `navigator.onLine` exclusively.** **Fix:** drive offline state from request outcomes; treat the API as a hint.
- **Status indicator with no ARIA live region.** **Fix:** `<div role="status" aria-live="polite">` for normal transitions; `aria-live="assertive"` only for errors that require action.
- **`beforeunload` prompt fires when nothing is unsaved.** **Fix:** track `hasUnsavedChanges` precisely (dirty since last *successful* save); flush in-flight saves rather than prompting.
- **One autosave per field with no coordination.** **Fix:** one debounced scheduler per document; field changes update the in-memory model and schedule a single save.
- **Autosaving an irreversible action.** **Fix:** autosave the draft; require an explicit Publish / Send / Charge button for the irreversible step.
