---
name: profile-optimizer
description: >
  Analyzes React DevTools Profiler exports, Chrome DevTools Performance
  traces, and Chrome heap snapshots / heap-timelines / heap-profiles.
  Identifies the highest-impact bottlenecks (long tasks, expensive renders,
  layout thrash, wasted memoisation, blocking scripts, retained memory,
  leaks) and proposes concrete code fixes ranked by measured impact.
  Auto-detects the input format (React `.json` profile, Chrome trace `.json`
  / `.cpuprofile`, or `.heapsnapshot` / `.heaptimeline` / `.heapprofile`).
  Iterates via the `/confidence` skill — if root-cause certainty is below
  90%, it digs deeper before recommending a fix. Use when handed a profile
  file, asked "why is this slow?", "why is memory growing?", or asked to
  optimise a hot path with evidence. Triggers on "analyze profile", "react
  profiler", "chrome performance", "optimize from profile", "profile this",
  "why is this slow", "memory leak", "heap snapshot", "/profile-optimizer".
argument-hint: '<profile.json|trace.json|.cpuprofile|.heapsnapshot>'
license: MIT
disable-model-invocation: true
metadata:
  author: mthines
  version: '1.1.0'
  workflow_type: applied
  tags:
    - performance
    - profiling
    - react
    - chrome-devtools
    - optimization
    - flamegraph
    - long-tasks
    - inp
    - memory
    - heap
    - leak-detection
    - measurement
    - evidence-based
---

# Profile Optimizer

Turn a profile file into a ranked, evidence-backed optimisation plan.

> **Index file.** Detailed analysis rules, optimisation patterns, and report
> templates live under `rules/`, `references/`, and `templates/`. Load only
> what the current phase needs — the body of `SKILL.md` is a thin orchestrator.

---

## Inputs

The user passes one or more profile files. Accept any of:

| Format                     | Extension                | Detection signal                                                  |
| -------------------------- | ------------------------ | ----------------------------------------------------------------- |
| React DevTools Profiler    | `.json` (often `.reactprofile`) | Top-level keys include `dataForRoots` and `rendererID` / `version` |
| Chrome Performance trace   | `.json` / `.json.gz`     | Top-level `traceEvents` array (or NDJSON with `ph`, `ts`, `cat`)   |
| Chrome CPU profile (legacy)| `.cpuprofile`            | Top-level `nodes`, `samples`, `timeDeltas`                        |
| Chrome heap snapshot       | `.heapsnapshot`          | Top-level `snapshot.meta.node_fields` + `nodes`/`edges`/`strings` |
| Chrome heap timeline       | `.heaptimeline`          | Heap snapshot shape + `samples` array                              |
| Chrome heap profile (sampled allocations) | `.heapprofile` | Top-level `head` + `samples` (V8 sampling-allocation profile)      |

If the file is gzipped, decompress with `gunzip -k` before parsing.

If multiple formats are passed, treat them as complementary evidence:

- React profile + Chrome trace → correlate by wall-clock timestamp (React
  shows component cost, Chrome shows where the main thread actually spent
  time).
- Two or three heap snapshots → diff them to find what grew (leak detection).
- Chrome trace + heap timeline of the same interaction → CPU + memory cost
  of one action correlated.

See [`rules/input-detection.md`](./rules/input-detection.md) for the precise
detection logic.

---

## Workflow

Six phases. Do not skip a gate.

| Phase | Name                | Rule file                                                                | Gate                                                                     |
| ----- | ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 0     | Intake              | [`rules/input-detection.md`](./rules/input-detection.md)                 | Format detected, file size and validity confirmed                        |
| 1     | Measurement frame   | [`rules/measurement-methodology.md`](./rules/measurement-methodology.md) | Baseline metric chosen (TBT, INP, p95 commit, retained MB, etc.) and target stated |
| 2     | Hotspot extraction  | [`rules/react-profile-analysis.md`](./rules/react-profile-analysis.md), [`rules/chrome-trace-analysis.md`](./rules/chrome-trace-analysis.md), or [`rules/heap-snapshot-analysis.md`](./rules/heap-snapshot-analysis.md) | Top-N bottlenecks listed with concrete numbers (ms / MB / %, count)      |
| 3     | Root-cause          | [`rules/optimization-playbook.md`](./rules/optimization-playbook.md)     | Each hotspot mapped to a code-level cause (file path / component / API)  |
| 4     | Confidence gate     | [`rules/confidence-loop.md`](./rules/confidence-loop.md)                 | `/confidence analysis` ≥ 90% — else iterate (max 2 deep-dives)        |
| 5     | Optimisation plan   | [`templates/analysis-report.md`](./templates/analysis-report.md)         | Report written with ranked fixes, expected impact, and verification plan |

Phases 2 and 3 branch on the input format (CPU / memory) — everything else is shared.

---

## Required reading by phase

Load on demand — do not preload.

