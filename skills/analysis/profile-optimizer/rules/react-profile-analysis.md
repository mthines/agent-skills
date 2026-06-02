---
title: React Profile Analysis — Reading a DevTools Profiler Export
impact: HIGH
tags:
  - react
  - profiler
  - flamegraph
  - commit-phase
  - hotspots
---

# React Profile Analysis

Extract the highest-cost commits, the components driving them, and the
re-render reasons from a React DevTools Profiler `.json` export. The goal
of this phase is a **ranked list of culprits with measured cost** — not
opinions about the architecture.

## Anatomy of the export

A React Profiler export is a single JSON object:

```text
{
  version: <number>,
  rendererID: <number>,
  dataForRoots: [
    {
      rootID, displayName,
      commitData: [   <-- array of commits
        {
          changeDescriptions: [...],   // why each fiber re-rendered
          duration: <ms>,              // total commit duration
          effectDuration, passiveEffectDuration,
          fiberActualDurations: [[fiberID, ms], ...],
          fiberSelfDurations:   [[fiberID, ms], ...],
          priorityLevel,
          timestamp,                   // ms since profile start
          updaters: [...]              // who scheduled the update
        }
      ],
      operations: [...],               // tree mutations
      snapshots: { <fiberID>: { displayName, key, ... } }
    }
  ]
}
```

## Extraction recipe (jq)

Run these against the export and write the output into the report.

```bash
# Top 10 commits by duration
jq '.dataForRoots[0].commitData
    | map({i: .timestamp, dur: .duration, prio: .priorityLevel})
    | sort_by(-.dur)[0:10]' profile.json

# Sum of commit durations (total render time)
jq '[.dataForRoots[0].commitData[].duration] | add' profile.json

# Top components by self-duration across all commits
jq '.dataForRoots[0].commitData
    | map(.fiberSelfDurations)
    | flatten(1)
    | group_by(.[0])
    | map({fiber: .[0][0], totalSelf: ([.[][1]] | add), count: length})
    | sort_by(-.totalSelf)[0:10]' profile.json

# Resolve fiberID → displayName via snapshots
jq --arg id "<FIBER_ID>" '.dataForRoots[0].snapshots[$id]' profile.json
```

When the file is huge, use `jq --stream` and filter on the way through.

## What to look for, in order

Walk the profile in this order — the first match is usually the answer.

| # | Signal                                                                 | Meaning                                                                      | Common cause                                          |
| - | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1 | A single commit > 50ms                                                 | One render cycle is exceeding a frame                                        | One slow component, deep tree, or expensive `useEffect` body |
| 2 | Many commits clustered in time                                         | A loop of state updates ("update storms")                                    | `useEffect` writing state synchronously, sub→parent feedback |
| 3 | Same fiber dominating self-duration across many commits                | One component re-renders constantly                                          | Unstable props (object/array/function literals)       |
| 4 | `changeDescriptions` show props/hooks changed but values are identical | A reference change without a value change                                    | Inline object/array, recreated callback, context churn |
| 5 | Long-tail of small commits                                             | Death by a thousand cuts                                                     | Subscriptions, animation hooks, polling timers        |
| 6 | `priorityLevel` low but commits long                                   | Concurrent rendering yielding repeatedly                                     | Big synchronous work that should be transitioned      |

## Map fiber → file

The export gives `displayName` only. To locate the source:

1. Search the codebase: `grep -rn "function ${displayName}\|const ${displayName} = "`.
2. If multiple matches, narrow with the parent fiber (walk up via `operations`).
3. If a render-prop or HOC, `displayName` may be `Connect(Inner)` or
   `withXxx(Inner)` — strip wrappers and search again.

Quote the file path and line number in the report.

## Read `changeDescriptions` carefully

`changeDescriptions` flags **why** React re-rendered each fiber:

```json
{
  "<fiberID>": {
    "didHooksChange": true,
    "isFirstMount": false,
    "props": ["onClick"],
    "state": null,
    "context": false,
    "hooks": [3]
  }
}
```

Translate this into a root cause:

| `changeDescriptions` shape                          | Root cause                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `props: ["onClick"]` repeatedly with same logic     | Parent recreates the function each render — wrap in `useCallback` or move out |
| `props: ["data"]` where `data` is `{...users}`      | New object reference every render — memoise or restructure              |
| `context: true` on every commit                     | Provider value rebuilt every render — memoise the value                  |
| `didHooksChange: true` with no obvious dep          | A custom hook is the culprit — open it and check                         |
| `isFirstMount: true` repeated for the same name     | Component is being unmounted/remounted — check parent `key`s             |

## Examples

### Good — finding

> `<UserListItem>` (id 4271) appears in `fiberSelfDurations` of 47 of 52
> commits, totalling **183ms (38% of total render time)**.
> `changeDescriptions` shows `props: ["onSelect"]` changing every commit
> while `props: ["user"]` stays equal. Root cause: parent `<UserList>`
> at `src/users/UserList.tsx:42` recreates `onSelect` inline each render.
> Estimated fix saving: **~165ms** (assume `React.memo` + stable callback
> drops 90% of re-renders). Verification: re-profile and read total render
> time + `<UserListItem>` self-duration sum.

### Bad — finding

> The user list is slow. Memoise it.

Why bad: no count, no percentage, no root cause, no estimated saving.

## Common mistakes

- Reporting `actualDuration` (includes children) when you mean
  `selfDuration` (the component itself). **Fix:** be explicit which one
  the number is.
- Ignoring `priorityLevel` — long low-priority commits and long
  high-priority commits have different fixes (`startTransition` vs
  reducing work). **Fix:** include the priority in the finding.
- Stopping at the first slow commit without checking whether it repeats.
  **Fix:** always sort the top-10 and look for repetition patterns.
- Missing the `updaters` field, which names the component that scheduled
  the update — often the actual culprit. **Fix:** always read `updaters`.
