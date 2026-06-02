---
title: Optimization Playbook — Map a Hotspot to a Fix
impact: HIGH
tags:
  - optimization
  - playbook
  - decision-table
  - react
  - chrome
---

# Optimization Playbook

For each hotspot from Phase 2, decide what to do. This rule is a decision
table from **observed signal → first-line fix**, not a list of techniques to
apply unprompted.

> **Default to skepticism on memoisation.** The React Compiler now applies
> automatic memoisation; manual `useMemo`/`useCallback` without measurement
> often regresses. Apply only when the profile shows a measured win.

## React signals

| Signal in the React profile                                                     | First-line fix                                                                                       | Where in the code                              |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Same component re-renders with `props` reference-changed but value-equal         | Wrap consumer in `React.memo`; stabilise the prop with `useMemo`/`useCallback` at the producer       | The producer (parent) and the consumer (child) |
| Context provider re-renders the whole subtree every commit                       | Memoise the provider `value` with `useMemo`; split the context if value contains unrelated fields    | `<XxxProvider>` definition                     |
| `useEffect` body sets state synchronously after render                           | Move the derivation into render or `useMemo`; use `useSyncExternalStore` for subscriptions           | Effect site                                    |
| List of N items each rendering a heavy component                                 | Virtualise (`react-virtual`, `react-window`); split the row component and `React.memo` it            | The list parent                                |
| Single large component over 16ms                                                 | Split component; lift heavy work into a `useMemo`; consider `useDeferredValue` / `startTransition`   | The component                                  |
| `actualDuration >> selfDuration` (children dominate)                             | The child tree is the problem — drill down before changing this component                            | The child tree                                 |
| First mount of a route is the slow commit                                        | Lazy-load the route (`React.lazy`); preload on hover/intent                                          | Route definition                               |
| Same key remounts repeatedly across commits                                      | Stabilise the key — usually a parent passes `Math.random()` or array index inappropriately            | The parent's key prop                          |
| Animation hook (`useFrame`, `useTransition`) churns commits                      | Move the animation off React state (refs + direct DOM, or CSS animation)                             | The animating component                       |

## Chrome signals

| Signal in the Chrome trace                                                      | First-line fix                                                                                       | Where in the code                              |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Single sync long task > 200ms inside a JS function                              | Yield: `scheduler.yield()` (with fallback) at chunk boundaries; or split into requestIdleCallback     | The hot function                              |
| `JSON.parse` of a large payload in a sync task                                  | Stream-parse, or move to a Worker; or paginate the API                                               | The fetch/parse site                          |
| `EvaluateScript` of 200+ ms early in load                                       | Code-split, defer non-critical, route-level lazy-load                                                | Bundle entry                                   |
| Many `Layout` events inside one task (layout thrash)                            | Batch reads, then writes; use `requestAnimationFrame`; avoid `.offsetTop` in loops                    | The looping write/read code                   |
| `Recalculate Style` spikes per render                                            | Reduce CSS selector complexity; avoid universal/descendant selectors on hot elements                  | Stylesheet                                     |
| `ParseHTML` heavy on initial load                                                | Reduce DOM size at SSR; lazy-render below-the-fold                                                    | Page template                                 |
| Large `Image Decode` events                                                     | `loading="lazy"`, smaller variants via `<picture>`, modern formats (AVIF/WebP)                       | `<img>` tag                                    |
| Many small `setTimeout`/`setInterval` callbacks                                  | Consolidate timers; move polling to event-driven if possible                                          | Timer setup site                              |
| Long handler on `pointerup`/`click` causing INP                                 | Yield work after the visual feedback; show optimistic UI; defer non-critical work                     | Event handler                                  |

## Ranking the fixes

After mapping, rank by **expected ms saved**, not by ease.

```text
expected_saving_ms = observed_cost_ms × confidence_in_fix × work_eliminated_ratio
```

Where:

- `observed_cost_ms` — directly from the profile.
- `confidence_in_fix` — 0.5 if speculative, 0.8 if a known pattern, 1.0 if
  measured in a similar past fix.
- `work_eliminated_ratio` — fraction of the cost the fix removes (memoisation
  for re-renders is rarely 1.0; virtualisation often is).

Output the ranked list **with explicit numbers**, like:

```text
1. Memoise <UserList> rows (saves ~165ms; high confidence)
2. Stream-parse /events response (saves ~200ms; medium confidence — needs API change)
3. Lazy-load /admin route (saves ~80ms; high confidence; one-line change)
```

## When to recommend "do nothing"

Some findings should be left alone:

- A 5ms component on a screen the user reaches twice a session.
- A 12ms commit during page load that runs in parallel with network I/O.
- A long task that occurs *after* meaningful paint and before the next
  interaction (it is invisible to the user).

Naming a non-action explicitly is more valuable than a busywork fix.

## Anti-patterns (full list)

- Recommending `useMemo`/`useCallback` everywhere without measuring.
- "Add `React.memo` to fix re-renders" without checking whether the props
  are actually equal — adding `memo` over unstable props is pure overhead.
- Suggesting Web Workers for sub-50ms work (the post-message overhead
  dominates).
- Citing "best practices" without a number.
- Ignoring whether `priorityLevel` is `IdlePriority` — slow idle work is
  free.
- Treating layout thrash and slow style as the same thing.
- Skipping the confidence gate.

## Examples

### Good — playbook output

> **Hotspot 1.** `<UserListItem>` re-renders 47× per save. `props.onSelect`
> is unstable.
> **Fix.** Stabilise `onSelect` with `useCallback` in the parent;
> wrap `<UserListItem>` in `React.memo`. Targeted file: `src/users/UserList.tsx:42-58`.
> **Expected.** −165ms commit time (observed 183ms × 0.9 ratio).
> **Verify.** Re-profile, check fiber 4271 self-duration sum.

### Bad — playbook output

> Use memoisation. Reduce re-renders.

Why bad: not a fix, not a target file, not a verification step.
