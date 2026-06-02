# Profile Analysis — {{ artefact-name }}

## Summary

- **Profile type:** {{ react-profiler | chrome-trace | cpuprofile }}
- **Recording conditions:** {{ device profile, throttling, build mode }}
- **Primary metric:** {{ INP | TBT | LCP | commit-duration | frame-rate }}
- **Baseline:** {{ measured value, e.g. INP 412ms }}
- **Target:** {{ goal value, e.g. INP ≤ 200ms }}
- **Confidence (post-iteration):** {{ score }}%

## Top hotspots

| # | Hotspot                                | Cost              | % of total | Source location                         |
| - | -------------------------------------- | ----------------- | ---------- | --------------------------------------- |
| 1 | {{ hotspot 1 }}                        | {{ ms }}          | {{ % }}    | {{ file:line }}                         |
| 2 | {{ hotspot 2 }}                        | {{ ms }}          | {{ % }}    | {{ file:line }}                         |
| 3 | {{ hotspot 3 }}                        | {{ ms }}          | {{ % }}    | {{ file:line }}                         |

## Root causes

### 1. {{ Hotspot 1 title }}

- **Evidence:** {{ direct quote of profile data — counts, durations, flags }}
- **Why it costs what it costs:** {{ one-paragraph mechanism }}
- **Code site:** {{ file:line — short snippet if helpful }}

### 2. {{ Hotspot 2 title }}

- **Evidence:** {{ ... }}
- **Why it costs what it costs:** {{ ... }}
- **Code site:** {{ ... }}

### 3. {{ Hotspot 3 title }}

- **Evidence:** {{ ... }}
- **Why it costs what it costs:** {{ ... }}
- **Code site:** {{ ... }}

## Ranked optimisations

| # | Fix                                    | Estimated saving | Confidence | Effort | Risk         |
| - | -------------------------------------- | ---------------- | ---------- | ------ | ------------ |
| 1 | {{ fix 1 }}                            | {{ ~ms }}        | {{ H/M/L }} | {{ XS/S/M/L }} | {{ low/medium/high }} |
| 2 | {{ fix 2 }}                            | {{ ~ms }}        | {{ ... }}  | {{ ... }} | {{ ... }}             |
| 3 | {{ fix 3 }}                            | {{ ~ms }}        | {{ ... }}  | {{ ... }} | {{ ... }}             |

### Fix 1 — {{ title }}

**File:** {{ path:line }}

**Change:**

```{{ lang }}
{{ before / after diff or replacement snippet }}
```

**Verification:** {{ how to confirm the saving — re-record under the same
conditions, compare metric X, look for event Y. }}

### Fix 2 — {{ title }}

…

### Fix 3 — {{ title }}

…

## Things to leave alone

- {{ low-impact item with reason — names a non-action explicitly }}
- {{ ... }}

## Open questions / what would raise confidence

- {{ specific question for the user, OR additional evidence needed }}
- {{ ... }}

## Verification plan

1. Apply fix 1.
2. Re-record under {{ same conditions: device, throttling, build }}.
3. Read {{ primary metric }} and compare to {{ baseline }}.
4. If improvement < {{ expected threshold }}, return to Phase 3 and
   re-analyse — the model of the problem was wrong.