| Phase | Files                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | [`rules/input-detection.md`](./rules/input-detection.md)                                                                                                             |
| 1     | [`rules/measurement-methodology.md`](./rules/measurement-methodology.md)                                                                                             |
| 2 (CPU) | [`rules/react-profile-analysis.md`](./rules/react-profile-analysis.md), [`rules/chrome-trace-analysis.md`](./rules/chrome-trace-analysis.md)                       |
| 2 (Memory) | [`rules/heap-snapshot-analysis.md`](./rules/heap-snapshot-analysis.md) (also points to [`scripts/heap-summary.mjs`](./scripts/heap-summary.mjs) and [`scripts/heap-diff.mjs`](./scripts/heap-diff.mjs))                                |
| 3     | [`rules/optimization-playbook.md`](./rules/optimization-playbook.md), [`references/react-optimization-patterns.md`](./references/react-optimization-patterns.md), [`references/chrome-optimization-patterns.md`](./references/chrome-optimization-patterns.md) |
| 4     | [`rules/confidence-loop.md`](./rules/confidence-loop.md)                                                                                                             |
| 5     | [`templates/analysis-report.md`](./templates/analysis-report.md)                                                                                                     |

---

## Confidence-gated iteration

After the first pass at root-cause analysis, invoke the confidence skill in
`analysis` mode:

```text
Skill(skill="confidence", args="analysis")
```

Apply this gate:

| Score        | Action                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------- |
| **≥ 90%**    | Proceed to Phase 5 (optimisation plan).                                                             |
| **70–89%**   | Run one deeper pass: re-read the profile, look at the next-deepest frame, correlate sources.       |
| **< 70%**    | Surface the gap to the user with a question — do **not** propose code changes on speculation.       |

After **two** deep-dive iterations without reaching 90%, stop and present
findings as a hypothesis with the evidence required to confirm it. This is
the `/confidence` iteration protocol applied to performance work — see
[`rules/confidence-loop.md`](./rules/confidence-loop.md).

---

## Core principles

1. **Measure before recommending.** Every fix must be tied to a number from
   the profile. "This component re-renders too much" is not a finding;
   "`<UserList>` rendered 47 times in a 230ms commit, accounting for 38% of
   that commit" is.
2. **Rank by impact, not by ease.** A 5ms fix on a hot path beats a 50ms fix
   on a cold one. Use the profile's own data to estimate ceiling impact.
3. **Root cause over symptom.** A long task is the symptom; the work
   inside it is the cause. Do not stop at "task X took 240ms" — drill into
   the call stack.
4. **Auto-detect, do not interrogate.** Read the file, infer the format,
   state what you found. Ask the user only if detection genuinely fails.
5. **Confidence-gated honesty.** If `/confidence` returns < 90%, dig
   deeper or admit uncertainty. Do not paper over a weak diagnosis with a
   confident-sounding fix.
6. **One profile at a time, but correlate when given two.** A React profile
   plus a matching Chrome trace is far more powerful than either alone.

---

## Anti-patterns (one-liners — full list in
[`rules/optimization-playbook.md`](./rules/optimization-playbook.md))

- Recommending `useMemo`/`useCallback` everywhere without measuring (the
  React Compiler exists, and unmeasured memoisation often regresses).
- Treating a long task in `Function call` as the root cause without
  expanding the call stack.
- Reporting raw event counts without converting to percentage of total
  blocking time or commit duration.
- Skipping the confidence gate because the first hypothesis "looks right".
- Fixing one big bottleneck and ignoring the long tail of repeated small
  ones (death-by-a-thousand-cuts is the common case in real apps).

---

## Memory-profiling quickstart

When the input is a heap snapshot / timeline / profile:

1. **Validate capture.** A single snapshot is only good for a baseline
   analysis — refuse to diagnose a leak from one. Leak diagnosis needs
   ≥ 2 snapshots, ideally 3 (baseline → after-action → after-cleanup).
2. **Run `heap-summary` on the most recent snapshot** for top constructors
   and node-type breakdown:
   ```bash
   node --max-old-space-size=4096 \
     <skill_dir>/scripts/heap-summary.mjs <snapshot.heapsnapshot>
   ```
3. **Run `heap-diff` for the leak case** to find what grew between two
   snapshots:
   ```bash
   node --max-old-space-size=4096 \
     <skill_dir>/scripts/heap-diff.mjs <before.heapsnapshot> <after.heapsnapshot>
   ```
4. **Map suspects to source.** Use [`rules/heap-snapshot-analysis.md`](./rules/heap-snapshot-analysis.md)
   Phases 3–4 to go from constructor name → source file → retainer pattern.

The full methodology (capture protocol, how to interpret the diff, common
leak shapes) is in [`rules/heap-snapshot-analysis.md`](./rules/heap-snapshot-analysis.md).
Don't preload it — only when an input is detected as a heap format.

## Definition of Done

- [ ] Input format detected and stated.
- [ ] Baseline metric and target chosen (Phase 1) — ms for CPU work, MB
      retained for memory work.
- [ ] Top-N hotspots listed with measured cost (ms / MB / %, count).
- [ ] Each hotspot mapped to a file/component/API/constructor with line or
      retainer references where possible.
- [ ] `/confidence analysis` reached ≥ 90% (or two deep-dives recorded
      with the remaining uncertainty surfaced to the user).
- [ ] Optimisation plan written using
      [`templates/analysis-report.md`](./templates/analysis-report.md), with
      ranked fixes, expected ms / MB saved, and a re-profile verification step.
- [ ] User has the next concrete action (apply fix N, re-profile, compare).
