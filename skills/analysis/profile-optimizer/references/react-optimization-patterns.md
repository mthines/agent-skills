---
title: React Optimization Patterns — Worked Examples
impact: MEDIUM
tags:
  - reference
  - react
  - patterns
  - examples
---

# React Optimization Patterns

Worked examples mapped to the signals in
[`rules/react-profile-analysis.md`](../rules/react-profile-analysis.md).
Load this file when you need a concrete code change for a specific
finding — not as a checklist to apply unprompted.

## Contents

- Stable callbacks for memoised children
- Memoised context value
- Splitting a god-component
- List virtualisation
- `useDeferredValue` for typing latency
- `startTransition` for non-urgent updates
- Replacing state-driven animation with refs
- Decoupling subscriptions with `useSyncExternalStore`

---

## Stable callbacks for memoised children

**Signal.** A `React.memo`'d child re-renders despite props looking equal,
because the parent recreates a function each render.

### Before

```tsx
function UserList({ users }) {
  return users.map((u) => (
    <UserListItem
      key={u.id}
      user={u}
      onSelect={() => trackSelect(u.id)} // new ref every render
    />
  ));
}
```

### After

```tsx
function UserList({ users }) {
  const onSelect = useCallback((id: string) => trackSelect(id), []);
  return users.map((u) => (
    <UserListItem key={u.id} user={u} onSelect={onSelect} />
  ));
}

const UserListItem = React.memo(function UserListItem({ user, onSelect }) {
  return <button onClick={() => onSelect(user.id)}>{user.name}</button>;
});
```

`UserListItem` now only re-renders when `user` actually changes.

---

## Memoised context value

**Signal.** `<XxxProvider>` re-renders the entire subtree every commit,
even when nothing in the value changed.

### Before

```tsx
<UserContext.Provider value={{ user, setUser }}>
  {children}
</UserContext.Provider>
```

### After

```tsx
const value = useMemo(() => ({ user, setUser }), [user]);
return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
```

If `user` and `setUser` change at different rates, split the context:

```tsx
<UserStateContext.Provider value={user}>
  <UserDispatchContext.Provider value={setUser}>
    {children}
  </UserDispatchContext.Provider>
</UserStateContext.Provider>
```

---

## Splitting a god-component

**Signal.** A single component shows `selfDuration` > 16ms and a long
`fiberSelfDurations` entry across many commits.

### Before

A 600-line `<Dashboard>` that owns all state, fetches three resources, and
renders three panels.

### After

```tsx
function Dashboard() {
  return (
    <>
      <UserPanel />
      <ActivityPanel />
      <BillingPanel />
    </>
  );
}
```

Each panel owns its state and fetch. A change in one panel no longer
re-renders the others. Often the simplest, highest-impact React fix.

---

## List virtualisation

**Signal.** The flamegraph shows N identical bars where N is large
(hundreds or thousands), totalling tens to hundreds of ms.

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function Rows({ items }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 8,
  });
  return (
    <div ref={parentRef} style={{ height: 600, overflow: 'auto' }}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((vi) => (
          <Row
            key={vi.key}
            item={items[vi.index]}
            style={{ position: 'absolute', top: vi.start, height: vi.size }}
          />
        ))}
      </div>
    </div>
  );
}
```

Cuts the DOM and React work to roughly the visible viewport.

---

## `useDeferredValue` for typing latency

**Signal.** Long commit on every keystroke in a search input.

```tsx
function Search() {
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} />
      <Results query={deferred} />
    </>
  );
}
```

The input updates synchronously; `<Results>` lags one frame and is
interruptible. Pair with `<Suspense>` if the results fetch is async.

---

## `startTransition` for non-urgent updates

**Signal.** A click handler triggers a heavy state update that delays the
visual feedback.

```tsx
const [tab, setTab] = useState<'a' | 'b'>('a');
const onClick = (next: 'a' | 'b') => {
  startTransition(() => setTab(next));
};
```

The button's pressed state flips immediately; the tab transition runs at
lower priority and is interruptible.

---

## Replacing state-driven animation with refs

**Signal.** Many small commits (one per frame) on an animated component.

### Before

```tsx
const [x, setX] = useState(0);
useFrame(() => setX((v) => v + 1)); // React re-render per frame
```

### After

```tsx
const ref = useRef<HTMLDivElement>(null);
useFrame(() => {
  if (ref.current) ref.current.style.transform = `translateX(${++count}px)`;
});
```

For pure visual animation, write to the DOM directly. React state is for
data that other components observe.

---

## Decoupling subscriptions with `useSyncExternalStore`

**Signal.** `useEffect` body sets state from an external source on every
render or every emission, causing storm-of-updates patterns.

```tsx
function useCount(store: Store) {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getCount(),
    () => store.getCount(),
  );
}
```

The hook participates in concurrent rendering correctly and avoids the
"subscribe inside `useEffect` and `setState`" pattern that causes
unnecessary commits.
